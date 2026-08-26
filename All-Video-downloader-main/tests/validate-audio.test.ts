/**
 * Regression tests for:
 *  - pickOutput: prefers merged file over .fNNN fragments
 *  - validateMediaFile: hasVideo / hasAudio exposed correctly
 *
 * All ffprobe calls are mocked — no real media files, no network access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { promisify } from "util"

// ---------------------------------------------------------------------------
// Mock child_process so ffprobe returns controlled JSON
// ---------------------------------------------------------------------------

type FfprobeResponse = {
  format?: { format_name?: string; duration?: string }
  streams?: Array<{ codec_type?: string; codec_name?: string }>
}

let ffprobeResponse: FfprobeResponse = {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "120" },
  streams: [
    { codec_type: "video", codec_name: "h264" },
    { codec_type: "audio", codec_name: "aac" },
  ],
}

vi.mock("child_process", () => {
  function execFile(
    _cmd: string,
    _args: string[],
    optsOrCb: unknown,
    maybeCb?: (err: Error | null, stdout: string, stderr: string) => void
  ) {
    const callback = (typeof optsOrCb === "function" ? optsOrCb : maybeCb) as (
      err: Error | null,
      stdout: string,
      stderr: string
    ) => void
    callback(null, JSON.stringify(ffprobeResponse), "")
  }
  ;(execFile as unknown as Record<symbol, unknown>)[promisify.custom] = (
    _cmd: string,
    _args: string[]
  ) =>
    new Promise((resolve) => {
      resolve({ stdout: JSON.stringify(ffprobeResponse), stderr: "" })
    })
  return { execFile }
})

beforeEach(() => {
  ffprobeResponse = {
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "120" },
    streams: [
      { codec_type: "video", codec_name: "h264" },
      { codec_type: "audio", codec_name: "aac" },
    ],
  }
  vi.resetModules()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "vt-"))
}

async function makeFile(dir: string, name: string, size: number): Promise<void> {
  await fs.writeFile(path.join(dir, name), Buffer.alloc(size, 0x1))
}

// ---------------------------------------------------------------------------
// validateMediaFile tests
// ---------------------------------------------------------------------------

describe("validateMediaFile", () => {
  it("returns hasVideo=true and hasAudio=true for a normal merged file", async () => {
    const { validateMediaFile } = await import("../lib/validate")
    const dir = await makeTmpDir()
    const f = path.join(dir, "video.mp4")
    await fs.writeFile(f, Buffer.alloc(8192, 0x0)) // dummy content ≥ 4096 bytes
    const result = await validateMediaFile(f)
    expect(result.ok).toBe(true)
    expect(result.hasVideo).toBe(true)
    expect(result.hasAudio).toBe(true)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("exposes hasVideo=true and hasAudio=false for a video-only stream", async () => {
    ffprobeResponse = {
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "60" },
      streams: [{ codec_type: "video", codec_name: "h264" }],
    }
    const { validateMediaFile } = await import("../lib/validate")
    const dir = await makeTmpDir()
    const f = path.join(dir, "video_only.mp4")
    await fs.writeFile(f, Buffer.alloc(8192, 0x0))
    const result = await validateMediaFile(f)
    // ok is still true (validate only checks is-it-media, not audio+video presence)
    expect(result.ok).toBe(true)
    expect(result.hasVideo).toBe(true)
    expect(result.hasAudio).toBe(false)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("returns ok=false for a file that is too small", async () => {
    const { validateMediaFile } = await import("../lib/validate")
    const dir = await makeTmpDir()
    const f = path.join(dir, "tiny.mp4")
    await fs.writeFile(f, Buffer.alloc(100))
    const result = await validateMediaFile(f)
    expect(result.ok).toBe(false)
    await fs.rm(dir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// pickOutput: merged-output picker
// ---------------------------------------------------------------------------

describe("pickOutput", () => {
  it("prefers the merged file over .fNNN format fragments (merged is smaller)", async () => {
    const { pickOutput } = await import("../lib/extract")
    const dir = await makeTmpDir()
    // Merged file is SMALLER than the video fragment — pickOutput must still
    // prefer it because it has no .fNNN suffix.
    await makeFile(dir, "Title.mp4", 1024 * 1024)          // 1 MB merged
    await makeFile(dir, "Title.f399.mp4", 2 * 1024 * 1024) // 2 MB video fragment
    await makeFile(dir, "Title.f251.webm", 512 * 1024)     // 512 KB audio fragment
    const result = await pickOutput(dir)
    expect(result?.name).toBe("Title.mp4")
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("ignores .part artifact files and returns the merged output", async () => {
    const { pickOutput } = await import("../lib/extract")
    const dir = await makeTmpDir()
    await makeFile(dir, "Title.mp4", 1024 * 1024)
    await makeFile(dir, "Title.mp4.part", 3 * 1024 * 1024) // large artifact — must be ignored
    const result = await pickOutput(dir)
    expect(result?.name).toBe("Title.mp4")
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("falls back to the largest file when no merged candidate exists", async () => {
    const { pickOutput } = await import("../lib/extract")
    const dir = await makeTmpDir()
    // Only fragments remain (merge step never ran / was skipped)
    await makeFile(dir, "Title.f140.m4a", 512 * 1024)         // audio 512 KB
    await makeFile(dir, "Title.f137.mp4", 2 * 1024 * 1024)    // video 2 MB
    const result = await pickOutput(dir)
    // Largest is the video fragment
    expect(result?.name).toBe("Title.f137.mp4")
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("returns null for an empty directory", async () => {
    const { pickOutput } = await import("../lib/extract")
    const dir = await makeTmpDir()
    const result = await pickOutput(dir)
    expect(result).toBeNull()
    await fs.rm(dir, { recursive: true, force: true })
  })
})
