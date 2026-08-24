import * as Sentry from '@sentry/react'

// Fetches are routinely aborted (component unmount, a newer request
// superseding an in-flight one) — that's expected control flow, not a
// failure worth reporting.
export default function reportError (context, error) {
  if (error?.name === 'AbortError') return
  console.error(`${context}:`, error)
  Sentry.captureException(error, { tags: { context } })
}
