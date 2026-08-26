import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { isValidUrl, platformKey, QUALITY_MAP, DOWNLOAD_ROOT } from "@/lib/ytdlp"
import { downloadWithFallbacks, classifyFailure, ExtractionFailure } from "@/lib/extract"
import { cookiesPathForPlatform, SESSION_COOKIE } from "@/lib/session"
import { isSafeToFetch } from "@/lib/security/safe-url"
import { checkRateLimit, clientKey, downloadGuard } from "@/lib/security/rate-limit"
import { getResolve } from "@/lib/resolve-cache"
import { DownloadResult } from "@/types"

// Large (up to 5GB) downloads need real time on a slow connection —
// give the route generous headroom above the internal extraction deadline.
export const maxDuration = 1800

function normalizeUrlForMatch(input: string): string {
  try {
    const u = new URL(input)
    u.hash = ""
    return u.toString()
  } catch {
    return input.trim()
  }
}

export async function POST(request: NextRequest) {
  if (!checkRateLimit(`download:${clientKey(request)}`, 8, 60_000)) {
    return NextResponse.json({ error: "Too many download requests — please slow down and try again in a minute." }, { status: 429 })
  }

  const sessionId = request.cookies.get(SESSION_COOKIE)?.value
  let url = ""
  let quality = "best"
  let resolveId = ""
  try {
    const body = await request.json()
    url = String(body?.url ?? "").trim()
    quality = String(body?.quality ?? "best")
    resolveId = String(body?.resolveId ?? "")
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  // Prefer reusing an already-resolved probe (Phase 2). getResolve() only
  // returns a hit if it hasn't expired AND — when the resolve used cookies —
  // it belongs to this same session (prevents one session's cookie-backed
  // resolve being replayed by another). infoJsonPath lets the download
  // skip a second full extraction via yt-dlp's --load-info-json.
  const requestedUrl = url
  let cookiesPath: string | null = null
  let infoJsonPath: string | null = null
  const cached = resolveId ? getResolve(resolveId, sessionId) : null
  if (cached) {
    if (requestedUrl && normalizeUrlForMatch(requestedUrl) !== normalizeUrlForMatch(cached.url)) {
      return NextResponse.json(
        { error: "This saved download session does not match the provided URL. Please fetch video info again." },
        { status: 409 }
      )
    }
    url = cached.url
    cookiesPath = cached.cookiesPath
    infoJsonPath = cached.infoJsonPath
  }

  if (!isValidUrl(url)) {
    return NextResponse.json({ error: "Please enter a valid http(s) URL" }, { status: 400 })
  }
  const safety = await isSafeToFetch(url)
  if (!safety.ok) {
    return NextResponse.json({ error: "This URL points to a private/internal address and cannot be fetched." }, { status: 400 })
  }

  if (!downloadGuard.tryAcquire()) {
    return NextResponse.json(
      { error: "The server is already processing the maximum number of downloads — please try again shortly." },
      { status: 503 }
    )
  }

  const q = QUALITY_MAP[quality] ?? QUALITY_MAP.best
  if (!cached && sessionId) {
    cookiesPath = cookiesPathForPlatform(sessionId, platformKey(url))
  }

  const fileId = crypto.randomUUID()
  const dir = path.join(DOWNLOAD_ROOT, fileId)
  await fs.mkdir(dir, { recursive: true })

  try {
    // cached-info-json (skips re-extraction) -> native no-cookie -> cookie
    // -> impersonation -> generic -> page scan. Output is deep-validated
    // (signature + ffprobe); fakes are auto-deleted. Capped at MAX_FILESIZE.
    const out = await downloadWithFallbacks({ url, dir, formatArgs: q.args, cookiesPath, infoJsonPath })
    const result: DownloadResult = { fileId, filename: out.filename, sizeBytes: out.sizeBytes }
    return NextResponse.json({ ...result, method: out.method, durationSec: out.durationSec })
  } catch (err: unknown) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    const failure: ExtractionFailure =
      err instanceof Error && "failure" in err
        ? (err as Error & { failure: ExtractionFailure }).failure
        : classifyFailure(err instanceof Error ? err.message : "Download failed", "download")
    return NextResponse.json(
      { error: failure.message, category: failure.category, detail: failure.detail },
      { status: 422 }
    )
  } finally {
    downloadGuard.release()
  }
}
