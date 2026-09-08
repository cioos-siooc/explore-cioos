import { useState, useEffect } from "react";
import { server } from "../../config.js";
import reportError from "../../state/reportError.js";

// The path is the whole cache key: every caller builds it from the ids it
// varies on, so it is also the complete dependency list. It used to take a
// separate `deps` array, which the linter could not check and which every
// caller filled with exactly the values already in the path.
export default function useHarvestFetch(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`${server}/harvest${path}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        reportError("harvest fetch failed", e);
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { data, loading, error };
}
