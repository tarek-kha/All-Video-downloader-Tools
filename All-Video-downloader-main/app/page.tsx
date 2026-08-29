"use client"

import { useState, useEffect, useCallback } from "react"
import { Input } from "@/components/ui/input"
import {
  Link2,
  Loader2,
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
import { BRANDS, BrandIcon } from "@/components/platform-logos"
import { VideoInfo, HistoryItem } from "@/types"
import { parseApiResponse } from "@/lib/client-api"

const HISTORY_KEY = "vdl-history-v1"
const PLATFORM_KEYS = [
  "youtube",
  "tiktok",
  "instagram",
  "x",
  "facebook",
  "vimeo",
  "reddit",
] as const

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
    <div className="min-h-screen bg-background pb-20">
      {/* Top bar */}
      <div className="container mx-auto max-w-2xl px-4 pt-2.5 flex justify-end">
        <CookieSettings />
      </div>

      {tab === "home" ? (
        <main className="container mx-auto max-w-2xl px-4 pt-2 space-y-4">
          {/* Hero: logo → subtitle → platform pills */}
          <div className="text-center space-y-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="VidSaver"
              className="mx-auto h-16 sm:h-20 w-auto select-none drop-shadow-[0_4px_18px_rgba(250,204,21,0.25)]"
              draggable={false}
            />
            <p className="text-muted-foreground text-xs sm:text-sm">
              Paste a video link from any platform and download in different qualities.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {PLATFORM_KEYS.map((key) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-card/60 px-2.5 py-1 text-[11px] font-medium text-foreground/80"
                >
                  <BrandIcon brand={key} className="h-3.5 w-3.5" />
                  {BRANDS[key].label}
                </span>
              ))}
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-card/60 px-2.5 py-1 text-[11px] font-medium text-primary">
                +1000 more
              </span>
            </div>
          </div>

          {/* URL input + Download (fetch) button */}
          <form onSubmit={handleFetch} className="space-y-2.5">
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste video link here..."
                className="h-11 text-sm pl-9 pr-16 rounded-xl border-primary/30 bg-card focus-visible:ring-primary/50"
                autoFocus
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
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
              className="w-full h-11 rounded-xl bg-gradient-to-b from-amber-300 via-yellow-500 to-amber-600 text-[#1a1206] font-extrabold text-base tracking-wide gold-glow-sm hover:brightness-110 active:brightness-95 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {loading ? "FETCHING…" : "DOWNLOAD"}
            </button>
          </form>

          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
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
            <div className="rounded-2xl border border-border bg-card/50 px-4 py-6 text-center space-y-2">
              <Inbox className="h-8 w-8 mx-auto text-muted-foreground/50" />
              <p className="text-muted-foreground text-xs">
                No downloads yet — your downloaded videos will appear in History.
              </p>
            </div>
          )}

          <p className="text-center text-[10px] text-muted-foreground/60">
            Only download content you have the right to save. Respect each platform&apos;s
            terms of service and copyright law.
          </p>
        </main>
      ) : (
        <main className="container mx-auto max-w-2xl px-4 pt-4 space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" /> Download History
            <span className="text-sm font-normal text-muted-foreground">
              ({history.length})
            </span>
          </h2>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card/50 px-4 py-8 text-center space-y-2">
              <Inbox className="h-8 w-8 mx-auto text-muted-foreground/50" />
              <p className="text-muted-foreground text-xs">
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
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
              tab === "home" ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Home className="h-4 w-4" />
            Home
            <span
              className={`h-0.5 w-8 rounded-full transition-colors ${
                tab === "home" ? "bg-primary" : "bg-transparent"
              }`}
            />
          </button>
          <button
            onClick={() => setTab("history")}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors relative ${
              tab === "history" ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="relative">
              <Clock className="h-4 w-4" />
              {history.length > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {history.length}
                </span>
              )}
            </span>
            History
            <span
              className={`h-0.5 w-8 rounded-full transition-colors ${
                tab === "history" ? "bg-primary" : "bg-transparent"
              }`}
            />
          </button>
        </div>
      </nav>
    </div>
  )
}
