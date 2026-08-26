import { describe, it, expect } from "vitest"
import { checkRateLimit } from "../lib/security/rate-limit"

describe("checkRateLimit", () => {
  it("allows requests up to the limit", () => {
    const key = `test-allow-${Math.random()}`
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000)).toBe(true)
    }
  })

  it("rejects requests beyond the limit within the window", () => {
    const key = `test-reject-${Math.random()}`
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 60_000)).toBe(true)
    }
    expect(checkRateLimit(key, 3, 60_000)).toBe(false)
  })

  it("resets after the window elapses", async () => {
    const key = `test-reset-${Math.random()}`
    expect(checkRateLimit(key, 1, 50)).toBe(true)
    expect(checkRateLimit(key, 1, 50)).toBe(false)
    await new Promise((r) => setTimeout(r, 80))
    expect(checkRateLimit(key, 1, 50)).toBe(true)
  })

  it("tracks separate keys independently", () => {
    const keyA = `test-a-${Math.random()}`
    const keyB = `test-b-${Math.random()}`
    expect(checkRateLimit(keyA, 1, 60_000)).toBe(true)
    expect(checkRateLimit(keyA, 1, 60_000)).toBe(false)
    // A different key should be unaffected by A's limit
    expect(checkRateLimit(keyB, 1, 60_000)).toBe(true)
  })
})

describe("concurrency guards", () => {
  it("caps concurrent acquisitions at the configured max and releases correctly", async () => {
    const { extractGuard } = await import("../lib/security/rate-limit")
    const startingLoad = extractGuard.current
    const acquired: boolean[] = []
    // extractGuard max is 4 — acquire up to that many plus one extra
    for (let i = 0; i < 4; i++) acquired.push(extractGuard.tryAcquire())
    const overLimit = extractGuard.tryAcquire()
    expect(acquired.every(Boolean)).toBe(true)
    // If we started at 0, a 5th acquire beyond max(4) should fail
    if (startingLoad === 0) {
      expect(overLimit).toBe(false)
    }
    // Release everything we acquired
    for (const a of acquired) if (a) extractGuard.release()
    if (overLimit) extractGuard.release()
    expect(extractGuard.current).toBe(startingLoad)
  })
})
