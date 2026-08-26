import { NextResponse } from "next/server"
import { extractGuard, downloadGuard } from "@/lib/security/rate-limit"
import { checkRequiredDependencies, checkPoProviderAvailable } from "@/lib/health"

export const dynamic = "force-dynamic"

/**
 * Runtime health endpoint (Phase 4). Actually verifies required binaries
 * (yt-dlp/ffmpeg/ffprobe/Deno) respond — returns 503 + ok:false if any is
 * missing. The optional PO-token provider is reported separately and never
 * affects the overall status (200) since it's a fallback, not a
 * requirement. No secrets, cookies, tokens, raw URLs, or filesystem paths
 * are ever included in the response — only booleans and names.
 */
export async function GET() {
  const [required, poProviderAvailable] = await Promise.all([
    checkRequiredDependencies(),
    checkPoProviderAvailable(),
  ])
  const ok = required.every((d) => d.ok)

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      ok,
      dependencies: Object.fromEntries(required.map((d) => [d.name, d.ok])),
      poProviderAvailable,
      uptimeSec: Math.round(process.uptime()),
      load: {
        activeExtracts: extractGuard.current,
        activeDownloads: downloadGuard.current,
      },
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  )
}
