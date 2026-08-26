import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import { createReadStream } from "fs"
import path from "path"
import { DOWNLOAD_ROOT } from "@/lib/ytdlp"

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".opus": "audio/ogg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

/**
 * Wrap a Node read stream (optionally bounded to a byte range) in a
 * WebStream with backpressure and safe close/error handling. Avoids the
 * "Controller is already closed" crash that Readable.toWeb() can trigger
 * when the client disconnects, which was cutting downloads off mid-transfer.
 */
function nodeStreamToWeb(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const nodeStream = range
    ? createReadStream(filePath, { start: range.start, end: range.end, highWaterMark: 1024 * 1024 })
    : createReadStream(filePath, { highWaterMark: 1024 * 1024 })
  let closed = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: string | Buffer) => {
        if (closed) return
        try {
          controller.enqueue(
            typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
          )
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            nodeStream.pause()
          }
        } catch {
          closed = true
          nodeStream.destroy()
        }
      })
      nodeStream.on("end", () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // already closed by the client — ignore
        }
      })
      nodeStream.on("error", (err) => {
        if (closed) return
        closed = true
        try {
          controller.error(err)
        } catch {
          // already closed — ignore
        }
      })
    },
    pull() {
      nodeStream.resume()
    },
    cancel() {
      closed = true
      nodeStream.destroy()
    },
  })
}

/** Parses a single "bytes=start-end" Range header against a known file size. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, startStr, endStr] = m
  let start: number
  let end: number
  if (startStr === "" && endStr === "") return null
  if (startStr === "") {
    // suffix range: last N bytes
    const suffixLen = parseInt(endStr, 10)
    if (Number.isNaN(suffixLen) || suffixLen <= 0) return null
    start = Math.max(0, size - suffixLen)
    end = size - 1
  } else {
    start = parseInt(startStr, 10)
    end = endStr === "" ? size - 1 : parseInt(endStr, 10)
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || start >= size) return null
  end = Math.min(end, size - 1)
  return { start, end }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // Prevent path traversal — id must be a UUID
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid file id" }, { status: 400 })
  }
  const dir = path.join(DOWNLOAD_ROOT, id)
  try {
    const files = await fs.readdir(dir)
    if (!files.length) throw new Error("empty")
    let best = files[0]
    let bestSize = 0
    for (const f of files) {
      const st = await fs.stat(path.join(dir, f))
      if (st.size > bestSize) {
        bestSize = st.size
        best = f
      }
    }
    const filePath = path.join(dir, best)
    const ext = path.extname(best).toLowerCase()
    const contentType = MIME[ext] ?? "application/octet-stream"

    // ASCII-safe fallback + RFC 5987 encoded full name for maximum browser compatibility
    const asciiName = best.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'")
    const dispositionHeader = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(best)}`

    // Range support — enables pause/resume, download-manager compatibility,
    // and stable large-file transfers on unreliable mobile connections.
    const rangeHeader = request.headers.get("range")
    if (rangeHeader) {
      const range = parseRange(rangeHeader, bestSize)
      if (!range) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${bestSize}`, "Accept-Ranges": "bytes" },
        })
      }
      const chunkSize = range.end - range.start + 1
      return new NextResponse(nodeStreamToWeb(filePath, range), {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${range.start}-${range.end}/${bestSize}`,
          "Accept-Ranges": "bytes",
          "Content-Disposition": dispositionHeader,
          "Cache-Control": "no-store",
        },
      })
    }

    return new NextResponse(nodeStreamToWeb(filePath), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bestSize),
        "Content-Disposition": dispositionHeader,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return NextResponse.json(
      { error: "File not found — it may have expired. Download it again." },
      { status: 404 }
    )
  }
}
