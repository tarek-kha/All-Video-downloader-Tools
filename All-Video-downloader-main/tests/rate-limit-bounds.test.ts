import { describe, it, expect, beforeEach, vi } from "vitest"

beforeEach(() => {
  vi.resetModules()
  delete process.env.RATE_LIMIT_MAX_BUCKETS
})

describe("rate limiter bucket bounding", () => {
  it("respects a configured RATE_LIMIT_MAX_BUCKETS cap", async () => {
    process.env.RATE_LIMIT_MAX_BUCKETS = "3"
    const { checkRateLimit, __testing } = await import("../lib/security/rate-limit")
    expect(__testing.MAX_BUCKETS).toBe(3)

    checkRateLimit("key-a", 5, 60_000)
    checkRateLimit("key-b", 5, 60_000)
    checkRateLimit("key-c", 5, 60_000)
    expect(__testing.buckets.size).toBe(3)
  })

  it("never grows the bucket map beyond the configured cap, even under many distinct keys", async () => {
    process.env.RATE_LIMIT_MAX_BUCKETS = "5"
    const { checkRateLimit, __testing } = await import("../lib/security/rate-limit")

    for (let i = 0; i < 50; i++) {
      checkRateLimit(`spam-key-${i}`, 5, 60_000)
      expect(__testing.buckets.size).toBeLessThanOrEqual(5)
    }
    expect(__testing.buckets.size).toBeLessThanOrEqual(5)
  })

  it("evicts the oldest bucket first when at capacity and no buckets have expired yet", async () => {
    process.env.RATE_LIMIT_MAX_BUCKETS = "2"
    const { checkRateLimit, __testing } = await import("../lib/security/rate-limit")

    checkRateLimit("oldest", 5, 60_000)
    checkRateLimit("middle", 5, 60_000)
    // Map is now full (size 2). Adding a third, brand-new key must evict
    // "oldest" (the longest-standing entry) to make room.
    checkRateLimit("newest", 5, 60_000)

    expect(__testing.buckets.has("oldest")).toBe(false)
    expect(__testing.buckets.has("middle")).toBe(true)
    expect(__testing.buckets.has("newest")).toBe(true)
    expect(__testing.buckets.size).toBe(2)
  })

  it("prefers evicting expired buckets over oldest-but-still-active ones", async () => {
    process.env.RATE_LIMIT_MAX_BUCKETS = "2"
    const { checkRateLimit, __testing } = await import("../lib/security/rate-limit")

    // "expiring" has an already-passed window; "active" is still valid.
    checkRateLimit("expiring", 5, 1) // 1ms window — expired almost immediately
    await new Promise((r) => setTimeout(r, 10))
    checkRateLimit("active", 5, 60_000)
    // At capacity now. The new key should reclaim the room from the
    // expired "expiring" bucket rather than evicting "active".
    checkRateLimit("brand-new", 5, 60_000)

    expect(__testing.buckets.has("expiring")).toBe(false)
    expect(__testing.buckets.has("active")).toBe(true)
    expect(__testing.buckets.has("brand-new")).toBe(true)
  })

  it("does not evict anything when updating an EXISTING key's count (only new-key inserts trigger eviction)", async () => {
    process.env.RATE_LIMIT_MAX_BUCKETS = "2"
    const { checkRateLimit, __testing } = await import("../lib/security/rate-limit")

    checkRateLimit("a", 5, 60_000)
    checkRateLimit("b", 5, 60_000)
    // Re-hitting an existing key while at capacity must NOT evict anything.
    checkRateLimit("a", 5, 60_000)
    expect(__testing.buckets.has("a")).toBe(true)
    expect(__testing.buckets.has("b")).toBe(true)
    expect(__testing.buckets.size).toBe(2)
  })
})
