import { useEffect, useState } from "react";

import { server } from "../../../config.js";
import reportError from "../../../state/reportError.js";

// When each of a trajectory dataset's platforms was inside the selected area —
// a hex or track clicked on the map, a drawn polygon, or the lat/lon bounds —
// as a Map of trajectory id -> [{start, end}] (inclusive UTC days). Empty with
// no selected area: every trajectory's whole history would answer nothing the
// card's timeframe doesn't already say.
//
// `area` is the clicked point ({lngLat, z}); the server resolves it to the hex
// of that zoom's tier, the same cell the click lit up.
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

  // Derived, not held: a new selection shows no passes until its own answer
  // lands, rather than the last selection's.
  return url && answer.url === url ? answer.passes : EMPTY;
}
