import { useCallback, useEffect, useRef, useState } from "react";

// Live { width, height } of an element, in CSS pixels. plotly-basic has no
// ResizeObserver, so a container resized without a window resize left the plot
// at Plotly's 450px default; the measure() on attach is the load-bearing
// measure-on-mount. Measure a container whose size is an INPUT to the plot,
// never the plot's own box, or it loops forever.
//
// A callback ref, not useRef + useEffect: the element can mount long after the
// component (Modal returns null until a record opens), and an effect that read
// ref.current once never looked again. `.current` is set on the callback so a
// caller can still reach the node (Rail's pointer maths).
export default function useElementSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observed = useRef(null);
  const observer = useRef(null);
  const published = useRef({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const el = observed.current;
    if (!el) return;
    // clientWidth/Height, not getBoundingClientRect: excludes padding the
    // plot can't draw in, and a scroller's clientHeight is its visible budget.
    const next = { width: el.clientWidth, height: el.clientHeight };
    // Compared here, not in an updater: an "unchanged" updater still re-renders,
    // and every preview plot render re-plots every panel.
    if (
      next.width === published.current.width &&
      next.height === published.current.height
    ) {
      return;
    }
    published.current = next;
    setSize(next);
  }, []);

  // Built once so its identity never changes: React re-calls a callback ref
  // whose function differs between renders, rebuilding the observer each time.
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
