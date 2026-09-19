import { NextRequest, NextResponse } from "next/server"
import { isValidUrl, platformKey } from "@/lib/ytdlp"
import { getDirectUrl } from "@/lib/direct"
import { cookiesPathForPlatform, getOrCreateSessionId, SESSION_COOKIE } from "@/lib/session"
import { isSafeToFetch } from "@/lib/security/safe-url"
import { checkRateLimit, clientKey } from "@/lib/security/rate-limit"

export const maxDuration = 60

function attachSessionCookie(res: NextResponse, sessionId: string) {
  res.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function POST(request: NextRequest) {
  if (!checkRateLimit(`direct:${clientKey(request)}`, 12, 60_000)) {
    return NextResponse.json(
      { error: "Too many requests — please slow down." },
      { status: 429 }
    )
  }

  const { sessionId } = getOrCreateSessionId(request.cookies.get(SESSION_COOKIE)?.value)
  let url = ""
  let quality = "best"

  try {
    const body = await request.json()
    url = String(body?.url ?? "").trim()
    quality = String(body?.quality ?? "best")
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!isValidUrl(url)) {
    return NextResponse.json(
      { error: "Please enter a valid http(s) URL" },
      { status: 400 }
    )
  }

  const safety = await isSafeToFetch(url)
  if (!safety.ok) {
    return NextResponse.json(
      { error: "This URL points to a private/internal address and cannot be fetched." },
      { status: 400 }
    )
  }

  const cookiesPath = cookiesPathForPlatform(sessionId, platformKey(url))
  const result = await getDirectUrl(url, quality, cookiesPath)

  const res = NextResponse.json(
    result
      ? { success: true, directUrl: result.directUrl, ext: result.ext, method: result.method }
      : { success: false, directUrl: null }
  )
  attachSessionCookie(res, sessionId)
  return res
}
