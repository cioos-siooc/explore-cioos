import * as React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

const ActivityContext = createContext()

// What the app is currently waiting on, as the set of translation keys naming
// the in-flight work. Nothing else in the app knows this: the loading state is
// eight independent booleans spread over the providers and a few components,
// and each used to get its own indicator. ActivityIndicator reads this to
// report all of them in one place.
export function useActivity () {
  return useContext(ActivityContext)
}

// Declare that `labelKey` names work that is in flight while `active` is true.
// Counted rather than flagged, so two components waiting on the same kind of
// thing collapse to one entry and the first to finish doesn't clear the label
// out from under the second.
export function useActivityTask (labelKey, active) {
  const { register } = useActivity()

  useEffect(() => {
    if (!active || !labelKey) return undefined
    return register(labelKey)
  }, [register, labelKey, active])
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
