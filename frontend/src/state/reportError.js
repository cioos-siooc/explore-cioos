import * as Sentry from "@sentry/react";

// fetch() rejects with a bare TypeError when no HTTP response arrived at all
// (dropped connection, network change, sleep). Messages per Chrome, Firefox,
// Safari; Sentry appends " (<host>)".
const NETWORK_FAILURE =
  /^(Failed to fetch|NetworkError when attempting to fetch resource|Load failed)/;

// Fetches are routinely aborted (component unmount, a newer request
// superseding an in-flight one) — that's expected control flow, not a
// failure worth reporting.
export default function reportError(context, error) {
  if (error?.name === "AbortError") return;
  if (error instanceof TypeError && NETWORK_FAILURE.test(error.message)) {
    // Every in-flight request fails together, one issue per call site; group
    // them into a single warning so an outage still shows as a spike.
    console.warn(`${context}:`, error);
    Sentry.captureException(error, {
      level: "warning",
      fingerprint: ["fetch-network-failure"],
      tags: { context },
    });
    return;
  }
  console.error(`${context}:`, error);
  Sentry.captureException(error, { tags: { context } });
}
