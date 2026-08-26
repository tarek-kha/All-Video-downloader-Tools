import { describe, expect, it } from "vitest"
import { parseApiResponse } from "../lib/client-api"

describe("parseApiResponse", () => {
  it("parses JSON success responses", async () => {
    const res = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
    await expect(parseApiResponse<{ ok: boolean }>(res)).resolves.toEqual({ ok: true })
  })

  it("returns friendly message for HTML gateway errors instead of JSON parse errors", async () => {
    const res = new Response("<!DOCTYPE html><html><body>502 Bad Gateway</body></html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    })
    await expect(parseApiResponse(res)).rejects.toThrow("Server temporarily unavailable.")
  })

  it("returns text for successful non-JSON responses", async () => {
    const res = new Response("ok", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })
    await expect(parseApiResponse<string>(res)).resolves.toBe("ok")
  })
})
