"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Download, Image, Loader2, Clock, User } from "lucide-react"
import { VideoInfo, DownloadResult, HistoryItem } from "@/types"

function formatDuration(s: number | null): string {
  if (s == null) return "—"
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`
}

function formatBytes(n: number): string {
  if (n > 1e9) return (n / 1e9).toFixed(2) + " GB"
  if (n > 1e6) return (n / 1e6).toFixed(1) + " MB"
  return (n / 1e3).toFixed(0) + " KB"
}

interface VideoCardProps {
  info: VideoInfo
  sourceUrl: string
  /** Called IMMEDIATELY when Download is clicked (status: "downloading") so
   * the item appears in history right away, before the server responds. */
  onQueued: (item: HistoryItem) => void
  /** Called once the server responds, patching the same history item by id
   * with the final status ("complete" or "failed") and result details. */
  onSettled: (id: string, patch: Partial<HistoryItem>) => void
}

export function VideoCard({ info, sourceUrl, onQueued, onSettled }: VideoCardProps) {
  const [quality, setQuality] = useState(info.formats[0]?.value ?? "best")
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<DownloadResult | null>(null)

  const handleDownload = async () => {
    setDownloading(true)
    setError(null)
    setDone(null)

    // Instant feedback: add the history item right away, before the network
    // request even starts, so the user sees it appear immediately.
    const historyId = crypto.randomUUID()
    onQueued({
      id: historyId,
      url: sourceUrl,
      title: info.title,
      thumbnail: info.thumbnail,
      platform: info.platform,
      quality,
      filename: "",
      fileId: "",
      downloadedAt: new Date().toISOString(),
      status: "downloading",
    })

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send the resolveId from /api/info's response when available so the
        // server can reuse the already-resolved context (Phase 2) instead of
        // re-deriving platform/cookie info from the raw URL again.
        body: JSON.stringify({ url: sourceUrl, quality, resolveId: info.resolveId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Download failed")
      setDone(data)
      onSettled(historyId, {
        filename: data.filename,
        fileId: data.fileId,
        status: "complete",
      })
      // Trigger the browser download
      window.location.href = `/api/file/${data.fileId}`
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Download failed"
      setError(message)
      onSettled(historyId, { status: "failed", error: message })
    } finally {
      setDownloading(false)
    }
  }

  const thumbHref = info.thumbnail
    ? `/api/thumb?url=${encodeURIComponent(info.thumbnail)}&name=${encodeURIComponent(
        info.title.slice(0, 60)
      )}`
    : null

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col sm:flex-row">
          {info.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={info.thumbnail}
              alt={info.title}
              className="h-48 w-full sm:w-72 object-cover shrink-0"
            />
          )}
          <div className="p-5 flex flex-col gap-3 flex-1 min-w-0">
            <div className="flex items-start gap-2">
              <Badge variant="secondary">{info.platform}</Badge>
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" /> {formatDuration(info.duration)}
              </Badge>
            </div>
            <h2 className="font-semibold text-lg leading-snug line-clamp-2">{info.title}</h2>
            {info.uploader && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <User className="h-3.5 w-3.5" /> {info.uploader}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-2 mt-auto">
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger className="sm:w-56">
                  <SelectValue placeholder="Quality" />
                </SelectTrigger>
                <SelectContent>
                  {info.formats.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleDownload} disabled={downloading} className="gap-2">
                {downloading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Downloading…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" /> Download
                  </>
                )}
              </Button>
              {thumbHref && (
                <Button variant="outline" asChild className="gap-2">
                  <a href={thumbHref}>
                    <Image className="h-4 w-4" /> Thumbnail
                  </a>
                </Button>
              )}
            </div>

            {downloading && (
              <p className="text-xs text-muted-foreground">
                Added to your download list below — fetching and converting on the server now
                (large videos can take longer)…
              </p>
            )}
            {done && (
              <p className="text-sm text-green-600 dark:text-green-400">
                Saved {done.filename} ({formatBytes(done.sizeBytes)}) — your download should start
                automatically.{" "}
                <a className="underline" href={`/api/file/${done.fileId}`}>
                  Click here
                </a>{" "}
                if it didn&apos;t.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
