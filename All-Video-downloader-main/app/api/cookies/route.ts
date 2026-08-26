import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { getOrCreateSessionId, cookiesPathForPlatform, SESSION_COOKIE } from "@/lib/session"
import { PLATFORM_KEYS, PlatformKey } from "@/lib/ytdlp"
import { checkRateLimit, clientKey } from "@/lib/security/rate-limit"

function attachSessionCookie(res: NextResponse, sessionId: string) {
  res.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
}

function isPlatformKey(v: string): v is PlatformKey {
  return (PLATFORM_KEYS as string[]).includes(v)
}

// GET -> status of every platform's cookie file for this visitor's session
export async function GET(request: NextRequest) {
  if (!checkRateLimit(`cookies-get:${clientKey(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests — please slow down." }, { status: 429 })
  }
  const { sessionId, isNew } = getOrCreateSessionId(request.cookies.get(SESSION_COOKIE)?.value)
  const platforms: Record<string, { configured: boolean; updatedAt?: string }> = {}
  for (const key of PLATFORM_KEYS) {
    const p = cookiesPathForPlatform(sessionId, key)
    try {
      const st = await fs.stat(p)
      platforms[key] = { configured: true, updatedAt: st.mtime.toISOString() }
    } catch {
      platforms[key] = { configured: false }
    }
  }
  const res = NextResponse.json({ platforms })
  if (isNew) attachSessionCookie(res, sessionId)
  return res
}

// POST { platform, content } -> save cookies.txt for one specific platform
export async function POST(request: NextRequest) {
  if (!checkRateLimit(`cookies-write:${clientKey(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests — please slow down." }, { status: 429 })
  }
  const { sessionId } = getOrCreateSessionId(request.cookies.get(SESSION_COOKIE)?.value)
  let content = ""
  let platform = ""
  try {
    const body = await request.json()
    content = String(body?.content ?? "")
    platform = String(body?.platform ?? "")
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  if (!isPlatformKey(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 })
  }
  const trimmed = content.trim()
  if (!trimmed || trimmed.length > 1_000_000) {
    return NextResponse.json({ error: "Cookie file is empty or too large" }, { status: 400 })
  }
  if (!trimmed.split("\n").some((l) => l.includes("\t") || l.startsWith("# Netscape"))) {
    return NextResponse.json(
      { error: "That doesn't look like a Netscape-format cookies.txt export" },
      { status: 400 }
    )
  }
  const header = trimmed.startsWith("# Netscape") ? "" : "# Netscape HTTP Cookie File\n"
  const cookiesPath = cookiesPathForPlatform(sessionId, platform)
  await fs.mkdir(path.dirname(cookiesPath), { recursive: true })
  await fs.writeFile(cookiesPath, header + trimmed + "\n", { mode: 0o600 })
  const res = NextResponse.json({ configured: true, platform })
  attachSessionCookie(res, sessionId)
  return res
}

// DELETE ?platform=youtube -> remove cookies.txt for one specific platform
export async function DELETE(request: NextRequest) {
  if (!checkRateLimit(`cookies-write:${clientKey(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests — please slow down." }, { status: 429 })
  }
  const { sessionId } = getOrCreateSessionId(request.cookies.get(SESSION_COOKIE)?.value)
  const { searchParams } = new URL(request.url)
  const platform = searchParams.get("platform") ?? ""
  if (!isPlatformKey(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 })
  }
  const cookiesPath = cookiesPathForPlatform(sessionId, platform)
  await fs.rm(cookiesPath, { force: true }).catch(() => {})
  const res = NextResponse.json({ configured: false, platform })
  attachSessionCookie(res, sessionId)
  return res
}
