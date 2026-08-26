import { execFile } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import path from "path"

export const execFileAsync = promisify(execFile)

function findProjectRoot(): string {
  const candidates = [
    process.cwd(),
    path.join(process.cwd(), "magica", "projects", "app"),
    __dirname.replace(/\/lib$/, ""),
  ]
  for (const c of candidates) {
    if (existsSync(path.join(c, "next.config.js")) || existsSync(path.join(c, "next.config.ts"))) {
      return c
    }
  }
  return process.cwd()
}

export const PROJECT_ROOT = findProjectRoot()
export const DOWNLOAD_ROOT = path.join(PROJECT_ROOT, "downloads")

// Hard cap on a single downloaded file — keeps the sandbox disk safe while
// still allowing full-length, high quality videos through.
export const MAX_FILESIZE = "5G"
export const MAX_FILESIZE_BYTES = 5 * 1024 * 1024 * 1024

// Cookies are stored per-session AND per-platform (see lib/session.ts), so
// a YouTube cookie file is never sent to TikTok, Instagram cookies never
// leak to X/Twitter, etc.
export function cookieArgs(cookiesPath: string | null | undefined): string[] {
  return cookiesPath && existsSync(cookiesPath) ? ["--cookies", cookiesPath] : []
}

export function isValidUrl(input: string): boolean {
  try {
    const u = new URL(input)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

export type PlatformKey =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "twitter"
  | "facebook"
  | "linkedin"
  | "vimeo"
  | "reddit"
  | "other"

export const PLATFORM_LABELS: Record<PlatformKey, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitter: "X / Twitter",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  vimeo: "Vimeo",
  reddit: "Reddit",
  other: "Other sites",
}

export const PLATFORM_KEYS = Object.keys(PLATFORM_LABELS) as PlatformKey[]

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "")
  } catch {
    return ""
  }
}

/** Stable key used to look up the right cookie file for a URL. */
export function platformKey(url: string): PlatformKey {
  const host = hostOf(url)
  if (/youtube\.com|youtu\.be/.test(host)) return "youtube"
  if (/tiktok\.com/.test(host)) return "tiktok"
  if (/instagram\.com/.test(host)) return "instagram"
  if (/twitter\.com|x\.com/.test(host)) return "twitter"
  if (/facebook\.com|fb\.watch/.test(host)) return "facebook"
  if (/linkedin\.com/.test(host)) return "linkedin"
  if (/vimeo\.com/.test(host)) return "vimeo"
  if (/reddit\.com/.test(host)) return "reddit"
  return "other"
}

export function detectPlatform(url: string): string {
  const host = hostOf(url)
  if (/youtube\.com|youtu\.be/.test(host)) return "YouTube"
  if (/tiktok\.com/.test(host)) return "TikTok"
  if (/instagram\.com/.test(host)) return "Instagram"
  if (/twitter\.com|x\.com/.test(host)) return "X / Twitter"
  if (/facebook\.com|fb\.watch/.test(host)) return "Facebook"
  if (/linkedin\.com/.test(host)) return "LinkedIn"
  if (/vimeo\.com/.test(host)) return "Vimeo"
  if (/reddit\.com/.test(host)) return "Reddit"
  if (/twitch\.tv/.test(host)) return "Twitch"
  if (/dailymotion\.com/.test(host)) return "Dailymotion"
  if (/vk(video)?\.(com|ru)/.test(host)) return "VK Video"
  if (/ok\.ru/.test(host)) return "OK.ru"
  return host || "Unknown"
}

export function friendlyError(msg: string): string {
  if (msg.includes("Sign in to confirm"))
    return "This platform is asking for login verification from the server. Add cookies for this platform (top-right Cookies button) to unlock it."
  if (msg.includes("Requested format is not available"))
    return "That quality isn't available for this video — try 'Best available'."
  if (msg.includes("Unsupported URL"))
    return "This URL isn't supported. Try a direct video post link."
  if (msg.includes("Private") || msg.includes("login required"))
    return "This video is private or requires login — add cookies for this platform to unlock it."
  if (msg.includes("File is larger than max-filesize") || msg.includes("max-filesize"))
    return `This file is larger than the ${MAX_FILESIZE} limit — try a lower quality (e.g. 1080p or 720p).`
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT"))
    return "The request timed out — the video may be very long or the connection slow. Try a lower quality."
  return "Request failed. The video may be private, region-locked, or unsupported."
}

export const QUALITY_MAP: Record<string, { args: string[]; label: string }> = {
  best: {
    label: "Best available (video + audio, up to 5GB)",
    args: ["-f", "bv*+ba/b", "--merge-output-format", "mp4"],
  },
  "2160p": {
    label: "4K (2160p)",
    args: ["-f", "bv*[height<=2160]+ba/b[height<=2160]", "--merge-output-format", "mp4"],
  },
  "1080p": {
    label: "Full HD (1080p)",
    args: ["-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4"],
  },
  "720p": {
    label: "HD (720p)",
    args: ["-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4"],
  },
  "480p": {
    label: "SD (480p)",
    args: ["-f", "bv*[height<=480]+ba/b[height<=480]", "--merge-output-format", "mp4"],
  },
  audio: {
    label: "Audio only (MP3)",
    args: ["-x", "--audio-format", "mp3", "--audio-quality", "0"],
  },
}
