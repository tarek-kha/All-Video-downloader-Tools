"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, Loader2, Video, Download, ClipboardPaste, X } from "lucide-react"
import { VideoCard } from "@/components/video-card"
import { HistoryList } from "@/components/history-list"
import { CookieSettings } from "@/components/cookie-settings"
import { VideoInfo, HistoryItem } from "@/types"

const HISTORY_KEY = "vdl-history-v1"
const PLATFORMS = ["YouTube", "TikTok", "Instagram", "X / Twitter", "Facebook", "LinkedIn", "Vimeo", "Reddit", "VK Video", "OK.ru", "+1000 more"]

export default function HomePage() {
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
  const handleQueued = useCallback(
    (item: HistoryItem) => {
      setHistory((prev) => {
        const next = [item, ...prev].slice(0, 50)
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
        } catch {
          // ignore
        }
        return next
      })
    },
    []
  )

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
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch video info")
      setInfo(data)
      setFetchedUrl(target)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      {/* Top bar — compact cookie manager lives here now, not at the bottom */}
      <div className="container mx-auto max-w-3xl px-4 pt-4 flex justify-end">
        <CookieSettings />
      </div>

      <main className="container mx-auto max-w-3xl px-4 pt-4 pb-12 space-y-8">
        {/* Hero */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary text-primary-foreground mb-1">
            <Video className="h-7 w-7" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">All-in-One Video Downloader</h1>
          <p className="text-muted-foreground">
            Paste any video link — pick your quality, grab the thumbnail, done. Supports files up
            to 5GB.
          </p>
          <div className="flex flex-wrap justify-center gap-1.5 pt-1">
            {PLATFORMS.map((p) => (
              <Badge key={p} variant="outline" className="font-normal">
                {p}
              </Badge>
            ))}
          </div>
        </div>

        {/* URL input */}
        <form onSubmit={handleFetch} className="flex gap-2">
          <div className="relative flex-1">
            <button
              type="button"
              onClick={handlePaste}
              aria-label="Paste from clipboard"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ClipboardPaste className="h-4 w-4" />
            </button>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=… or any TikTok / Instagram / X link"
              className="h-12 text-base pl-9 pr-9"
              autoFocus
            />
            {url && (
              <button
                type="button"
                onClick={() => setUrl("")}
                aria-label="Clear"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button type="submit" size="lg" disabled={loading || !url.trim()} className="h-12 gap-2 px-6">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {loading ? "Fetching…" : "Fetch"}
          </Button>
        </form>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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

        {/* Empty-state hint */}
        {!info && !loading && !error && history.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            <Download className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Your downloads will appear here.
          </div>
        )}

        {/* History */}
        <HistoryList
          items={history}
          onClear={() => saveHistory([])}
          onRemove={(id) => saveHistory(history.filter((h) => h.id !== id))}
        />

        <p className="text-center text-xs text-muted-foreground pt-4">
          Only download content you have the right to save. Respect each platform&apos;s terms of
          service and copyright law.
        </p>
      </main>
    </div>
  )
}
