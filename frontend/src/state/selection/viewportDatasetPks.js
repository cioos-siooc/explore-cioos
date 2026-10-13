import { useEffect, useMemo, useState } from "react";

import { server } from "../../config.js";
import reportError from "../reportError.js";
import {
  createDataFilterQueryString,
  polygonIsRectangle,
} from "../../utilities.jsx";
import { intersectBoundsWithPolygonBbox } from "../../wmsUtilities.js";

const NONE_IN_VIEW = new Set();

// The /pointQuery/inView request for a viewport: the filters, the viewport
// clipped to the drawn shape's envelope as the rectangle filter, and a
// freeform shape's ring on top. Returns null when the bbox test should answer
// instead — a viewport wrapping the antimeridian can't be one rectangle — and
// { empty: true } when the view and the drawn shape don't overlap at all.
export function viewportRequest(viewportBounds, query, polygon) {
  if (!viewportBounds) return null;
  const [[west, south], [east, north]] = viewportBounds;
  if (west < -180 || east > 180) return null;

  const rectangle = intersectBoundsWithPolygonBbox(
    { west, south, east, north },
    polygon,
  );
  if (!rectangle) return { empty: true };

  const params = [
    createDataFilterQueryString(query),
    `latMin=${rectangle.south.toFixed(4)}`,
    `latMax=${rectangle.north.toFixed(4)}`,
    `lonMin=${rectangle.west.toFixed(4)}`,
    `lonMax=${rectangle.east.toFixed(4)}`,
    polygon && !polygonIsRectangle(polygon)
      ? "polygon=" + JSON.stringify(polygon)
      : "",
  ].filter(Boolean);
  return { url: `${server}/pointQuery/inView?${params.join("&")}` };
}

// pks of the datasets with a matched feature inside the viewport, or null
// while that isn't known (loading, failed, or not askable) so the caller falls
// back to its bbox test. A dataset's bbox is a poor stand-in for an OBIS
// dataset: its occurrences span an ocean, so its box overlaps nearly any view.
export function useViewportDatasetPks({
  viewportBounds,
  query,
  polygon,
  enabled,
}) {
  const request = useMemo(
    () => (enabled ? viewportRequest(viewportBounds, query, polygon) : null),
    [enabled, viewportBounds, query, polygon],
  );
  // Keyed by URL, so an answer for the previous view is never applied to this
  // one while its own request is in flight.
  const [result, setResult] = useState({ url: null, pks: null });
  const url = request?.url;

  useEffect(() => {
    if (!url) return undefined;
    const controller = new AbortController();
    let current = true;

    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!current) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const pks = await response.json();
        if (!current) return;
        setResult({ url, pks: new Set(pks) });
      } catch (error) {
        if (!current || error.name === "AbortError") return;
        reportError("pointQuery/inView failed", error);
        setResult({ url, pks: null });
      }
    }

    load();
    return () => {
      current = false;
      controller.abort();
    };
  }, [url]);

  if (!request) return null;
  if (request.empty) return NONE_IN_VIEW;
  return result.url === url ? result.pks : null;
}
