import { describe, it, expect, vi, beforeEach } from "vitest"
import { promises as fs } from "fs"
import { putResolve, getResolve } from "../lib/resolve-cache"

async function readInfoJson(infoJsonPath: string) {
  return JSON.parse(await fs.readFile(infoJsonPath, "utf8"))
}

describe("resolve-cache", () => {
  it("stores and retrieves an entry by id", async () => {
    const id = await putResolve("https://example.com/video", null, "session-a", { title: "Test" })
    const hit = getResolve(id, "session-a")
    expect(hit).not.toBeNull()
    expect(hit?.url).toBe("https://example.com/video")
    const info = await readInfoJson(hit!.infoJsonPath)
    expect(info.title).toBe("Test")
  })

  it("returns null for an unknown id", () => {
    expect(getResolve("00000000-0000-0000-0000-000000000000", "session-a")).toBeNull()
  })

  it("denies access when a different session requests a cookie-backed resolve", async () => {
    const id = await putResolve("https://example.com/private", "/tmp/fake-cookies.txt", "session-owner", {
      title: "Private",
    })
    // The owning session can read it
    expect(getResolve(id, "session-owner")).not.toBeNull()
    // A different session must NOT be able to reuse a cookie-backed resolve
    expect(getResolve(id, "session-intruder")).toBeNull()
  })

  it("denies cross-session reuse even when no cookies were involved", async () => {
    const id = await putResolve("https://example.com/public", null, "session-owner", { title: "Public" })
    expect(getResolve(id, "some-other-session")).toBeNull()
  })

  it("writes the entry to a temp info.json file for --load-info-json reuse", async () => {
    const id = await putResolve("https://example.com/video2", null, "session-a", { title: "InfoJson" })
    const hit = getResolve(id, "session-a")
    expect(hit?.infoJsonPath).toMatch(/\.json$/)
    const info = await readInfoJson(hit!.infoJsonPath)
    expect(info.title).toBe("InfoJson")
  })
})

describe("resolve-cache bounds", () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.RESOLVE_CACHE_MAX_ENTRIES
  })

  it("caps in-memory entries and evicts oldest entries when at capacity", async () => {
    process.env.RESOLVE_CACHE_MAX_ENTRIES = "2"
    const mod = await import("../lib/resolve-cache")
    const id1 = await mod.putResolve("https://example.com/1", null, "session-a", { id: 1 })
    const id2 = await mod.putResolve("https://example.com/2", null, "session-a", { id: 2 })
    const id3 = await mod.putResolve("https://example.com/3", null, "session-a", { id: 3 })

    expect(mod.__testing.cache.size).toBeLessThanOrEqual(2)
    expect(mod.getResolve(id1, "session-a")).toBeNull()
    expect(mod.getResolve(id2, "session-a") || mod.getResolve(id3, "session-a")).not.toBeNull()
  })
})
