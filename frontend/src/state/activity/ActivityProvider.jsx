import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useChanged } from "../../utilities.jsx";

// A cached filter change would otherwise flash the logo pulse and status panel.
const ANNOUNCE_AFTER_MS = 250;

// Defaulted: index.jsx's Suspense splash reads this from outside AppProviders.
const ActivityContext = createContext({
  register: () => () => {},
  labelKeys: [],
  busy: false,
  announced: false,
});

// The set of translation keys naming in-flight work, gathered from loading
// flags spread over providers and components.
export function useActivity() {
  return useContext(ActivityContext);
}

// Counted, not flagged, so the first of two same-key callers to finish
// doesn't clear the label from under the second.
export function useActivityTask(labelKey, active) {
  const { register } = useActivity();
  const on = Boolean(active && labelKey);
  useEffect(
    () => (on ? register(labelKey) : undefined),
    [register, labelKey, on],
  );
}

export default function ActivityProvider({ children }) {
  const [counts, setCounts] = useState({});
  // Keeps `register` stable so a task's effect doesn't re-run every render.
  const countsRef = useRef(counts);

  const register = useCallback((labelKey) => {
    const next = (countsRef.current[labelKey] || 0) + 1;
    countsRef.current = { ...countsRef.current, [labelKey]: next };
    setCounts(countsRef.current);

    return () => {
      const remaining = (countsRef.current[labelKey] || 0) - 1;
      const { [labelKey]: _dropped, ...rest } = countsRef.current;
      countsRef.current =
        remaining > 0 ? { ...rest, [labelKey]: remaining } : rest;
      setCounts(countsRef.current);
    };
  }, []);

  const labelKeys = useMemo(() => Object.keys(counts), [counts]);
  const busy = labelKeys.length > 0;

  // The logo pulse and the status panel share this delay so they can't
  // disagree. `busy` stays raw for screen readers, which have no flicker.
  const [announced, setAnnounced] = useState(false);

  // Going quiet retracts immediately, so only announcing needs a timer.
  if (useChanged(busy) && !busy) setAnnounced(false);

  useEffect(() => {
    if (!busy) return undefined;
    const timer = setTimeout(() => setAnnounced(true), ANNOUNCE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  const value = useMemo(
    () => ({ register, labelKeys, busy, announced }),
    [register, labelKeys, busy, announced],
  );

  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}
