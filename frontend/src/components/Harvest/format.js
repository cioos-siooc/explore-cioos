// Shared display formatters for the Harvest dashboard pages.

export function hostname(url) {
  try { return new URL(url).hostname || url } catch { return url }
}

export function fmtDt(val) {
  if (!val) return '—'
  const d = val instanceof Date ? val : new Date(val)
  if (isNaN(d.getTime())) return String(val)
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Whole seconds (run durations).
export function fmtDurationS(s) {
  if (s == null) return '—'
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// Milliseconds (per-dataset attempt durations).
export function fmtDurationMs(ms) {
  if (ms == null) return '—'
  return (ms / 1000).toFixed(1) + 's'
}

// Link to the dataset on its source (ERDDAP data page or OBIS).
export function datasetLink(erddapUrl, datasetId, source) {
  if (source === 'obis') return `https://obis.org/dataset/${datasetId}`
  try {
    return `${erddapUrl.replace(/\/$/, '')}/tabledap/${datasetId}.html`
  } catch {
    return '#'
  }
}

// Run-page views keep raw statuses for audit fidelity; this maps a
// hash-verified skip to its own 'unchanged' display status there.
export function displayStatus(attempt) {
  return attempt.status === 'skipped' && attempt.reason_code === 'UNCHANGED'
    ? 'unchanged'
    : attempt.status
}
