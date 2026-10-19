import * as helpers from "@turf/helpers";
import turfPointsWithinPolygon from "@turf/points-within-polygon";

import { pointRadiusFor } from "./pointRadius.js";

// Rules take queryRenderedFeatures hits and camera state, never a MapLibre
// instance, so the ranking is testable without a WebGL context.

// @turf/union (and the bignumber/polyclip it pulls in) loads once the map is
// up rather than with the entry bundle; a click before then highlights the
// unmerged pieces.
let turfUnion = null;
export const loadTurfUnion = () =>
  import("@turf/union")
    .then((module) => {
      turfUnion = module.default;
    })
    .catch(() => {});

export const GRIDDAP_PRIORITY_ZOOM = 5;

// Past this zoom someone is working with a specific grid; below it a
// rectangle over a continent's worth of hexes cannot swallow their hover.
export const griddapOutranksHexesIn = (hits, zoom) =>
  zoom >= GRIDDAP_PRIORITY_ZOOM &&
  hits.some((feature) => feature.layer.id === "griddap-coverage-fill");

// Clickable track layers, most-deliberate target first: an arrowhead is
// aimed at (it is what the head tooltip describes), the line is the fallback.
export const trackClickLayers = [
  "track-heads",
  "track-heads-fixed",
  "track-lines",
];

// The selected platform's own drawing, which sits over the tile layers.
export const selectedTrackLayers = [
  "selected-track-fixes",
  "selected-track-fixes-nocog",
  "selected-track-line",
];

// 'points' carries an invisible 10px hit stroke, 2-4x the drawn circle;
// yielding to all of it would leave tracks un-hoverable wherever profiles are
// dense. A track yields only to the visible circle plus a little grace.
// Hover-only: a click gathers everything under it (see handleMapClick).
export const POINT_HIT_GRACE_PX = 2;
export const isOnAPointIn = (hits, point, { project, radiusRange }) =>
  hits
    .filter((feature) => feature.layer.id === "points")
    .some((feature) => {
      const centre = project(feature.geometry.coordinates);
      const radius =
        pointRadiusFor(feature.properties.count, radiusRange) +
        POINT_HIT_GRACE_PX;
      return (
        (centre.x - point.x) ** 2 + (centre.y - point.y) ** 2 <= radius ** 2
      );
    });

// Ranked by trackClickLayers rather than render order, so overlapping tracks
// resolve the same way every time.
export const trackFeatureIn = (hits) =>
  hits
    .filter((feature) => trackClickLayers.includes(feature.layer.id))
    .sort(
      (a, b) =>
        trackClickLayers.indexOf(a.layer.id) -
        trackClickLayers.indexOf(b.layer.id),
    )[0];

// Griddap rectangles defer to the point/hex layers below
// GRIDDAP_PRIORITY_ZOOM; griddapOutranksHexesIn holds the other half of this
// rule.
export const griddapCoveredIn = (hits, zoom) => {
  const covering =
    zoom >= GRIDDAP_PRIORITY_ZOOM ? ["points"] : ["points", "hexes"];
  return (
    hits.some((feature) => covering.includes(feature.layer.id)) ||
    Boolean(trackFeatureIn(hits))
  );
};

export function dedupeGriddapByPk(features) {
  const byPk = new Map();
  features.forEach((feature) => {
    if (!byPk.has(feature.properties.pk))
      byPk.set(feature.properties.pk, feature);
  });
  return [...byPk.values()];
}

// nested feature properties arrive JSON-stringified from MapLibre
export function griddapTitle(feature, language) {
  try {
    const titleTranslated = JSON.parse(feature.properties.title_translated);
    return (
      titleTranslated[language] ||
      titleTranslated.en ||
      feature.properties.dataset_id
    );
  } catch {
    return feature.properties.dataset_id || "";
  }
}

export const datasetPksOf = (feature) => {
  try {
    const pks = JSON.parse(feature.properties.datasets);
    return Array.isArray(pks) ? pks.map(Number) : [];
  } catch {
    return [];
  }
};

// Deduped by (dataset, trajectory): an arrowhead on its own line hits both
// layers, and a track that doubles back is hit several times. The card and the
// single-track shortcut must agree on the count.
export function trackItemsIn(hits) {
  const tracks = [];
  const seen = new Set();
  hits
    .filter((feature) =>
      [...trackClickLayers, ...selectedTrackLayers].includes(feature.layer.id),
    )
    .forEach((feature) => {
      const {
        pk_url: pk,
        trajectory_id: trajectoryId,
        dataset_title: datasetTitle,
      } = feature.properties;
      // trajectory_id is '' for a dataset with a single unnamed trajectory
      // (the schema default) and that is a valid selection end to end, so
      // test for absence rather than falsiness.
      if (pk == null || trajectoryId == null) return;
      const key = `${pk}:${trajectoryId}`;
      if (seen.has(key)) return;
      seen.add(key);
      tracks.push({
        kind: "track",
        pk: Number(pk),
        trajectoryId,
        title: datasetTitle,
      });
    });
  return tracks;
}

// Returns null when the click landed on empty water.
export const buildFeatureQuery = (
  lngLat,
  hits,
  { zoom, queryRendered, language },
) => {
  if (hits.length === 0) return null;

  const tracks = trackItemsIn(hits);

  // Deduped by (layer, pk): a feature straddling a tile boundary is returned
  // once per tile, which inflated the total and scribbled the outline.
  const observationHits = [];
  const seenObservations = new Set();
  hits.forEach((feature) => {
    const layerId = feature.layer.id;
    if (!["points", "hexes", "coverage-hexes"].includes(layerId)) return;
    const key = `${layerId}:${feature.properties.pk}`;
    if (seenObservations.has(key)) return;
    seenObservations.add(key);
    observationHits.push(feature);
  });

  const observations = new Map();
  const addObservations = (feature) => {
    datasetPksOf(feature).forEach((pk) => {
      const existing = observations.get(pk);
      if (existing) {
        existing.platform = existing.platform || feature.properties.platform;
        return;
      }
      observations.set(pk, {
        kind: "observation",
        pk,
        platform: feature.properties.platform,
        // The card says marker vs cell rather than implying a precision the
        // aggregate doesn't have.
        aggregate: feature.layer.id !== "points",
      });
    });
  };
  let observationCount = 0;
  const cellFeatures = [];
  // In /tiles/datasets' terms. `source` only moves if a coverage hex was hit.
  const buckets = {
    hexPks: new Set(),
    pointPks: new Set(),
    source: "main",
    z: Math.floor(zoom),
  };
  observationHits.forEach((feature) => {
    const layerId = feature.layer.id;
    const count = Number(feature.properties.count) || 0;
    observationCount += count;
    // MVT clips a hex to every tile it crosses, so gather every rendered
    // fragment sharing this pk and union them: otherwise the highlight covers
    // one sliver and draws the internal tile edge as a line across the hex.
    if (layerId !== "points") {
      const fragments = queryRendered({
        layers: [layerId],
        filter: ["==", ["get", "pk"], feature.properties.pk],
      });
      const parts = fragments.length ? fragments : [feature];
      if (!turfUnion) {
        cellFeatures.push(...parts);
      } else {
        let merged = parts[0];
        for (let i = 1; i < parts.length; i++) {
          try {
            // @turf/union 7 takes ONE FeatureCollection. Folded pairwise so a
            // degenerate fragment costs only itself.
            merged =
              turfUnion(helpers.featureCollection([merged, parts[i]])) ||
              merged;
          } catch {
            // A degenerate fragment (e.g. an MVT buffer sliver) fails to union;
            // keep what merged so far.
          }
        }
        cellFeatures.push(merged);
      }
    }
    // A tile carries only the bucket total, which for days is a union across
    // datasets; /tiles/datasets splits it from the rows.
    (layerId === "points" ? buckets.pointPks : buckets.hexPks).add(
      Number(feature.properties.pk),
    );
    // /tiles/cells unions different sources than /tiles; the card has to ask
    // the same one or its numbers won't add up to the hex.
    if (layerId === "coverage-hexes") buckets.source = "cells";

    addObservations(feature);
  });

  // A coverage hex shares the marker tier's zoom band, so the stations
  // inside it join the card and its total.
  const markersInCells = [];
  if (cellFeatures.length) {
    const seenMarkers = new Set();
    turfPointsWithinPolygon(
      helpers.featureCollection(queryRendered({ layers: ["points"] })),
      helpers.featureCollection(cellFeatures),
    ).features.forEach((feature) => {
      if (seenMarkers.has(feature.properties.pk)) return;
      seenMarkers.add(feature.properties.pk);
      markersInCells.push(feature);
      observationCount += Number(feature.properties.count) || 0;
      buckets.pointPks.add(Number(feature.properties.pk));
      addObservations(feature);
    });
  }

  // Deduped by dataset: stacked grids over the same water are the norm.
  const gridFeatures = dedupeGriddapByPk(
    hits.filter((feature) => feature.layer.id === "griddap-coverage-fill"),
  );
  const grids = gridFeatures.map((feature) => ({
    kind: "grid",
    pk: Number(feature.properties.pk),
    title: griddapTitle(feature, language),
  }));

  const items = [...tracks, ...observations.values(), ...grids];
  if (items.length === 0) return null;

  // Areas are outlined, markers ringed; only areas can be framed. Stacked grid
  // rectangles would compound the translucent fill, while painting only their
  // union loses the nested boxes' borders. So the union feeds the fill only
  // ('fill'), the rectangles the outline/glow only ('outline'), the rest all
  // ('both').
  let mergedGrid = gridFeatures[0] || null;
  for (let i = 1; turfUnion && i < gridFeatures.length; i++) {
    try {
      // One FeatureCollection per call — see the hex fragment union above.
      mergedGrid =
        turfUnion(helpers.featureCollection([mergedGrid, gridFeatures[i]])) ||
        mergedGrid;
    } catch {
      // A degenerate polygon fails to union; keep what merged so far.
    }
  }

  // A GeoJSONFeature's `geometry` is a prototype getter, so spreading a
  // feature silently drops it; hence (feature, role) pairs, not tagged copies.
  const highlightFeature = ({ feature, role }) => ({
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      // click-highlight-point sizes itself with the same ramp as 'points',
      // which reads `count`. Unioned shapes have none, but are never points.
      count: Number(feature.properties?.count) || 0,
      role,
    },
  });

  const areaHighlights = [
    ...cellFeatures.map((feature) => ({ feature, role: "both" })),
    ...gridFeatures.map((feature) => ({ feature, role: "outline" })),
    ...(mergedGrid ? [{ feature: mergedGrid, role: "fill" }] : []),
  ].map(highlightFeature);

  const highlight = {
    type: "FeatureCollection",
    features: [
      ...areaHighlights,
      ...observationHits
        .filter((feature) => feature.layer.id === "points")
        .concat(markersInCells)
        .map((feature) => highlightFeature({ feature, role: "both" })),
    ],
  };

  return {
    // Clicking the same spot twice re-opens a dismissed card rather than being
    // deduped away by React.
    nonce: Date.now(),
    lngLat: [lngLat.lng, lngLat.lat],
    items,
    observationCount,
    highlight,
    // Sets are not serialisable; the card only reads them as lists.
    buckets: {
      ...buckets,
      hexPks: [...buckets.hexPks],
      pointPks: [...buckets.pointPks],
    },
    datasetPks: [...new Set(items.map((item) => item.pk))],
  };
};

// griddap-highlight draws the open dataset's grid, so the click highlight
// keeps only its cells and markers.
export const withoutGridHighlight = (highlight) => ({
  ...highlight,
  features: highlight.features.filter(
    (feature) => feature.properties.role === "both",
  ),
});

// MapLibre hands nested properties back as JSON strings.
export const featureHasDataset = (feature, pk) => {
  try {
    return JSON.parse(feature.properties.datasets).includes(pk);
  } catch {
    return false;
  }
};
