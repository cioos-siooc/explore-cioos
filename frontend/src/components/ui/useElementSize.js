import { useEffect, useRef, useState } from 'react'

// Live { width, height } of an element, in CSS pixels.
//
// Lifted out of Rail.jsx (which measured one axis and kept it private) because
// the preview plot needs the same thing for a different reason: Plotly sizes
// itself from window.getComputedStyle(container) and there is no ResizeObserver
// anywhere in the plotly-basic bundle, so a container that changes size without
// a window resize — a modal opening, a lazy chunk landing, a flex row settling —
// is invisible to it. That is what left the plot drawn at Plotly's 450px default
// until the first control change forced a relayout.
//
// The publish() before observe() is the load-bearing part: it is the
// measure-on-mount that the plot was missing.
//
// Measure a container whose size is an INPUT to the plot, never the plot's own
// box — feeding a measured height back in as the plot's height is an infinite
// loop.
export default function useElementSize () {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const publish = () => {
      // clientWidth/Height, not getBoundingClientRect: the border box would
      // include padding the plot cannot draw in, and a scrolling container's
      // clientHeight is the visible height rather than the content height —
      // which is exactly the budget the plot has to fit.
      setSize((previous) =>
        previous.width === el.clientWidth && previous.height === el.clientHeight
          ? previous
          : { width: el.clientWidth, height: el.clientHeight }
      )
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    window.addEventListener('resize', publish)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publish)
    }
  }, [])

  return [ref, size]
}
