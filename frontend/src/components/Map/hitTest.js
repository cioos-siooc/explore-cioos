import * as helpers from "@turf/helpers";
import turfUnion from "@turf/union";

import { pointRadiusFor } from "./pointRadius.js";

// The hover-precedence rules, taken off the map object.
//
// Each rule reads an array of queryRenderedFeatures hits and whatever camera
// state it needs, passed in — never a MapLibre instance. That is the seam:
// the ranking is arithmetic over feature layer ids, so it is testable without a
// WebGL context, while the map stays the only thing that knows how to produce
// the hits. The three map methods the rules need (the zoom, `project`, and the
// re-query that gathers a hex's tile fragments) arrive as a scalar and two
// functions.

// Zoom at which griddap coverage rectangles take hover/click priority over
// the hex aggregates (which stop being drawn at hexMaxZoom anyway).
export const GRIDDAP_PRIORITY_ZOOM = 5;

// Past GRIDDAP_PRIORITY_ZOOM the rectangles outrank the hex aggregates: the
// hexes are a coarse backdrop by then, and someone zoomed in that far is
// working with a specific grid. Below it the hexes keep the hover, so a
// coverage rectangle drawn over a continent's worth of them cannot swallow it.
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

// 'points' carries an invisible 10px hit stroke so small circles stay easy
// to hit (see its paint), but that halo is 2-4x the circle actually drawn —
// standing aside for all of it would leave track lines un-hoverable at z7+
// (where points appear) anywhere profiles are dense, which is most of the
// coast. A track yields only to the circle the user can see, plus a pixel
// or two of grace.
//
// These precedence tests are now hover-only. Click used to run the same
// ladder — eight mutual stand-aside functions deciding which of six
// handlers owned a given pixel — and it is gone: one click gathers
// everything under it and the card lists it (see handleMapClick). Hover
// still has to pick a single winner, because there is only one tooltip.
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

// The track feature under a point, ranked by trackClickLayers rather than by
// render order, so a head from one trajectory and a line from another under
// the same cursor resolve the same way every time.
export const trackFeatureIn = (hits) =>
  hits
    .filter((feature) => trackClickLayers.includes(feature.layer.id))
    .sort(
      (a, b) =>
        trackClickLayers.indexOf(a.layer.id) -
        trackClickLayers.indexOf(b.layer.id),
    )[0];

// Griddap coverage rectangles defer to the point/hex layers, so a hover
// meant for an observation isn't swallowed by the grid drawn over it. Past
// GRIDDAP_PRIORITY_ZOOM the rectangles outrank the hex aggregates instead —
// see griddapOutranksHexesIn in hitTest.js, which holds the other half of
// this rule.
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

// The tracks one hit-test found, deduped by (dataset, trajectory): a click
// on an arrowhead sitting on its own line hits both layers, and a track
// that doubles back can be hit several times over. Shared by the card's
// query and by the single-track shortcut below, which both have to agree
// on how many distinct tracks a click actually landed on.
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

// Everything one click found, grouped the way the card reads it out. Returns
// null when the click landed on empty water.
export const buildFeatureQuery = (
  lngLat,
  hits,
  { zoom, queryRendered, language },
) => {
  if (hits.length === 0) return null;

  // Tracks first — see trackItemsIn.
  const tracks = trackItemsIn(hits);

  // Observations: individual markers where they are drawn, the aggregate
  // cell otherwise. A marker also names its platform, which the cell can't.
  //
  // Deduped by (layer, pk) first. A cell or marker that straddles a tile
  // boundary is returned once per tile it appears in, and counting it twice
  // inflated the card's total; drawing it twice turned the clicked-region
  // outline into a scribble of near-coincident hexagons.
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
  let observationCount = 0;
  const cellFeatures = [];
  // What was clicked, in the terms /tiles/datasets takes: the tile buckets
  // themselves, plus which layer drew them. `source` starts at the main
  // tile layer and only moves if a coverage hex is what was hit.
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
    // A hex is one row server-side, but MVT clips it to whichever tiles
    // it crosses — at low zoom it fits inside a single tile, at high
    // zoom (e.g. z10) the same hex spans several, and `feature` above is
    // only the fragment the click point happened to land in. Pull every
    // currently-rendered fragment sharing this pk so the highlight/bounds
    // below cover the whole hex instead of the one sliver under the
    // cursor.
    //
    // The fragments still meet at the tile edge they were clipped along,
    // so unioning them back into one polygon isn't just cosmetic tidying
    // — without it, click-highlight-line/glow draw that internal edge as
    // a line cutting across the hex, on top of drawing its true outline.
    if (layerId !== "points") {
      const fragments = queryRendered({
        layers: [layerId],
        filter: ["==", ["get", "pk"], feature.properties.pk],
      });
      const parts = fragments.length ? fragments : [feature];
      let merged = parts[0];
      for (let i = 1; i < parts.length; i++) {
        try {
          // @turf/union 7 takes ONE FeatureCollection, not two
          // features. Still folded pairwise rather than unioning the
          // whole collection in one call, so a single degenerate
          // fragment costs only itself (see catch below).
          merged =
            turfUnion(helpers.featureCollection([merged, parts[i]])) || merged;
        } catch {
          // A degenerate fragment (e.g. a sliver from the MVT buffer
          // overlap) fails to union — keep what merged so far rather
          // than losing the highlight entirely.
        }
      }
      cellFeatures.push(merged);
    }
    // The bucket this feature stands for, so the card can ask the API what
    // each dataset in it contributes. A tile carries only the bucket TOTAL
    // (`count`), and for the days metric that total is a union across the
    // datasets in the cell — it is nobody's individual figure. Splitting it
    // here is not possible; /tiles/datasets does it from the rows.
    (layerId === "points" ? buckets.pointPks : buckets.hexPks).add(
      Number(feature.properties.pk),
    );
    // 'coverage-hexes' is drawn from /tiles/cells, which unions a different
    // set of sources than /tiles. The card has to ask the same one, or the
    // numbers it shows will not add up to the hex it is describing.
    if (layerId === "coverage-hexes") buckets.source = "cells";

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
        // A marker is a place the user can point at; a cell is a
        // neighbourhood. The card says which it is rather than implying a
        // precision the aggregate doesn't have.
        aggregate: layerId !== "points",
      });
    });
  });

  // Gridded footprints, deduped by dataset — a stack of grids covering the
  // same water is the norm, not the exception.
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

  // What the click actually landed on, drawn back onto the map so the card
  // has something to point at. Without it the card was a panel of titles
  // floating over an unchanged map, and nothing said which of forty
  // identical hexes it was describing.
  //
  // Areas (hexes, coverage hexes, grid rectangles) are outlined; individual
  // markers are ringed. They stay in one collection — the highlight layers
  // filter on geometry type — but only the areas can be framed.
  //
  // Grid rectangles routinely stack — a dozen gridded datasets can share
  // the same patch of ocean — and click-highlight-fill paints every area
  // feature as its own translucent polygon, so pushing one per dataset
  // would compound into a darker patch the more of them overlap here.
  // A single unioned shape fixes the opacity, but painting *only* that
  // shape (dropping the individual rectangles) collapses nested/uneven
  // boxes down to just their outer envelope — the small ones disappear
  // and it reads as "just the biggest box got selected". So both are
  // kept, tagged with the `role` the highlight layers filter on: the
  // merged shape feeds the fill and only the fill ('fill'), the
  // individual rectangles feed the outline and glow and only those
  // ('outline'), so every box in the stack still draws its own border.
  // Everything else is drawn by all of them ('both').
  let mergedGrid = gridFeatures[0] || null;
  for (let i = 1; i < gridFeatures.length; i++) {
    try {
      // One FeatureCollection per call — see the note in the hex
      // fragment union above.
      mergedGrid =
        turfUnion(helpers.featureCollection([mergedGrid, gridFeatures[i]])) ||
        mergedGrid;
    } catch {
      // A degenerate polygon fails to union — keep what merged so far
      // rather than losing the highlight entirely.
    }
  }

  // A feature from queryRenderedFeatures is a MapLibre GeoJSONFeature,
  // whose `geometry` is a getter on the prototype: it has to be read off
  // the live object here, and a feature can never be tagged by spreading
  // it (`{ ...feature, role }` copies own properties only, silently
  // dropping the geometry and leaving the highlight with nothing to
  // draw). Hence the (feature, role) pairs rather than tagged copies.
  const highlightFeature = ({ feature, role }) => ({
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      // `count` rides along because click-highlight-point sizes itself
      // with the same ramp 'points' does, and that expression reads it.
      // A unioned shape carries turf's empty properties, but only the
      // point layers read `count`, and those are never unioned.
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
        .map((feature) => highlightFeature({ feature, role: "both" })),
    ],
  };

  return {
    // A nonce, so clicking the same spot twice re-opens a card the user
    // dismissed rather than being deduped away by React.
    nonce: Date.now(),
    lngLat: [lngLat.lng, lngLat.lat],
    items,
    observationCount,
    highlight,
    // What the card asks /tiles/datasets about — see the buckets comment
    // above. Sets are not serialisable and the card only ever reads them
    // as lists, so they are flattened here.
    buckets: {
      ...buckets,
      hexPks: [...buckets.hexPks],
      pointPks: [...buckets.pointPks],
    },
    // Every dataset under the click, which the datasets list reads to pin
    // and outline them (DatasetsTable's pinnedPks).
    datasetPks: [...new Set(items.map((item) => item.pk))],
  };
};
