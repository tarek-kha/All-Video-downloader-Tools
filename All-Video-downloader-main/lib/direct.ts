import { execFileAsync, cookieArgs, proxyArgs, hasProxy, QUALITY_MAP } from "./ytdlp"

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export interface DirectUrlResult {
  directUrl: string
  method: string
  ext: string
}

/**
 * Try to get a direct CDN URL for the video so the browser can download
 * straight from the platform — bypassing Render entirely and saving bandwidth.
 *
 * Returns null when:
 * - the format requires server-side merging (separate video+audio tracks)
 * - the platform doesn't expose a single direct file
 * - all fallback attempts fail
 */
export async function getDirectUrl(
  url: string,
  quality: string,
  cookiesPath: string | null
): Promise<DirectUrlResult | null> {
  const spec = QUALITY_MAP[quality]
  if (!spec) return null

  // Audio extraction (-x --audio-format mp3) needs FFmpeg → skip direct
  const isAudioExtract = spec.args.includes("-x")

  // Build args: -g = print direct URL only, no download
  const base = [
    "--no-playlist",
    "--no-warnings",
    "--user-agent",
    BROWSER_UA,
    "-g",
  ]

  // For audio extraction, we can't return MP3 directly (needs FFmpeg),
  // but we CAN return the raw best-audio stream (m4a/webm).
  // For video, use the quality selector as-is; if yt-dlp returns multiple
  // lines (separate v+a) we reject it below.
  const formatArgs = isAudioExtract
    ? ["-f", "ba/b", "-g"]
    : [...spec.args, "-g"]

  const attempts: Array<{ method: string; extra: string[]; timeout: number }> = [
    { method: "direct", extra: [], timeout: 30_000 },
  ]

  if (hasProxy()) {
    attempts.push({ method: "proxy", extra: proxyArgs(), timeout: 45_000 })
  }

  if (cookiesPath) {
    attempts.push({
      method: "cookie",
      extra: cookieArgs(cookiesPath),
      timeout: 45_000,
    })
  }

  for (const attempt of attempts) {
    try {
      const args = [...base, ...attempt.extra, ...formatArgs, url]
      const { stdout } = await execFileAsync("yt-dlp", args, {
        maxBuffer: 2 * 1024 * 1024,
        timeout: attempt.timeout,
      })

      // -g can output multiple lines for separate video+audio tracks.
      // We ONLY accept exactly one http(s) line → a single merged file.
      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("http"))

      if (lines.length === 1) {
        const directUrl = lines[0]
        // Guess extension from URL path
        const extMatch = directUrl.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/)
        const ext = extMatch
          ? extMatch[1].toLowerCase()
          : isAudioExtract
            ? "m4a"
            : "mp4"
        return { directUrl, method: attempt.method, ext }
      }

      // Multiple lines = needs server-side merge → abort direct-link path
      if (lines.length > 1) return null
    } catch {
      // continue to next fallback
    }
  }

  return null
}
