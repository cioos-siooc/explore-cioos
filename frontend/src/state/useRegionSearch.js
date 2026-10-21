import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDebounce } from "../utilities.jsx";
import fetchJson from "./fetchJson.js";
import { useMapState } from "./map/MapStateProvider.jsx";
import {
  MAX_RING_VERTICES,
  parseRegions,
  prefixQuery,
  regionBox,
  regionOutline,
  regionSearchUrl,
} from "./regionSearch.js";
import reportError from "./reportError.js";
import { useSelection } from "./selection/SelectionProvider.jsx";

export const REGION_MIN_LENGTH = 3;

// Places from NRCan GeoNames, kept with the term they answer so a stale reply
// is simply not shown, rather than cleared by an effect. Matched as typed
// first, then as written when that finds nothing. `loading` holds from the
// keystroke, through the debounce, to the reply.
export function useRegionMatches(term) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("fr") ? "fr" : "en";
  const query = useDebounce(term, 300);
  const [result, setResult] = useState({ query: "", items: [] });
  const wanted = query.length >= REGION_MIN_LENGTH;

  useEffect(() => {
    if (!wanted) return undefined;
    const controller = new AbortController();
    const search = (q) =>
      fetchJson(regionSearchUrl(q, lang), { signal: controller.signal }).then(
        parseRegions,
      );
    const prefixed = prefixQuery(query);
    search(prefixed)
      .then((items) =>
        items.length || prefixed === query ? items : search(query),
      )
      .then((items) => setResult({ query, items }))
      .catch((error) => {
        if (error.name === "AbortError") return;
        reportError("region search failed", error);
        setResult({ query, items: [] });
      });
    return () => controller.abort();
  }, [wanted, query, lang]);

  const answered = result.query === term;
  return {
    places: term.length >= REGION_MIN_LENGTH && answered ? result.items : [],
    loading: term.length >= REGION_MIN_LENGTH && !answered,
  };
}

// Frames a place on the map and, for `shape` 'polygon' or 'box', makes an
// area the area filter as its outline or the box around it, named after it.
// A point place can only be gone to.
export function useGoToRegion() {
  const { requestDraw, zoomToGeometry } = useMapState();
  const { setAreaPlace } = useSelection();
  return useCallback(
    async (region, shape = "goto") => {
      zoomToGeometry(region.geometry);
      if (shape === "goto" || !region.area) return;
      try {
        const ring =
          shape === "box"
            ? regionBox(region.geometry)
            : await regionOutline(region.geometry);
        setAreaPlace({ name: region.name, cgndbid: region.cgndbid, ring });
        requestDraw("shape", ring);
      } catch (error) {
        reportError("region outline failed", error);
      }
    },
    [requestDraw, setAreaPlace, zoomToGeometry],
  );
}

// A typed or pasted area, framed and made the area filter as given, or as an
// outline that keeps all of it when it is over the vertex budget.
export function useApplyArea() {
  const { requestDraw, zoomToGeometry } = useMapState();
  return useCallback(
    async (ring) => {
      const geometry = { type: "Polygon", coordinates: [ring] };
      zoomToGeometry(geometry);
      try {
        requestDraw(
          "shape",
          ring.length > MAX_RING_VERTICES
            ? await regionOutline(geometry)
            : ring,
        );
      } catch (error) {
        reportError("area outline failed", error);
      }
    },
    [requestDraw, zoomToGeometry],
  );
}
