"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Download,
  Image as ImageIcon,
  Loader2,
  Clock,
  User,
  Globe,
  Play,
  FileText,
  ChevronRight,
  Film,
  Music,
} from "lucide-react"
import { VideoInfo, DownloadResult, HistoryItem } from "@/types"
import { parseApiResponse } from "@/lib/client-api"

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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** Short box labels for the quality grid. */
const SHORT_LABELS: Record<string, string> = {
  best: "Best",
  "2160p": "4K",
  "1440p": "2K",
  "1080p": "1080p",
  "720p": "720p",
  "480p": "480p",
  "360p": "360p",
  audio: "MP3",
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

type MediaTab = "video" | "audio" | "images"

export function VideoCard({ info, sourceUrl, onQueued, onSettled }: VideoCardProps) {
  const [tab, setTab] = useState<MediaTab>("video")
  const [downloadingQuality, setDownloadingQuality] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<DownloadResult | null>(null)

  const handleDownload = async (quality: string) => {
    setDownloadingQuality(quality)
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
      const data = await parseApiResponse<DownloadResult>(res)
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
      setDownloadingQuality(null)
    }
  }

  const thumbHref = info.thumbnail
    ? `/api/thumb?url=${encodeURIComponent(info.thumbnail)}&name=${encodeURIComponent(
        info.title.slice(0, 60)
      )}`
    : null

  const videoFormats = info.formats.filter((f) => f.value !== "audio")
  const audioFormats = info.formats.filter((f) => f.value === "audio")

  const FormatBox = ({ value, ext }: { value: string; ext: string }) => {
    const busy = downloadingQuality === value
    return (
      <button
        onClick={() => handleDownload(value)}
        disabled={downloadingQuality !== null}
        className="group flex flex-col items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-card px-2 py-4 transition-all hover:border-primary hover:bg-accent/40 hover:gold-glow-sm active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
      >
        <span className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">
          {SHORT_LABELS[value] ?? value}
        </span>
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{ext}</span>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <Download className="h-4 w-4 text-primary" />
        )}
      </button>
    )
  }

  const tabs: { key: MediaTab; label: string; icon: React.ReactNode }[] = [
    { key: "video", label: "Video", icon: <Film className="h-4 w-4" /> },
    { key: "audio", label: "Audio", icon: <Music className="h-4 w-4" /> },
    { key: "images", label: "Images", icon: <ImageIcon className="h-4 w-4" /> },
  ]

  return (
    <Card className="overflow-hidden border-primary/25 bg-card">
      <CardContent className="p-0">
        {/* Title strip */}
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm font-medium truncate">{info.title}</p>
        </div>

        {/* Thumbnail with play overlay */}
        {info.thumbnail && (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={info.thumbnail}
              alt={info.title}
              className="aspect-video w-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-lg">
                <Play className="h-6 w-6 text-black fill-black ml-0.5" />
              </span>
            </div>
            {info.duration != null && (
              <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-2 py-0.5 text-xs font-medium text-white flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatDuration(info.duration)}
              </span>
            )}
          </div>
        )}

        {/* Meta rows */}
        <div className="divide-y divide-border">
          {info.uploader && (
            <div className="flex items-center justify-between px-4 py-3.5">
              <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
                  <User className="h-4 w-4 text-primary" />
                </span>
                Uploader
              </span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-primary max-w-[55%] truncate">
                {info.uploader} <ChevronRight className="h-4 w-4 shrink-0" />
              </span>
            </div>
          )}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between px-4 py-3.5 hover:bg-accent/30 transition-colors"
          >
            <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
                <Globe className="h-4 w-4 text-primary" />
              </span>
              Source
            </span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-primary max-w-[55%] truncate">
              {hostOf(sourceUrl)} <ChevronRight className="h-4 w-4 shrink-0" />
            </span>
          </a>
        </div>

        {/* Media tabs */}
        <div className="grid grid-cols-3 border-y border-border">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? "border-primary text-primary bg-accent/30"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Format grids */}
        <div className="p-4 space-y-4">
          {tab === "video" && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Film className="h-3.5 w-3.5" /> Video Formats
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {videoFormats.map((f) => (
                  <FormatBox key={f.value} value={f.value} ext="MP4" />
                ))}
              </div>
            </>
          )}

          {tab === "audio" && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Music className="h-3.5 w-3.5" /> Audio Formats
              </p>
              {audioFormats.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                  {audioFormats.map((f) => (
                    <FormatBox key={f.value} value={f.value} ext="MP3" />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No audio-only format available for this video.</p>
              )}
            </>
          )}

          {tab === "images" && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5" /> Images
              </p>
              {thumbHref ? (
                <a
                  href={thumbHref}
                  className="group flex flex-col items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-card px-2 py-4 transition-all hover:border-primary hover:bg-accent/40 hover:gold-glow-sm active:scale-95 w-32"
                >
                  <span className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">
                    Thumbnail
                  </span>
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider">JPG</span>
                  <Download className="h-4 w-4 text-primary" />
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">No thumbnail available for this video.</p>
              )}
            </>
          )}

          {/* Status messages */}
          {downloadingQuality && (
            <p className="text-xs text-muted-foreground">
              Added to your History — fetching and converting on the server now (large videos can
              take longer)…
            </p>
          )}
          {done && (
            <p className="text-sm text-green-500">
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

        {/* Platform badge footer */}
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Badge variant="secondary">{info.platform}</Badge>
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" /> {formatDuration(info.duration)}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
