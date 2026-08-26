import path from "path"
import { promises as fs } from "fs"
import { execFileAsync, cookieArgs, MAX_FILESIZE } from "./ytdlp"
import { validateMediaFile } from "./validate"
import { safeFetch, readLimited, UnsafeUrlError } from "./security/safe-fetch"

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export type FailureCategory =
  | "INVALID_URL"
  | "BLOCKED_URL"
  | "UNSUPPORTED_URL"
  | "VIDEO_UNAVAILABLE"
  | "PRIVATE_CONTENT"
  | "LOGIN_REQUIRED"
  | "PO_TOKEN_REQUIRED"
  | "AGE_RESTRICTED"
  | "GEO_RESTRICTED"
  | "DRM"
  | "ANTI_BOT"
  | "RATE_LIMITED"
  | "NO_FORMAT"
  | "FILE_TOO_LARGE"
  | "RESOLVE_TIMEOUT"
  | "DOWNLOAD_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "VALIDATION_FAILED"
  | "SERVER_BUSY"
  | "INTERNAL_ERROR"

export interface ExtractionFailure {
  category: FailureCategory
  message: string
  detail: string
}

const CATEGORY_MESSAGES: Record<FailureCategory, string> = {
  INVALID_URL: "The provided URL is invalid.",
  BLOCKED_URL: "This URL points to a private/internal address and cannot be fetched.",
  UNSUPPORTED_URL: "This URL is not supported by the extractor.",
  VIDEO_UNAVAILABLE: "This video appears to be unavailable, deleted, or no longer accessible.",
  PRIVATE_CONTENT: "This video is private and cannot be downloaded without access.",
  LOGIN_REQUIRED:
    "This video requires login. Add valid cookies for this platform and try again.",
  PO_TOKEN_REQUIRED:
    "This platform requires a server-side proof-of-origin (PO) token — this is not a login problem and cookies will not help. The PO-token provider must be configured on the server.",
  AGE_RESTRICTED: "This content is age-restricted and requires an authenticated account.",
  GEO_RESTRICTED:
    "This video is geo-restricted by its uploader/platform and isn't available from the server's region — this is unrelated to cookies or login.",
  DRM: "This video is DRM-protected (encrypted). Downloading it is not technically possible.",
  ANTI_BOT:
    "The site is blocking automated access (anti-bot / CAPTCHA / datacenter IP block). Cookies are unlikely to fix this.",
  RATE_LIMITED: "The upstream platform rate-limited this request. Please wait and try again.",
  NO_FORMAT: "The selected format/quality is not available for this video.",
  FILE_TOO_LARGE: `This file is larger than the ${MAX_FILESIZE} limit — try a lower quality.`,
  RESOLVE_TIMEOUT: "Resolving video metadata timed out. Please retry.",
  DOWNLOAD_TIMEOUT: "Downloading the media timed out. Try a lower quality and retry.",
  UPSTREAM_ERROR: "The upstream platform returned an unexpected server error.",
  VALIDATION_FAILED: "Downloaded output failed media validation.",
  SERVER_BUSY: "The download server is busy. Please try again shortly.",
  INTERNAL_ERROR: "Request failed due to an internal server error.",
}

/**
 * IMPORTANT: `rawMsg` for a failed yt-dlp attempt is Node's
 * "Command failed: yt-dlp <full args...>\n<actual stderr>" — the full
 * command line (including our own --max-filesize / --cookies flags) is
 * echoed back verbatim. Any classifier regex must only match yt-dlp's own
 * runtime error text, never a flag name that we ourselves passed on the
 * command line, or every failure gets mis-labeled as that category
 * (e.g. "--max-filesize 5G" in the echoed command falsely matching a bare
 * "max-filesize" check even when the real error was something unrelated,
 * such as "Requested format is not available").
 */
function runtimeErrorText(rawMsg: string): string {
  const errorMarker = rawMsg.search(/\bERROR:\s/i)
  const base = errorMarker >= 0 ? rawMsg.slice(errorMarker) : rawMsg
  return base
    .replace(/(?:^|\n)\s*(?:Error:\s*)?Command failed:[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function compactDetail(raw: string): string {
  return runtimeErrorText(raw).slice(0, 240)
}

export function classifyFailure(rawMsg: string, phase: "resolve" | "download" = "download"): ExtractionFailure {
  const m = runtimeErrorText(rawMsg).toLowerCase()
  let category: FailureCategory = "INTERNAL_ERROR"
  if (/invalid url|only http\(s\)|malformed url/.test(m)) category = "INVALID_URL"
  else if (/blocked unsafe url|private\/internal/.test(m)) category = "BLOCKED_URL"
  else if (/server is busy|maximum number of downloads/.test(m)) category = "SERVER_BUSY"
  else if (/drm|widevine|fairplay|playready|encrypted media|license url/.test(m)) category = "DRM"
  else if (/not available in your (country|region)|geo.?restrict|geoblock|geo.?block/.test(m)) category = "GEO_RESTRICTED"
  else if (/confirm your age|age.?restrict|age.?verification/.test(m)) category = "AGE_RESTRICTED"
  else if (/private video|private content/.test(m)) category = "PRIVATE_CONTENT"
  // PO-token: server-side proof-of-origin requirement — NOT a login/cookie issue.
  // Must be checked before the generic login check so it gets the accurate message.
  else if (/\bpo.?token\b/.test(m)) category = "PO_TOKEN_REQUIRED"
  // Genuine login / session / age gating that cookies can actually fix.
  else if (/sign in|log ?in required|login required|authentication required/.test(m))
    category = "LOGIN_REQUIRED"
  // cookies-from-browser error means yt-dlp tried to read a browser cookie store
  // but the server has no browser — this is a server config issue, not a user
  // login problem.  Route to ANTI_BOT so the user isn't told to "add cookies".
  else if (/cookies-from-browser/.test(m)) category = "ANTI_BOT"
  else if (/too many requests|rate.?limit|429/.test(m)) category = "RATE_LIMITED"
  else if (/captcha|cloudflare|access denied|forbidden|challenge|bot|datacenter/.test(m)) category = "ANTI_BOT"
  else if (/requested format is not available|no video formats|no suitable format/.test(m)) category = "NO_FORMAT"
  else if (/file is larger than max-filesize/.test(m)) category = "FILE_TOO_LARGE"
  else if (/unsupported url/.test(m)) category = "UNSUPPORTED_URL"
  else if (/rejected fake media|ffprobe could not parse|not media:|no audio or video streams/.test(m))
    category = "VALIDATION_FAILED"
  else if (/video unavailable|deleted|removed|no longer available|does not exist|404|not found/.test(m))
    category = "VIDEO_UNAVAILABLE"
  else if (/http error 5\d\d|upstream 5\d\d|service unavailable|bad gateway/.test(m)) category = "UPSTREAM_ERROR"
  else if (/timed out|etimedout|timeout/.test(m)) category = phase === "resolve" ? "RESOLVE_TIMEOUT" : "DOWNLOAD_TIMEOUT"

  return { category, message: CATEGORY_MESSAGES[category], detail: compactDetail(rawMsg) }
}

// ---------------------------------------------------------------------------
// Impersonation support (curl_cffi) — detected once per process
// ---------------------------------------------------------------------------

let impersonateAvailable: boolean | null = null
async function canImpersonate(): Promise<boolean> {
  if (impersonateAvailable !== null) return impersonateAvailable
  try {
    const { stdout } = await execFileAsync("yt-dlp", ["--list-impersonate-targets"], {
      timeout: 20_000,
    })
    impersonateAvailable = /chrome/i.test(stdout) && !/chrome.*unavailable/i.test(stdout)
  } catch {
    impersonateAvailable = false
  }
  return impersonateAvailable
}

// ---------------------------------------------------------------------------
// Page scanning: direct MP4/WebM, HLS, DASH, <video>/<source>, og:video,
// JSON-LD contentUrl, and embedded iframes (one level deep)
// ---------------------------------------------------------------------------

export interface MediaCandidate {
  url: string
  referer: string
  kind: "direct" | "hls" | "dash" | "embed"
}

// Known player hosts we can hand straight back to yt-dlp's native extractors.
const EMBED_HOST_RE =
  /(?:youtube\.com\/(?:embed|watch|shorts)|youtu\.be\/|player\.vimeo\.com\/video|vimeo\.com\/\d|dailymotion\.com\/(?:embed\/)?video|player\.twitch\.tv|streamable\.com|wistia\.(?:com|net)|brightcove\.net|jwplatform\.com|kaltura\.com|facebook\.com\/plugins\/video|rumble\.com\/embed|bitchute\.com\/embed|odysee\.com\/\$\/embed)/i

function detectEmbeds(html: string, baseUrl: string): MediaCandidate[] {
  const out: MediaCandidate[] = []
  const push = (raw: string) => {
    try {
      const abs = new URL(raw, baseUrl).toString()
      if (EMBED_HOST_RE.test(abs)) out.push({ url: abs, referer: baseUrl, kind: "embed" })
    } catch {
      /* ignore */
    }
  }
  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) push(m[1])
  for (const m of html.matchAll(/["'](?:embedUrl|embed_url|player_url)["']\s*:\s*["']([^"']+)["']/gi))
    push(m[1])
  // Bare youtube.com/embed/ID or youtu.be/ID references anywhere in scripts
  for (const m of html.matchAll(
    /https?:\/\/(?:www\.)?(?:youtube\.com\/embed\/[\w-]{6,}|youtu\.be\/[\w-]{6,}|player\.vimeo\.com\/video\/\d+|dailymotion\.com\/embed\/video\/\w+)/gi
  ))
    push(m[0])
  // Dedupe
  const seen = new Set<string>()
  return out.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true))).slice(0, 4)
}

const MEDIA_URL_RE =
  /https?:\/\/[^"'\s\\<>]+?\.(?:mp4|webm|mov|m4v|mkv|m3u8|mpd)(?:\?[^"'\s\\<>]*)?/gi
const JUNK_RE =
  /thumb|sprite|preview|poster|logo|banner|advert|\/ads?[\/._-]|pixel|tracker|analytics|\.svg|blank|placeholder|trailer_sm|_fb\.mp4|apk_new|\/apk[\/._-]|app.?install|app.?download|promo_?video|splash/i

function kindOf(u: string): MediaCandidate["kind"] {
  if (/\.m3u8(\?|$)|\/hls[\/?]/i.test(u)) return "hls"
  if (/\.mpd(\?|$)|\/dash[\/?]/i.test(u)) return "dash"
  return "direct"
}

function unescapeHtml(s: string): string {
  return s
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
}

/** SSRF-safe page fetch — validates the URL (and every redirect hop)
 * against the private-IP blocklist before connecting. Returns "" on any
 * failure (including a blocked unsafe URL) so callers degrade gracefully. */
async function fetchPage(url: string, referer?: string): Promise<string> {
  try {
    const res = await safeFetch(url, {
      timeoutMs: 15_000,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(referer ? { Referer: referer } : {}),
      },
    })
    const ct = res.headers.get("content-type") ?? ""
    if (!res.ok || /image|video|audio|octet-stream/.test(ct)) return ""
    const body = await readLimited(res, 2 * 1024 * 1024)
    return unescapeHtml(new TextDecoder().decode(body))
  } catch {
    return ""
  }
}

async function fetchText(url: string, referer?: string): Promise<string> {
  try {
    const res = await safeFetch(url, {
      timeoutMs: 15_000,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "*/*",
        ...(referer ? { Referer: referer } : {}),
      },
    })
    if (!res.ok) return ""
    const ct = res.headers.get("content-type") ?? ""
    // Only parse textual bodies (JSON/text); never pull a media stream here.
    if (/image|video|audio|octet-stream|mpegurl|dash/.test(ct)) return ""
    return new TextDecoder().decode(await readLimited(res, 3 * 1024 * 1024))
  } catch {
    return ""
  }
}

function collectFromHtml(html: string, baseUrl: string): string[] {
  const found = new Set<string>()
  const add = (raw: string | undefined | null) => {
    if (!raw) return
    try {
      const abs = new URL(raw, baseUrl).toString()
      if (/^https?:/.test(abs) && !JUNK_RE.test(abs)) found.add(abs)
    } catch {
      /* ignore bad urls */
    }
  }
  for (const m of html.matchAll(MEDIA_URL_RE)) if (!JUNK_RE.test(m[0])) found.add(m[0])
  // <video src> / <source src>
  for (const m of html.matchAll(/<(?:video|source)[^>]+src=["']([^"']+)["']/gi)) add(m[1])
  // OpenGraph / Twitter video meta
  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:video(?::(?:secure_)?url)?|twitter:player:stream)["'][^>]+content=["']([^"']+)["']/gi
  ))
    add(m[1])
  for (const m of html.matchAll(
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:video(?::(?:secure_)?url)?|twitter:player:stream)["']/gi
  ))
    add(m[1])
  // JSON-LD contentUrl / embedUrl
  for (const m of html.matchAll(/["'](?:contentUrl|contentURL)["']\s*:\s*["']([^"']+)["']/gi)) add(m[1])
  return [...found]
}

const PLAYER_CONFIG_RE =
  /["'](?:videoUrl|video_url|videoSrc|hlsUrl|hls_url|streamUrl|stream_url|manifestUrl|fileUrl|file|src)["']\s*:\s*["'](https?:[^"']{12,})["']/gi

export async function scanPageForMedia(url: string): Promise<MediaCandidate[]> {
  const html = await fetchPage(url)
  if (!html) return []
  // Player JSON configs carry the REAL stream endpoints (often extension-less
  // /media/hls/?s=... URLs) - rank these above raw regex hits, which are
  // frequently related-video preview decoys.
  const priority: MediaCandidate[] = []
  for (const m of html.matchAll(PLAYER_CONFIG_RE)) {
    const u = m[1]
    if (!JUNK_RE.test(u) && !/\.(jpe?g|png|gif|webp|css|js|vtt|srt)(\?|$)/i.test(u))
      priority.push({ url: u, referer: url, kind: kindOf(u) })
  }
  const embeds = detectEmbeds(html, url)
  const direct = collectFromHtml(html, url)
  const candidates: MediaCandidate[] = direct
    .filter((u) => /^https?:\/\/.+\.(?:mp4|webm|mov|m4v|mkv|m3u8|mpd)(?:\?|$)/i.test(u))
    .map((u) => ({ url: u, referer: url, kind: kindOf(u) }))

  // One level of iframe embeds (players hosted on CDN subdomains)
  const iframes = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => {
      try {
        return new URL(m[1], url).toString()
      } catch {
        return ""
      }
    })
    .filter((u) => /^https?:/.test(u) && !JUNK_RE.test(u) && !/facebook|twitter|recaptcha|ads|consent/i.test(u))
    .slice(0, 3)
  for (const frame of iframes) {
    const fhtml = await fetchPage(frame, url)
    if (!fhtml) continue
    for (const u of collectFromHtml(fhtml, frame)) {
      if (/\.(m3u8|mpd|mp4|webm|mov|m4v|mkv)(\?|$)/i.test(u))
        candidates.push({ url: u, referer: frame, kind: kindOf(u) })
    }
  }

  // Second hop: player-config endpoints frequently return JSON that itself
  // holds the real CDN media URL (e.g. tube sites' /media/mp4/?s=... APIs).
  const resolved: MediaCandidate[] = []
  for (const c of priority.slice(0, 4)) {
    const hasExt = /\.(m3u8|mpd|mp4|webm|mov|m4v|mkv)(\?|$)/i.test(c.url)
    if (hasExt) continue
    const body = unescapeHtml(await fetchText(c.url, c.referer))
    if (!body) continue
    for (const m of body.matchAll(MEDIA_URL_RE)) {
      if (!JUNK_RE.test(m[0])) resolved.push({ url: m[0], referer: c.referer, kind: kindOf(m[0]) })
    }
    for (const m of body.matchAll(
      /["'](?:videoUrl|video_url|file|src|url|hls|manifest)["']\s*:\s*["'](https?:[^"']{12,})["']/gi
    )) {
      const u = m[1]
      if (!JUNK_RE.test(u) && /\.(m3u8|mpd|mp4|webm|mov|m4v|mkv)(\?|$)/i.test(u))
        resolved.push({ url: u, referer: c.referer, kind: kindOf(u) })
    }
  }

  // Dedupe + rank: embeds first (native extractor = best A/V), then resolved
  // CDN URLs, then player-config, then raw direct/HLS/DASH hits.
  const seen = new Set<string>()
  const rank = { embed: -1, direct: 0, hls: 1, dash: 2 }
  const rest = candidates.sort((a, b) => rank[a.kind] - rank[b.kind])
  return [...embeds, ...resolved, ...priority, ...rest]
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .slice(0, 10)
}

// ---------------------------------------------------------------------------
// Probe (info) with fallbacks: native → impersonate → generic → page scan
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type YtdlpEntry = Record<string, any>

async function runProbe(args: string[], timeout: number): Promise<YtdlpEntry> {
  // 4 MB is ample for a full yt-dlp info JSON (typical: 100–400 KB). A 64 MB
  // buffer on a 512 MB Render instance causes a significant memory spike for
  // info-heavy playlists; capping here prevents OOM crashes and keeps the
  // health of the process stable across repeated polls.
  const MAX_PROBE_BUFFER = 4 * 1024 * 1024
  let stdout: string
  try {
    const result = await execFileAsync("yt-dlp", args, {
      maxBuffer: MAX_PROBE_BUFFER,
      timeout,
    })
    stdout = result.stdout
  } catch (e) {
    // Re-throw normally for timeouts and exit-code failures, but treat
    // maxBuffer overflow as a classified error so it never surfaces as an
    // unhandled Node crash (RangeError: stdout maxBuffer exceeded).
    if (e instanceof Error && e.message.includes("maxBuffer")) {
      const overflow = new Error("yt-dlp output exceeded probe buffer limit") as Error & {
        failure: ExtractionFailure
      }
      overflow.failure = {
        category: "INTERNAL_ERROR",
        message: CATEGORY_MESSAGES["INTERNAL_ERROR"],
        detail: "yt-dlp output exceeded probe buffer limit",
      }
      throw overflow
    }
    throw e
  }
  const raw = JSON.parse(stdout)
  return raw?._type === "playlist" ? raw.entries?.[0] : raw
}

export async function probeWithFallbacks(
  url: string,
  cookiesPath: string | null
): Promise<YtdlpEntry> {
  const base = ["-J", "--no-playlist", "--no-warnings", "--user-agent", BROWSER_UA]
  const noCookieBase = [...base]
  const withCookieBase = [...base, ...cookieArgs(cookiesPath)]
  const errors: string[] = []

  // Cookies-first is NOT the default anymore: forcing saved cookies into
  // every attempt (even for plainly public videos) can trip extra
  // rate-limits/session-rotation on some platforms. Try public/no-cookie
  // extraction first; only fall back to cookies if the public attempt
  // itself signals a login/age/private requirement.
  // First probe gets an interactive budget (30 s) — enough for normal sites
  // to respond before the user gives up waiting. Later fallbacks get longer
  // budgets because they're only reached when the first attempt genuinely
  // failed (never speculative/parallel). Total worst-case budget stays well
  // under the original 75 s + 60 s + 60 s + 45 s = 240 s.
  try {
    return await runProbe([...noCookieBase, url], 30_000)
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }
  if (cookiesPath) {
    try {
      return await runProbe([...withCookieBase, url], 45_000)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (await canImpersonate()) {
    try {
      return await runProbe([...withCookieBase, "--impersonate", "chrome", url], 45_000)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  try {
    return await runProbe([...withCookieBase, "--force-generic-extractor", url], 45_000)
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }

  // Before giving up: if the page embeds a known player (YouTube/Vimeo/etc),
  // probe that embed with yt-dlp's native extractor for rich metadata.
  const candidates = await scanPageForMedia(url)
  const embed = candidates.find((c) => c.kind === "embed")
  if (embed) {
    try {
      return await runProbe([...withCookieBase, embed.url], 60_000)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  // Last resort: our own page scan — synthesize a minimal info entry
  if (candidates.length) {
    const html = await fetchPage(url)
    const title = /<title[^>]*>([^<]{1,200})/i.exec(html)?.[1]?.trim()
    const thumb = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1]
    return {
      id: crypto.randomUUID(),
      title: title || url,
      thumbnail: thumb ?? null,
      duration: null,
      webpage_url: url,
      _magica_page_scan: true,
    }
  }
  throw new Error(errors[0] ?? "No extractable media found")
}

// ---------------------------------------------------------------------------
// Download with fallbacks: cached-info-json → native → impersonate →
// generic → page-scan candidates. Every attempt's output is deep-validated;
// fakes are deleted. Deadline is generous (25 min) so full-length, large
// (up to 5GB) videos have time to finish on a normal connection instead of
// being cut off.
// ---------------------------------------------------------------------------

export interface DownloadSuccess {
  filename: string
  sizeBytes: number
  method: string
  durationSec?: number
}

/**
 * Prefer the true merged output file — the one whose name does NOT contain
 * a yt-dlp format-id suffix (`.fNNN.`) and is not a partial/temp artifact
 * (`.part`, `.ytdl`, `.temp`). Falls back to the largest file if no merged
 * candidate is found, which handles single-stream downloads (e.g. direct MP4
 * URLs or genuine no-DASH sources) that never produce a `.fNNN.` fragment.
 */
export async function pickOutput(dir: string): Promise<{ name: string; size: number } | null> {
  let files: string[] = []
  try {
    files = await fs.readdir(dir)
  } catch {
    return null
  }

  // Exclude partial/temp artifacts that yt-dlp writes during download.
  const ARTIFACT_RE = /\.(?:part|ytdl|temp)$/i
  // Format-fragment suffix produced by yt-dlp before ffmpeg merges them
  // e.g. "Title.f399.mp4" or "Title.f251.webm"
  const FRAGMENT_RE = /\.\bf\d{2,5}\b\.[^.]+$/

  const candidates = files.filter((f) => !ARTIFACT_RE.test(f))
  const merged = candidates.filter((f) => !FRAGMENT_RE.test(f))

  // Helper: stat and return { name, size } or null
  const stat = async (f: string) => {
    const st = await fs.stat(path.join(dir, f)).catch(() => null)
    return st?.isFile() ? { name: f, size: st.size } : null
  }

  if (merged.length > 0) {
    // Among merged candidates, pick the largest (handles the case of multiple
    // completed single-stream downloads where all files lack a .fNNN suffix).
    let best: { name: string; size: number } | null = null
    for (const f of merged) {
      const s = await stat(f)
      if (s && (!best || s.size > best.size)) best = s
    }
    if (best) return best
  }

  // No merged file — fall back to largest overall (e.g. video-only fragment
  // on a source that genuinely has no audio).
  let best: { name: string; size: number } | null = null
  for (const f of candidates) {
    const s = await stat(f)
    if (s && (!best || s.size > best.size)) best = s
  }
  return best
}

async function wipeDirExcept(dir: string, keep: string) {
  const files = await fs.readdir(dir).catch(() => [] as string[])
  await Promise.all(
    files
      .filter((f) => f !== keep)
      .map((f) => fs.rm(path.join(dir, f), { force: true }).catch(() => {}))
  )
}

async function wipeDir(dir: string) {
  const files = await fs.readdir(dir).catch(() => [] as string[])
  await Promise.all(files.map((f) => fs.rm(path.join(dir, f), { force: true }).catch(() => {})))
}

export async function downloadWithFallbacks(opts: {
  url: string
  dir: string
  formatArgs: string[]
  cookiesPath: string | null
  /** Path to a previously-saved yt-dlp info.json (from /api/info's probe).
   * When present, tried FIRST via `--load-info-json`, which skips
   * re-extracting the page/video entirely — this is what actually
   * eliminates the duplicate extraction, not just reusing the raw URL. */
  infoJsonPath?: string | null
}): Promise<DownloadSuccess> {
  const { url, dir, formatArgs, cookiesPath, infoJsonPath } = opts
  const audioOnly = formatArgs.includes("-x")
  // 25 minutes total — enough headroom for a full 5GB file on a normal
  // connection, across every fallback strategy combined.
  const deadline = Date.now() + 25 * 60 * 1000
  const timeLeft = () => deadline - Date.now()
  const outTpl = path.join(dir, "%(title).80s.%(ext)s")
  const commonBase = [
    "--no-playlist",
    "--no-warnings",
    "--restrict-filenames",
    "--retries",
    "3",
    "--fragment-retries",
    "5",
    "--socket-timeout",
    "30",
    "--max-filesize",
    MAX_FILESIZE,
    "--user-agent",
    BROWSER_UA,
    "-o",
    outTpl,
  ]
  const noCookieBase = [...commonBase]
  const withCookieBase = [...commonBase, ...cookieArgs(cookiesPath)]
  const errors: string[] = []

  const tryAttempt = async (method: string, args: string[], timeout: number, allowVideoOnly = false): Promise<DownloadSuccess | null> => {
    if (timeLeft() < 25_000) return null
    try {
      await execFileAsync("yt-dlp", args, {
        maxBuffer: 16 * 1024 * 1024,
        timeout: Math.min(timeout, timeLeft() - 5_000),
      })
    } catch (e) {
      errors.push(`${method}: ${e instanceof Error ? e.message : String(e)}`)
      await wipeDir(dir)
      return null
    }
    const best = await pickOutput(dir)
    if (!best) {
      errors.push(`${method}: produced no file`)
      return null
    }
    const check = await validateMediaFile(path.join(dir, best.name))
    if (!check.ok) {
      errors.push(`${method}: rejected fake media (${check.reason})`)
      await wipeDir(dir)
      return null
    }
    // For video requests: require both video AND audio streams, unless the
    // source is known to have no audio at all (e.g. silent clips, GIF-style).
    if (!audioOnly && check.hasVideo && !check.hasAudio && !allowVideoOnly) {
      errors.push(`${method}: rejected video-only output (missing audio track)`)
      await fs.rm(path.join(dir, best.name), { force: true }).catch(() => {})
      return null
    }
    // For audio-only requests: must have at least an audio stream.
    if (audioOnly && !check.hasAudio) {
      errors.push(`${method}: rejected output without audio stream`)
      await fs.rm(path.join(dir, best.name), { force: true }).catch(() => {})
      return null
    }
    return { filename: best.name, sizeBytes: best.size, method, durationSec: check.durationSec }
  }

  // Detect whether the source genuinely has no audio at all (e.g. silent clip,
  // GIF-style post) so we can skip the missing-audio rejection for those.
  // Reads the cached info.json if available; returns false when unknown.
  const sourceHasNoAudio = await (async (): Promise<boolean> => {
    if (!infoJsonPath) return false
    try {
      const raw = JSON.parse(await fs.readFile(infoJsonPath, "utf8"))
      const formats: Array<{ acodec?: string }> = Array.isArray(raw?.formats) ? raw.formats : []
      if (formats.length === 0) return false
      return formats.every((f) => !f.acodec || f.acodec === "none")
    } catch {
      return false
    }
  })()

  // If a specific height/quality selector isn't available for this site,
  // fall back to plain best/worst rather than failing outright.
  const robust = (base: string[]) =>
    formatArgs[0] === "-f" ? ["-f", `${formatArgs[1]}/best/worst`, ...formatArgs.slice(2), ...base] : [...formatArgs, ...base]

  // 0. Reuse the cached probe (from /api/info) via --load-info-json — this
  // is the step that actually skips a second full extraction. No URL is
  // passed here; yt-dlp resolves formats straight from the saved JSON.
  // Falls through to a fresh extraction below if the cached format URLs
  // have expired (common for signed CDN links) or the platform doesn't
  // support this path well.
  if (infoJsonPath) {
    const r0 = await tryAttempt(
      "cached-info-json",
      [...robust(noCookieBase), "--load-info-json", infoJsonPath],
      10 * 60 * 1000,
      sourceHasNoAudio
    )
    if (r0) return r0
  }

  // 1. Native extractor, no cookies first (avoids unnecessarily forcing a
  // saved login session onto plainly public content).
  let r = await tryAttempt("native", [...robust(noCookieBase), url], 20 * 60 * 1000, sourceHasNoAudio)
  if (r) return r
  // 2. Native + cookies (only if the visitor has saved cookies for this platform)
  if (cookiesPath) {
    r = await tryAttempt("native-cookie", [...robust(withCookieBase), url], 15 * 60 * 1000, sourceHasNoAudio)
    if (r) return r
  }
  // 3. Native + browser TLS impersonation (beats many anti-bot walls)
  if (await canImpersonate()) {
    r = await tryAttempt("impersonate", [...robust(withCookieBase), "--impersonate", "chrome", url], 15 * 60 * 1000, sourceHasNoAudio)
    if (r) return r
  }
  // 4. Generic extractor
  r = await tryAttempt("generic", [...robust(withCookieBase), "--force-generic-extractor", url], 10 * 60 * 1000, sourceHasNoAudio)
  if (r) return r
  // 5. Page scan → direct/HLS/DASH candidates
  const candidates = await scanPageForMedia(url).catch(() => [] as MediaCandidate[])
  let decoyFallback: DownloadSuccess | null = null
  for (const c of candidates) {
    if (timeLeft() < 30_000) break
    // Embeds go through yt-dlp's native extractor (best A/V); direct single
    // files skip format merging; manifests keep the quality selector.
    const fmt = c.kind === "direct" ? (audioOnly ? formatArgs : []) : robust([])
    const refArgs = c.kind === "embed" ? [] : ["--referer", c.referer]
    r = await tryAttempt(
      `page-scan:${c.kind}`,
      [...fmt, ...withCookieBase, ...refArgs, c.url],
      8 * 60 * 1000,
      sourceHasNoAudio
    )
    if (r) {
      // Suspiciously short & tiny files are usually preview/teaser/ad
      // decoys — keep the best one aside but try remaining candidates
      // first. Raised the size bar (5MB) since some ad decoys are a few
      // MB (e.g. app-install promo clips) yet still clearly not the real
      // requested video when duration is very short.
      const suspicious = (r.durationSec ?? 0) < 15 && r.sizeBytes < 5_000_000
      if (!suspicious) return r
      if (!decoyFallback || r.sizeBytes > decoyFallback.sizeBytes) {
        const kept = path.join(dir, ".keep-" + r.filename)
        await fs.rename(path.join(dir, r.filename), kept).catch(() => {})
        decoyFallback = { ...r, filename: ".keep-" + r.filename }
      }
      await wipeDirExcept(dir, decoyFallback.filename)
    }
  }
  if (decoyFallback) {
    const finalName = decoyFallback.filename.replace(/^\.keep-/, "")
    await fs
      .rename(path.join(dir, decoyFallback.filename), path.join(dir, finalName))
      .catch(() => {})
    return { ...decoyFallback, filename: finalName, method: decoyFallback.method + ":short" }
  }

  // All methods failed — classify using the most specific error we saw
  const joined = errors.join(" || ")
  const failure = classifyFailure(joined)
  const err = new Error(failure.message) as Error & { failure: ExtractionFailure }
  err.failure = { ...failure, detail: joined.slice(0, 900) }
  throw err
}

export { UnsafeUrlError }
