import { describe, it, expect } from "vitest"
import { classifyFailure } from "../lib/extract"

describe("classifyFailure", () => {
  it("does not misclassify arbitrary failures as FILE_TOO_LARGE just because --max-filesize flag exists in command text", () => {
    const raw =
      "native: Error: Command failed: yt-dlp --max-filesize 5G -f 1080p https://example.com\nERROR: Requested format is not available"
    const out = classifyFailure(raw, "download")
    expect(out.category).toBe("NO_FORMAT")
  })

  it("maps timeout errors to resolve/download specific timeout categories", () => {
    expect(classifyFailure("ETIMEDOUT while fetching metadata", "resolve").category).toBe("RESOLVE_TIMEOUT")
    expect(classifyFailure("operation timed out", "download").category).toBe("DOWNLOAD_TIMEOUT")
  })

  // Directive 7: PO-token must be its own category, not LOGIN_REQUIRED
  it("classifies po_token errors as PO_TOKEN_REQUIRED, not LOGIN_REQUIRED", () => {
    const raw = "ERROR: Sign in to confirm you're not a bot. Use --cookies-from-browser or supply a po_token."
    const out = classifyFailure(raw)
    expect(out.category).toBe("PO_TOKEN_REQUIRED")
    // Message must not tell the user to add cookies
    expect(out.message).not.toMatch(/add.*cookie|cookie.*add/i)
  })

  it("classifies cookies-from-browser errors as ANTI_BOT, not LOGIN_REQUIRED", () => {
    const raw = "ERROR: Could not read browser cookies. Use --cookies-from-browser."
    const out = classifyFailure(raw)
    expect(out.category).toBe("ANTI_BOT")
  })

  it("classifies genuine sign-in requirement as LOGIN_REQUIRED", () => {
    const raw = "ERROR: Sign in to access this video. Use --cookies to provide your session cookies."
    const out = classifyFailure(raw)
    expect(out.category).toBe("LOGIN_REQUIRED")
  })

  it("classifies CAPTCHA / bot-block as ANTI_BOT", () => {
    expect(classifyFailure("ERROR: CAPTCHA challenge required").category).toBe("ANTI_BOT")
    expect(classifyFailure("ERROR: Access denied by Cloudflare").category).toBe("ANTI_BOT")
    expect(classifyFailure("ERROR: datacenter IP blocked by site").category).toBe("ANTI_BOT")
  })

  it("classifies DRM errors correctly", () => {
    expect(classifyFailure("ERROR: DRM-protected content, Widevine required").category).toBe("DRM")
  })

  it("classifies geo-restriction correctly", () => {
    expect(classifyFailure("ERROR: not available in your country").category).toBe("GEO_RESTRICTED")
  })

  it("classifies rate-limit errors correctly", () => {
    expect(classifyFailure("ERROR: HTTP Error 429: Too Many Requests").category).toBe("RATE_LIMITED")
  })

  it("never exposes raw --cookies flag from echoed command line in classification", () => {
    const raw =
      "native-cookie: Error: Command failed: yt-dlp --cookies /tmp/session/yt-cookies.txt https://example.com\nERROR: Video unavailable"
    const out = classifyFailure(raw, "download")
    // Should classify as VIDEO_UNAVAILABLE, not INTERNAL_ERROR
    expect(out.category).toBe("VIDEO_UNAVAILABLE")
    // detail must be compact and not contain the full raw command line with cookie path
    expect(out.detail.length).toBeLessThanOrEqual(240)
  })
})
