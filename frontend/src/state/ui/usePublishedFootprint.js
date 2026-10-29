import { useEffect } from "react";

// Publishes a floating surface's footprint as a :root custom property so other
// surfaces can hold clearance without hard-coding its size; removed on unmount.
// Pass a stable `measure` (module scope or useCallback): it is an effect dep.
export default function usePublishedFootprint(ref, property, measure) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const publish = () => {
      const px = Math.max(Math.round(measure(el.getBoundingClientRect())), 0);
      document.documentElement.style.setProperty(property, `${px}px`);
    };
    publish();

    // The viewport matters too, since every measurement is relative to it.
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    window.addEventListener("resize", publish);
    // A class change can move the surface without resizing it, and a
    // transition only lands where it was going at its end.
    const classObserver = new MutationObserver(publish);
    classObserver.observe(el, { attributes: true, attributeFilter: ["class"] });
    const onTransitionEnd = (event) => {
      if (event.target === el) publish();
    };
    el.addEventListener("transitionend", onTransitionEnd);
    return () => {
      observer.disconnect();
      classObserver.disconnect();
      el.removeEventListener("transitionend", onTransitionEnd);
      window.removeEventListener("resize", publish);
      document.documentElement.style.removeProperty(property);
    };
  }, [ref, property, measure]);
}
