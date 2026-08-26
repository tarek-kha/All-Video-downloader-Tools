import { describe, it, expect, vi, beforeEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { promisify } from "util"

// Controls which commands the mocked child_process.execFile "succeeds" for,
// and what stdout they return. Any command not explicitly set to fail is
// treated as succeeding; default stdout is a "pip show"-style response
// reporting version 1.3.2 (matches lib/health.ts's default expected pin),
// so tests only need to override what they specifically care about.
let shouldFail: Record<string, boolean> = {}
let stdoutFor: Record<string, string> = {}

vi.mock("child_process", () => {
  function execFile(
    cmd: string,
    _args: string[],
    optsOrCb: unknown,
    maybeCb?: (err: Error | null, stdout: string, stderr: string) => void
  ) {
    const callback = (typeof optsOrCb === "function" ? optsOrCb : maybeCb) as (
      err: Error | null,
      stdout: string,
      stderr: string
    ) => void
    if (shouldFail[cmd]) {
      callback(new Error(`${cmd}: command not found`), "", "")
    } else {
      callback(null, stdoutFor[cmd] ?? "Name: bgutil-ytdlp-pot-provider\nVersion: 1.3.2\n", "")
    }
  }
  // Node's real child_process.execFile provides a custom util.promisify
  // implementation that resolves { stdout, stderr } instead of just the
  // first callback value — our mock must replicate that, or
  // lib/health.ts's `promisify(execFile)` resolves to a bare string and
  // `const { stdout } = ...` silently destructures undefined.
  ;(execFile as unknown as Record<symbol, unknown>)[promisify.custom] = (
    cmd: string,
    args: string[]
  ) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    })
  return { execFile }
})

beforeEach(() => {
  shouldFail = {}
  stdoutFor = {}
  vi.resetModules()
})

describe("checkRequiredDependencies", () => {
  it("reports every dependency ok when all commands succeed", async () => {
    const { checkRequiredDependencies } = await import("../lib/health")
    const result = await checkRequiredDependencies()
    expect(result.map((d) => d.name).sort()).toEqual(["deno", "ffmpeg", "ffprobe", "yt-dlp"].sort())
    expect(result.every((d) => d.ok)).toBe(true)
  })

  it("flags only the specific dependency that fails", async () => {
    shouldFail.deno = true
    const { checkRequiredDependencies } = await import("../lib/health")
    const result = await checkRequiredDependencies()
    const deno = result.find((d) => d.name === "deno")
    const others = result.filter((d) => d.name !== "deno")
    expect(deno?.ok).toBe(false)
    expect(others.every((d) => d.ok)).toBe(true)
  })

  it("never throws even if a binary is completely missing", async () => {
    shouldFail["yt-dlp"] = true
    shouldFail.ffmpeg = true
    shouldFail.ffprobe = true
    shouldFail.deno = true
    const { checkRequiredDependencies } = await import("../lib/health")
    const result = await checkRequiredDependencies()
    expect(result.every((d) => !d.ok)).toBe(true)
  })
})

describe("checkPoProviderAvailable", () => {
  it("returns false when the compiled script is missing, even if the pip check succeeds", async () => {
    process.env.PO_PROVIDER_SCRIPT_PATH = "/definitely/does/not/exist/main.js"
    const { checkPoProviderAvailable } = await import("../lib/health")
    expect(await checkPoProviderAvailable()).toBe(false)
    delete process.env.PO_PROVIDER_SCRIPT_PATH
  })

  it("returns false when the pip package check fails, even if the script file exists", async () => {
    const tmpFile = path.join(os.tmpdir(), `po-script-${Date.now()}.js`)
    await fs.writeFile(tmpFile, "// stub")
    process.env.PO_PROVIDER_SCRIPT_PATH = tmpFile
    shouldFail["/opt/ytdlp-venv/bin/python3"] = true
    const { checkPoProviderAvailable } = await import("../lib/health")
    expect(await checkPoProviderAvailable()).toBe(false)
    delete process.env.PO_PROVIDER_SCRIPT_PATH
    await fs.rm(tmpFile, { force: true })
  })

  it("returns true only when the pip package, matching version, AND the compiled script are all present", async () => {
    const tmpFile = path.join(os.tmpdir(), `po-script-ok-${Date.now()}.js`)
    await fs.writeFile(tmpFile, "// stub")
    process.env.PO_PROVIDER_SCRIPT_PATH = tmpFile
    // Default mock stdout already reports "Version: 1.3.2", matching the
    // default PO_EXPECTED_VERSION in lib/health.ts.
    const { checkPoProviderAvailable } = await import("../lib/health")
    expect(await checkPoProviderAvailable()).toBe(true)
    delete process.env.PO_PROVIDER_SCRIPT_PATH
    await fs.rm(tmpFile, { force: true })
  })

  it("returns false when the installed pip version does NOT match the pinned/expected version", async () => {
    const tmpFile = path.join(os.tmpdir(), `po-script-mismatch-${Date.now()}.js`)
    await fs.writeFile(tmpFile, "// stub")
    process.env.PO_PROVIDER_SCRIPT_PATH = tmpFile
    stdoutFor["/opt/ytdlp-venv/bin/python3"] = "Name: bgutil-ytdlp-pot-provider\nVersion: 0.9.0\n"
    const { checkPoProviderAvailable } = await import("../lib/health")
    expect(await checkPoProviderAvailable()).toBe(false)
    delete process.env.PO_PROVIDER_SCRIPT_PATH
    await fs.rm(tmpFile, { force: true })
  })

  it("respects PO_PROVIDER_VERSION overrides for both the expectation and a matching install", async () => {
    const tmpFile = path.join(os.tmpdir(), `po-script-custom-${Date.now()}.js`)
    await fs.writeFile(tmpFile, "// stub")
    process.env.PO_PROVIDER_SCRIPT_PATH = tmpFile
    process.env.PO_PROVIDER_VERSION = "2.0.0"
    stdoutFor["/opt/ytdlp-venv/bin/python3"] = "Name: bgutil-ytdlp-pot-provider\nVersion: 2.0.0\n"
    const { checkPoProviderAvailable } = await import("../lib/health")
    expect(await checkPoProviderAvailable()).toBe(true)
    delete process.env.PO_PROVIDER_SCRIPT_PATH
    delete process.env.PO_PROVIDER_VERSION
    await fs.rm(tmpFile, { force: true })
  })
})
