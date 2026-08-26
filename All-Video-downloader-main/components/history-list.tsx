"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Download, Trash, Clock, Share, Check, Loader2, AlertCircle } from "lucide-react"
import { HistoryItem } from "@/types"

interface HistoryListProps {
  items: HistoryItem[]
  onClear: () => void
  onRemove: (id: string) => void
}

export function HistoryList({ items, onClear, onRemove }: HistoryListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  if (!items.length) return null

  const share = async (item: HistoryItem) => {
    const link =
      typeof window !== "undefined"
        ? `${window.location.origin}/api/file/${item.fileId}`
        : `/api/file/${item.fileId}`
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // clipboard unavailable — fall back to a prompt so the user can copy manually
      window.prompt("Copy this link:", link)
    }
    setCopiedId(item.id)
    setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 2000)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" /> Download history
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
          Clear all
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => {
          // Items saved before this field existed have no status — treat as complete.
          const status = item.status ?? "complete"
          return (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border p-2.5 hover:bg-accent/50 transition-colors"
            >
              {item.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnail}
                  alt=""
                  className="h-12 w-20 rounded object-cover shrink-0"
                />
              ) : (
                <div className="h-12 w-20 rounded bg-muted shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {item.platform}
                  </Badge>
                  {status === "downloading" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Downloading…
                    </Badge>
                  )}
                  {status === "failed" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-destructive border-destructive/40">
                      <AlertCircle className="h-2.5 w-2.5" /> Failed
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {item.quality} · {new Date(item.downloadedAt).toLocaleString()}
                  </span>
                </div>
                {status === "failed" && item.error && (
                  <p className="text-xs text-destructive mt-0.5 line-clamp-2">{item.error}</p>
                )}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => share(item)}
                title="Copy shareable download link"
                disabled={status !== "complete"}
              >
                {copiedId === item.id ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Share className="h-4 w-4" />
                )}
              </Button>
              <Button variant="outline" size="icon" asChild title="Download again" disabled={status !== "complete"}>
                {status === "complete" ? (
                  <a href={`/api/file/${item.fileId}`}>
                    <Download className="h-4 w-4" />
                  </a>
                ) : (
                  <span>
                    <Download className="h-4 w-4" />
                  </span>
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(item.id)}
                title="Remove from history"
              >
                <Trash className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
