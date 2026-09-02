import * as React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// Defaulted rather than left undefined: index.jsx renders the loading splash as
// its Suspense fallback, which is outside AppProviders entirely, and that splash
// reads this registry. Outside a provider there is genuinely nothing registered,
// so an empty registry is the right answer rather than a crash.
const ActivityContext = createContext({
  register: () => () => {},
  labelKeys: [],
  busy: false
})

// What the app is currently waiting on, as the set of translation keys naming
// the in-flight work. Nothing else in the app knows this: the loading state is
// eight independent booleans spread over the providers and a few components,
// and each used to get its own indicator. ActivityIndicator reads this to
// report all of them in one place.
export function useActivity () {
  return useContext(ActivityContext)
}

const NOTHING = []

// Declare that every key in `labelKeys` names work currently in flight. Takes a
// list rather than one flag so a caller whose set of waits is dynamic — the map,
// which knows which of its layers are fetching — can register them all without
// varying its hook count between renders.
//
// Counted rather than flagged, so two callers waiting on the same kind of thing
// collapse to one entry and the first to finish doesn't clear the label out from
// under the second.
export function useActivityTasks (labelKeys = NOTHING) {
  const { register } = useActivity()
  // The effect keys off the joined string: a fresh array of the same keys on
  // every render would otherwise unregister and re-register the lot each time.
  const joined = labelKeys.join('\u0000')

  useEffect(() => {
    if (!joined) return undefined
    const unregisters = joined.split('\u0000').map(register)
    return () => unregisters.forEach((unregister) => unregister())
  }, [register, joined])
}

// The single-flag case, which is most of them.
export function useActivityTask (labelKey, active) {
  useActivityTasks(active && labelKey ? [labelKey] : NOTHING)
}

export default function ActivityProvider ({ children }) {
  const [counts, setCounts] = useState({})
  // The registry is written from effect cleanups during render-heavy updates;
  // keeping the identity of `register` stable means a task's effect doesn't
  // re-run (and so doesn't unregister and re-register) on every render.
  const countsRef = useRef(counts)

  const register = useCallback((labelKey) => {
    const next = (countsRef.current[labelKey] || 0) + 1
    countsRef.current = { ...countsRef.current, [labelKey]: next }
    setCounts(countsRef.current)

    return () => {
      const remaining = (countsRef.current[labelKey] || 0) - 1
      const { [labelKey]: _dropped, ...rest } = countsRef.current
      countsRef.current =
        remaining > 0 ? { ...rest, [labelKey]: remaining } : rest
      setCounts(countsRef.current)
    }
  }, [])

  const labelKeys = useMemo(() => Object.keys(counts), [counts])

  const value = useMemo(
    () => ({ register, labelKeys, busy: labelKeys.length > 0 }),
    [register, labelKeys]
  )

  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  )
}
