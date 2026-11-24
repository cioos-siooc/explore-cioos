import {
  basemapHandoffEndZoom,
  basemapHandoffStartZoom,
  clickHighlightColor,
  dimmedFeatureColor,
  gridCoverageColor,
  hexOutlineColor,
  mapInkColor,
  MARKER_MIN_ZOOM,
  MARKER_FADE_END_ZOOM,
  HEX_FILL_OPACITY_STOPS,
  trackLineColor,
} from "../config";
import platforms from "../../platforms.json";
import { platformColor } from "../../platformVocab.js";
import { withAlpha } from "../../utilities";
import { FIRST_LABEL_LAYER_ID } from "./basemapStyle.js";
import { radiusExpression } from "./pointRadius.js";
import { rampExpression } from "./hexRamp.js";

// Shared with the Legend: the hex band and the marker tier must not drift.
export const HEX_MAX_ZOOM = MARKER_MIN_ZOOM;
// Only one is ever on screen, and queryRenderedFeatures returns nothing for a
// layer outside its zoom range, so asking for both needs no zoom test.
export const HEX_LAYER_IDS = ["hexes", "coverage-hexes"];
export const POINT_LAYER_IDS = ["points"];
export const HEX_SOURCE_IDS = ["cde-tiles", "cde-cells"];
export const DATA_SOURCE_IDS = [...HEX_SOURCE_IDS, "tracks"];
// The CHS soundings are deliberately not here: they are the slowest thing on
// the map by a wide margin. See reportFirstPaint.
export const BASEMAP_SOURCE_IDS = ["bathymetry", "imagery", "ofm"];

export const emptyFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// While a WMS overlay is active every other data layer is hidden so the
// gridded field reads cleanly.
export const observationLayerIds = [
  "hexes",
  "points",
  "points-halo",
  "points-highlighted",
  "focused-points",
  "focused-points-halo",
  "coverage-hexes",
  "coverage-hex-outlines",
];
// Not in observationLayerIds: the trajectories layer's own switch owns them
// (applyLayerVisibility); this list exists only for the WMS overlay's hide.
export const trackLayerIds = [
  "track-lines",
  "track-heads",
  "track-heads-fixed",
  "selected-track-line",
  "selected-track-fixes",
  "selected-track-fixes-nocog",
];
export const griddapLayerIds = [
  "griddap-coverage-fill",
  "griddap-coverage-casing",
  "griddap-coverage-line",
  "griddap-coverage-point",
];
// Basemap, not data: owned by their own switch and left out of the WMS
// overlay's hide.
export const bathymetryLayerIds = [
  "bathymetry-nonna",
  "bathymetry-nonna-hillshade",
];

const TRACK_HEAD_HAS_COURSE = ["has", "cog"];
// Hidden outside a drawn shape, as the dataset list leaves them out: they can't
// be hovered or clicked, and the map lays out less. Values are each layer's
// own filter.
export const SELECTION_FILTERED_LAYERS = {
  hexes: undefined,
  points: undefined,
  "points-halo": undefined,
  "coverage-hexes": undefined,
  "coverage-hex-outlines": undefined,
  "track-lines": undefined,
  "track-heads": TRACK_HEAD_HAS_COURSE,
  "track-heads-fixed": ["!", TRACK_HEAD_HAS_COURSE],
};

export const NO_HEX_HOVERED = ["==", ["get", "pk"], -1];
// The hex under the cursor, outlined so the chip's figure has a visible owner:
// at hex zoom a cell can be a few pixels across. One layer per source, each
// filtered to a single pk.
export const HEX_HOVER_LAYERS = [
  {
    id: "hexes-hover",
    of: "hexes",
    source: "cde-tiles",
    sourceLayer: "internal-layer-name",
    minzoom: 0,
    maxzoom: HEX_MAX_ZOOM,
  },
  {
    id: "coverage-hexes-hover",
    of: "coverage-hexes",
    source: "cde-cells",
    sourceLayer: "coverage-hexes-layer",
    minzoom: HEX_MAX_ZOOM,
    maxzoom: 24,
  },
];

// setFeatureState addresses a source/source-layer, not a style layer.
export const focusTargets = {
  points: { source: "cde-tiles", sourceLayer: "internal-layer-name" },
  hexes: { source: "cde-tiles", sourceLayer: "internal-layer-name" },
  "coverage-hexes": {
    source: "cde-cells",
    sourceLayer: "coverage-hexes-layer",
  },
};

// Opaque: overlapping translucent markers mixed into hues no platform has.
// The white halo is what separates neighbours.
const CIRCLE_OPACITY = 1;
// The white rim is all that separates a marker from the cell under it: at
// 1.25px and 0.9 the darker platform hues sank into the darker ramp stops.
export const HALO_PADDING = 1.75;
const HALO_OPACITY = 1;
// Partial opacity so coincident tracks compound: 27 St. Lawrence voyages in
// 90 days render as ONE line at full opacity.
const TRACK_LINE_OPACITY = 0.55;
// A head last seen before the window's final week (the server's `active`).
const TRACK_HEAD_INACTIVE_OPACITY = 0.35;
const TRACK_HEAD_OPACITY = [
  "case",
  ["to-boolean", ["get", "active"]],
  1,
  TRACK_HEAD_INACTIVE_OPACITY,
];
// Thin and translucent over the imagery: at full strength the 20 km cells
// read as a coordinate grid rather than as coverage.
const COVERAGE_HEX_OUTLINE_OPACITY = 0.6;

// They share one paint, so a radius change must reach all of them or the halo
// and click highlight desync from the markers.
const POINT_LAYERS = [
  ["points", 0],
  ["points-halo", HALO_PADDING],
  ["points-highlighted", 0],
  ["focused-points", 0],
  ["focused-points-halo", HALO_PADDING],
  ["click-highlight-point", 0],
  ["click-highlight-point-glow", 6],
];

// MapLibre cannot interpolate to or from a data-driven value: the transition
// just holds the old value then snaps, which read as a glitch after the map had
// stopped moving.
const NO_TRANSITION = { duration: 0 };

// Focus dimming is a feature-state flag the paint expressions carry from the
// start. setFilter, or setPaintProperty on a data-driven property, forces a
// relayout that re-sends every loaded tile to the worker, so the old
// repaint-and-overlay approach re-tessellated the viewport per list row.
const IS_DIMMED = ["boolean", ["feature-state", "dimmed"], false];
const dimmable = (color) => ["case", IS_DIMMED, dimmedFeatureColor, color];

const platformColors = [
  "match",
  ["get", "platform"],
  ...platforms.flatMap((p) => [p.label_en, platformColor(p.label_en)]),
  platformColor("unknown"),
];

// Markers and the cells' white edges cross-fade in over HEX_MAX_ZOOM to
// MARKER_FADE_END_ZOOM rather than switching on. Kept narrow: a map left inside
// it would show half-transparent markers blending into hues no platform has.
const MARKER_FADE_START_FRACTION = 0.2;
const markerFadeIn = (opacityAt) => [
  "interpolate",
  ["linear"],
  ["zoom"],
  HEX_MAX_ZOOM,
  opacityAt(MARKER_FADE_START_FRACTION),
  MARKER_FADE_END_ZOOM,
  opacityAt(1),
];

// Count is carried by colour alone; opacity varies with zoom alone. The two
// hex layers split HEX_FILL_OPACITY_STOPS at HEX_MAX_ZOOM; the count reaches
// transparency through the ramp's alpha (toRampStops), and MapLibre multiplies
// the two.
const zoomOpacity = (keep) => [
  "interpolate",
  ["linear"],
  ["zoom"],
  ...HEX_FILL_OPACITY_STOPS.filter(([zoom]) => keep(zoom)).flat(),
];

// The coverage cell is a fixed 20 km across (web-api/routes/tiles.js), so past
// the basemap hand-off a full fill would bury the imagery; the fill thins to a
// tint over the same window and the outline layer comes up exactly as the fill
// goes, so a cell is never both uncoloured and unmarked. The 'case' sits in the
// stop's OUTPUT because MapLibre rejects a 'zoom' expression that isn't the
// input to a top-level step/interpolate, and a throwing setPaintProperty would
// leave the hex layers stuck at opacity 0.
const COVERAGE_HEX_OUTLINE_OPACITY_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["zoom"],
  basemapHandoffStartZoom,
  0,
  basemapHandoffEndZoom,
  [
    "case",
    IS_DIMMED,
    COVERAGE_HEX_OUTLINE_OPACITY * 0.35,
    COVERAGE_HEX_OUTLINE_OPACITY,
  ],
];

// Each table is { layerId: { paint?, layout? } }: one definition serves both
// the layer's creation and every later update (applyStyle).

// The count-ramp layers are created at zero opacity and revealed once their
// colours are final (see revealData in Map.jsx).
export function revealStyle(revealed) {
  const opacity = (value) => (revealed ? value : 0);
  return {
    hexes: {
      paint: { "fill-opacity": opacity(zoomOpacity((z) => z <= HEX_MAX_ZOOM)) },
    },
    "coverage-hexes": {
      paint: { "fill-opacity": opacity(zoomOpacity((z) => z >= HEX_MAX_ZOOM)) },
    },
    "coverage-hex-outlines": {
      paint: {
        "line-opacity": opacity(COVERAGE_HEX_OUTLINE_OPACITY_EXPRESSION),
      },
    },
    points: {
      paint: {
        "circle-opacity": opacity(
          markerFadeIn((fraction) => CIRCLE_OPACITY * fraction),
        ),
      },
    },
    // Shares its source layer with 'points', so dimmed markers lose their
    // white ring; only halfway, since the casing keeps a grey dot legible over
    // dark sea.
    "points-halo": {
      paint: {
        "circle-opacity": opacity(
          markerFadeIn((fraction) => [
            "case",
            IS_DIMMED,
            0.5 * fraction,
            HALO_OPACITY * fraction,
          ]),
        ),
      },
    },
    "focused-points": { paint: { "circle-opacity": opacity(CIRCLE_OPACITY) } },
    "focused-points-halo": {
      paint: { "circle-opacity": opacity(HALO_OPACITY) },
    },
  };
}

// The grey is a feature-state branch inside the ramp expressions (see
// dimmable), so a ramp refresh carries the focus through. Coverage hexes have
// their own domain: sharing the main tier's min/max flattened them.
export function rampStyle({ stops, coverageStops, radiusRange }) {
  const coverageColor = dimmable(rampExpression(coverageStops, "count"));
  return {
    ...Object.fromEntries(
      POINT_LAYERS.map(([id, padding]) => [
        id,
        { paint: { "circle-radius": radiusExpression(radiusRange, padding) } },
      ]),
    ),
    hexes: {
      paint: { "fill-color": dimmable(rampExpression(stops, "count")) },
    },
    "coverage-hexes": { paint: { "fill-color": coverageColor } },
    "coverage-hex-outlines": { paint: { "line-color": coverageColor } },
  };
}

// Track features carry their dataset (pk_url, a string in the tile), so the
// paint reads the focus off the property with no feature-state. A selected
// platform ("selection") outranks a focused dataset: everything under its
// track goes grey.
export function trackFocusStyle(pk) {
  const isFocused = ["==", ["to-number", ["get", "pk_url"]], pk];
  const [lineColor, headIcon] =
    pk === "selection"
      ? [dimmedFeatureColor, "track-head-arrow-dim"]
      : pk
        ? [
            ["case", isFocused, trackLineColor, dimmedFeatureColor],
            ["case", isFocused, "track-head-arrow", "track-head-arrow-dim"],
          ]
        : [trackLineColor, "track-head-arrow"];
  return {
    "track-lines": { paint: { "line-color": lineColor } },
    "track-heads": { layout: { "icon-image": headIcon } },
    "track-heads-fixed": { paint: { "circle-color": lineColor } },
  };
}

export function visibilityStyle(layerIds, visible) {
  return Object.fromEntries(
    layerIds.map((id) => [
      id,
      { layout: { visibility: visible ? "visible" : "none" } },
    ]),
  );
}

// Layers not yet in the style are skipped.
export function applyStyle(map, style) {
  Object.entries(style).forEach(([id, { paint = {}, layout = {} }]) => {
    if (!map.getLayer(id)) return;
    Object.entries(paint).forEach(([key, value]) =>
      map.setPaintProperty(id, key, value),
    );
    Object.entries(layout).forEach(([key, value]) =>
      map.setLayoutProperty(id, key, value),
    );
  });
}

// Drawn at 2x and added with pixelRatio 2 so it stays crisp on hidpi.
function buildHeadArrowImage(fillColor, strokeColor = "#ffffff") {
  const ratio = 2;
  const size = 16 * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  // A CPU canvas: getImageData on a GPU one stalls on the map's shader work.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.beginPath();
  ctx.moveTo(size / 2, 1.5 * ratio); // apex (north)
  ctx.lineTo(size - 2.5 * ratio, size - 2.5 * ratio);
  ctx.lineTo(size / 2, size - 5.5 * ratio); // tail notch
  ctx.lineTo(2.5 * ratio, size - 2.5 * ratio);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.5 * ratio;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

const tiles = { source: "cde-tiles", "source-layer": "internal-layer-name" };
const cells = { source: "cde-cells", "source-layer": "coverage-hexes-layer" };
const hovered = (on, off) => [
  "case",
  ["boolean", ["feature-state", "hovered"], false],
  on,
  off,
];

// [spec, beforeId] in insertion order: a beforeId must already exist (MapLibre
// throws otherwise).
function layerSpecs({ tracksVisible }) {
  const marker = { ...tiles, type: "circle", minzoom: HEX_MAX_ZOOM };
  const tracksVisibility = tracksVisible ? "visible" : "none";
  return [
    // Data layers go below the basemap labels so names stay readable.
    [
      {
        ...marker,
        id: "points",
        layout: { "circle-sort-key": ["get", "count"] },
        paint: {
          "circle-radius-transition": NO_TRANSITION,
          "circle-color-transition": NO_TRANSITION,
          "circle-color": dimmable(platformColors),
          // The invisible 10px hit halo.
          "circle-stroke-color": dimmable(platformColors),
          "circle-stroke-opacity": 0.001,
          "circle-stroke-width": 10,
        },
      },
      FIRST_LABEL_LAYER_ID,
    ],
    // Below HEX_MAX_ZOOM these counts are merged into the 'hexes' layer.
    [
      {
        ...cells,
        id: "coverage-hexes",
        type: "fill",
        minzoom: HEX_MAX_ZOOM,
        paint: {
          "fill-opacity-transition": NO_TRANSITION,
          "fill-color-transition": NO_TRANSITION,
          // A fill's outline cannot outlive its opacity, so
          // 'coverage-hex-outlines' takes over once the fill thins. Faded in
          // with the markers.
          "fill-outline-color": [
            "interpolate",
            ["linear"],
            ["zoom"],
            HEX_MAX_ZOOM,
            withAlpha(hexOutlineColor, 0),
            MARKER_FADE_END_ZOOM,
            withAlpha(hexOutlineColor, 0.6),
          ],
        },
      },
      "points",
    ],
    // A fill's 'fill-outline-color' is drawn at the fill's opacity and goes
    // with it, hence a line layer of its own that rises as the fill falls.
    [
      {
        ...cells,
        id: "coverage-hex-outlines",
        type: "line",
        minzoom: HEX_MAX_ZOOM,
        paint: {
          "line-color-transition": NO_TRANSITION,
          "line-opacity-transition": NO_TRANSITION,
          "line-width": 1,
        },
      },
      "points",
    ],
    // Visual only; interaction stays on 'points'. No circle-sort-key on
    // purpose: overlapping white casings composite the same in any order, and
    // a sort key would still cost a per-tile sort on the worker.
    [
      {
        ...marker,
        id: "points-halo",
        paint: {
          "circle-color": "#ffffff",
          "circle-radius-transition": NO_TRANSITION,
        },
      },
      "points",
    ],
    [
      {
        ...tiles,
        id: "hexes",
        type: "fill",
        minzoom: 0,
        maxzoom: HEX_MAX_ZOOM,
        paint: {
          "fill-opacity-transition": NO_TRANSITION,
          "fill-color-transition": NO_TRANSITION,
        },
      },
      FIRST_LABEL_LAYER_ID,
    ],
    [
      {
        ...marker,
        id: "points-highlighted",
        // Must match 'points', or rings and markers disagree about which of an
        // overlapping pair is on top.
        layout: { "circle-sort-key": ["get", "count"] },
        paint: {
          "circle-color": dimmable(platformColors),
          "circle-opacity": CIRCLE_OPACITY,
          "circle-radius-transition": NO_TRANSITION,
          "circle-stroke-color": mapInkColor,
          // A ring around a greyed circle would still read as picked out.
          "circle-stroke-width": ["case", IS_DIMMED, 0, 0.75],
        },
        filter: ["in", "pk", ""],
      },
      FIRST_LABEL_LAYER_ID,
    ],
    // 'points' sort-key can't depend on feature-state, so focused markers were
    // buried under grey ones; they're redrawn on top from a copy. Purely
    // visual: clicks still resolve on 'points'. Below 'points-highlighted' so a
    // drawn shape's selection rings stay on top.
    [
      {
        id: "focused-points-halo",
        type: "circle",
        minzoom: HEX_MAX_ZOOM,
        source: "focused-points",
        paint: {
          "circle-color": "#ffffff",
          "circle-radius-transition": NO_TRANSITION,
        },
      },
      "points-highlighted",
    ],
    [
      {
        id: "focused-points",
        type: "circle",
        minzoom: HEX_MAX_ZOOM,
        source: "focused-points",
        layout: { "circle-sort-key": ["get", "count"] },
        paint: {
          "circle-color-transition": NO_TRANSITION,
          "circle-color": platformColors,
          "circle-radius-transition": NO_TRANSITION,
        },
      },
      "points-highlighted",
    ],

    // Gridded coverage. The fill is kept transparent (stacked rectangles
    // composite into a slab) but still drawn, since hit-testing reads it.
    // Before 'points-highlighted' so circles stay on top.
    [
      {
        id: "griddap-coverage-fill",
        type: "fill",
        source: "griddap-coverage",
        paint: { "fill-color": gridCoverageColor, "fill-opacity": 0 },
      },
      "points-highlighted",
    ],
    [
      {
        id: "griddap-coverage-casing",
        type: "line",
        source: "griddap-coverage",
        paint: {
          "line-color": hexOutlineColor,
          "line-opacity": 0.45,
          "line-width": hovered(4.5, 3.5),
        },
      },
      "points-highlighted",
    ],
    [
      {
        id: "griddap-coverage-line",
        type: "line",
        source: "griddap-coverage",
        paint: {
          "line-color": gridCoverageColor,
          "line-width": hovered(2.5, 1.5),
          "line-dasharray": [2, 2],
        },
      },
      "points-highlighted",
    ],
    [
      {
        id: "griddap-coverage-point",
        type: "circle",
        source: "griddap-coverage",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": hexOutlineColor,
          "circle-opacity": 0.8,
          "circle-stroke-color": gridCoverageColor,
          "circle-stroke-width": hovered(2.5, 1.5),
        },
      },
      "points-highlighted",
    ],
    // The focused grid answers in the click goldenrod, like every selection.
    [
      {
        id: "griddap-highlight-line",
        type: "line",
        source: "griddap-highlight",
        paint: { "line-color": clickHighlightColor, "line-width": 2.5 },
      },
      "points-highlighted",
    ],
    [
      {
        id: "griddap-highlight-point",
        type: "circle",
        source: "griddap-highlight",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 7,
          "circle-opacity": 0,
          "circle-stroke-color": clickHighlightColor,
          "circle-stroke-width": 2.5,
        },
      },
      "points-highlighted",
    ],

    ...HEX_HOVER_LAYERS.map(({ id, source, sourceLayer, minzoom, maxzoom }) => [
      {
        id,
        type: "line",
        source,
        "source-layer": sourceLayer,
        minzoom,
        maxzoom,
        filter: NO_HEX_HOVERED,
        paint: {
          "line-color": mapInkColor,
          "line-width": 1.5,
          "line-opacity": 0.9,
        },
      },
      FIRST_LABEL_LAYER_ID,
    ]),

    // No beforeId, so the click highlight draws over every data layer: a
    // highlight the markers cover is no highlight. The merged fill goes down
    // first: on top of the per-box glow it smothered every nested box's glow,
    // so only the biggest box looked selected.
    [
      {
        id: "click-highlight-fill",
        type: "fill",
        source: "click-highlight",
        // Grid rectangles are outlined only (see `role` in buildFeatureQuery).
        filter: [
          "all",
          ["!=", ["geometry-type"], "Point"],
          ["!=", ["get", "role"], "outline"],
        ],
        paint: { "fill-color": clickHighlightColor, "fill-opacity": 0.18 },
      },
    ],
    // Point and polygon geometries blur through different properties
    // (circle-blur vs. line-blur), so each gets its own layer.
    [
      {
        id: "click-highlight-glow",
        type: "line",
        source: "click-highlight",
        filter: ["!=", ["geometry-type"], "Point"],
        paint: {
          "line-color": clickHighlightColor,
          "line-width": 10,
          "line-blur": 8,
          "line-opacity": 0.85,
        },
      },
    ],
    [
      {
        id: "click-highlight-point-glow",
        type: "circle",
        source: "click-highlight",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius-transition": NO_TRANSITION,
          "circle-color": clickHighlightColor,
          "circle-blur": 0.8,
          "circle-opacity": 0.85,
        },
      },
    ],
    [
      {
        id: "click-highlight-line",
        type: "line",
        source: "click-highlight",
        filter: ["!=", ["geometry-type"], "Point"],
        paint: { "line-color": clickHighlightColor, "line-width": 2.5 },
      },
    ],
    // Outlined, not enlarged, so the legend's size key still reads true; the
    // radius is the 'points' expression over the carried `count`. The marker's
    // own circle-stroke is the invisible hit halo, so it can't be used.
    [
      {
        id: "click-highlight-point",
        type: "circle",
        source: "click-highlight",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius-transition": NO_TRANSITION,
          "circle-color": "rgba(0, 0, 0, 0)",
          "circle-stroke-color": clickHighlightColor,
          "circle-stroke-width": 2.5,
        },
      },
    ],
    // A fixed size: the record's feature carries no `count`. Under the focused
    // markers, since the record's own marker is in 'focused-points' and the
    // ring is wider than the largest marker.
    [
      {
        id: "mapped-record-glow",
        type: "circle",
        source: "mapped-record",
        paint: {
          "circle-radius": 16,
          "circle-color": clickHighlightColor,
          "circle-blur": 0.8,
          "circle-opacity": 0.85,
        },
      },
      "focused-points-halo",
    ],
    [
      {
        id: "mapped-record-ring",
        type: "circle",
        source: "mapped-record",
        paint: {
          "circle-radius": 11,
          "circle-color": "rgba(0, 0, 0, 0)",
          "circle-stroke-color": clickHighlightColor,
          "circle-stroke-width": 3,
        },
      },
      "focused-points-halo",
    ],

    [
      {
        id: "track-lines",
        type: "line",
        source: "tracks",
        "source-layer": "track-lines",
        layout: {
          visibility: tracksVisibility,
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1, 10, 2.5],
          "line-opacity": TRACK_LINE_OPACITY,
        },
      },
    ],
    // Heads where cog is undefined (single fixes, stationary platforms) fall
    // back to circles.
    [
      {
        id: "track-heads",
        type: "symbol",
        source: "tracks",
        "source-layer": "track-heads",
        filter: SELECTION_FILTERED_LAYERS["track-heads"],
        layout: {
          visibility: tracksVisibility,
          "icon-rotate": ["get", "cog"],
          // Rotates with the map so the arrow points along the geographic
          // course.
          "icon-rotation-alignment": "map",
          // Below z7 a tile can carry ~100k heads and forcing every one to
          // render overwhelms the tab; at z7+ it's a few hundred (also capped
          // per tile by /tiles/tracks).
          "icon-allow-overlap": ["step", ["zoom"], false, HEX_MAX_ZOOM, true],
          "icon-ignore-placement": [
            "step",
            ["zoom"],
            false,
            HEX_MAX_ZOOM,
            true,
          ],
          // When culling, keep the most recent heads deterministically.
          "symbol-sort-key": ["-", 0, ["coalesce", ["get", "head_time"], 0]],
        },
        paint: { "icon-opacity": TRACK_HEAD_OPACITY },
      },
    ],
    [
      {
        id: "track-heads-fixed",
        type: "circle",
        source: "tracks",
        "source-layer": "track-heads",
        filter: SELECTION_FILTERED_LAYERS["track-heads-fixed"],
        layout: { visibility: tracksVisibility },
        paint: {
          "circle-radius": 4.5,
          "circle-opacity": TRACK_HEAD_OPACITY,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-opacity": TRACK_HEAD_OPACITY,
          "circle-stroke-width": 1.5,
        },
      },
    ],

    // The click-highlight colour: a drawn track is what the last click found,
    // so it wears the same accent as a ringed marker or outlined hex. Line
    // features are the path; point features are the raw fixes.
    [
      {
        id: "selected-track-line",
        type: "line",
        source: "selected-track",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": clickHighlightColor, "line-width": 3 },
      },
    ],
    [
      {
        id: "selected-track-fixes",
        type: "symbol",
        source: "selected-track",
        // MapLibre rejects filters mixing legacy ('$type') and expression
        // operators.
        filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "cog"]],
        layout: {
          "icon-image": "selected-fix-arrow",
          "icon-size": 0.75,
          "icon-rotate": ["get", "cog"],
          "icon-rotation-alignment": "map",
          // A track can run to 60k fixes, and allow-overlap buried the line
          // under arrows. Collision spaces the survivors on screen at every
          // zoom, and placement walks feature (= time) order, so they're an
          // even walk along the track.
          "icon-allow-overlap": false,
          "icon-ignore-placement": false,
          "icon-padding": 4,
        },
      },
    ],
    [
      {
        id: "selected-track-fixes-nocog",
        type: "circle",
        source: "selected-track",
        filter: [
          "all",
          ["==", ["geometry-type"], "Point"],
          ["!", ["has", "cog"]],
        ],
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": 3,
          "circle-stroke-color": clickHighlightColor,
          "circle-stroke-width": 1.5,
        },
      },
    ],
  ];
}

const merge = (spec, styles) => ({
  ...spec,
  paint: Object.assign({}, spec.paint, ...styles.map((s) => s[spec.id]?.paint)),
  layout: Object.assign(
    {},
    spec.layout,
    ...styles.map((s) => s[spec.id]?.layout),
  ),
});

// Every source and layer the data draws with, created once the style is up.
// `styles` are the current revealStyle/rampStyle/trackFocusStyle tables, so a
// layer is born in its current state.
export function addDataLayers(
  map,
  { tileQuery, cellTileQuery, tracksQuery, griddapCoverage, tracksVisible },
  styles,
) {
  const geojson = (data = emptyFeatureCollection, extra = {}) => ({
    type: "geojson",
    data,
    ...extra,
  });
  // Shared sources: per-layer inline sources fetched and parsed the same tile
  // pyramids six times on every pan.
  //
  // maxzoom 14: routes/tiles.js has nothing new past z7, and ST_AsMVTGeom at
  // extent 4096 over z14 (~0.42 m/unit at 45°N) is finer than a z17 pixel, so
  // deeper tiles were 64 queries for one tile's data, refetched on every filter
  // change's setTiles. The cells' geometry is the same at every zoom from 4 up,
  // so past z10 (~7 m per tile unit at 45°N on a 20 km cell) a deeper tile
  // only refetched identical data.
  //
  // promoteId: setFeatureState addresses the feature id.
  const sources = {
    "cde-tiles": {
      type: "vector",
      tiles: [tileQuery],
      maxzoom: 14,
      promoteId: "pk",
    },
    "cde-cells": {
      type: "vector",
      tiles: [cellTileQuery],
      maxzoom: 10,
      promoteId: "pk",
    },
    "focused-points": geojson(),
    // GeoJSON rather than tiles: coverage is tens of features served whole by
    // /griddapCoverage.
    "griddap-coverage": geojson(griddapCoverage || undefined, {
      promoteId: "pk",
    }),
    "griddap-highlight": geojson(),
    "click-highlight": geojson(),
    "mapped-record": geojson(),
    // No minzoom on purpose. At low zoom one tile can carry every trajectory in
    // the window (100k+ features); trailingWindowOptions' one-year cap keeps
    // that in check. If it regresses, simplify server-side in
    // web-api/routes/tiles.js rather than adding a minzoom.
    tracks: { type: "vector", maxzoom: 8, tiles: [tracksQuery] },
    "selected-track": geojson(),
  };
  Object.entries(sources).forEach(([id, source]) => map.addSource(id, source));

  [
    ["track-head-arrow", buildHeadArrowImage(trackLineColor)],
    ["track-head-arrow-dim", buildHeadArrowImage(dimmedFeatureColor)],
    ["selected-fix-arrow", buildHeadArrowImage("#ffffff", clickHighlightColor)],
  ].forEach(([id, image]) => map.addImage(id, image, { pixelRatio: 2 }));

  layerSpecs({ tracksVisible }).forEach(([spec, beforeId]) =>
    map.addLayer(merge(spec, styles), beforeId),
  );
}
