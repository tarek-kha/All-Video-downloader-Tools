import { execFile } from "child_process"
import { promisify } from "util"
import { promises as fs } from "fs"

const run = promisify(execFile)

export interface MediaCheck {
  ok: boolean
  reason?: string
  durationSec?: number
  container?: string
  hasVideo?: boolean
  hasAudio?: boolean
}

const IMAGE_OR_TEXT_FORMATS =
  /image2|png_pipe|mjpeg|gif|webp_pipe|bmp_pipe|svg|tty|jpeg_pipe|apng/i

/**
 * Deep-validate that a downloaded file is a genuine, playable audio/video
 * file. Rejects SVG/HTML/JSON/XML/images/error pages by signature and by
 * ffprobe container+stream analysis. Never trust extension alone.
 */
export async function validateMediaFile(filePath: string): Promise<MediaCheck> {
  let size = 0
  try {
    size = (await fs.stat(filePath)).size
  } catch {
    return { ok: false, reason: "file missing" }
  }
  if (size < 4096) return { ok: false, reason: `file too small (${size} bytes)` }

  // 1) Signature check on the first bytes — catches SVG/HTML/JSON/XML/redirect pages
  try {
    const fh = await fs.open(filePath, "r")
    const buf = Buffer.alloc(1024)
    await fh.read(buf, 0, 1024, 0)
    await fh.close()
    const head = buf.toString("utf8").trimStart().toLowerCase()
    if (
      head.startsWith("<?xml") ||
      head.startsWith("<svg") ||
      head.startsWith("<!doctype") ||
      head.startsWith("<html") ||
      head.startsWith("{") ||
      head.startsWith("[")
    ) {
      return { ok: false, reason: "not media: text/markup document (SVG/HTML/JSON/XML)" }
    }
  } catch {
    return { ok: false, reason: "unreadable file" }
  }

  // 2) ffprobe: must contain at least one real audio or video stream
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 }
    )
    const info = JSON.parse(stdout)
    const formatName: string = info?.format?.format_name ?? ""
    if (IMAGE_OR_TEXT_FORMATS.test(formatName)) {
      return { ok: false, reason: `not media: container is ${formatName}` }
    }
    const streams: Array<{ codec_type?: string; codec_name?: string; duration?: string }> =
      Array.isArray(info?.streams) ? info.streams : []
    const hasVideo = streams.some(
      (s) => s.codec_type === "video" && !/mjpeg|png|gif|bmp|webp/i.test(s.codec_name ?? "")
    )
    const hasAudio = streams.some((s) => s.codec_type === "audio")
    if (!hasVideo && !hasAudio) {
      return { ok: false, reason: "no audio or video streams found" }
    }
    const durationSec = parseFloat(info?.format?.duration ?? "0") || 0
    // A "video" with no duration and tiny size is a decoy (thumbnail/ad frame)
    if (durationSec < 0.5 && size < 200 * 1024) {
      return { ok: false, reason: "zero-length media (likely a decoy/ad asset)" }
    }
    return { ok: true, durationSec, container: formatName, hasVideo, hasAudio }
  } catch {
    return { ok: false, reason: "ffprobe could not parse the file as media" }
  }
}
