import { describe, it, expect, beforeEach, vi } from "vitest"

function reqWithForwardedFor(value: string | null): Request {
  const headers = new Headers()
  if (value !== null) headers.set("x-forwarded-for", value)
  return new Request("https://example.com/api/info", { headers })
}

beforeEach(() => {
  vi.resetModules()
  delete process.env.TRUST_PROXY
  delete process.env.TRUSTED_PROXY_HOPS
})

describe("clientKey — proxy trust disabled (default/secure-by-default)", () => {
  it("never trusts X-Forwarded-For when TRUST_PROXY is unset", async () => {
    const { clientKey } = await import("../lib/security/rate-limit")
    expect(clientKey(reqWithForwardedFor("1.2.3.4"))).toBe("unknown")
  })

  it("ignores forwarded headers even when TRUST_PROXY is an unexpected value", async () => {
    process.env.TRUST_PROXY = "yes" // not the literal string "true"
    const { clientKey } = await import("../lib/security/rate-limit")
    expect(clientKey(reqWithForwardedFor("1.2.3.4"))).toBe("unknown")
  })
})

describe("clientKey — proxy trust enabled", () => {
  beforeEach(() => {
    process.env.TRUST_PROXY = "true"
    process.env.TRUSTED_PROXY_HOPS = "1"
  })

  it("uses the single forwarded IPv4 address when only one is present", async () => {
    const { clientKey } = await import("../lib/security/rate-limit")
    expect(clientKey(reqWithForwardedFor("203.0.113.7"))).toBe("203.0.113.7")
  })

  it("takes the LAST entry (appended by the trusted proxy), not the client-controlled first entry", async () => {
    const { clientKey } = await import("../lib/security/rate-limit")
    // A malicious client could prepend a fake IP; the real client IP is
    // whatever the trusted proxy actually appended at the end.
    expect(clientKey(reqWithForwardedFor("9.9.9.9, 203.0.113.7"))).toBe("203.0.113.7")
  })

  it("supports IPv6 addresses", async () => {
    const { clientKey } = await import("../lib/security/rate-limit")
    expect(clientKey(reqWithForwardedFor("2001:db8::1"))).toBe("2001:db8::1")
  })

  it("falls back to 'unknown' for a malformed forwarded value instead of trusting it verbatim", async () => {
    const { clientKey } = await import("../lib/security/rate-limit")
    expect(clientKey(reqWithForwardedFor("not-an-ip; DROP TABLE users;--"))).toBe("unknown")
  })

  it("falls back to 'unknown' when the header is missing entirely", async () => {
    const { clientKey } = await import("../lib/security/rate-limit")
    expect(clientKey(reqWithForwardedFor(null))).toBe("unknown")
  })

  it("respects TRUSTED_PROXY_HOPS=2 by reading the second-from-right entry", async () => {
    process.env.TRUSTED_PROXY_HOPS = "2"
    const { clientKey } = await import("../lib/security/rate-limit")
    // client, proxy1(untrusted-ish), proxy2(trusted, appended last) —
    // with 2 trusted hops configured, the real client is 2 from the right.
    expect(clientKey(reqWithForwardedFor("198.51.100.9, 203.0.113.7, 192.0.2.1"))).toBe("203.0.113.7")
  })
})

describe("clientKey — different real IPs get independent rate-limit identities", () => {
  it("distinguishes two different trusted forwarded IPs", async () => {
    process.env.TRUST_PROXY = "true"
    const { clientKey, checkRateLimit } = await import("../lib/security/rate-limit")
    const keyA = clientKey(reqWithForwardedFor("203.0.113.1"))
    const keyB = clientKey(reqWithForwardedFor("203.0.113.2"))
    expect(keyA).not.toBe(keyB)
    // Exhaust A's limit — B must be unaffected
    expect(checkRateLimit(`t:${keyA}`, 1, 60_000)).toBe(true)
    expect(checkRateLimit(`t:${keyA}`, 1, 60_000)).toBe(false)
    expect(checkRateLimit(`t:${keyB}`, 1, 60_000)).toBe(true)
  })
})
