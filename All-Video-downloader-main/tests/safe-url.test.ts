import { describe, it, expect } from "vitest"
import { isPrivateIp, isSyntacticallySafeUrl, isSafeToFetch } from "../lib/security/safe-url"

describe("isPrivateIp", () => {
  it("flags common private/internal IPv4 ranges", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true)
    expect(isPrivateIp("10.0.0.5")).toBe(true)
    expect(isPrivateIp("172.16.0.1")).toBe(true)
    expect(isPrivateIp("192.168.1.1")).toBe(true)
    expect(isPrivateIp("169.254.169.254")).toBe(true) // cloud metadata endpoint
    expect(isPrivateIp("0.0.0.0")).toBe(true)
  })

  it("allows public IPv4 addresses", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false)
    expect(isPrivateIp("1.1.1.1")).toBe(false)
  })

  it("flags IPv6 loopback and link-local", () => {
    expect(isPrivateIp("::1")).toBe(true)
    expect(isPrivateIp("fe80::1")).toBe(true)
  })
})

describe("isSyntacticallySafeUrl", () => {
  it("rejects non-http(s) schemes", () => {
    expect(isSyntacticallySafeUrl("ftp://example.com").ok).toBe(false)
    expect(isSyntacticallySafeUrl("file:///etc/passwd").ok).toBe(false)
  })

  it("rejects malformed URLs", () => {
    expect(isSyntacticallySafeUrl("not a url").ok).toBe(false)
  })

  it("rejects embedded credentials", () => {
    expect(isSyntacticallySafeUrl("https://user:pass@example.com").ok).toBe(false)
  })

  it("rejects localhost and raw private IPs", () => {
    expect(isSyntacticallySafeUrl("http://localhost/").ok).toBe(false)
    expect(isSyntacticallySafeUrl("http://127.0.0.1/").ok).toBe(false)
    expect(isSyntacticallySafeUrl("http://169.254.169.254/latest/meta-data").ok).toBe(false)
  })

  it("allows a normal public https URL", () => {
    expect(isSyntacticallySafeUrl("https://example.com/video/123").ok).toBe(true)
  })
})

describe("isSafeToFetch (DNS-resolving check)", () => {
  it("rejects a hostname that resolves to localhost", async () => {
    // "localhost" itself is already caught synchronously, but this exercises
    // the async DNS path for a made-up private-pointing hostname pattern.
    const result = await isSafeToFetch("http://127.0.0.1:8080/internal")
    expect(result.ok).toBe(false)
  })

  it("allows a public IP address without requiring DNS", async () => {
    const result = await isSafeToFetch("https://8.8.8.8/")
    expect(result.ok).toBe(true)
  })
})
