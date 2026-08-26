// Next.js server-startup hook (stable since Next 15, no experimental flag
// needed). Starts the Phase 4 cleanup scheduler exactly once when the
// server boots, instead of lazily on first request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCleanupScheduler } = await import("./lib/cleanup")
    startCleanupScheduler()
  }
}
