import { promises as dns } from "dns"
import net from "net"

/**
 * SSRF protection: validates that a user-supplied URL resolves only to
 * public, routable IP addresses before we ever fetch it server-side.
 * Used by every outbound fetch that takes a URL from an untrusted source
 * (the pasted video link, page-scan candidates, redirect targets, and the
 * thumbnail proxy).
 */

const PRIVATE_V4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local / cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
]

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + parseInt(part, 10), 0) >>> 0
}

function isPrivateV4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip)
  return PRIVATE_V4_RANGES.some(([base, bits]) => {
    const baseInt = ipv4ToInt(base)
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (ipInt & mask) === (baseInt & mask)
  })
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === "::1" || lower === "::") return true
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true // link-local + unique-local
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — check the embedded v4 address too
    const v4 = lower.split(":").pop()
    if (v4 && net.isIPv4(v4)) return isPrivateV4(v4)
  }
  return false
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateV4(ip)
  if (net.isIPv6(ip)) return isPrivateV6(ip)
  return true // unrecognized — fail closed
}

export interface UrlCheckResult {
  ok: boolean
  reason?: string
}

/** Cheap synchronous checks — scheme, credentials, obviously-local hostnames. */
export function isSyntacticallySafeUrl(input: string): UrlCheckResult {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return { ok: false, reason: "Invalid URL" }
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Only http(s) URLs are allowed" }
  }
  if (u.username || u.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed" }
  }
  const host = u.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") {
    return { ok: false, reason: "Local addresses are not allowed" }
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    return { ok: false, reason: "Private/internal IP addresses are not allowed" }
  }
  return { ok: true }
}

/**
 * Full check including DNS resolution — every A/AAAA address the hostname
 * resolves to must be public. Call this right before connecting, and again
 * after following any redirect (DNS rebinding protection).
 */
export async function isSafeToFetch(input: string): Promise<UrlCheckResult> {
  const syntactic = isSyntacticallySafeUrl(input)
  if (!syntactic.ok) return syntactic

  const u = new URL(input)
  const host = u.hostname

  if (net.isIP(host)) {
    return isPrivateIp(host) ? { ok: false, reason: "Private/internal IP addresses are not allowed" } : { ok: true }
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true })
    if (!records.length) return { ok: false, reason: "Could not resolve hostname" }
    const anyPrivate = records.some((r) => isPrivateIp(r.address))
    if (anyPrivate) return { ok: false, reason: "Hostname resolves to a private/internal address" }
    return { ok: true }
  } catch {
    return { ok: false, reason: "Could not resolve hostname" }
  }
}
