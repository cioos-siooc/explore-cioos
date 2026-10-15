import { useCallback, useEffect, useRef, useState } from "react";

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
// A CALLBACK REF, NOT useRef + useEffect
// The element may mount long after the component does: DatasetPreview is kept
// mounted for the whole session (AppShell renders PreviewHost unconditionally)
// and Modal returns null until a record is opened, so the box it measures does
// not exist at mount. An effect that reads ref.current once saw null, returned,
// and never looked again — the preview plot was sized from a height of 0 and
// drawn at its MIN_PLOT_PX floor no matter how big the window was. A callback
// ref runs on every attach and detach instead, which is the only thing that
// cannot miss.
//
// `.current` is set on the callback itself so a caller can still reach the node
// (Rail measures the track's rect for its pointer maths).
//
// The measure-on-attach is the load-bearing part: it is what the plot was
// missing.
//
// Measure a container whose size is an INPUT to the plot, never the plot's own
// box — feeding a measured height back in as the plot's height is an infinite
// loop.
export default function useElementSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observed = useRef(null);
  const observer = useRef(null);
  const published = useRef({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const el = observed.current;
    if (!el) return;
    // clientWidth/Height, not getBoundingClientRect: the border box would
    // include padding the plot cannot draw in, and a scrolling container's
    // clientHeight is the visible height rather than the content height —
    // which is exactly the budget the plot has to fit.
    const next = { width: el.clientWidth, height: el.clientHeight };
    // Compared here rather than inside the updater: an updater that answers
    // "unchanged" still costs a render of this component, and every render of
    // the preview plot is a Plotly re-plot of every panel.
    if (
      next.width === published.current.width &&
      next.height === published.current.height
    ) {
      return;
    }
    published.current = next;
    setSize(next);
  }, []);

  // Built once, via the state initializer, so its identity never changes:
  // React calls a callback ref with null and then the node again whenever the
  // function itself differs between renders, which would tear down and rebuild
  // the observer on every keystroke elsewhere in the tree.
  const [ref] = useState(() => {
    const attach = (element) => {
      observer.current?.disconnect();
      observer.current = null;
      attach.current = element;
      observed.current = element;
      if (!element) return;
      measure();
      observer.current = new ResizeObserver(measure);
      observer.current.observe(element);
    };
    attach.current = null;
    return attach;
  });

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [measure]);

  return [ref, size];
}
