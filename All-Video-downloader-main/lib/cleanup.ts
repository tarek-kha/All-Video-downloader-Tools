import { promises as fs } from "fs"
import path from "path"
import { DOWNLOAD_ROOT, PROJECT_ROOT } from "./ytdlp"

/**
 * Automatic cleanup worker (Phase 4). Removes:
 *  - completed/prepared download directories older than DOWNLOAD_TTL_MS
 *  - per-platform session cookie files inactive longer than SESSION_TTL_MS
 * Resolve-cache entries and their temp info.json files already self-clean
 * on their own TTL (see lib/resolve-cache.ts) and are not duplicated here.
 * Failed jobs already clean up immediately on error (see lib/extract.ts),
 * so there's nothing extra to sweep for those.
 */

const DOWNLOAD_TTL_MS = 45 * 60 * 1000 // 45 minutes — long enough for a slow download to finish and be picked up
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days of inactivity, per the audit's privacy-oriented recommendation
const SWEEP_INTERVAL_MS = 10 * 60 * 1000 // every 10 minutes

let started = false

async function sweepDownloads(): Promise<{ removed: number }> {
  let removed = 0
  let entries: string[] = []
  try {
    entries = await fs.readdir(DOWNLOAD_ROOT)
  } catch {
    return { removed }
  }
  const now = Date.now()
  for (const id of entries) {
    const dir = path.join(DOWNLOAD_ROOT, id)
    try {
      const st = await fs.stat(dir)
      if (!st.isDirectory()) continue
      if (now - st.mtimeMs > DOWNLOAD_TTL_MS) {
        await fs.rm(dir, { recursive: true, force: true })
        removed++
      }
    } catch {
      // already gone or unreadable — ignore
    }
  }
  return { removed }
}

async function sweepSessions(): Promise<{ removed: number }> {
  let removed = 0
  const sessionsRoot = path.join(PROJECT_ROOT, ".data", "sessions")
  let sessionIds: string[] = []
  try {
    sessionIds = await fs.readdir(sessionsRoot)
  } catch {
    return { removed }
  }
  const now = Date.now()
  for (const sessionId of sessionIds) {
    const sessionDir = path.join(sessionsRoot, sessionId)
    try {
      const files = await fs.readdir(sessionDir)
      if (!files.length) {
        await fs.rmdir(sessionDir).catch(() => {})
        continue
      }
      let newestMtime = 0
      for (const f of files) {
        const st = await fs.stat(path.join(sessionDir, f)).catch(() => null)
        if (st && st.mtimeMs > newestMtime) newestMtime = st.mtimeMs
      }
      if (now - newestMtime > SESSION_TTL_MS) {
        await fs.rm(sessionDir, { recursive: true, force: true })
        removed++
      }
    } catch {
      // already gone or unreadable — ignore
    }
  }
  return { removed }
}

export async function runCleanupOnce(): Promise<{ downloadsRemoved: number; sessionsRemoved: number }> {
  const [d, s] = await Promise.all([sweepDownloads(), sweepSessions()])
  return { downloadsRemoved: d.removed, sessionsRemoved: s.removed }
}

/** Starts the periodic background sweep. Safe to call multiple times —
 * only the first call actually schedules the interval. */
export function startCleanupScheduler(): void {
  if (started) return
  started = true
  const tick = () => {
    runCleanupOnce().catch((err) => {
      // Never let a cleanup failure crash the process — log and continue.
      console.error("[cleanup] sweep failed:", err instanceof Error ? err.message : String(err))
    })
  }
  // Run once shortly after boot, then on a fixed interval.
  setTimeout(tick, 30_000).unref?.()
  setInterval(tick, SWEEP_INTERVAL_MS).unref?.()
}

export const __testing = { DOWNLOAD_TTL_MS, SESSION_TTL_MS, sweepDownloads, sweepSessions }
