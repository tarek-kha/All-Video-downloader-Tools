export async function parseApiResponse<T>(res: Response): Promise<T> {
  const contentType = (res.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as T & { error?: string }
    if (!res.ok) throw new Error(data?.error || fallbackMessage(res.status))
    return data
  }

  const text = (await res.text()).slice(0, 500)
  if (!res.ok) throw new Error(fallbackMessage(res.status, text))
  return text as unknown as T
}

function fallbackMessage(status: number, bodyText?: string): string {
  if (status === 429) return "Too many requests. Please try again shortly."
  if (status === 503) return "Download server is busy or temporarily unavailable."
  if (status === 502 || status === 504) return "Server temporarily unavailable."
  if (status >= 500) return "Server temporarily unavailable."
  if (bodyText && !/<!doctype|<html/i.test(bodyText)) return bodyText
  return "Request failed."
}
