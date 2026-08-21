import { useEffect, useState } from 'react'

import { server } from '../../config'

// Harvests run every few days; some datasets append a row every few minutes.
// Between the two, the harvested picture of such a dataset ends days ago. These
// helpers read the current state straight from ERDDAP (through /live/*) for the
// dataset the user is looking at, so its "data through", latest position and
// track tail are current even though the map's hexes and counts — cross-dataset
// aggregates baked into cached tiles — remain as of the last harvest.
//
// That split is why anything showing a live value must also show the dataset's
// `last_updated_at` — the harvest the counts and coverage reflect — or the two
// silently contradict each other.

// How recent a dataset's newest observation must be for it to count as live.
// Set just above the harvest cadence: a dataset that gained nothing since the
// last harvest has nothing live to show.
export const LIVE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000

// /live/freshness answers for every harvested dataset at once and is cached
// server-side for 5 minutes, so one in-flight promise is shared by every badge
// on the page and re-fetched no more often than the server would answer anew.
const FRESHNESS_TTL_MS = 5 * 60 * 1000
let freshnessCache = null

function loadFreshness () {
  const now = Date.now()
  if (!freshnessCache || now - freshnessCache.at > FRESHNESS_TTL_MS) {
    freshnessCache = {
      at: now,
      promise: fetch(`${server}/live/freshness`)
        .then((response) => (response.ok ? response.json() : {}))
        .catch((error) => {
          // Freshness is an overlay on harvested values, never a prerequisite:
          // an empty map just leaves every dataset showing what was harvested.
          console.warn('live freshness unavailable:', error)
          return {}
        })
    }
  }
  return freshnessCache.promise
}

/** `{ [erddapUrl]: { [datasetId]: maxTime } }`, `{}` until it lands. */
export function useFreshness () {
  const [freshness, setFreshness] = useState({})

  useEffect(() => {
    let cancelled = false
    loadFreshness().then((data) => {
      if (!cancelled) setFreshness(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return freshness
}

/**
 * The newest observation time known for a dataset: live from the server listing
 * when it answered, otherwise the value recorded at the last harvest.
 */
export function liveTimeMax (dataset, freshness) {
  if (!dataset) return null
  const live = freshness?.[dataset.erddap_server_url]?.[dataset.dataset_id]
  return live ?? dataset.source_time_max ?? null
}

/** Whether a dataset is still being appended to, by that newest observation. */
export function isLive (dataset, freshness) {
  const maxTime = liveTimeMax(dataset, freshness)
  if (!maxTime) return false
  const age = Date.now() - new Date(maxTime).getTime()
  return Number.isFinite(age) && age >= 0 && age < LIVE_THRESHOLD_MS
}

/**
 * The latest observation per station/trajectory of one dataset, straight from
 * ERDDAP. `latest` stays empty for a dataset that has no live tabledap answer
 * (griddap, a withdrawn dataset, a server that is down), which is what leaves
 * the caller showing harvested values alone. The harvest date those values
 * reflect is already on the dataset as `last_updated_at`.
 */
export function useLatest (dataset, enabled = true) {
  const [state, setState] = useState({
    latest: [],
    valueColumn: null,
    loading: false
  })

  const datasetPk = dataset?.pk
  useEffect(() => {
    if (!enabled || !datasetPk) {
      setState({ latest: [], valueColumn: null, loading: false })
      return undefined
    }
    let cancelled = false
    setState((current) => ({ ...current, loading: true }))
    fetch(`${server}/live/latest?dataset=${datasetPk}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch((error) => {
        console.warn('live latest unavailable:', error)
        return null
      })
      .then((data) => {
        if (cancelled) return
        setState({
          latest: data?.latest ?? [],
          valueColumn: data?.value_column ?? null,
          loading: false
        })
      })
    return () => {
      cancelled = true
    }
  }, [datasetPk, enabled])

  return state
}

/**
 * The most recent of the per-station rows. A dataset the panel shows as one
 * thing needs one "latest observation", and the rows come back one per station
 * in no particular order.
 */
export function newestRow (latest) {
  return (latest ?? []).reduce(
    (best, row) =>
      !best || new Date(row.time) > new Date(best.time) ? row : best,
    null
  )
}
