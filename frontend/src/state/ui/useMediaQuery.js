import { useCallback, useSyncExternalStore } from "react";

// THE mobile rung (700px in theme.css; a landscape phone takes it by height),
// spelled here so JS and CSS branches cannot drift apart.
export const MOBILE_QUERY = "(max-width: 700px), (max-height: 500px)";

export const TOUCH_QUERY = "(hover: none)";

// For when the markup itself differs; layout belongs in CSS.
// useSyncExternalStore rather than effect-mirrored state, which rendered one
// frame at the wrong rung.
export default function useMediaQuery(query) {
  const subscribe = useCallback(
    (onStoreChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
  );
}
