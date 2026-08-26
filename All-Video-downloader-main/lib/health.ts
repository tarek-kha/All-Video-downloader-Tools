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

/** Runs a command with a short timeout; returns stdout on success or null
 * on failure/timeout. Never throws. Callers that only need a boolean use
 * checkCommand(); checkPoProviderAvailable() needs the actual stdout to
 * verify the installed version. */
async function runCommand(cmd: string, args: string[], timeoutMs = 5000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs })
    return stdout
  } catch {
    return null
  }
}

/** Boolean wrapper around runCommand — never includes stdout/stderr/paths
 * in the result, so no command output or filesystem detail can leak. */
export async function checkCommand(cmd: string, args: string[], timeoutMs = 5000): Promise<boolean> {
  return (await runCommand(cmd, args, timeoutMs)) !== null
}

/** Required runtime dependencies — the app cannot correctly extract/convert
 * video without these. Missing any of these should surface as unhealthy. */
export async function checkRequiredDependencies(): Promise<DependencyStatus[]> {
  const checks: Array<[string, () => Promise<boolean>]> = [
    ["yt-dlp", () => checkCommand("yt-dlp", ["--version"])],
    ["ffmpeg", () => checkCommand("ffmpeg", ["-version"])],
    ["ffprobe", () => checkCommand("ffprobe", ["-version"])],
    ["deno", () => checkCommand("deno", ["--version"])],
  ]
  return Promise.all(checks.map(async ([name, fn]) => ({ name, ok: await fn() })))
}

// Optional YouTube PO-token provider (see lib/extract.ts / Dockerfile).
// Configurable via env vars so this isn't hardcoded to one Docker layout.
// PO_PROVIDER_VERSION is set by the Dockerfile (ENV, derived from the same
// ARG used for the git clone tag AND the pip version pin) so the installed
// pip package, the cloned/built server script, and this health check all
// agree on one version — never three independently-drifting values.
const PO_VENV_PYTHON = process.env.PO_PROVIDER_PYTHON || "/opt/ytdlp-venv/bin/python3"
const PO_PACKAGE_NAME = process.env.PO_PROVIDER_PACKAGE || "bgutil-ytdlp-pot-provider"
const PO_SCRIPT_PATH =
  process.env.PO_PROVIDER_SCRIPT_PATH ||
  path.join(os.homedir(), "bgutil-ytdlp-pot-provider", "server", "build", "main.js")
const PO_EXPECTED_VERSION = process.env.PO_PROVIDER_VERSION || "1.3.2"

/**
 * Best-effort, network-free verification that the optional PO-token
 * provider is actually installed, built, AND at the expected pinned
 * version — NOT a live YouTube check (that would hit YouTube's servers on
 * every health poll, which is exactly the kind of automated traffic this
 * whole feature exists to avoid triggering). All three must hold:
 *  1. the pip plugin package is installed in the yt-dlp venv
 *  2. its reported version matches PO_EXPECTED_VERSION (same pin as the
 *     git-cloned/built server script — a version mismatch between the two
 *     could otherwise cause silent protocol incompatibilities)
 *  3. the compiled provider script exists on disk
 * If any is false, PO is reported unavailable — the app still works fine
 * without it (normal public extraction is unaffected either way).
 */
export async function checkPoProviderAvailable(): Promise<boolean> {
  const pipOutput = await runCommand(PO_VENV_PYTHON, ["-m", "pip", "show", PO_PACKAGE_NAME], 5000)
  const scriptBuilt = existsSync(PO_SCRIPT_PATH)
  if (!pipOutput || !scriptBuilt) return false
  const versionMatch = /^Version:\s*(\S+)/m.exec(pipOutput)
  return versionMatch?.[1] === PO_EXPECTED_VERSION
}
