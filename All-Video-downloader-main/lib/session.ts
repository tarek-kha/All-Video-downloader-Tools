import { randomUUID } from "crypto"
import path from "path"
import { PROJECT_ROOT, PlatformKey } from "./ytdlp"

export const SESSION_COOKIE = "vdl_session"

export function getOrCreateSessionId(cookieValue: string | undefined): {
  sessionId: string
  isNew: boolean
} {
  if (cookieValue && /^[0-9a-f-]{36}$/i.test(cookieValue)) {
    return { sessionId: cookieValue, isNew: false }
  }
  return { sessionId: randomUUID(), isNew: true }
}

/** @deprecated kept only so older imports don't break — use cookiesPathForPlatform */
export function cookiesPathForSession(sessionId: string): string {
  return path.join(PROJECT_ROOT, ".data", "sessions", sessionId, "cookies.txt")
}

/** One cookie file per visitor session AND per platform — a YouTube login
 * never gets sent to TikTok, an Instagram session never leaks to X, etc. */
export function cookiesPathForPlatform(sessionId: string, platform: PlatformKey | string): string {
  const safe = String(platform).replace(/[^a-z0-9_-]/gi, "_").toLowerCase()
  return path.join(PROJECT_ROOT, ".data", "sessions", sessionId, `cookies-${safe}.txt`)
}
