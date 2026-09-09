import { useEffect, useState } from 'react'

// The viewport rung at which the app stops being a map with chrome floating
// over it and becomes a stack of full-screen surfaces: the brand bar goes
// edge-to-edge, the datasets list and the modals take the whole screen, the
// legend collapses to a button, and the time/depth bars give the map its edges
// back (their filters stay reachable in the Filters modal). It is the 700px
// rung documented in theme.css — THE mobile rung for the map's own chrome —
// spelled here as a query so the components that branch on it in JS and the
// stylesheets that branch on it in CSS cannot drift apart.
export const MOBILE_QUERY = '(max-width: 700px)'

// Subscribes to a media query and re-renders when it flips. Layout that CSS can
// carry belongs in CSS; this is for the cases where the markup itself differs —
// a different icon, a card that becomes a modal, a control that isn't rendered
// at all.
export default function useMediaQuery (query) {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e) => setMatches(e.matches)
    // The query may have changed since the state initialiser ran.
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
