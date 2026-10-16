import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDebounce } from "../utilities.jsx";
import fetchJson from "./fetchJson.js";
import { useMapState } from "./map/MapStateProvider.jsx";
import {
  parseRegions,
  regionBox,
  regionOutline,
  regionSearchUrl,
} from "./regionSearch.js";
import reportError from "./reportError.js";

export const REGION_MIN_LENGTH = 3;

// Places from NRCan GeoNames, kept with the term they answer so a stale reply
// is simply not shown, rather than cleared by an effect.
export function useRegionMatches(term) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("fr") ? "fr" : "en";
  const query = useDebounce(term, 300);
  const [result, setResult] = useState({ query: "", items: [] });
  const wanted = query.length >= REGION_MIN_LENGTH;

  useEffect(() => {
    if (!wanted) return undefined;
    const controller = new AbortController();
    fetchJson(regionSearchUrl(query, lang), { signal: controller.signal })
      .then((geojson) => setResult({ query, items: parseRegions(geojson) }))
      .catch((error) => {
        if (error.name !== "AbortError")
          reportError("region search failed", error);
      });
    return () => controller.abort();
  }, [wanted, query, lang]);

  return wanted && result.query === term ? result.items : [];
}

// Frames a place on the map and, for `shape` 'polygon' or 'box', makes an
// area the area filter as its outline or the box around it. A point place
// can only be gone to.
export function useGoToRegion() {
  const { requestDraw, zoomToGeometry } = useMapState();
  return useCallback(
    async (region, shape = "goto") => {
      zoomToGeometry(region.geometry);
      if (shape === "goto" || !region.area) return;
      try {
        const ring =
          shape === "box"
            ? regionBox(region.geometry)
            : await regionOutline(region.geometry);
        requestDraw("shape", ring);
      } catch (error) {
        reportError("region outline failed", error);
      }
    },
    [requestDraw, zoomToGeometry],
  );
}
