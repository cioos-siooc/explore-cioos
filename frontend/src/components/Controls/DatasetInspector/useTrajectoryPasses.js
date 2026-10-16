import { useEffect, useState } from "react";

import { server } from "../../../config.js";
import reportError from "../../../state/reportError.js";

// Map of trajectory id -> [{start, end}] (inclusive UTC days) inside the
// selected area. `area` is the clicked {lngLat, z}; the server resolves it to
// that zoom tier's hex.
const EMPTY = new Map();

export default function useTrajectoryPasses(datasetPk, query, area) {
  const [answer, setAnswer] = useState({ url: null, passes: EMPTY });

  const hasShape = Boolean(query?.polygon || query?.latMin !== undefined);
  let url = null;
  if (datasetPk !== undefined && (area || hasShape)) {
    const params = new URLSearchParams(query);
    params.set("datasetPKs", datasetPk);
    if (area) {
      params.set("at", area.lngLat.join(","));
      params.set("z", area.z);
    }
    url = `${server}/trajectories/passes?${params.toString()}`;
  }

  useEffect(() => {
    if (!url) return undefined;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((rows) =>
        setAnswer({
          url,
          passes: new Map(rows.map((row) => [row.trajectory_id, row.passes])),
        }),
      )
      .catch((error) => {
        if (error.name === "AbortError") return;
        reportError("trajectories/passes fetch failed", error);
        setAnswer({ url, passes: EMPTY });
      });
    return () => controller.abort();
  }, [url]);

  // Derived, not held, so a new selection never shows the last one's passes.
  return url && answer.url === url ? answer.passes : EMPTY;
}
