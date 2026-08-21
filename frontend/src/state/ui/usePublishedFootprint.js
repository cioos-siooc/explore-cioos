import { useEffect } from 'react'

// Publishes how much room a floating map surface takes up as a CSS custom
// property on :root, so the other surfaces over the map can hold clearance from
// it without hard-coding its size. The measurements have to be live: the top bar
// grows as filter chips wrap onto new rows, and both bars change height with the
// locale's label lengths.
//
// `measure` turns the element's viewport rect into a pixel number. The property
// is removed when the element unmounts, so rules reading it fall back to their
// no-clearance value the moment the surface is gone. Pass a stable `measure`
// (module scope or useCallback) — it is an effect dependency.
export default function usePublishedFootprint (ref, property, measure) {
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    const publish = () => {
      const px = Math.max(Math.round(measure(el.getBoundingClientRect())), 0)
      document.documentElement.style.setProperty(property, `${px}px`)
    }
    publish()

    // The element resizes with its own content; the viewport matters too, since
    // every measurement here is relative to it.
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    window.addEventListener('resize', publish)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publish)
      document.documentElement.style.removeProperty(property)
    }
  }, [ref, property, measure])
}
