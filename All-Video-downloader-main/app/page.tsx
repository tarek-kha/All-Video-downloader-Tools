"use client"

import { useState, useEffect, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Link2,
  Loader2,
  Video,
  Download,
  ClipboardPaste,
  X,
  Home,
  Clock,
  Inbox,
} from "lucide-react"
import { VideoCard } from "@/components/video-card"
import { HistoryList } from "@/components/history-list"
import { CookieSettings } from "@/components/cookie-settings"
import { VideoInfo, HistoryItem } from "@/types"
import { parseApiResponse } from "@/lib/client-api"

const HISTORY_KEY = "vdl-history-v1"
const PLATFORMS = [
  "YouTube",
  "TikTok",
  "Instagram",
  "X / Twitter",
  "Facebook",
  "Vimeo",
  "Reddit",
  "+1000 more",
]

export default function HomePage() {
  const [tab, setTab] = useState<"home" | "history">("home")
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<VideoInfo | null>(null)
  const [fetchedUrl, setFetchedUrl] = useState("")
  const [history, setHistory] = useState<HistoryItem[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (raw) setHistory(JSON.parse(raw))
    } catch {
      // ignore corrupt history
    }
  }, [])

  const saveHistory = useCallback((items: HistoryItem[]) => {
    setHistory(items)
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50)))
    } catch {
      // storage full — ignore
    }
  }, [])

  // Called the instant Download is clicked — item appears immediately.
  const handleQueued = useCallback((item: HistoryItem) => {
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 50)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  // Called once the server responds — patches the same item with final state.
  const handleSettled = useCallback((id: string, patch: Partial<HistoryItem>) => {
    setHistory((prev) => {
      const next = prev.map((h) => (h.id === id ? { ...h, ...patch } : h))
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text.trim())
    } catch {
      // clipboard permission denied or unavailable — ignore
    }
  }

  const handleFetch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const target = url.trim()
    if (!target) return
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      })
      const data = await parseApiResponse<VideoInfo>(res)
      setInfo(data)
      setFetchedUrl(target)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Top bar */}
      <div className="container mx-auto max-w-2xl px-4 pt-4 flex justify-end">
        <CookieSettings />
      </div>

      {tab === "home" ? (
        <main className="container mx-auto max-w-2xl px-4 pt-6 space-y-7">
          {/* Hero */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl border border-primary/40 bg-primary/10 gold-glow">
              <Video className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gold-gradient leading-tight">
                All-in-One
                <br />
                Video Downloader
              </h1>
              <p className="text-muted-foreground mt-3 text-sm sm:text-base">
                Paste a video link from any platform and
                <br className="sm:hidden" /> download in different qualities.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              {PLATFORMS.map((p) => (
                <Badge
                  key={p}
                  variant="outline"
                  className="font-normal border-primary/30 text-foreground/80 px-3 py-1"
                >
                  {p}
                </Badge>
              ))}
            </div>
          </div>

          {/* URL input + Download (fetch) button */}
          <form onSubmit={handleFetch} className="space-y-3">
            <div className="relative">
              <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste video link here..."
                className="h-14 text-base pl-11 pr-20 rounded-xl border-primary/30 bg-card focus-visible:ring-primary/50"
                autoFocus
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={handlePaste}
                  aria-label="Paste from clipboard"
                  className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                >
                  <ClipboardPaste className="h-4 w-4" />
                </button>
                {url && (
                  <button
                    type="button"
                    onClick={() => setUrl("")}
                    aria-label="Clear"
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="w-full h-14 rounded-xl bg-gradient-to-b from-amber-300 via-yellow-500 to-amber-600 text-[#1a1206] font-extrabold text-lg tracking-wide gold-glow-sm hover:brightness-110 active:brightness-95 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Download className="h-5 w-5" />
              )}
              {loading ? "FETCHING…" : "DOWNLOAD"}
            </button>
          </form>

          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Result */}
          {info && (
            <VideoCard
              info={info}
              sourceUrl={fetchedUrl}
              onQueued={handleQueued}
              onSettled={handleSettled}
            />
          )}

          {/* Empty state */}
          {!info && !loading && !error && (
            <div className="rounded-2xl border border-border bg-card/50 px-4 py-10 text-center space-y-3">
              <Inbox className="h-10 w-10 mx-auto text-muted-foreground/50" />
              <p className="text-muted-foreground text-sm">
                No downloads yet
                <br />
                <span className="text-xs">Your downloaded videos will appear in History.</span>
              </p>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground/70 pt-2">
            Only download content you have the right to save. Respect each platform&apos;s
            terms of service and copyright law.
          </p>
        </main>
      ) : (
        <main className="container mx-auto max-w-2xl px-4 pt-6 space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" /> Download History
            <span className="text-sm font-normal text-muted-foreground">
              ({history.length})
            </span>
          </h2>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card/50 px-4 py-10 text-center space-y-3">
              <Inbox className="h-10 w-10 mx-auto text-muted-foreground/50" />
              <p className="text-muted-foreground text-sm">
                Nothing here yet — downloaded videos will show up in this list.
              </p>
            </div>
          ) : (
            <HistoryList
              items={history}
              onClear={() => saveHistory([])}
              onRemove={(id) => saveHistory(history.filter((h) => h.id !== id))}
            />
          )}
        </main>
      )}

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="container mx-auto max-w-2xl flex">
          <button
            onClick={() => setTab("home")}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
              tab === "home" ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Home className="h-5 w-5" />
            Home
            <span
              className={`h-0.5 w-10 rounded-full transition-colors ${
                tab === "home" ? "bg-primary" : "bg-transparent"
              }`}
            />
          </button>
          <button
            onClick={() => setTab("history")}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors relative ${
              tab === "history" ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="relative">
              <Clock className="h-5 w-5" />
              {history.length > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {history.length}
                </span>
              )}
            </span>
            History
            <span
              className={`h-0.5 w-10 rounded-full transition-colors ${
                tab === "history" ? "bg-primary" : "bg-transparent"
              }`}
            />
          </button>
        </div>
      </nav>
    </div>
  )
}
