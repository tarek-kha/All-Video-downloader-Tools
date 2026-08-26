"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Cookie, Check, Trash, Loader2 } from "lucide-react"
import { parseApiResponse } from "@/lib/client-api"

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitter: "X / Twitter",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  vimeo: "Vimeo",
  reddit: "Reddit",
  other: "Other sites",
}
const PLATFORM_KEYS = Object.keys(PLATFORM_LABELS)

type PlatformStatus = Record<string, { configured: boolean; updatedAt?: string }>

export function CookieSettings() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<PlatformStatus>({})
  const [active, setActive] = useState(PLATFORM_KEYS[0])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = useCallback(() => {
    fetch("/api/cookies")
      .then((r) => parseApiResponse<{ platforms?: PlatformStatus }>(r))
      .then((d) => setStatus(d.platforms ?? {}))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const configuredCount = Object.values(status).filter((s) => s.configured).length

  const save = async (platform: string) => {
    const content = drafts[platform]?.trim()
    if (!content) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, content }),
      })
      await parseApiResponse<{ configured: boolean }>(res)
      setDrafts((d) => ({ ...d, [platform]: "" }))
      setMessage({ ok: true, text: `${PLATFORM_LABELS[platform]} cookies saved.` })
      refresh()
    } catch (e: unknown) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Failed to save cookies" })
    } finally {
      setSaving(false)
    }
  }

  const clear = async (platform: string) => {
    try {
      const res = await fetch(`/api/cookies?platform=${platform}`, { method: "DELETE" })
      await parseApiResponse<{ configured: boolean }>(res)
      setMessage({ ok: true, text: `${PLATFORM_LABELS[platform]} cookies removed.` })
      refresh()
    } catch (e: unknown) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Failed to remove cookies" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Cookie className="h-3.5 w-3.5" />
          Cookies
          {configuredCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {configuredCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cookie className="h-4 w-4" /> Per-platform cookies
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Some platforms block server downloads unless you provide cookies from a logged-in
          browser. Export with an extension like &quot;Get cookies.txt LOCALLY&quot; (Netscape
          format) and paste per platform below — each platform&apos;s cookies are kept separate
          and never mixed with another&apos;s.
        </p>
        <Tabs value={active} onValueChange={setActive}>
          <TabsList className="flex flex-wrap h-auto gap-1">
            {PLATFORM_KEYS.map((key) => (
              <TabsTrigger key={key} value={key} className="text-xs gap-1">
                {PLATFORM_LABELS[key]}
                {status[key]?.configured && <Check className="h-3 w-3 text-green-600" />}
              </TabsTrigger>
            ))}
          </TabsList>
          {PLATFORM_KEYS.map((key) => (
            <TabsContent key={key} value={key} className="space-y-2 mt-3">
              <Textarea
                value={drafts[key] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                placeholder={`# Netscape HTTP Cookie File\n.${key === "other" ? "example.com" : key + ".com"}\tTRUE\t/\tTRUE\t…`}
                className="font-mono text-xs min-h-28"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => save(key)}
                  disabled={saving || !drafts[key]?.trim()}
                  size="sm"
                  className="gap-2"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save
                </Button>
                {status[key]?.configured && (
                  <Button onClick={() => clear(key)} variant="outline" size="sm" className="gap-2">
                    <Trash className="h-4 w-4" /> Remove
                  </Button>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
        {message && (
          <p className={`text-sm ${message.ok ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
            {message.text}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
