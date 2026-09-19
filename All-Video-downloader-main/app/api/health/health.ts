import { execFile } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import path from "path"
import os from "os"

const execFileAsync = promisify(execFile)

export interface DependencyStatus {
  name: string
  ok: boolean
}

/** Fast path: check if the binary exists on disk without spawning a process.
 * On Render free (0.1 CPU) spawning Python just to run `--version` takes
 * 5-10 s cold, which exceeds the health-checker's patience. A synchronous
 * fs check is <1 ms and never fails when the binary is actually present. */
function binaryExists(cmd: string): boolean {
  const candidates = [
    `/usr/local/bin/${cmd}`,
    `/usr/bin/${cmd}`,
    `/bin/${cmd}`,
  ]
  for (const p of candidates) {
    if (existsSync(p)) return true
  }
  return false
}

/** Spawning fallback — only used when the fast path misses (e.g. binary
 * installed in an unusual location). Kept short so the health check still
 * returns quickly. */
async function runCommand(cmd: string, args: string[], timeoutMs = 3000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs })
    return stdout
  } catch {
    return null
  }
}

export async function checkCommand(cmd: string, args: string[], timeoutMs = 3000): Promise<boolean> {
  return (await runCommand(cmd, args, timeoutMs)) !== null
}

/** Required runtime dependencies — the app cannot correctly extract/convert
 * video without these. We use the fast disk-existence path first; only if
 * that misses do we fall back to a short process spawn. */
export async function checkRequiredDependencies(): Promise<DependencyStatus[]> {
  const binaries = [
    { name: "yt-dlp", path: "/usr/local/bin/yt-dlp" },
    { name: "ffmpeg", path: "/usr/bin/ffmpeg" },
    { name: "ffprobe", path: "/usr/bin/ffprobe" },
    { name: "deno", path: "/usr/bin/deno" },
  ]

  const fast = binaries.map(({ name, path }) => ({ name, ok: existsSync(path) }))
  const missing = fast.filter((r) => !r.ok)

  if (missing.length === 0) return fast

  // Fallback: the binary might live somewhere else — try a quick spawn
  const slow = await Promise.all(
    missing.map(async ({ name }) => ({
      name,
      ok: await checkCommand(name, ["--version"], name === "yt-dlp" ? 8000 : 3000),
    }))
  )
  const slowMap = new Map(slow.map((s) => [s.name, s.ok]))
  return fast.map((r) => (r.ok ? r : { name: r.name, ok: slowMap.get(r.name) ?? false }))
}

// Optional YouTube PO-token provider (see lib/extract.ts / Dockerfile).
const PO_VENV_PYTHON = process.env.PO_PROVIDER_PYTHON || "/opt/ytdlp-venv/bin/python3"
const PO_PACKAGE_NAME = process.env.PO_PROVIDER_PACKAGE || "bgutil-ytdlp-pot-provider"
const PO_SCRIPT_PATH =
  process.env.PO_PROVIDER_SCRIPT_PATH ||
  path.join(os.homedir(), "bgutil-ytdlp-pot-provider", "server", "build", "main.js")
const PO_EXPECTED_VERSION = process.env.PO_PROVIDER_VERSION || "2.0.0"

/**
 * Best-effort verification that the optional PO-token provider is installed.
 * Fast path: just check the compiled script exists on disk (<1 ms).
 * Slow path: verify pip package version (only if script exists — keeps the
 * common "not installed" case instant). */
export async function checkPoProviderAvailable(): Promise<boolean> {
  const scriptBuilt = existsSync(PO_SCRIPT_PATH)
  if (!scriptBuilt) return false

  const pipOutput = await runCommand(
    PO_VENV_PYTHON,
    ["-m", "pip", "show", PO_PACKAGE_NAME],
    5000
  )
  if (!pipOutput) return false
  const versionMatch = /^Version:\s*(\S+)/m.exec(pipOutput)
  return versionMatch?.[1] === PO_EXPECTED_VERSION
}
