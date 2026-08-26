import { NextRequest, NextResponse } from "next/server"
import { isValidUrl, detectPlatform, platformKey, QUALITY_MAP } from "@/lib/ytdlp"
import { probeWithFallbacks, classifyFailure } from "@/lib/extract"
import { cookiesPathForPlatform, SESSION_COOKIE } from "@/lib/session"
import { isSafeToFetch } from "@/lib/security/safe-url"
import { checkRateLimit, clientKey, extractGuard } from "@/lib/security/rate-limit"
import { putResolve } from "@/lib/resolve-cache"
import { VideoInfo } from "@/types"

export const maxDuration = 120

export async function POST(request: NextRequest) {
  if (!checkRateLimit(`info:${clientKey(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests — please slow down and try again in a minute." }, { status: 429 })
  }

  let url = ""
  try {
    const body = await request.json()
    url = String(body?.url ?? "").trim()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!isValidUrl(url)) {
    return NextResponse.json({ error: "Please enter a valid http(s) URL" }, { status: 400 })
  }
  const safety = await isSafeToFetch(url)
  if (!safety.ok) {
    return NextResponse.json({ error: "This URL points to a private/internal address and cannot be fetched." }, { status: 400 })
  }

  if (!extractGuard.tryAcquire()) {
    return NextResponse.json(
      { error: "The server is busy handling other requests right now — please try again in a few seconds." },
      { status: 503 }
    )
  }

  const sessionId = request.cookies.get(SESSION_COOKIE)?.value ?? null
  const cookiesPath = sessionId ? cookiesPathForPlatform(sessionId, platformKey(url)) : null

  try {
    const entry = await probeWithFallbacks(url, cookiesPath)
    if (!entry) throw new Error("No video found at this URL")

    // Determine the max available height to filter resolution options
    const heights: number[] = Array.isArray(entry.formats)
      ? entry.formats
          .map((f: { height?: number | null }) => f.height ?? 0)
          .filter((h: number) => h > 0)
      : []
    const maxHeight = heights.length ? Math.max(...heights) : 0

    const formats = Object.entries(QUALITY_MAP)
      .filter(([key]) => {
        if (key === "best" || key === "audio") return true
        if (maxHeight === 0) return true // unknown — offer everything
        return parseInt(key) <= maxHeight
      })
      .map(([value, v]) => ({ value, label: v.label }))

    // Cache the resolved probe (including the raw entry, written to a temp
    // info.json) so /api/download can skip re-extracting via
    // --load-info-json instead of re-deriving everything from the URL.
    const resolveId = await putResolve(url, cookiesPath, sessionId, entry)

    const info: VideoInfo = {
      id: entry.id ?? crypto.randomUUID(),
      title: entry.title ?? "Untitled video",
      thumbnail: entry.thumbnail ?? null,
      duration: typeof entry.duration === "number" ? entry.duration : null,
      uploader: entry.uploader ?? entry.channel ?? null,
      platform: detectPlatform(url),
      webpageUrl: entry.webpage_url ?? url,
      formats,
      resolveId,
    }
    return NextResponse.json(info)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch video info"
    const failure = classifyFailure(msg)
    return NextResponse.json(
      { error: failure.message, category: failure.category, detail: failure.detail },
      { status: 422 }
    )
  } finally {
    extractGuard.release()
  }
}
