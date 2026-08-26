export interface VideoInfo {
  id: string
  title: string
  thumbnail: string | null
  duration: number | null
  uploader: string | null
  platform: string
  webpageUrl: string
  formats: FormatOption[]
  /** Short-lived resolver token — pass this to /api/download to reuse the
   * already-resolved metadata/cookie context instead of resolving again. */
  resolveId?: string
}

export interface FormatOption {
  value: string
  label: string
}

export interface DownloadResult {
  fileId: string
  filename: string
  sizeBytes: number
}

export type JobStatus = "queued" | "downloading" | "complete" | "failed"

export interface HistoryItem {
  id: string
  url: string
  title: string
  thumbnail: string | null
  platform: string
  quality: string
  filename: string
  fileId: string
  downloadedAt: string
  status?: JobStatus // undefined = legacy items from before this field existed; treated as complete
  error?: string
}
