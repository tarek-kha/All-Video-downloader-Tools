"use client"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body>
        <div className="min-h-screen flex items-center justify-center text-center p-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-4">{error.message}</p>
            <button onClick={reset} className="underline">
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
