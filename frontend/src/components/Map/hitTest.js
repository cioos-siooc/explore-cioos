// The hover-precedence rules, taken off the map object.
//
// Each rule reads an array of queryRenderedFeatures hits and whatever camera
// scalars it needs, passed in — never a MapLibre instance. That is the seam:
// the ranking is arithmetic over feature layer ids, so it is testable without a
// WebGL context, while the map stays the only thing that knows how to produce
// the hits. See §P2.6 in TODO-cde-revisions.md for the rest of the group still
// inside Map.jsx's mount effect.

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
