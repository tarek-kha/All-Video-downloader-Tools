import { randomUUID } from "crypto"
import { promises as fs } from "fs"
import os from "os"
import path from "path"

/**
 * Short-lived server-side cache for a resolved (probed) video, keyed by a
 * resolveId handed back to the client. This is what actually lets
 * /api/download SKIP a second full yt-dlp extraction: the raw probe JSON is
 * written to a temp file and handed to yt-dlp via `--load-info-json` at
 * download time, instead of re-resolving the URL from scratch.
 *
 * Bound to the visitor's session — a resolveId cannot be reused by a
 * different session, which matters when the resolve used that session's
 * saved cookies (prevents one session's cookie-authenticated resolve
 * being replayed by another).
 *
 * Single-instance in-memory cache — fine for Render's one free instance;
 * a multi-instance deployment would need a shared store (e.g. Redis)
 * instead, since this Map doesn't sync across processes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ResolveEntry {
  url: string
  cookiesPath: string | null
  sessionId: string | null
  infoJsonPath: string
  createdAt: number
  expiresAt: number
}

const cache = new Map<string, ResolveEntry>()
const TTL_MS = 5 * 60 * 1000 // 5 minutes — within the audit's suggested 2-10 min window
const TMP_DIR = path.join(os.tmpdir(), "vdl-resolve-cache")

export async function putResolve(
  url: string,
  cookiesPath: string | null,
  sessionId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry: Record<string, any>
): Promise<string> {
  const id = randomUUID()
  await fs.mkdir(TMP_DIR, { recursive: true })
  const infoJsonPath = path.join(TMP_DIR, `${id}.json`)
  await fs.writeFile(infoJsonPath, JSON.stringify(entry))
  const now = Date.now()
  cache.set(id, { url, cookiesPath, sessionId, infoJsonPath, createdAt: now, expiresAt: now + TTL_MS })
  return id
}

/** Returns the cached entry only if it exists, hasn't expired, AND belongs
 * to the requesting session (or was resolved with no cookies at all, in
 * which case there's nothing session-sensitive to protect). */
export function getResolve(id: string, requestingSessionId: string | undefined): ResolveEntry | null {
  const hit = cache.get(id)
  if (!hit) return null
  if (hit.expiresAt < Date.now()) {
    cache.delete(id)
    fs.rm(hit.infoJsonPath, { force: true }).catch(() => {})
    return null
  }
  // If the resolve used a specific session's cookies, only that same
  // session may reuse it.
  if (hit.cookiesPath && hit.sessionId && hit.sessionId !== requestingSessionId) {
    return null
  }
  return hit
}

setInterval(() => {
  const now = Date.now()
  for (const [id, e] of cache) {
    if (e.expiresAt < now) {
      cache.delete(id)
      fs.rm(e.infoJsonPath, { force: true }).catch(() => {})
    }
  }
}, 60_000).unref?.()
