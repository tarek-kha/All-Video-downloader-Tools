import { isSafeToFetch } from "./safe-url"

/**
 * SSRF-hardened fetch wrapper. Validates the URL (and every redirect hop)
 * against the private-IP blocklist before connecting, and caps response
 * size to prevent memory/disk exhaustion from a malicious or oversized
 * upstream response.
 */

export interface SafeFetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  maxRedirects?: number
  maxBytes?: number
}

export class UnsafeUrlError extends Error {
  constructor(reason: string) {
    super(`Blocked unsafe URL: ${reason}`)
    this.name = "UnsafeUrlError"
  }
}

/** Follows redirects manually so each hop can be re-validated (DNS rebinding guard). */
export async function safeFetch(
  url: string,
  opts: SafeFetchOptions = {}
): Promise<Response> {
  const { headers = {}, timeoutMs = 15_000, maxRedirects = 5 } = opts
  let current = url

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await isSafeToFetch(current)
    if (!check.ok) throw new UnsafeUrlError(check.reason ?? "invalid URL")

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(current, {
        signal: ctrl.signal,
        redirect: "manual",
        headers,
      })
    } finally {
      clearTimeout(t)
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location")
      if (!location) return res
      current = new URL(location, current).toString()
      continue
    }
    return res
  }
  throw new UnsafeUrlError("too many redirects")
}

/** Reads a Response body up to maxBytes, throwing if it's exceeded. */
export async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error(`Response exceeded ${maxBytes} byte limit`)
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)))
}
