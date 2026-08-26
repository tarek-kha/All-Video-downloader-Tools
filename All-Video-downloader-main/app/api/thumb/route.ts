import { NextResponse } from "next/server"
import { isValidUrl } from "@/lib/ytdlp"
import { safeFetch, readLimited, UnsafeUrlError } from "@/lib/security/safe-fetch"
import { checkRateLimit, clientKey } from "@/lib/security/rate-limit"

export const maxDuration = 60

const MAX_THUMB_BYTES = 15 * 1024 * 1024 // 15MB cap — thumbnails should never be huge

export async function GET(request: Request) {
  if (!checkRateLimit(`thumb:${clientKey(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests — please slow down." }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const url = searchParams.get("url") ?? ""
  const name = (searchParams.get("name") ?? "thumbnail").replace(/[^\w.-]+/g, "_").slice(0, 80)

  if (!isValidUrl(url)) {
    return NextResponse.json({ error: "Invalid thumbnail URL" }, { status: 400 })
  }
  try {
    const res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeoutMs: 10_000 })
    if (!res.ok) throw new Error(`Upstream ${res.status}`)
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase()
    const isAllowedImage =
      contentType.startsWith("image/jpeg") ||
      contentType.startsWith("image/png") ||
      contentType.startsWith("image/webp") ||
      contentType.startsWith("image/gif")
    if (!isAllowedImage) throw new Error("Upstream did not return a supported image")
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "jpg"
    const body = await readLimited(res, MAX_THUMB_BYTES)
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${name}.${ext}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (e: unknown) {
    if (e instanceof UnsafeUrlError) {
      return NextResponse.json({ error: "This thumbnail URL is not allowed." }, { status: 400 })
    }
    return NextResponse.json({ error: "Could not fetch thumbnail" }, { status: 422 })
  }
}
