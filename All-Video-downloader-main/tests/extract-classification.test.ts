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
})
