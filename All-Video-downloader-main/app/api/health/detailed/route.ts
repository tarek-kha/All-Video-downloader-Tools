import { NextResponse } from "next/server"
import { extractGuard, downloadGuard } from "@/lib/security/rate-limit"
import { checkRequiredDependencies, checkPoProviderAvailable } from "@/lib/health"

export const dynamic = "force-dynamic"

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
