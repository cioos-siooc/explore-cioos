import { useEffect, useState } from 'react'

// useState whose value survives a reload, keyed under a single namespace in
// localStorage. Used for UI preferences the user sets once and expects to find
// again (map layer toggles, projection) — never for shareable state,
// which belongs in the URL.
//
// Storage is best-effort: private-mode Safari and blocked third-party storage
// both throw on access, and a preference is never worth crashing the app over,
// so failures fall back to the in-memory default.
const PREFIX = 'cde.'

function read (key, fallback) {
  try {
    const stored = window.localStorage.getItem(PREFIX + key)
    return stored === null ? fallback : JSON.parse(stored)
  } catch (error) {
    console.warn(`could not read ${key} from localStorage:`, error)
    return fallback
  }
}

export default function usePersistentState (key, defaultValue) {
  const [value, setValue] = useState(() => read(key, defaultValue))

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch (error) {
      console.warn(`could not persist ${key} to localStorage:`, error)
    }
  }, [key, value])

  return [value, setValue]
}
