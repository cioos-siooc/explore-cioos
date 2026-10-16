import { useEffect, useRef, useState } from "react";

// Live { width, height } of an element, in CSS pixels. plotly-basic has no
// ResizeObserver, so a container resized without a window resize left the plot
// at Plotly's 450px default; the publish() before observe() is the
// load-bearing measure-on-mount. Measure a container whose size is an INPUT to
// the plot, never the plot's own box, or it loops forever.
export default function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const publish = () => {
      // clientWidth/Height, not getBoundingClientRect: excludes padding the
      // plot can't draw in, and a scroller's clientHeight is its visible budget.
      setSize((previous) =>
        previous.width === el.clientWidth && previous.height === el.clientHeight
          ? previous
          : { width: el.clientWidth, height: el.clientHeight },
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, []);

  return [ref, size];
}
