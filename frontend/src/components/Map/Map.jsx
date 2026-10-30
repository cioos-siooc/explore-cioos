import * as React from "react";
import { Map as MaplibreMap, Marker, Popup, setWorkerUrl } from "maplibre-gl";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { useState, useEffect, useLayoutEffect, useRef } from "react";

import * as helpers from "@turf/helpers";
import turfBboxPolygon from "@turf/bbox-polygon";
import turfPointsWithinPolygon from "@turf/points-within-polygon";
import turfBbox from "@turf/bbox";

import DrawRectangle from "mapbox-gl-draw-rectangle-mode";
import debounce from "lodash-es/debounce";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "./styles.css";
import Spinner from "../ui/Spinner.jsx";

import { server } from "../../config";
import reportError from "../../state/reportError.js";
import fetchJson from "../../state/fetchJson.js";
import {
  boundsFromGeoJson,
  escapeHtml,
  formatInstant,
  formatInstantRange,
  generateColorStops,
  getCurrentRangeLevel,
  mapCoverPadding,
  polygonIsRectangle,
  quantizeCountRange,
  rangesEqual,
  revealOffset,
  zoomToDatasetCamera,
  splitTrackRuns,
  initialBearing,
} from "../../utilities";
import {
  buildWmsGetMapUrl,
  clampBoundsForWms,
  intersectBoundsWithPolygonBbox,
  warpEquirectToMercator,
} from "../../wmsUtilities";
import {
  basemapHandoffEndZoom,
  basemapHandoffStartZoom,
  clickHighlightColor,
  colorScale,
  defaultBathymetryPalette,
  hexOutlineColor,
  MARKER_MIN_ZOOM,
  trackLineColor,
} from "../config";
import platforms from "../../platforms.json";
import { platformColor } from "../../platformVocab.js";
import DepthProbe from "./DepthProbe.jsx";
import {
  TRAJECTORY_TYPE_KEYS,
  anyTrajectoryLayerOn,
} from "../../state/dataLayers.js";
import {
  buildBasemapStyle,
  getLabelTextField,
  FIRST_LABEL_LAYER_ID,
  LABEL_LAYER_IDS,
  nonnaColorRamp,
} from "./basemapStyle.js";
import {
  buildTileSuffix,
  filterTimeWindow,
  tracksTimeWindow,
} from "./tileQuery.js";
import {
  buildFeatureQuery,
  datasetPksOf,
  dedupeGriddapByPk,
  featureHasDataset,
  griddapCoveredIn,
  griddapHitLayers,
  griddapOutranksHexesIn,
  griddapTitle,
  isGriddapHit,
  isOnAPointIn,
  loadTurfUnion,
  selectedTrackLayers,
  trackClickLayers,
  trackItemsIn,
} from "./hitTest.js";
import { radiusExpression } from "./pointRadius.js";
import { rampExpression, toRampStops } from "./hexRamp.js";
import { focusedPointFeatures } from "./focusedPoints.js";
import { selectionLayerFilter } from "./selectionFilter.js";
import { createTileRetry } from "./tileRetry.js";
import { withBoxHint, withPolygonHint } from "./DrawHint/drawHintModes.js";

// maplibre 6 can't find its worker from inside a bundle.
setWorkerUrl(maplibreWorkerUrl);

// Captured before the overrides below replace them.
const defaultDragVertex = MapboxDraw.modes.direct_select.dragVertex;
const defaultDirectSelectToDisplayFeatures =
  MapboxDraw.modes.direct_select.toDisplayFeatures;

// mapbox-gl-draw strips a rectangle's closing point; polygonIsRectangle
// expects a closed 5-point ring.
function isRectangleFeature(feature) {
  const ring = feature?.type === "Polygon" && feature.coordinates?.[0];
  return (
    Boolean(ring) && ring.length === 4 && polygonIsRectangle([...ring, ring[0]])
  );
}

// Hides vertex/midpoint handles for a merely-selected shape; a second click
// enters direct_select, whose default toDisplayFeatures draws them.
const disabledEvent = function (state, geojson, display) {
  display(geojson);
};

const modes = MapboxDraw.modes;
MapboxDraw.modes.simple_select.toDisplayFeatures = disabledEvent;

// Keeps a drawn box an axis-aligned rectangle: a single-corner drag also
// slides its two adjacent corners along their shared axes, leaving the
// opposite corner as the anchor. Anything else keeps the library behaviour.
modes.direct_select.dragVertex = function (state, e, delta) {
  const path = state.selectedCoordPaths[0];
  if (
    state.selectedCoordPaths.length !== 1 ||
    !isRectangleFeature(state.feature)
  ) {
    defaultDragVertex.call(this, state, e, delta);
    return;
  }
  const [ringIndex, index] = path.split(".").map((x) => parseInt(x, 10));
  const oldCoord = state.feature.getCoordinate(path);
  const newCoord = [oldCoord[0] + delta.lng, oldCoord[1] + delta.lat];
  [(index + 3) % 4, (index + 1) % 4].forEach((neighborIndex) => {
    const neighborPath = `${ringIndex}.${neighborIndex}`;
    const neighborOld = state.feature.getCoordinate(neighborPath);
    if (neighborOld[0] === oldCoord[0]) {
      state.feature.updateCoordinate(neighborPath, newCoord[0], neighborOld[1]);
    } else {
      state.feature.updateCoordinate(neighborPath, neighborOld[0], newCoord[1]);
    }
  });
  state.feature.updateCoordinate(path, newCoord[0], newCoord[1]);
};

// A spatial filter can only be resized from its handles, never moved
// wholesale; dragMoveLocation is still tracked so a later handle-drag in the
// same gesture doesn't jump.
modes.direct_select.dragFeature = function (state, e) {
  state.dragMoveLocation = e.lngLat;
};

// A midpoint would add a 5th vertex and break a rectangle's 4 corners.
modes.direct_select.toDisplayFeatures = function (state, geojson, push) {
  if (
    state.featureId === geojson.properties.id &&
    isRectangleFeature(state.feature)
  ) {
    defaultDirectSelectToDisplayFeatures.call(
      this,
      state,
      geojson,
      (feature) => {
        if (feature.properties?.meta === "midpoint") return;
        push(feature);
      },
    );
    return;
  }
  defaultDirectSelectToDisplayFeatures.call(this, state, geojson, push);
};

// Keep a drawn shape "active" rather than exiting to simple_select's plain
// look when clicking empty water or another feature.
modes.direct_select.clickNoTarget = modes.direct_select.clickActiveFeature;
modes.direct_select.clickInactive = modes.direct_select.clickActiveFeature;

modes.draw_polygon = withPolygonHint(MapboxDraw.modes.draw_polygon);
modes.draw_rectangle = withBoxHint(DrawRectangle);

const drawControlOptions = {
  displayControlsDefault: false,
  // Driven imperatively from the top bar (see the drawRequest effect).
  controls: {
    point: false,
    line_string: false,
    polygon: false,
    trash: false,
    combine_features: false,
    uncombine_features: false,
    modes,
    pitchWithRotate: false,
    dragRotate: false,
    touchZoomRotate: false,
  },
  styles: [
    {
      id: "gl-draw-polygon-fill",
      type: "fill",
      filter: ["all", ["==", "$type", "Polygon"]],
      paint: {
        "fill-color": [
          "case",
          ["==", ["get", "active"], "true"],
          "#fbb03b",
          "#3bb2d0",
        ],
        "fill-opacity": 0.1,
      },
    },
    {
      id: "gl-draw-lines",
      type: "line",
      filter: [
        "any",
        ["==", "$type", "LineString"],
        ["==", "$type", "Polygon"],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "case",
          ["==", ["get", "active"], "true"],
          "#fbb03b",
          "#3bb2d0",
        ],
        "line-dasharray": ["literal", [0.2, 2]],
        "line-width": 2,
      },
    },
    {
      id: "gl-draw-point-outer",
      type: "circle",
      filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5],
        "circle-color": "#fff",
      },
    },
    {
      id: "gl-draw-point-inner",
      type: "circle",
      filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3],
        "circle-color": [
          "case",
          ["==", ["get", "active"], "true"],
          "#fbb03b",
          "#3bb2d0",
        ],
      },
    },
    {
      id: "gl-draw-vertex-outer",
      type: "circle",
      filter: [
        "all",
        ["==", "$type", "Point"],
        ["==", "meta", "vertex"],
        ["!=", "mode", "simple_select"],
      ],
      paint: {
        "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5],
        "circle-color": "#fff",
      },
    },
    {
      id: "gl-draw-vertex-inner",
      type: "circle",
      filter: [
        "all",
        ["==", "$type", "Point"],
        ["==", "meta", "vertex"],
        ["!=", "mode", "simple_select"],
      ],
      paint: {
        "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3],
        "circle-color": "#fbb03b",
      },
    },
    {
      id: "gl-draw-midpoint",
      type: "circle",
      filter: ["all", ["==", "meta", "midpoint"]],
      paint: { "circle-radius": 3, "circle-color": "#fbb03b" },
    },
  ],
};

// A debounce, not a throttle: one measurement at the end of a gesture, so a
// hesitant pan doesn't renumber the legend halfway through.
const VIEWPORT_RAMP_DEBOUNCE_MS = 400;
const MAP_VIEW_DEBOUNCE_MS = 250;

// Partial opacity so coincident tracks compound: 27 St. Lawrence voyages in
// 90 days render as ONE line at full opacity.
const TRACK_LINE_OPACITY = 0.55;
const DATA_STALE_OPACITY = 0.25;
// direct_select fires draw.update on every drag tick, and setPolygon feeds
// the /pointQuery fetch.
const DRAW_UPDATE_DEBOUNCE_MS = 300;
// Zoomed in, one or two cells are often all there is; falling back to the
// catalogue-wide domain painted them pale. generateColorStops gives a
// one-value range a mid shade.
const MIN_VIEWPORT_HEXES = 1;
// Only one is ever on screen, and queryRenderedFeatures returns nothing for a
// layer outside its zoom range, so asking for both needs no zoom test.
const HEX_LAYER_IDS = ["hexes", "coverage-hexes"];
const HEX_SOURCE_IDS = ["cde-tiles", "cde-cells"];

// The coverage cell is a fixed 20 km across (web-api/routes/tiles.js), so
// past the basemap hand-off it would just tint the imagery; the fill fades
// over the same window and the ramp moves to the border
// ('coverage-hex-outlines').
const HEX_FILL_FADE_START_ZOOM = basemapHandoffStartZoom;
const HEX_FILL_FADE_END_ZOOM = basemapHandoffEndZoom;

// The CHS soundings are deliberately not here: they are the slowest thing on
// the map by a wide margin. See reportFirstPaint.
const BASEMAP_SOURCE_IDS = ["bathymetry", "imagery", "ofm"];

// Grouped the way a reader thinks about the map, not by MapLibre source. `id`
// maps to a translated label in ActivityTasks.
const WATCHED_MAP_LAYERS = [
  { id: "observations", sources: HEX_SOURCE_IDS },
  { id: "tracks", sources: ["tracks", "selected-track"] },
  { id: "bathymetry", sources: ["bathymetry", "nonna"] },
  { id: "imagery", sources: ["imagery"] },
  { id: "griddap", sources: ["griddap-coverage"] },
  { id: "wmsOverlay", sources: ["wms-overlay"] },
];
// A browser-cached GetMap resolves in a frame or two; the spinner would flash.
const WMS_SPINNER_DELAY_MS = 300;

// The round trip is exact to float noise for a point really on the surface,
// off by tens of pixels for one that isn't (see viewportQueryIsReliable).
const SURFACE_ROUND_TRIP_TOLERANCE_PX = 1;

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

// While a WMS overlay is active every other data layer is hidden so the
// gridded field reads cleanly.
const observationLayerIds = [
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
const trackLayerIds = [
  "track-lines",
  "track-heads",
  "track-heads-fixed",
  "selected-track-line",
  "selected-track-fixes",
  "selected-track-fixes-nocog",
];
const griddapLayerIds = [
  "griddap-coverage-fill",
  "griddap-coverage-line",
  "griddap-coverage-point",
];
// Basemap, not data: owned by their own switch and left out of the WMS
// overlay's hide.
const bathymetryLayerIds = ["bathymetry-nonna", "bathymetry-nonna-hillshade"];

const emptyFeatureCollection = { type: "FeatureCollection", features: [] };

const TRACK_HEAD_HAS_COURSE = ["has", "cog"];
// Hidden outside a drawn shape, as the dataset list leaves them out: they can't
// be hovered or clicked, and the map lays out less. Values are
// each layer's own filter.
const SELECTION_FILTERED_LAYERS = {
  hexes: undefined,
  points: undefined,
  "points-halo": undefined,
  "coverage-hexes": undefined,
  "coverage-hex-outlines": undefined,
  "track-lines": undefined,
  "track-heads": TRACK_HEAD_HAS_COURSE,
  "track-heads-fixed": ["!", TRACK_HEAD_HAS_COURSE],
};

// The eslint-disable react-hooks/exhaustive-deps comments below: effects call
// helpers rebuilt on every render (the component re-renders on every map
// move), so listing them would re-issue map commands continuously. The real
// fix is making the helpers stable with useCallback; until then each site is
// marked individually so new effects are still checked.
export default function CreateMap({
  mapQueryString,
  polygon,
  setPolygon,
  setLoading,
  setLoadingLayers = () => {},
  // Read once, when the map is created.
  initialView,
  setMapView,
  // null for a click on empty water. See handleMapClick.
  onFeatureQuery = () => {},
  // Handed back so the map can outline the region the open card describes.
  featureQuery,
  // Read at mount only.
  sharedFeatureQueryAt,
  // One marker, one dataset, nothing else under the cursor. highlightQuery is
  // a minimal featureQuery so the caller can still pin the dataset. See
  // handleMapClick.
  onMarkerClick = () => {},
  // One track and nothing else under the cursor. See handleMapClick.
  onTrackClick = () => {},
  // Every click while the depth tool is on, instead of anything else it hits.
  onDepthQuery = () => {},
  // Its answer, labelled at the clicked point.
  depthReading,
  depthToolActive = false,
  // Escape, the usual way out of a map tool.
  onDepthToolExit = () => {},
  rangeLevels,
  coverageRangeLevels,
  // undefined when there is nothing to measure and the global tier takes over.
  onViewportHexRange = () => {},
  hoveredDataset,
  setHoveredDataset,
  inspectDataset,
  tracksMode,
  scrubTime,
  trailingDays,
  selectedTrajectory,
  mappedRecord,
  dataLayers,
  griddapCoverage,
  dataLayersVisible = true,
  bathymetryVisible = true,
  bathymetryPalette = defaultBathymetryPalette,
  activeWmsOverlay,
  projection = "mercator",
  zoomTarget,
  drawRequest,
  featureQueryRequest,
  onMapReady = () => {},
  // See reportFirstPaint.
  onFirstPaint = () => {},
}) {
  const { t, i18n } = useTranslation();

  const mapContainer = useRef(null);
  const map = useRef(null);
  const creatingPolygon = useRef(false);
  const shiftBoxCreate = useRef(false);

  const circleOpacity = 0.7;
  // Count is carried by colour alone; opacity varies with zoom alone.
  const hexOpacity = 0.8;
  const hexMinZoom = 0;
  // Shared with the Legend: the hex band and the marker tier must not drift.
  const hexMaxZoom = MARKER_MIN_ZOOM;
  // Nearly solid: a hairline stands in for a whole hexagon of fill.
  const COVERAGE_HEX_OUTLINE_OPACITY = 0.9;

  // Doesn't bottom out at a wash: at 0.15 the cells stopped reading as a shade
  // of anything. Across the basemap hand-over the fill goes to nothing and the
  // border carries the ramp (HEX_FILL_FADE_*_ZOOM).
  const COVERAGE_HEX_OPACITY_STOPS = [
    [hexMaxZoom, 0.6],
    [hexMaxZoom + 1.5, 0.5],
    [HEX_FILL_FADE_START_ZOOM, 0.43],
    [HEX_FILL_FADE_END_ZOOM, 0],
  ];

  // Continuous with COVERAGE_HEX_OPACITY_STOPS: ends at hexMaxZoom on the value
  // that one starts with.
  const HEX_OPACITY_STOPS = [
    [hexMinZoom, hexOpacity],
    [hexMaxZoom, COVERAGE_HEX_OPACITY_STOPS[0][1]],
  ];
  const [draw] = useState(() => new MapboxDraw(drawControlOptions));
  // refreshTiles is the one public call that reloads an errored tile.
  const [tileRetry] = useState(() =>
    createTileRetry({
      refresh: (sourceId, tile) => {
        if (map.current?.getSource(sourceId)) {
          map.current.refreshTiles(sourceId, [tile]);
        }
      },
    }),
  );
  const drawPolygon = useRef(draw);
  const doFinalCheck = useRef(false);
  const layersLoaded = useRef(false);
  const colorStops = useRef([]);
  const coverageColorStops = useRef([]);
  // A ref, not state: a re-render isn't what it should cause; the legend hears
  // via onViewportHexRange.
  const viewportHexRange = useRef(undefined);
  // For the map handlers registered once on mount.
  const setColorStopsRef = useRef(undefined);
  // Bumped when a count stops meaning what it meant (new filters or geometry);
  // part of the ramp key.
  const rampQueryEpoch = useRef(0);
  // See revealData.
  const dataRevealed = useRef(false);
  const firstPaintReported = useRef(false);
  // Mirrors firstPaintReported purely to reach the DOM; the ref stays the guard
  // because reportFirstPaint reads it synchronously.
  const [firstPainted, setFirstPainted] = useState(false);
  // The mount effect's pushMapView, so reportFirstPaint can seed the in-view
  // bounds the moment the map is handed over.
  const pushMapViewRef = useRef(null);
  // For the once-registered measurement handler, which runs on the mount
  // closure.
  const rangeLevelsRef = useRef(rangeLevels);
  const pointRadiusRange = useRef(null);
  // A ref because zoomend/sourcedata/idle handlers need the current value.
  const focusedDatasetPk = useRef(undefined);
  // Makes re-applying an unchanged focus free (see hoverHighlightPoints).
  const appliedFocus = useRef("");
  // Reset when the track layers are (re)created.
  const trackFocusApplied = useRef(undefined);
  // Only an open page scales the ramp; a hover leaves it alone.
  const rampFocusPk = useRef(undefined);
  // undefined: nothing measured for the current key, so the next idle measures.
  const rampMeasuredFor = useRef(undefined);
  // For the one-shot map 'load' closure.
  const tracksModeRef = useRef(tracksMode);
  const scrubTimeRef = useRef(scrubTime);
  const trailingDaysRef = useRef(trailingDays);
  const dataLayersRef = useRef(dataLayers);
  const onViewportHexRangeRef = useRef(onViewportHexRange);
  const selectedTrajectoryRef = useRef(selectedTrajectory);

  const rawTrackRef = useRef(null);
  // So a redraw from a filter change doesn't re-frame it.
  const framedTrackRef = useRef(null);

  // Drops the TimeSelector's timeMin/timeMax: the scrub window must not fight
  // the date-range filter.
  function buildTracksTileUrl(queryString, scrub, trailing) {
    const params = new URLSearchParams(queryString);
    params.delete("timeMin");
    params.delete("timeMax");
    const { timeMin, timeMax } = tracksTimeWindow(scrub, trailing);
    params.set("timeMin", timeMin);
    params.set("timeMax", timeMax);
    const layers = dataLayersRef.current;
    if (layers) {
      const enabled = TRAJECTORY_TYPE_KEYS.filter(([key]) => layers[key]).map(
        ([, type]) => type,
      );
      if (enabled.length < TRAJECTORY_TYPE_KEYS.length) {
        params.set("trajectoryTypes", enabled.join(","));
      }
    }
    return `${server}/tiles/tracks/{z}/{x}/{y}.mvt?${params.toString()}`;
  }

  function refreshTracksSource(queryString, scrub, trailing) {
    if (!map.current || !map.current.getSource("tracks")) return;
    tileRetry.reset("tracks");
    // setTiles clears the source's tile cache and reloads the viewport tiles.
    map.current
      .getSource("tracks")
      .setTiles([buildTracksTileUrl(queryString, scrub, trailing)]);
  }

  function refreshCombinedSources(queryString) {
    // Guard on source existence, NOT map.loaded(): loaded() is false whenever
    // any tile is in flight, which on heavy coverage/track tiles silently
    // dropped filter changes. setTiles works fine while other tiles load.
    if (
      !map.current ||
      !map.current.getSource("cde-tiles") ||
      !map.current.getSource("cde-cells")
    )
      return;
    const { tileQuery, cellTileQuery } = tileUrls(queryString);
    HEX_SOURCE_IDS.forEach((id) => tileRetry.reset(id));
    map.current.getSource("cde-tiles").setTiles([tileQuery]);
    map.current.getSource("cde-cells").setTiles([cellTileQuery]);
  }

  // The ONLY thing that hides the tracks: the "Hexes & points" picker owns
  // observationLayerIds alone. Which track types draw is decided server-side
  // (buildTileSuffix).
  function applyLayerVisibility() {
    if (!map.current || !map.current.getLayer("track-lines")) return;
    const trajOn = anyTrajectoryLayerOn(dataLayersRef.current);
    const showTracks = trajOn && tracksModeRef.current;
    ["track-lines", "track-heads", "track-heads-fixed"].forEach((id) =>
      map.current.setLayoutProperty(
        id,
        "visibility",
        showTracks ? "visible" : "none",
      ),
    );
  }

  // Used only until /legend resolves: MapLibre silently drops a layer whose
  // paint function has zero stops. Never seen, since the layers stay at zero
  // opacity until revealData.
  const defaultRangeLevels = {
    zoom0: [1, 100],
    zoom1: [1, 100],
    zoom2: [1, 100],
  };
  const defaultCoverageRangeLevels = { zoom1: [1, 100] };

  // The count-ramp layers (hexes, points and casing) are created at zero
  // opacity and revealed once their colours are final; otherwise a first load
  // paints every feature twice (placeholder then real domain), a full-map
  // flash. The splash is translucent, so this gate is what hides that repaint.
  //
  // Zero opacity rather than 'visibility: none': queryRenderedFeatures skips a
  // hidden layer, and measuring the hexes is what decides the reveal. One-way:
  // later filter changes dim instead (markDataStale).
  function revealData() {
    if (dataRevealed.current || !map.current) return;
    dataRevealed.current = true;
    reportFirstPaint();
    applyObservationOpacity(1);
  }

  // `scale` is DATA_STALE_OPACITY while the tiles shown are for the previous
  // filters.
  function applyObservationOpacity(scale) {
    if (map.current.getLayer("hexes")) {
      map.current.setPaintProperty(
        "hexes",
        "fill-opacity",
        hexOpacityExpression(scale),
      );
    }
    if (map.current.getLayer("coverage-hexes")) {
      map.current.setPaintProperty(
        "coverage-hexes",
        "fill-opacity",
        coverageHexOpacityExpression(scale),
      );
    }
    if (map.current.getLayer("coverage-hex-outlines")) {
      map.current.setPaintProperty(
        "coverage-hex-outlines",
        "line-opacity",
        coverageHexOutlineOpacityExpression(scale),
      );
    }
    if (map.current.getLayer("points")) {
      map.current.setPaintProperty(
        "points",
        "circle-opacity",
        circleOpacity * scale,
      );
    }
    if (map.current.getLayer("points-halo")) {
      map.current.setPaintProperty(
        "points-halo",
        "circle-opacity",
        pointsHaloOpacity(scale),
      );
    }
    if (map.current.getLayer("focused-points")) {
      map.current.setPaintProperty(
        "focused-points",
        "circle-opacity",
        circleOpacity * scale,
      );
      map.current.setPaintProperty(
        "focused-points-halo",
        "circle-opacity",
        0.9 * scale,
      );
    }
  }

  // What the first-paint splash waits on: hexes painted with their final ramp
  // and the basemap drawn. Deliberately not 'idle', which waits for the CHS
  // soundings and can fire before the hex sources were even requested.
  function reportFirstPaint() {
    if (firstPaintReported.current || !map.current) return;
    if (!dataRevealed.current) return;
    // A source the style hasn't added yet is skipped: the hexes can't have been
    // revealed until the style was up.
    const basemapDrawn = BASEMAP_SOURCE_IDS.every(
      (id) => !map.current.getSource(id) || map.current.isSourceLoaded(id),
    );
    if (!basemapDrawn) return;
    firstPaintReported.current = true;
    // data-map-ready lets tests wait on the splash's condition rather than its
    // CSS fade, which screenshot capture disables.
    setFirstPainted(true);
    onFirstPaint();
    pushMapViewRef.current?.();
  }

  // Called with the tiles loaded, so a measured range is final. Without one (an
  // empty result or an off-screen focused dataset) the /legend tier must be in
  // too, or it lands later and double-colours the map.
  function revealDataIfRamped(measuredRange) {
    if (measuredRange === undefined && !rangeLevelsRef.current) return;
    revealData();
  }

  // False while a source is missing: its tiles are still on their way.
  function hexSourcesLoaded() {
    return HEX_SOURCE_IDS.every(
      (id) => map.current.getSource(id) && map.current.isSourceLoaded(id),
    );
  }

  // setTiles keeps the previous filters' tiles painted until each is replaced,
  // seconds on a cold query, so those layers are dimmed meanwhile. Opacity is
  // zoom-only, so the swap costs no worker relayout.
  const staleData = useRef({ observations: false, tracks: false });
  const STALE_GROUPS = {
    observations: { sources: HEX_SOURCE_IDS, apply: applyObservationOpacity },
    tracks: { sources: ["tracks"], apply: applyTrackOpacity },
  };

  function applyTrackOpacity(scale) {
    if (!map.current.getLayer("track-lines")) return;
    map.current.setPaintProperty(
      "track-lines",
      "line-opacity",
      TRACK_LINE_OPACITY * scale,
    );
    map.current.setPaintProperty("track-heads", "icon-opacity", scale);
    map.current.setPaintProperty("track-heads-fixed", "circle-opacity", scale);
    map.current.setPaintProperty(
      "track-heads-fixed",
      "circle-stroke-opacity",
      scale,
    );
  }

  // Before the first reveal the layers are already invisible.
  function markDataStale(group) {
    if (!dataRevealed.current || staleData.current[group]) return;
    staleData.current[group] = true;
    STALE_GROUPS[group].apply(DATA_STALE_OPACITY);
  }

  function settleStaleData() {
    if (!map.current) return;
    Object.entries(STALE_GROUPS).forEach(([group, { sources, apply }]) => {
      if (!staleData.current[group]) return;
      const loaded = sources.every(
        (id) => !map.current.getSource(id) || map.current.isSourceLoaded(id),
      );
      if (!loaded) return;
      staleData.current[group] = false;
      apply(1);
    });
  }

  const [boxSelectStartCoords, setBoxSelectStartCoords] = useState();
  const [boxSelectEndCoords, setBoxSelectEndCoords] = useState();

  // Own class so the frame-stripping in styles.css is scoped to this popup.
  const [popup] = useState(
    () =>
      new Popup({
        closeButton: false,
        closeOnClick: true,
        className: "mapChipPopup",
        offset: 10,
        maxWidth: "260px",
      }),
  );

  // A dot under the label, so the depth reads as that exact spot's. The label
  // is its own React root: MapLibre owns the popup's DOM.
  const [depthProbe] = useState(() => {
    const dot = document.createElement("span");
    dot.className = "depthProbeDot";
    const content = document.createElement("div");
    return {
      marker: new Marker({ element: dot }),
      label: new Popup({
        closeButton: false,
        closeOnClick: false,
        className: "depthProbePopup",
        anchor: "bottom",
        offset: 12,
        maxWidth: "260px",
      }).setDOMContent(content),
      root: createRoot(content),
    };
  });

  useEffect(() => {
    // Pinned only once a depth is in: not while reading, on land, or where
    // there is no sounding.
    if (
      !map.current ||
      !depthReading ||
      depthReading.pending ||
      depthReading.depth === null ||
      !bathymetryVisible
    ) {
      depthProbe.marker.remove();
      depthProbe.label.remove();
      return;
    }
    depthProbe.root.render(<DepthProbe reading={depthReading} />);
    depthProbe.marker.setLngLat(depthReading.lngLat).addTo(map.current);
    depthProbe.label.setLngLat(depthReading.lngLat).addTo(map.current);
  }, [depthProbe, depthReading, bathymetryVisible]);

  // Deferred: unmounting a root while React is committing this one warns.
  useEffect(
    () => () => setTimeout(() => depthProbe.root.unmount()),
    [depthProbe],
  );

  const colors = [
    "match",
    ["get", "platform"],
    ...platforms.flatMap((p) => [p.label_en, platformColor(p.label_en)]),
    platformColor("unknown"),
  ];

  // Focus dimming is a feature-state flag the paint expressions carry from the
  // start. setFilter, or setPaintProperty on a data-driven property, forces a
  // relayout that re-sends every loaded tile to the worker, so the old
  // repaint-and-overlay approach re-tessellated the viewport per list row.
  const IS_DIMMED = ["boolean", ["feature-state", "dimmed"], false];
  const dimmable = (color) => ["case", IS_DIMMED, "lightgrey", color];

  // Shares its source layer with 'points', so dimmed markers lose their white
  // ring; only halfway, since the casing keeps a grey dot legible over dark
  // sea.
  function pointsHaloOpacity(scale = 1) {
    return ["case", IS_DIMMED, 0.5 * scale, 0.9 * scale];
  }

  // setFeatureState addresses a source/source-layer, not a style layer.
  const focusTargets = {
    points: { source: "cde-tiles", sourceLayer: "internal-layer-name" },
    hexes: { source: "cde-tiles", sourceLayer: "internal-layer-name" },
    "coverage-hexes": {
      source: "cde-cells",
      sourceLayer: "coverage-hexes-layer",
    },
  };

  // Track features carry their dataset (pk_url, a string in the tile), so the
  // paint reads the focus off the property with no feature-state.
  const trackIsFocused = (pk) => ["==", ["to-number", ["get", "pk_url"]], pk];

  useEffect(() => {
    setColorStops();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeLevels, coverageRangeLevels]);

  useEffect(() => {
    if (boxSelectStartCoords && boxSelectEndCoords) {
      drawPolygon.current?.deleteAll();

      const lineStringObj = helpers.lineString([
        boxSelectStartCoords,
        boxSelectEndCoords,
      ]);
      const bboxPolygonObj = turfBboxPolygon(turfBbox(lineStringObj));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBoxSelectEndCoords();
      setBoxSelectStartCoords();
      setLoading(true);
      drawPolygon.current.add({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [bboxPolygonObj.geometry.coordinates[0]],
        },
      });
      highlightPoints(bboxPolygonObj.geometry.coordinates[0]);
      setPolygon(bboxPolygonObj.geometry.coordinates[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxSelectEndCoords]);

  function deleteAllShapes() {
    drawPolygon.current?.deleteAll();
    map.current.setFilter("points-highlighted", ["in", "pk", ""]);
    setPolygon();
  }

  function endDrawing() {
    if (!map.current) return;
    map.current.getCanvas().style.cursor = "unset";
    drawPolygon.current.changeMode("simple_select");
    deleteAllShapes();
  }

  const hexFillColor = () => rampExpression(colorStops.current, "count");

  // The interpolation variable is `total`, not `count`: i18next treats a
  // numeric `count` as a plural trigger and looks for _one/_other variants.
  const metricCountLabel = (value) =>
    t("mapHexCountDays", {
      total: Number(value || 0).toLocaleString(i18n.language),
    });

  // MapLibre cannot interpolate to or from a data-driven value: the transition
  // just holds the old value then snaps, which read as a glitch after the map
  // had stopped moving.
  const NO_TRANSITION = { duration: 0 };

  // They share one paint, so a radius change must reach all of them or the
  // halo and click highlight desync from the markers.
  const POINT_LAYERS = [
    ["points", 0],
    ["points-halo", 1.25],
    ["points-highlighted", 0],
    ["focused-points", 0],
    ["focused-points-halo", 1.25],
    ["click-highlight-point", 0],
    ["click-highlight-point-glow", 6],
  ];
  // Own domain: sharing the main tier's min/max flattened them.
  const coverageHexFillColor = () =>
    rampExpression(coverageColorStops.current, "count");

  // A fill's outline cannot outlive its opacity, so 'coverage-hex-outlines'
  // draws this colour once the fill has gone.
  const coverageHexOutlineColor = () => hexOutlineColor;

  // Zoom only: the count reaches transparency through the ramp's alpha
  // (toRampStops), and MapLibre multiplies the two. `scale` multiplies the
  // stops because MapLibre rejects wrapping a top-level zoom interpolate.
  const scaleStops = (stops, scale) =>
    stops.flatMap(([zoom, opacity]) => [zoom, opacity * scale]);
  function hexOpacityExpression(scale = 1) {
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      ...scaleStops(HEX_OPACITY_STOPS, scale),
    ];
  }
  function coverageHexOpacityExpression(scale = 1) {
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      ...scaleStops(COVERAGE_HEX_OPACITY_STOPS, scale),
    ];
  }

  // Comes up exactly as the fill goes, so a cell is never both uncoloured and
  // unmarked. The 'case' sits in the stop's OUTPUT because MapLibre rejects a
  // 'zoom' expression that isn't the input to a top-level step/interpolate, and
  // a throwing setPaintProperty would leave the hex layers stuck at opacity 0.
  function coverageHexOutlineOpacityExpression(scale = 1) {
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      HEX_FILL_FADE_START_ZOOM,
      0,
      HEX_FILL_FADE_END_ZOOM,
      [
        "case",
        IS_DIMMED,
        COVERAGE_HEX_OUTLINE_OPACITY * 0.35 * scale,
        COVERAGE_HEX_OUTLINE_OPACITY * scale,
      ],
    ];
  }

  const coverageHexBorderColor = () => dimmable(coverageHexFillColor());

  function setColorStops() {
    if (!map.current) return;
    // Placeholder ranges until /legend resolves (see defaultRangeLevels).
    const effectiveRangeLevels = rangeLevels || defaultRangeLevels;
    // Zoomed into a quiet corner, the global maximum comes from elsewhere and
    // every cell in view lands in the ramp's palest decade. One measurement
    // serves both layers, since only one is ever on screen.
    const hexDomain =
      viewportHexRange.current ||
      getCurrentRangeLevel(effectiveRangeLevels, map.current.getZoom());
    colorStops.current = toRampStops(generateColorStops(colorScale, hexDomain));

    // Coverage hexes only render at zoom >= hexMaxZoom, always on the hex_1
    // grid.
    const effectiveCoverageRangeLevels =
      coverageRangeLevels || defaultCoverageRangeLevels;
    const coverageDomain =
      viewportHexRange.current || effectiveCoverageRangeLevels.zoom1;
    coverageColorStops.current = toRampStops(
      generateColorStops(colorScale, coverageDomain),
    );

    pointRadiusRange.current = getCurrentRangeLevel(
      effectiveRangeLevels,
      hexMaxZoom,
    );

    // The grey is a feature-state branch inside the ramp expressions (see
    // dimmable), so a ramp refresh carries the focus through.
    if (colorStops.current.length > 0) {
      if (map.current.getZoom() >= 7 && map.current.getLayer("points")) {
        map.current.setPaintProperty(
          "points",
          "circle-color",
          dimmable(colors),
        );
        if (map.current.getLayer("focused-points")) {
          map.current.setPaintProperty(
            "focused-points",
            "circle-color",
            colors,
          );
        }
      }
      // Kept populated at every zoom: a reload while zoomed in would otherwise
      // leave hexes unpainted on zoom-out.
      if (map.current.getLayer("hexes")) {
        map.current.setPaintProperty(
          "hexes",
          "fill-color",
          dimmable(hexFillColor()),
        );
      }
    }

    POINT_LAYERS.forEach(([layer, padding]) => {
      if (map.current.getLayer(layer)) {
        map.current.setPaintProperty(
          layer,
          "circle-radius",
          radiusExpression(pointRadiusRange.current, padding),
        );
      }
    });

    if (map.current.getLayer("coverage-hexes")) {
      map.current.setPaintProperty(
        "coverage-hexes",
        "fill-color",
        dimmable(coverageHexFillColor()),
      );
      map.current.setPaintProperty(
        "coverage-hexes",
        "fill-outline-color",
        coverageHexOutlineColor(),
      );
    }
    if (map.current.getLayer("coverage-hex-outlines")) {
      map.current.setPaintProperty(
        "coverage-hex-outlines",
        "line-color",
        coverageHexBorderColor(),
      );
    }
  }

  // In globe projection, a viewport corner whose ray misses the sphere is
  // snapped to the horizon by unprojectScreenPoint, so queryRenderedFeatures
  // searches a region that isn't the one on screen (about z3 and below) and the
  // ramp domain jumps. A corner that fails the unproject/project round trip is
  // off the surface; mercator never trips it.
  function viewportQueryIsReliable() {
    const canvas = map.current.getCanvas();
    const corners = [
      [0, 0],
      [canvas.clientWidth, 0],
      [0, canvas.clientHeight],
      [canvas.clientWidth, canvas.clientHeight],
    ];
    return corners.every(([x, y]) => {
      const roundTrip = map.current.project(map.current.unproject([x, y]));
      return (
        Math.hypot(roundTrip.x - x, roundTrip.y - y) <=
        SURFACE_ROUND_TRIP_TOLERANCE_PX
      );
    });
  }

  // Read from rendered features, so a viewport-scaled ramp costs no request.
  // A pass that gives up keeps the last good threshold: blanking it un-faded
  // the map on every unmeasurable moment.
  function measureVisibleHexRange(focusPk) {
    const layers = HEX_LAYER_IDS.filter((id) => map.current.getLayer(id));
    if (!layers.length) return undefined;
    // Only with the whole globe in view, where the catalogue-wide tier is the
    // honest domain anyway.
    if (!viewportQueryIsReliable()) return undefined;
    // Hidden layers and layers outside their zoom range return nothing.
    const features = map.current.queryRenderedFeatures({ layers });
    if (features.length < MIN_VIEWPORT_HEXES) return undefined;
    let lo = Infinity;
    let hi = -Infinity;
    // A plain loop: intermediate arrays would be the expensive part over every
    // rendered hex. Duplicates across tile boundaries are harmless for a
    // min/max.
    for (const feature of features) {
      // Greyed cells carry none of the ramp's colours, so they don't set its
      // domain.
      if (focusPk !== undefined && !featureHasDataset(feature, focusPk))
        continue;
      const count = Number(feature.properties?.count);
      if (!Number.isFinite(count) || count <= 0) continue;
      if (count < lo) lo = count;
      if (count > hi) hi = count;
    }
    if (!Number.isFinite(hi)) return undefined;
    return quantizeCountRange([lo, hi]);
  }

  // Re-measure only when the counts change meaning (rampQueryEpoch), the ramp
  // is scaled to another dataset (rampFocusPk), or the integer zoom changes. A
  // PAN deliberately isn't one: re-shading on every settle flickered, so a pan
  // from busy into quiet water stays pale until a zoom. Integer zoom, not the
  // hex tier: z0 and z4 share a grid but show wildly different extents.
  function rampKey() {
    return [
      rampQueryEpoch.current,
      rampFocusPk.current ?? "",
      Math.floor(map.current.getZoom()),
    ].join("|");
  }

  // Cheap to call spuriously: the key test stops the loop, since repainting a
  // data-driven property re-renders the map, which calls this.
  function refreshViewportHexRange() {
    if (!map.current) return;
    const key = rampKey();
    if (rampMeasuredFor.current === key) return;
    // Tiles still in flight: hold what's painted and measure at the next idle.
    // Mid-load the rendered hexes include the previous zoom's stand-in tiles,
    // and each re-colouring relayouts every loaded tile (see IS_DIMMED), which
    // slowed the very tiles being waited on.
    if (!hexSourcesLoaded()) return;
    const range = measureVisibleHexRange(rampFocusPk.current);
    // Pinned, holding colours through a drag.
    if (range !== undefined) rampMeasuredFor.current = key;
    // Loaded and empty IS an answer, so the global tier takes over. Not pinned:
    // panning into data at this zoom should find it at the next idle.

    if (!rangesEqual(viewportHexRange.current, range)) {
      viewportHexRange.current = range;
      setColorStopsRef.current();
      onViewportHexRangeRef.current(range);
    }
    // Even with nothing repainted, this settles the ramp the first reveal waits
    // for.
    revealDataIfRamped(range);
  }

  // Invalidated, not dropped: the painted ramp stays until a fresh measurement
  // replaces it, so a filter change is one re-colouring rather than a flash
  // through the catalogue-wide domain.
  function invalidateHexRamp() {
    rampQueryEpoch.current += 1;
  }

  // Whole-layer paint rather than feature-state, so it survives new tiles and
  // only needs re-applying when the focus changes. A selected platform
  // outranks a focused dataset: everything under its track goes grey.
  function applyTrackFocus() {
    if (!map.current || !map.current.getLayer("track-lines")) return;
    const pk = selectedTrajectoryRef.current
      ? "selection"
      : focusedDatasetPk.current;
    if (trackFocusApplied.current === pk) return;
    trackFocusApplied.current = pk;

    const [lineColor, headIcon] =
      pk === "selection"
        ? ["lightgrey", "track-head-arrow-dim"]
        : pk
          ? [
              ["case", trackIsFocused(pk), trackLineColor, "lightgrey"],
              [
                "case",
                trackIsFocused(pk),
                "track-head-arrow",
                "track-head-arrow-dim",
              ],
            ]
          : [trackLineColor, "track-head-arrow"];

    map.current.setPaintProperty("track-lines", "line-color", lineColor);
    map.current.setLayoutProperty("track-heads", "icon-image", headIcon);
    map.current.setPaintProperty(
      "track-heads-fixed",
      "circle-color",
      lineColor,
    );
  }

  function hoverHighlightPoints(pk) {
    if (!map.current || !layersLoaded.current) return;
    applyTrackFocus();

    // queryRenderedFeatures only sees what's on screen now, hence re-running on
    // sourcedata. Below z7 profiles are merged into 'hexes'.
    const pointLevel = map.current.getZoom() >= 7;
    const dimmedLayers = [pointLevel ? "points" : "hexes", "coverage-hexes"];

    const dimmed = {};
    let focusedPoints = emptyFeatureCollection;
    dimmedLayers.forEach((layerId) => {
      if (!pk || !map.current.getLayer(layerId)) {
        dimmed[layerId] = [];
        return;
      }
      const hits = map.current.queryRenderedFeatures({ layers: [layerId] });
      dimmed[layerId] = hits
        .filter((feature) => !featureHasDataset(feature, pk))
        // promoteId puts pk on the id, which setFeatureState addresses.
        .map((feature) => feature.id);
      // 'points' sort-key can't depend on feature-state, so focused markers
      // were buried under grey ones; they're redrawn on top from a copy, since
      // a filtered tile layer would relayout the whole source per focus change.
      if (layerId === "points") focusedPoints = focusedPointFeatures(hits, pk);
    });

    // Writing state fires sourcedata/idle, which re-run this, so a no-op must
    // stay a no-op or the map spins. The zoom band decides which layer is
    // dimmed.
    const signature = [
      pk,
      pointLevel,
      ...dimmedLayers.map((layerId) => dimmed[layerId].join(",")),
      focusedPoints.features.map((feature) => feature.id).join(","),
    ].join("|");
    if (signature === appliedFocus.current) return;
    appliedFocus.current = signature;

    map.current.getSource("focused-points")?.setData(focusedPoints);

    // Cleared wholesale so it can't drift from the map, on both source layers
    // so the other side of the z7 hand-off keeps no stale state.
    map.current.removeFeatureState(focusTargets.points);
    map.current.removeFeatureState(focusTargets["coverage-hexes"]);

    dimmedLayers.forEach((layerId) =>
      dimmed[layerId].forEach((id) =>
        map.current.setFeatureState(
          { ...focusTargets[layerId], id },
          { dimmed: true },
        ),
      ),
    );
  }

  const griddapCoverageRef = useRef(null);
  const wmsMoveHandler = useRef(null);
  // Bumped on every overlay change so stale in-flight GetMap loads are dropped.
  const wmsRenderToken = useRef(0);
  const polygonRef = useRef(null);
  // Read by map event handlers and the layer filters.
  const selectionRing = useRef(polygon);
  // An overlay set before the style loaded hid layers that did not exist yet.
  const activeWmsOverlayRef = useRef(null);
  const revealedWmsPk = useRef();
  // A marker so it follows the region being fetched through a pan, not the
  // map centre: a spatial filter can clip the overlay to part of the view.
  const [wmsSpinnerElement] = useState(() => {
    const element = document.createElement("div");
    element.className = "wmsLoadingSpinner cioosSpinnerDisc";
    element.dataset.testid = "wms-loading-spinner";
    return element;
  });
  const wmsSpinnerMarker = useRef(null);
  const wmsSpinnerTimer = useRef(null);

  function showWmsSpinner(bounds) {
    wmsSpinnerTimer.current = setTimeout(() => {
      if (!map.current) return;
      // Midpoint on screen, not in degrees: at Canadian latitudes the
      // arithmetic midpoint sits well south of the image's visual centre.
      const northWest = map.current.project([bounds.west, bounds.north]);
      const southEast = map.current.project([bounds.east, bounds.south]);
      wmsSpinnerMarker.current ??= new Marker({
        element: wmsSpinnerElement,
      });
      wmsSpinnerMarker.current
        .setLngLat(map.current.unproject(northWest.add(southEast).div(2)))
        .addTo(map.current);
    }, WMS_SPINNER_DELAY_MS);
  }

  function hideWmsSpinner() {
    clearTimeout(wmsSpinnerTimer.current);
    wmsSpinnerMarker.current?.remove();
  }

  function setGriddapHighlight(geometry) {
    const source = map.current?.getSource("griddap-highlight");
    if (!source) return;
    source.setData(
      geometry
        ? { type: "Feature", geometry, properties: {} }
        : emptyFeatureCollection,
    );
  }

  // `frame` asks for the zoom-to-dataset framing whenever any of it is hidden;
  // otherwise pan if it fits beside the panel, zoom out only when none of it is
  // in view.
  function revealBounds(bounds, { frame = false } = {}) {
    if (!map.current || !bounds) return;
    const { width, height } = map.current.getCanvas().getBoundingClientRect();
    const padding = mapCoverPadding(map.current);
    const free = {
      left: padding.left,
      top: padding.top,
      right: width - padding.right,
      bottom: height - padding.bottom,
    };
    const corners = [bounds[0], bounds[1]].map((c) => map.current.project(c));
    const box = {
      left: Math.min(...corners.map((p) => p.x)),
      right: Math.max(...corners.map((p) => p.x)),
      top: Math.min(...corners.map((p) => p.y)),
      bottom: Math.max(...corners.map((p) => p.y)),
    };
    const offset = revealOffset(box, free, 24);
    if (offset && !offset[0] && !offset[1]) return;
    if (frame) {
      map.current.fitBounds(bounds, zoomToDatasetCamera(map.current));
      return;
    }
    if (offset) {
      map.current.panBy(offset);
      return;
    }
    const outOfView =
      box.right < free.left ||
      box.left > free.right ||
      box.bottom < free.top ||
      box.top > free.bottom;
    if (outOfView) {
      map.current.fitBounds(bounds, {
        padding,
        maxZoom: map.current.getZoom(),
      });
    }
  }

  // Guarded on the source: a share link can resolve a click payload before
  // the style has added layers. An open dataset draws its own footprint, so the
  // click's hex, marker or grid box would read as part of it.
  const revealedQueryNonce = useRef();
  useEffect(() => {
    const source = map.current?.getSource("click-highlight");
    if (!source) return;
    source.setData(
      (!inspectDataset && featureQuery?.highlight) || emptyFeatureCollection,
    );
    if (!featureQuery?.highlight?.features?.length) return;
    if (revealedQueryNonce.current === featureQuery.nonce) return;
    const bounds = boundsFromGeoJson({
      coordinates: featureQuery.highlight.features.map(
        (f) => f.geometry.coordinates,
      ),
    });
    // A frame later, once the opened card or sidebar is marked. The nonce is
    // spent only when the reveal runs: opening a page re-runs this effect and
    // its cleanup would otherwise cancel the pending reveal.
    const frame = requestAnimationFrame(() => {
      revealedQueryNonce.current = featureQuery.nonce;
      revealBounds(bounds);
    });
    return () => cancelAnimationFrame(frame);
  }, [featureQuery, inspectDataset]);

  const hoveredGriddapIds = useRef([]);

  function setGriddapHovered(features) {
    if (!map.current?.getSource("griddap-coverage")) return;
    const setHovered = (id, hovered) =>
      map.current.setFeatureState(
        { source: "griddap-coverage", id },
        { hovered },
      );
    hoveredGriddapIds.current.forEach((id) => setHovered(id, false));
    hoveredGriddapIds.current = features.map((feature) => feature.id);
    hoveredGriddapIds.current.forEach((id) => setHovered(id, true));
  }

  // Read from map event handlers, so removeWmsOverlay restores the user's
  // toggle.
  const dataLayersVisibleRef = useRef(true);
  // The style creates these layers visible; 'style.load' applies the switch.
  const bathymetryVisibleRef = useRef(true);

  function setLayersVisibility(layerIds, visible) {
    layerIds.forEach((layerId) => {
      if (map.current.getLayer(layerId)) {
        map.current.setLayoutProperty(
          layerId,
          "visibility",
          visible ? "visible" : "none",
        );
      }
    });
    // A hidden layer returns nothing from queryRenderedFeatures, so showing one
    // needs a re-measure without the ramp key changing; only the following
    // 'idle' is left to act on it.
    if (visible) rampMeasuredFor.current = undefined;
  }

  // Restoring hands each group back to its owner: the picker for hex/point
  // layers, applyLayerVisibility for the tracks.
  function setDataLayersVisibility(visible) {
    setLayersVisibility(griddapLayerIds, visible);
    if (!visible) {
      setLayersVisibility(observationLayerIds, false);
      setLayersVisibility(trackLayerIds, false);
      return;
    }
    setLayersVisibility(observationLayerIds, dataLayersVisibleRef.current);
    setLayersVisibility(trackLayerIds, true);
    applyLayerVisibility();
  }

  function removeWmsOverlay() {
    wmsRenderToken.current += 1;
    hideWmsSpinner();
    if (wmsMoveHandler.current) {
      map.current.off("moveend", wmsMoveHandler.current);
      wmsMoveHandler.current = null;
    }
    if (map.current.getLayer("wms-overlay")) {
      map.current.removeLayer("wms-overlay");
    }
    if (map.current.getSource("wms-overlay")) {
      map.current.removeSource("wms-overlay");
    }
    setDataLayersVisibility(true);
  }

  // ERDDAP's WMS is EPSG:4326-only, so the image is requested with extra
  // vertical resolution and warped to Mercator (see wmsUtilities). A spatial
  // filter clips the request to its bounding box; read through a ref so the
  // debounced moveend handler uses the current polygon.
  function renderWmsImage(overlay) {
    if (!map.current) return;
    // A GetMap for an earlier pan resolving after a newer one would paint stale
    // bounds.
    const token = ++wmsRenderToken.current;
    hideWmsSpinner();
    const viewportBounds = clampBoundsForWms(map.current.getBounds());
    if (
      viewportBounds.south >= viewportBounds.north ||
      viewportBounds.west >= viewportBounds.east
    ) {
      return;
    }
    const bounds = intersectBoundsWithPolygonBbox(
      viewportBounds,
      polygonRef.current,
    );
    // filter selection is entirely off-screen: nothing to draw
    if (!bounds) {
      const emptySource = map.current.getSource("wms-overlay");
      if (emptySource && map.current.getLayer("wms-overlay")) {
        map.current.setLayoutProperty("wms-overlay", "visibility", "none");
      }
      return;
    }
    if (map.current.getLayer("wms-overlay")) {
      map.current.setLayoutProperty("wms-overlay", "visibility", "visible");
    }
    const canvasElement = map.current.getCanvas();
    const outWidth = Math.min(canvasElement.clientWidth, 2048);
    const outHeight = Math.min(canvasElement.clientHeight, 2048);
    const url = buildWmsGetMapUrl({
      wmsUrl: overlay.wmsUrl,
      datasetId: overlay.datasetId,
      variable: overlay.variable.name,
      bounds,
      width: outWidth,
      height: Math.min(Math.round(outHeight * 1.75), 2048),
      time: overlay.time,
      elevation: overlay.elevation,
    });
    showWmsSpinner(bounds);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (token !== wmsRenderToken.current || !map.current) return;
      // A share link's overlay can resolve before the style has loaded;
      // registered after the handler that adds the data layers it sits under.
      if (!map.current.getSource("cde-tiles")) {
        map.current.once("style.load", img.onload);
        return;
      }
      hideWmsSpinner();
      let imageUrl;
      try {
        imageUrl = warpEquirectToMercator(
          img,
          bounds.south,
          bounds.north,
          outWidth,
          outHeight,
        ).toDataURL("image/png");
      } catch (error) {
        // canvas tainted (server without CORS headers) — show unwarped
        console.warn("WMS warp failed, using unwarped image", error);
        imageUrl = url;
      }
      const coordinates = [
        [bounds.west, bounds.north],
        [bounds.east, bounds.north],
        [bounds.east, bounds.south],
        [bounds.west, bounds.south],
      ];
      const source = map.current.getSource("wms-overlay");
      if (source) {
        source.updateImage({ url: imageUrl, coordinates });
      } else {
        map.current.addSource("wms-overlay", {
          type: "image",
          url: imageUrl,
          coordinates,
        });
        map.current.addLayer(
          {
            id: "wms-overlay",
            type: "raster",
            source: "wms-overlay",
            paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 },
          },
          map.current.getLayer("coverage-hexes") ? "coverage-hexes" : undefined,
        );
      }
    };
    img.onerror = () => {
      if (token === wmsRenderToken.current) hideWmsSpinner();
      console.warn(`WMS GetMap failed: ${url}`);
    };
    img.src = url;
  }

  // The sole writer of griddap-highlight: a second writer in the overlay
  // effect ran later in the same commit and wiped the open grid's box.
  useEffect(() => {
    if (map.current) {
      const focusedDataset = hoveredDataset || inspectDataset;
      // The ramp follows the open page only: rescaling per hovered row would
      // set the whole map moving as the cursor swept the list.
      const rampPk =
        inspectDataset && inspectDataset.cdm_data_type !== "Grid"
          ? inspectDataset.pk
          : undefined;
      rampFocusPk.current = rampPk;
      if (focusedDataset?.cdm_data_type === "Grid") {
        // A griddap dataset has no map features: highlighting its pk would grey
        // the whole map. Draw its bbox instead.
        focusedDatasetPk.current = undefined;
        hoverHighlightPoints();
        setGriddapHighlight(focusedDataset.coverage_bbox_geojson);
      } else {
        focusedDatasetPk.current = focusedDataset?.pk;
        setGriddapHighlight(activeWmsOverlay ? activeWmsOverlay.bbox : null);
        hoverHighlightPoints(focusedDataset?.pk);
      }
      // hoverHighlightPoints skips everything until the layers have settled,
      // and clearing a focus has no later event to ride in on.
      applyTrackFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredDataset, inspectDataset, activeWmsOverlay]);

  useEffect(() => {
    griddapCoverageRef.current = griddapCoverage;
    const source = map.current?.getSource("griddap-coverage");
    if (source) source.setData(griddapCoverage || emptyFeatureCollection);
  }, [griddapCoverage]);

  // Owns the hex and point layers only; the ref keeps the choice through a WMS
  // overlay.
  useEffect(() => {
    dataLayersVisibleRef.current = dataLayersVisible;
    if (!map.current || activeWmsOverlay) return;
    setLayersVisibility(observationLayerIds, dataLayersVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayersVisible]);

  // Left alone by the WMS overlay: the depth wash reads as basemap.
  useEffect(() => {
    bathymetryVisibleRef.current = bathymetryVisible;
    if (!map.current) return;
    setLayersVisibility(bathymetryLayerIds, bathymetryVisible);
  }, [bathymetryVisible]);

  useEffect(() => {
    if (!map.current) return;
    map.current.setPaintProperty(
      "bathymetry-nonna",
      "color-relief-color",
      nonnaColorRamp(bathymetryPalette),
    );
  }, [bathymetryPalette]);

  // No setStyle() calls exist (language uses setLayoutProperty), so the
  // projection persists until toggled here.
  useEffect(() => {
    if (!map.current) return;
    map.current.setProjection({
      type: projection === "globe" ? "globe" : "mercator",
    });
  }, [projection]);

  // The camera settings are shared with ZoomToDataset, which compares them
  // against the live camera.
  useEffect(() => {
    if (!map.current || !zoomTarget?.geometry) return;
    const bounds = boundsFromGeoJson(zoomTarget.geometry);
    if (!bounds) return;
    map.current.fitBounds(bounds, {
      ...zoomToDatasetCamera(map.current),
      ...zoomTarget.camera,
      duration: 1000,
    });
  }, [zoomTarget]);

  // Set by the mount effect, which owns the hit-test.
  const askAtRef = useRef();
  // Declared after the zoom effect so a camera move requested in the same
  // render has started, and 'idle' waits for it to land.
  useEffect(() => {
    if (!map.current || !featureQueryRequest) return;
    const { lngLat } = featureQueryRequest;
    map.current.once("idle", () => askAtRef.current?.(lngLat));
    // A map already at rest never goes idle again on its own.
    map.current.triggerRepaint();
  }, [featureQueryRequest]);

  useEffect(() => {
    if (!drawRequest || !map.current) return;
    if (drawRequest.mode === "clear") {
      endDrawing();
      return;
    }
    if (drawRequest.mode === "shape") {
      endDrawing();
      const [featureId] = drawPolygon.current.add({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [drawRequest.ring] },
      });
      drawPolygon.current.changeMode("direct_select", { featureId });
      highlightPoints(drawRequest.ring);
      setPolygon(drawRequest.ring);
      return;
    }
    map.current.getCanvas().style.cursor = "crosshair";
    deleteAllShapes();
    creatingPolygon.current = true;
    drawPolygon.current.changeMode(
      drawRequest.mode === "box" ? "draw_rectangle" : "draw_polygon",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawRequest]);

  useEffect(() => {
    if (!map.current) return;
    polygonRef.current = polygon;
    activeWmsOverlayRef.current = activeWmsOverlay;
    removeWmsOverlay();
    if (!activeWmsOverlay) {
      revealedWmsPk.current = undefined;
      return;
    }
    renderWmsImage(activeWmsOverlay);
    const rerender = debounce(() => renderWmsImage(activeWmsOverlay), 300);
    wmsMoveHandler.current = rerender;
    map.current.on("moveend", rerender);
    setDataLayersVisibility(false);
    // Once per dataset: the user may have moved off it on purpose.
    if (revealedWmsPk.current !== activeWmsOverlay.pk) {
      revealedWmsPk.current = activeWmsOverlay.pk;
      revealBounds(boundsFromGeoJson(activeWmsOverlay.bbox), { frame: true });
    }
    return () => removeWmsOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWmsOverlay, polygon]);

  useEffect(() => {
    selectionRing.current = polygon;
    applySelectionFilter();
  }, [polygon]);

  function highlightPoints(polygon) {
    if (polygon && polygon.length >= 4) {
      const features = map.current
        .queryRenderedFeatures({ layers: ["points"] })
        .map((point) => {
          return {
            type: "Feature",
            geometry: {
              type: "Point",
              // Note order: longitude, latitude.
              coordinates: point.geometry.coordinates,
            },
            properties: { ...point.properties },
          };
        });

      const featureCollection = { type: "FeatureCollection", features };
      const searchWithin = helpers.polygon([polygon]);
      const pointsWithinPolygon = turfPointsWithinPolygon(
        featureCollection,
        searchWithin,
      );

      const filter = pointsWithinPolygon.features.reduce(
        function (memo, feature) {
          memo.push(feature.properties.pk);
          return memo;
        },
        ["in", "pk"],
      );

      map.current.setFilter("points-highlighted", filter);
    }
  }

  const mapQueryRef = useRef(mapQueryString);

  const onFeatureQueryRef = useRef(onFeatureQuery);
  // A ref so replaying it can't be re-triggered by a later render.
  const sharedFeatureQueryAtRef = useRef(sharedFeatureQueryAt);
  const onMarkerClickRef = useRef(onMarkerClick);
  const onTrackClickRef = useRef(onTrackClick);
  const onDepthQueryRef = useRef(onDepthQuery);
  const depthToolActiveRef = useRef(depthToolActive);

  // Written after commit so a render React throws away never leaks into them;
  // layout effects run before every effect and map event that reads them.
  useLayoutEffect(() => {
    rangeLevelsRef.current = rangeLevels;
    onViewportHexRangeRef.current = onViewportHexRange;
    selectedTrajectoryRef.current = selectedTrajectory;
    setColorStopsRef.current = setColorStops;
    mapQueryRef.current = mapQueryString;
    onFeatureQueryRef.current = onFeatureQuery;
    onMarkerClickRef.current = onMarkerClick;
    onTrackClickRef.current = onTrackClick;
    onDepthQueryRef.current = onDepthQuery;
    depthToolActiveRef.current = depthToolActive;
  });

  useEffect(() => {
    if (!depthToolActive) return undefined;
    popup.remove();
    const canvas = map.current?.getCanvas();
    if (canvas) canvas.style.cursor = "crosshair";
    const exitOnEscape = (e) => {
      if (e.key === "Escape") onDepthToolExit();
    };
    window.addEventListener("keydown", exitOnEscape);
    return () => {
      window.removeEventListener("keydown", exitOnEscape);
      if (canvas) canvas.style.cursor = "grab";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depthToolActive]);

  // /tiles and /tiles/cells split the zoom range for the same selection and
  // take the same params, so the hex switch can't leave trajectory counts in
  // one and not the other.
  function tileUrls(queryString) {
    const filterSuffix = buildTileSuffix(queryString, dataLayersRef.current);
    return {
      tileQuery: `${server}/tiles/{z}/{x}/{y}.mvt${filterSuffix}`,
      cellTileQuery: `${server}/tiles/cells/{z}/{x}/{y}.mvt${filterSuffix}`,
    };
  }

  useEffect(() => {
    // Guard on source existence, not map.loaded() (see refreshCombinedSources).
    if (!map.current || !map.current.getSource("cde-tiles")) return;

    map.current.setFilter("points-highlighted", ["in", "pk", ""]);

    invalidateHexRamp();
    refreshCombinedSources(mapQueryString);
    markDataStale("observations");
    // The tracks effect below refetches them for the same change.
    if (tracksModeRef.current && anyTrajectoryLayerOn(dataLayersRef.current)) {
      markDataStale("tracks");
    }
    setLoading(true);
    doFinalCheck.current = true;

    const drawnShape = drawPolygon.current.getAll().features[0];
    if (drawnShape) {
      const ring = drawnShape.geometry.coordinates[0];
      highlightPoints(ring);
      setPolygon(ring);
    } else {
      setPolygon();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapQueryString]);

  // The track tiles carry trajectoryTypes too, so they refetch here, or a
  // switched-off geometry's lines would linger until the next scrub.
  useEffect(() => {
    dataLayersRef.current = dataLayers;
    if (!map.current || !map.current.getSource("cde-tiles")) return;
    invalidateHexRamp();
    refreshCombinedSources(mapQueryString);
    markDataStale("observations");
    if (tracksModeRef.current && anyTrajectoryLayerOn(dataLayers)) {
      refreshTracksSource(
        mapQueryString,
        scrubTimeRef.current,
        trailingDaysRef.current,
      );
      markDataStale("tracks");
    }
    applyLayerVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayers]);

  // No source refetch: track lines come from their own /tiles/tracks source.
  useEffect(() => {
    tracksModeRef.current = tracksMode;
    if (!map.current || !map.current.getLayer("track-lines")) return;
    applyLayerVisibility();
    if (tracksMode) {
      refreshTracksSource(mapQueryString, scrubTime, trailingDays);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksMode]);

  useEffect(() => {
    scrubTimeRef.current = scrubTime;
    trailingDaysRef.current = trailingDays;
    if (!tracksMode) return;
    refreshTracksSource(mapQueryString, scrubTime, trailingDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapQueryString, scrubTime, trailingDays]);

  // Drawn clipped to the time filter, and framed only when the selection asks.
  useEffect(() => {
    // Picking a second platform mid-fetch is routine from the map, so the
    // in-flight request is abandoned rather than landing under the newer name.
    const abortController = new AbortController();
    let superseded = false;

    async function renderSelectedTrack() {
      if (!map.current) return;
      // A share link's ?track= routinely resolves before the style adds the
      // source, and nothing else re-runs this effect, so wait for the load.
      // Registered from here so it runs after the handler that adds the
      // sources.
      if (!map.current.getSource("selected-track")) {
        map.current.once("style.load", renderSelectedTrack);
        return;
      }
      const source = map.current.getSource("selected-track");

      if (!selectedTrajectory) {
        rawTrackRef.current = null;
        // Forgotten so re-picking the same platform frames it again.
        framedTrackRef.current = null;
        source.setData({ type: "FeatureCollection", features: [] });
        applyTrackFocus();
        return;
      }

      const { datasetPk, trajectoryId } = selectedTrajectory;
      const cacheKey = `${datasetPk}|${trajectoryId}`;
      if (rawTrackRef.current?.key !== cacheKey) {
        let track;
        try {
          const response = await fetch(
            `${server}/trajectories/track?datasetPKs=${datasetPk}&trajectoryId=${encodeURIComponent(trajectoryId)}`,
            { signal: abortController.signal },
          );
          if (!response.ok) return;
          track = await response.json();
        } catch (error) {
          reportError("track fetch failed", error);
          return;
        }
        if (superseded) return;
        rawTrackRef.current = {
          key: cacheKey,
          coordinates: track.coordinates,
          times: track.times,
          // null per fix for a plain Trajectory dataset; only TrajectoryProfile
          // fixes are records with an id.
          profileIds: track.profile_ids,
        };
      }
      const rawCoordinates = rawTrackRef.current.coordinates || [];
      const rawTimes = rawTrackRef.current.times || [];
      const rawProfileIds = rawTrackRef.current.profileIds;

      // Clipped to the time filter so the track agrees with every count on the
      // page; the full response stays cached. The response is time-ordered, so
      // the window is one contiguous slice. A missing fix time stops the walk
      // rather than clipping, so a track without times draws whole.
      const { min: windowMin, max: windowMax } =
        filterTimeWindow(mapQueryString);
      let from = 0;
      let to = rawCoordinates.length;
      if (windowMin !== undefined) {
        while (from < to && Date.parse(rawTimes[from]) < windowMin) from++;
      }
      if (windowMax !== undefined) {
        while (to > from && Date.parse(rawTimes[to - 1]) > windowMax) to--;
      }
      const coordinates = rawCoordinates.slice(from, to);
      const times = rawTimes.slice(from, to);
      const profileIds = rawProfileIds?.slice(from, to);

      // Draw nothing rather than leaving the last selection's track on screen.
      if (coordinates.length === 0) {
        source.setData(emptyFeatureCollection);
        applyTrackFocus();
        return;
      }

      // Same segmentation rule as the /tiles/tracks layer.
      const runs = splitTrackRuns(coordinates, times);
      const lineFeatures = runs
        .filter((run) => run.length >= 2)
        .map((run) => ({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: run,
          },
          properties: {},
        }));
      // Bearings never span run breaks (a data gap or the antimeridian); cog
      // stays unset for a single-fix run, which the -nocog circle layer picks
      // up. The running cursor recovers each point's fix time, since runs
      // partition the clipped coordinates in order.
      let fixIndex = 0;
      const fixFeatures = runs.flatMap((run) => {
        let lastCog = null;
        return run.map((coordinate, i) => {
          const time = times[fixIndex];
          const profileId = profileIds?.[fixIndex];
          fixIndex++;
          const cog =
            i > 0
              ? initialBearing(run[i - 1], coordinate)
              : run.length > 1
                ? initialBearing(coordinate, run[1])
                : null;
          if (cog !== null) lastCog = cog;
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: coordinate },
            properties: {
              ...(lastCog === null ? {} : { cog: lastCog }),
              ...(profileId ? { profile_id: profileId } : {}),
              time,
              trajectory_id: trajectoryId,
              dataset_title: selectedTrajectory.datasetTitle,
            },
          };
        });
      });
      source.setData({
        type: "FeatureCollection",
        features: [...lineFeatures, ...fixFeatures],
      });

      applyTrackFocus();

      // A track clicked on the map is already under the cursor, so flying out
      // to the whole voyage would throw away the view; only a list pick asks to
      // frame.
      if (!selectedTrajectory.frameView) return;
      // Once per selection: this re-runs as the time rail drags.
      if (framedTrackRef.current === cacheKey) return;
      framedTrackRef.current = cacheKey;

      const longitudes = coordinates.map((c) => c[0]);
      const latitudes = coordinates.map((c) => c[1]);
      revealBounds(
        [
          [Math.min(...longitudes), Math.min(...latitudes)],
          [Math.max(...longitudes), Math.max(...latitudes)],
        ],
        { frame: true },
      );
    }
    renderSelectedTrack();
    return () => {
      superseded = true;
      abortController.abort();
      // Including a pending 'style.load' retry (Evented.off clears
      // once-listeners).
      map.current?.off("style.load", renderSelectedTrack);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrajectory, mapQueryString]);

  useEffect(() => {
    const abortController = new AbortController();

    async function renderMappedRecord() {
      if (!map.current) return;
      // A share link resolves before the style has added the source.
      const source = map.current.getSource("mapped-record");
      if (!source) {
        map.current.once("style.load", renderMappedRecord);
        return;
      }
      source.setData(emptyFeatureCollection);
      if (!mappedRecord) return;

      const { datasetPk, recordId, frameView } = mappedRecord;
      let coordinates;
      try {
        ({ coordinates } = await fetchJson(
          `${server}/datasetRecordsList/location?datasetPKs=${datasetPk}&recordId=${encodeURIComponent(recordId)}`,
          { signal: abortController.signal },
        ));
      } catch (error) {
        if (error.name !== "AbortError") {
          reportError("record location fetch failed", error);
        }
        return;
      }
      if (!coordinates.length) return;
      source.setData({
        type: "FeatureCollection",
        features: coordinates.map((coordinate) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: coordinate },
          properties: {},
        })),
      });
      if (!frameView) return;
      const longitudes = coordinates.map((c) => c[0]);
      const latitudes = coordinates.map((c) => c[1]);
      revealBounds(
        [
          [Math.min(...longitudes), Math.min(...latitudes)],
          [Math.max(...longitudes), Math.max(...latitudes)],
        ],
        { frame: true },
      );
    }
    renderMappedRecord();
    return () => {
      abortController.abort();
      map.current?.off("style.load", renderMappedRecord);
    };
  }, [mappedRecord]);

  function addObservationLayers() {
    const { tileQuery, cellTileQuery } = tileUrls(mapQueryRef.current);

    // Shared sources: per-layer inline sources fetched and parsed the same tile
    // pyramids six times on every pan.
    //
    // maxzoom 14: routes/tiles.js has nothing new past z7, and ST_AsMVTGeom at
    // extent 4096 over z14 (~0.42 m/unit at 45°N) is finer than a z17 pixel, so
    // deeper tiles were 64 queries for one tile's data, refetched on every
    // filter change's setTiles.
    //
    // promoteId: setFeatureState addresses the feature id.
    map.current.addSource("cde-tiles", {
      type: "vector",
      tiles: [tileQuery],
      maxzoom: 14,
      promoteId: "pk",
    });
    // The cells' geometry is the same at every zoom from 4 up, so past z10
    // (~7 m per tile unit at 45°N on a 20 km cell) a deeper tile only refetched
    // identical data on every zoom step.
    map.current.addSource("cde-cells", {
      type: "vector",
      tiles: [cellTileQuery],
      maxzoom: 10,
      promoteId: "pk",
    });

    // Data layers go below the basemap labels so names stay readable.
    map.current.addLayer(
      {
        id: "points",
        type: "circle",
        minzoom: hexMaxZoom,
        source: "cde-tiles",
        "source-layer": "internal-layer-name",
        layout: {
          "circle-sort-key": ["get", "count"],
        },
        paint: {
          // Zero until the ramp is final — see revealData.
          "circle-opacity": dataRevealed.current ? circleOpacity : 0,
          "circle-radius-transition": NO_TRANSITION,
          "circle-radius": radiusExpression(pointRadiusRange.current),
          // See NO_TRANSITION.
          "circle-color-transition": NO_TRANSITION,
          "circle-color": dimmable(colors),
          "circle-stroke-color": dimmable(colors),
          "circle-stroke-opacity": 0.001,
          "circle-stroke-width": 10,
        },
      },
      FIRST_LABEL_LAYER_ID,
    );

    // beforeId 'points' must already exist (MapLibre throws otherwise). Below
    // hexMaxZoom these counts are merged into the 'hexes' layer.
    map.current.addLayer(
      {
        id: "coverage-hexes",
        type: "fill",
        minzoom: hexMaxZoom,
        source: "cde-cells",
        "source-layer": "coverage-hexes-layer",
        paint: {
          // Zero until the ramp is final — see revealData.
          "fill-opacity": dataRevealed.current
            ? coverageHexOpacityExpression()
            : 0,
          // See NO_TRANSITION.
          "fill-opacity-transition": NO_TRANSITION,
          "fill-color": dimmable(coverageHexFillColor()),
          "fill-color-transition": NO_TRANSITION,
          "fill-outline-color": coverageHexOutlineColor(),
        },
      },
      "points",
    );

    // A fill's 'fill-outline-color' is drawn at the fill's opacity and goes
    // with it, hence a line layer of its own that rises as the fill falls.
    // Gated by the same reveal, since it carries the ramp.
    map.current.addLayer(
      {
        id: "coverage-hex-outlines",
        type: "line",
        minzoom: hexMaxZoom,
        source: "cde-cells",
        "source-layer": "coverage-hexes-layer",
        paint: {
          "line-color-transition": NO_TRANSITION,
          "line-color": coverageHexBorderColor(),
          "line-opacity-transition": NO_TRANSITION,
          "line-opacity": dataRevealed.current
            ? coverageHexOutlineOpacityExpression()
            : 0,
          "line-width": 2,
        },
      },
      "points",
    );

    // Visual only; interaction stays on 'points'. No circle-sort-key on
    // purpose: overlapping white casings composite the same in any order, and a
    // sort key would still cost a per-tile sort on the worker.
    map.current.addLayer(
      {
        id: "points-halo",
        type: "circle",
        minzoom: hexMaxZoom,
        source: "cde-tiles",
        "source-layer": "internal-layer-name",
        paint: {
          "circle-color": "#ffffff",
          // Zero until the ramp is final — see revealData: its radius comes off
          // the same ramp.
          "circle-opacity": dataRevealed.current ? pointsHaloOpacity() : 0,
          "circle-radius-transition": NO_TRANSITION,
          "circle-radius": radiusExpression(pointRadiusRange.current, 1.25),
        },
      },
      "points",
    );

    map.current.addLayer(
      {
        id: "hexes",
        type: "fill",
        minzoom: hexMinZoom,
        maxzoom: hexMaxZoom,
        source: "cde-tiles",
        "source-layer": "internal-layer-name",

        paint: {
          // Zero until the ramp is final — see revealData.
          "fill-opacity": dataRevealed.current ? hexOpacityExpression() : 0,
          // See NO_TRANSITION.
          "fill-opacity-transition": NO_TRANSITION,
          // Not the legacy { property, stops } form, which can't nest inside
          // the 'case' dimmable wraps it in.
          "fill-color": dimmable(hexFillColor()),
          "fill-color-transition": NO_TRANSITION,
        },
      },
      FIRST_LABEL_LAYER_ID,
    );

    map.current.addLayer(
      {
        id: "points-highlighted",
        type: "circle",
        minzoom: hexMaxZoom,
        source: "cde-tiles",
        "source-layer": "internal-layer-name",
        layout: {
          // Must match 'points', or rings and markers disagree about which of
          // an overlapping pair is on top.
          "circle-sort-key": ["get", "count"],
        },
        paint: {
          "circle-color": dimmable(colors),
          "circle-opacity": circleOpacity,
          "circle-radius-transition": NO_TRANSITION,
          "circle-radius": radiusExpression(pointRadiusRange.current),
          "circle-stroke-color": "black",
          // A ring around a greyed circle would still read as picked out.
          "circle-stroke-width": ["case", IS_DIMMED, 0, 0.75],
        },
        filter: ["in", "pk", ""],
      },
      FIRST_LABEL_LAYER_ID,
    );

    // Purely visual: clicks still resolve on 'points'. Below
    // 'points-highlighted' so a drawn shape's selection rings stay on top.
    map.current.addSource("focused-points", {
      type: "geojson",
      data: emptyFeatureCollection,
    });
    map.current.addLayer(
      {
        id: "focused-points-halo",
        type: "circle",
        minzoom: hexMaxZoom,
        source: "focused-points",
        paint: {
          "circle-color": "#ffffff",
          // Zero until the ramp is final — see revealData.
          "circle-opacity": dataRevealed.current ? 0.9 : 0,
          "circle-radius-transition": NO_TRANSITION,
          "circle-radius": radiusExpression(pointRadiusRange.current, 1.25),
        },
      },
      "points-highlighted",
    );
    map.current.addLayer(
      {
        id: "focused-points",
        type: "circle",
        minzoom: hexMaxZoom,
        source: "focused-points",
        layout: {
          "circle-sort-key": ["get", "count"],
        },
        paint: {
          "circle-color-transition": NO_TRANSITION,
          "circle-color": colors,
          "circle-opacity": dataRevealed.current ? circleOpacity : 0,
          "circle-radius-transition": NO_TRANSITION,
          "circle-radius": radiusExpression(pointRadiusRange.current),
        },
      },
      "points-highlighted",
    );
  }

  function addGriddapLayers() {
    // GeoJSON rather than tiles: coverage is tens of features served whole by
    // /griddapCoverage. Before 'points-highlighted' so circles stay on top.
    map.current.addSource("griddap-coverage", {
      type: "geojson",
      promoteId: "pk",
      data: griddapCoverageRef.current || emptyFeatureCollection,
    });
    map.current.addSource("griddap-highlight", {
      type: "geojson",
      data: emptyFeatureCollection,
    });
    map.current.addLayer(
      {
        id: "griddap-coverage-fill",
        type: "fill",
        source: "griddap-coverage",
        // Kept low because stacked rectangles composite into a solid slab;
        // the hover affordance leans on the outline.
        paint: {
          "fill-color": "#52a79b",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hovered"], false],
            0.12,
            0.07,
          ],
        },
      },
      "points-highlighted",
    );
    map.current.addLayer(
      {
        id: "griddap-coverage-line",
        type: "line",
        source: "griddap-coverage",
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "hovered"], false],
            "#fbb03b",
            "#52a79b",
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hovered"], false],
            2.5,
            1.5,
          ],
          "line-dasharray": [2, 2],
        },
      },
      "points-highlighted",
    );
    map.current.addLayer(
      {
        id: "griddap-coverage-point",
        type: "circle",
        source: "griddap-coverage",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#52a79b",
          "circle-opacity": 0.35,
          "circle-stroke-color": [
            "case",
            ["boolean", ["feature-state", "hovered"], false],
            "#fbb03b",
            "#52a79b",
          ],
          "circle-stroke-width": [
            "case",
            ["boolean", ["feature-state", "hovered"], false],
            2.5,
            1.5,
          ],
        },
      },
      "points-highlighted",
    );
    map.current.addLayer(
      {
        id: "griddap-highlight-fill",
        type: "fill",
        source: "griddap-highlight",
        paint: { "fill-color": "#fbb03b", "fill-opacity": 0.1 },
      },
      "points-highlighted",
    );
    map.current.addLayer(
      {
        id: "griddap-highlight-line",
        type: "line",
        source: "griddap-highlight",
        paint: { "line-color": "#fbb03b", "line-width": 2.5 },
      },
      "points-highlighted",
    );
    map.current.addLayer(
      {
        id: "griddap-highlight-point",
        type: "circle",
        source: "griddap-highlight",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#fbb03b",
          "circle-opacity": 0.1,
          "circle-stroke-color": "#fbb03b",
          "circle-stroke-width": 2.5,
        },
      },
      "points-highlighted",
    );
  }

  function addClickHighlightLayers() {
    // No beforeId, so it draws over every data layer: a highlight the markers
    // cover is no highlight.
    map.current.addSource("click-highlight", {
      type: "geojson",
      data: emptyFeatureCollection,
    });
    // The merged fill goes down first: on top of the per-box glow it smothered
    // every nested box's glow, so only the biggest box looked selected.
    map.current.addLayer({
      id: "click-highlight-fill",
      type: "fill",
      source: "click-highlight",
      // Excludes the individual grid rectangles; the merged shape fills for
      // them so a stack's opacity doesn't compound (see `role` in
      // buildFeatureQuery).
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!=", ["get", "role"], "outline"],
      ],
      paint: {
        "fill-color": clickHighlightColor,
        "fill-opacity": 0.18,
      },
    });
    // Point and polygon geometries blur through different properties
    // (circle-blur vs. line-blur), so each gets its own layer.
    map.current.addLayer({
      id: "click-highlight-glow",
      type: "line",
      source: "click-highlight",
      // Excludes the fill-only merged grid shape — see click-highlight-fill.
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!=", ["get", "role"], "fill"],
      ],
      paint: {
        "line-color": clickHighlightColor,
        "line-width": 10,
        "line-blur": 8,
        "line-opacity": 0.85,
      },
    });
    map.current.addLayer({
      id: "click-highlight-point-glow",
      type: "circle",
      source: "click-highlight",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius-transition": NO_TRANSITION,
        "circle-radius": radiusExpression(pointRadiusRange.current, 6),
        "circle-color": clickHighlightColor,
        "circle-blur": 0.8,
        "circle-opacity": 0.85,
      },
    });
    map.current.addLayer({
      id: "click-highlight-line",
      type: "line",
      source: "click-highlight",
      // Excludes the fill-only merged grid shape, whose outline would duplicate
      // the boxes' outer envelope.
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!=", ["get", "role"], "fill"],
      ],
      paint: {
        "line-color": clickHighlightColor,
        "line-width": 2.5,
      },
    });
    // Outlined, not enlarged, so the legend's size key still reads true; the
    // radius is the 'points' expression over the carried `count`. The marker's
    // own circle-stroke is the invisible 10px hit halo, so it can't be used.
    map.current.addLayer({
      id: "click-highlight-point",
      type: "circle",
      source: "click-highlight",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius-transition": NO_TRANSITION,
        "circle-radius": radiusExpression(pointRadiusRange.current),
        "circle-color": "rgba(0, 0, 0, 0)",
        "circle-stroke-color": "#000000",
        "circle-stroke-width": 1.5,
      },
    });

    // A fixed size: the record's feature carries no `count`. Under the focused
    // markers, since the record's own marker is in 'focused-points' and the
    // ring is wider than the largest marker.
    map.current.addSource("mapped-record", {
      type: "geojson",
      data: emptyFeatureCollection,
    });
    map.current.addLayer(
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
    );
    map.current.addLayer(
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
    );
  }

  function addTrackLayers() {
    // Created via refs so the current switch and scrub window apply even though
    // this load handler runs once.
    const tracksVisibility = tracksModeRef.current ? "visible" : "none";
    map.current.addSource("tracks", {
      type: "vector",
      // No minzoom on purpose. At low zoom one tile can carry every trajectory
      // in the window (100k+ features); trailingWindowOptions' one-year cap
      // keeps that in check. If it regresses, simplify
      // server-side in web-api/routes/tiles.js rather than adding a minzoom.
      maxzoom: 8,
      tiles: [
        buildTracksTileUrl(
          mapQueryRef.current,
          scrubTimeRef.current,
          trailingDaysRef.current,
        ),
      ],
    });

    map.current.addLayer({
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
        "line-color": trackLineColor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1, 10, 2.5],
        // See TRACK_LINE_OPACITY.
        "line-opacity": TRACK_LINE_OPACITY,
      },
    });

    // Heads where cog is undefined (single fixes, stationary platforms) fall
    // back to circles.
    map.current.addImage(
      "track-head-arrow",
      buildHeadArrowImage(trackLineColor),
      {
        pixelRatio: 2,
      },
    );
    map.current.addImage(
      "track-head-arrow-dim",
      buildHeadArrowImage("lightgrey"),
      {
        pixelRatio: 2,
      },
    );

    map.current.addLayer({
      id: "track-heads",
      type: "symbol",
      source: "tracks",
      "source-layer": "track-heads",
      filter: SELECTION_FILTERED_LAYERS["track-heads"],
      layout: {
        visibility: tracksVisibility,
        "icon-image": "track-head-arrow",
        "icon-rotate": ["get", "cog"],
        // rotate with the map so the arrow points along the geographic course
        "icon-rotation-alignment": "map",
        // Below z7 a tile can carry ~100k heads and forcing every one to render
        // overwhelms the tab; at z7+ it's a few hundred (also capped per tile
        // by /tiles/tracks).
        "icon-allow-overlap": ["step", ["zoom"], false, hexMaxZoom, true],
        "icon-ignore-placement": ["step", ["zoom"], false, hexMaxZoom, true],
        // When culling, keep the most recent heads deterministically.
        "symbol-sort-key": ["-", 0, ["coalesce", ["get", "head_time"], 0]],
      },
    });

    map.current.addLayer({
      id: "track-heads-fixed",
      type: "circle",
      source: "tracks",
      "source-layer": "track-heads",
      filter: SELECTION_FILTERED_LAYERS["track-heads-fixed"],
      layout: { visibility: tracksVisibility },
      paint: {
        "circle-color": trackLineColor,
        "circle-radius": 4.5,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    });

    // Freshly created layers carry no focus paint.
    trackFocusApplied.current = undefined;
    applyTrackFocus();
  }

  function applySelectionFilter() {
    Object.entries(SELECTION_FILTERED_LAYERS).forEach(([layerId, filter]) => {
      if (!map.current?.getLayer(layerId)) return;
      map.current.setFilter(
        layerId,
        selectionLayerFilter(filter, selectionRing.current),
      );
    });
  }

  function addSelectedTrackLayers() {
    // Line features are the path; point features are the raw fixes.
    map.current.addSource("selected-track", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    // The click-highlight colour: a drawn track is what the last click found,
    // so it wears the same accent as a ringed marker or outlined hex.
    map.current.addLayer({
      id: "selected-track-line",
      type: "line",
      source: "selected-track",
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": clickHighlightColor,
        "line-width": 3,
      },
    });

    map.current.addImage(
      "selected-fix-arrow",
      buildHeadArrowImage("#ffffff", clickHighlightColor),
      { pixelRatio: 2 },
    );

    map.current.addLayer({
      id: "selected-track-fixes",
      type: "symbol",
      source: "selected-track",
      // MapLibre 5 rejects filters mixing legacy ('$type') and expression
      // operators
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "cog"]],
      layout: {
        "icon-image": "selected-fix-arrow",
        "icon-size": 0.75,
        "icon-rotate": ["get", "cog"],
        "icon-rotation-alignment": "map",
        // A track can run to 60k fixes, and allow-overlap buried the line under
        // arrows. Collision spaces the survivors on screen at every zoom, and
        // placement walks feature (= time) order, so they're an even walk along
        // the track.
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        "icon-padding": 4,
      },
    });

    map.current.addLayer({
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
    });
  }

  const pointHitContext = () => ({
    project: (lngLat) => map.current.project(lngLat),
    radiusRange: pointRadiusRange.current,
  });
  const featureQueryContext = () => ({
    zoom: map.current.getZoom(),
    queryRendered: (options) => map.current.queryRenderedFeatures(options),
    language: i18n.language,
    gridGeometry: (pk) =>
      griddapCoverageRef.current?.features?.find(
        (feature) => Number(feature.properties.pk) === pk,
      )?.geometry,
  });

  // One handler, one hit-test: report what's under the click and let the card
  // offer the actions; nothing here changes the camera or a filter. Titles
  // aren't on the tiles; the card resolves pks against the current results.
  const clickLayerIds = [
    ...trackClickLayers,
    ...selectedTrackLayers,
    "points",
    "coverage-hexes",
    "hexes",
    ...griddapHitLayers,
  ];

  // Shared by a click and a share link's replay. Once a marker or track (a
  // precise geometry) is under the point, hex hits are dropped: the hexes lie
  // beneath every station and every metre of track.
  const hitsAt = (point) => {
    const layers = clickLayerIds.filter((id) => map.current.getLayer(id));
    const hits = layers.length
      ? map.current.queryRenderedFeatures(point, { layers })
      : [];
    const precise =
      hits.some((feature) => feature.layer.id === "points") ||
      trackItemsIn(hits).length > 0;
    return precise
      ? hits.filter(
          (feature) => !["hexes", "coverage-hexes"].includes(feature.layer.id),
        )
      : hits;
  };

  function installHover() {
    // Hover only names what's under the cursor; detail is one click away in the
    // card. Lines are truncated rather than wrapped. Sized to the longest line
    // a rule produces: a full instant range (37 chars).
    const CHIP_MAX_CHARS = 40;
    const showChip = (lngLat, text) => {
      const lines = (Array.isArray(text) ? text : [text])
        .map((line) => String(line ?? "").trim())
        .filter(Boolean)
        .map((line) =>
          line.length > CHIP_MAX_CHARS
            ? `${line.slice(0, CHIP_MAX_CHARS - 1)}…`
            : line,
        );
      if (lines.length === 0) {
        popup.remove();
        return;
      }
      popup
        .setLngLat(lngLat)
        .setHTML(
          `<span class="mapChip">${lines
            .map(
              (line) => `<span class="mapChipLine">${escapeHtml(line)}</span>`,
            )
            .join("")}</span>`,
        )
        .addTo(map.current);
    };

    // Debounced: rebuilding on every mousemove flickered.
    const showGriddapTooltip = debounce((e, features) => {
      const sameStack =
        features.length === hoveredGriddapIds.current.length &&
        features.every(
          (feature, index) => feature.id === hoveredGriddapIds.current[index],
        );
      popup.setLngLat([e.lngLat.lng, e.lngLat.lat]);
      if (sameStack && popup.isOpen()) return;

      setGriddapHovered(features);
      showChip(
        e.lngLat,
        features.length > 1
          ? t("mapChipGridStack", { n: features.length })
          : griddapTitle(features[0], i18n.language),
      );
    }, 80);

    // One handler, one hit-test, once per frame. MapLibre's per-layer listeners
    // each run queryRenderedFeatures per raw mousemove (and 'mouseleave' adds
    // another), which over dense coastline was the most expensive thing the map
    // did. Precedence, highest first:
    //
    //   1. griddap rectangles, unless an observation or a track is under the
    //      cursor (griddapCoveredIn)
    //   2. the selected platform's own fixes, deliberately unguarded
    //   3. track lines, unless a point, a head or a selected fix is
    //   4. track heads, unless a point is
    //   5. points
    //   6. coverage hexes, unless a point is — points draw over them
    //   7. profile hexes, unless the rectangles outrank them at this zoom
    const hoverRules = [
      {
        id: "griddap",
        layers: griddapHitLayers,
        when: (hits) => !griddapCoveredIn(hits, map.current.getZoom()),
        show: (e, features) =>
          showGriddapTooltip(e, dedupeGriddapByPk(features)),
      },
      {
        id: "selected-fixes",
        layers: ["selected-track-fixes", "selected-track-fixes-nocog"],
        // The record id is absent on a plain Trajectory dataset. Falls back to
        // the platform where a fix carries no time.
        show: (e, features) => {
          const {
            dataset_title: datasetTitle,
            profile_id: profileId,
            time,
            trajectory_id: trajectoryId,
          } = features[0].properties;
          showChip(e.lngLat, [
            datasetTitle,
            profileId,
            formatInstant(time) || trajectoryId,
          ]);
        },
      },
      {
        id: "track-lines",
        layers: ["track-lines"],
        when: (hits, point) =>
          !isOnAPointIn(hits, point, pointHitContext()) &&
          !hits.some((feature) =>
            [
              "track-heads",
              "track-heads-fixed",
              ...selectedTrackLayers,
            ].includes(feature.layer.id),
          ),
        // No single instant or record id: an MVT line carries one set of
        // properties, so the segment's span is what it can say (lines CTE in
        // tiles.js).
        show: (e, features) => {
          const {
            dataset_title: datasetTitle,
            trajectory_id: trajectoryId,
            time_min: timeMin,
            time_max: timeMax,
          } = features[0].properties;
          showChip(e.lngLat, [
            datasetTitle,
            trajectoryId,
            formatInstantRange(timeMin, timeMax),
          ]);
        },
      },
      {
        id: "track-heads",
        layers: ["track-heads", "track-heads-fixed"],
        when: (hits, point) => !isOnAPointIn(hits, point, pointHitContext()),
        // A head is the platform's last fix in the scrubbed window.
        show: (e, features) => {
          const {
            dataset_title: datasetTitle,
            trajectory_id: trajectoryId,
            profile_id: profileId,
            head_time: headTime,
          } = features[0].properties;
          showChip(e.lngLat, [
            datasetTitle,
            trajectoryId,
            profileId,
            formatInstant(headTime),
          ]);
        },
      },
      {
        id: "points",
        layers: ["points"],
        show: (e, features) =>
          showChip(
            // the circle's centre, not the cursor
            features[0].geometry.coordinates.slice(),
            metricCountLabel(features[0].properties.count),
          ),
      },
      {
        id: "coverage-hexes",
        layers: ["coverage-hexes"],
        when: (hits) => !hits.some((feature) => feature.layer.id === "points"),
        show: (e, features) =>
          showChip(e.lngLat, metricCountLabel(features[0].properties.count)),
      },
      {
        id: "hexes",
        layers: ["hexes"],
        when: (hits) => !griddapOutranksHexesIn(hits, map.current.getZoom()),
        show: (e, features) =>
          showChip(e.lngLat, metricCountLabel(features[0].properties.count)),
      },
    ];

    // Includes layers only the guards read: track-lines stands aside for
    // 'selected-track-line'.
    const hoverLayerIds = [
      ...new Set([
        ...hoverRules.flatMap((rule) => rule.layers),
        "selected-track-line",
      ]),
    ];

    const handleHover = (e) => {
      // Drawing and the depth tool own the cursor; leave the popup as the last
      // hover left it.
      if (draw.getMode().includes("draw") || depthToolActiveRef.current) {
        showGriddapTooltip.cancel();
        setGriddapHovered([]);
        return;
      }

      const layers = hoverLayerIds.filter((id) => map.current.getLayer(id));
      const hits = layers.length
        ? map.current.queryRenderedFeatures(e.point, { layers })
        : [];

      const winner = hoverRules.find((rule) => {
        const features = hits.filter((feature) =>
          rule.layers.includes(feature.layer.id),
        );
        return features.length > 0 && (!rule.when || rule.when(hits, e.point));
      });

      // The rectangles' hover outline is feature-state, so it must be
      // released whenever they aren't the winner.
      if (winner?.id !== "griddap") {
        showGriddapTooltip.cancel();
        setGriddapHovered([]);
      }

      if (!winner) {
        map.current.getCanvas().style.cursor = "grab";
        popup.remove();
        return;
      }

      map.current.getCanvas().style.cursor = "pointer";
      winner.show(
        e,
        hits.filter((feature) => winner.layers.includes(feature.layer.id)),
      );
    };

    // Coalesced to one hit-test per frame, on the newest cursor position.
    let pendingHover = null;
    let hoverFrame = null;
    map.current.on("mousemove", (e) => {
      setHoveredDataset();
      pendingHover = e;
      if (hoverFrame !== null) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = null;
        const event = pendingHover;
        pendingHover = null;
        if (event && map.current) handleHover(event);
      });
    });

    // No mousemove fires once the cursor leaves the canvas.
    map.current.on("mouseout", () => {
      if (hoverFrame !== null) {
        cancelAnimationFrame(hoverFrame);
        hoverFrame = null;
      }
      pendingHover = null;
      showGriddapTooltip.cancel();
      setGriddapHovered([]);
      if (!draw.getMode().includes("draw") && !depthToolActiveRef.current) {
        map.current.getCanvas().style.cursor = "grab";
        popup.remove();
      }
    });
  }

  function installClick() {
    // A tap delivers 'touchend' then a synthesized 'click'; the second is the
    // same gesture and would re-open a card the first let the user dismiss.
    let lastClickHandledAt = 0;
    const TAP_ECHO_MS = 400;

    const handleMapClick = (e) => {
      const now = Date.now();
      if (now - lastClickHandledAt < TAP_ECHO_MS) return;
      lastClickHandledAt = now;

      // Drawing owns the canvas. A finished shape lands in direct_select, so
      // "done drawing" is "no longer in a draw_* mode".
      if (creatingPolygon.current) {
        if (!draw.getMode().includes("draw")) creatingPolygon.current = false;
        return;
      }
      if (draw.getMode().includes("draw")) return;

      // At every zoom: past NONNA's reach the API answers from GEBCO.
      if (depthToolActiveRef.current) {
        onDepthQueryRef.current(e.lngLat.wrap());
        return;
      }

      // Outside the drawn shape is out of the selection.
      const ring = selectionRing.current;
      if (
        ring &&
        !turfPointsWithinPolygon(
          helpers.point([e.lngLat.lng, e.lngLat.lat]),
          helpers.polygon([ring]),
        ).features.length
      ) {
        return;
      }

      const hits = hitsAt(e.point);
      const markerHits = hits.filter(
        (feature) => feature.layer.id === "points",
      );
      const tracks = trackItemsIn(hits);

      // The wide invisible hit stroke means one click commonly hits several
      // nearby stations, so pick the one whose true position is nearest the
      // cursor. Deduped by pk: a station straddling a tile boundary hits twice.
      let nearestMarker = null;
      if (markerHits.length > 0) {
        const seenPks = new Set();
        let nearestDistSq = Infinity;
        markerHits.forEach((feature) => {
          const pk = feature.properties.pk;
          if (seenPks.has(pk)) return;
          seenPks.add(pk);
          const projected = map.current.project(feature.geometry.coordinates);
          const dx = projected.x - e.point.x;
          const dy = projected.y - e.point.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearestMarker = feature;
          }
        });
      }

      // Only markers under the click, and the nearest names one dataset: jump
      // straight to its record.
      const nonMarkerHits = hits.filter(
        (feature) => feature.layer.id !== "points",
      );
      if (nearestMarker && nonMarkerHits.length === 0) {
        const markerDatasetPks = datasetPksOf(nearestMarker);
        if (markerDatasetPks.length === 1) {
          popup.remove();
          // The shape buildFeatureQuery would use, so the ring matches the
          // marker exactly once the record is closed.
          const highlight = {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: nearestMarker.geometry,
                properties: {
                  count: Number(nearestMarker.properties.count) || 0,
                },
              },
            ],
          };
          // Not through handleFeatureQuery: navigating there in the same tick
          // as the record jump races two navigations over a stale search-params
          // snapshot (see setInspectRecordID in SelectionProvider), so
          // onMarkerClick owns both.
          onMarkerClickRef.current(
            markerDatasetPks[0],
            Number(nearestMarker.properties.pk),
            {
              datasetPks: markerDatasetPks,
              highlight,
              nonce: Date.now(),
              // useUrlSync's ?at= reads this; the marker's position stands in.
              lngLat: nearestMarker.geometry.coordinates,
            },
          );
          return;
        }
      }

      // Same shortcut for exactly one track (the hexes beneath it were dropped
      // above).
      const gridHits = hits.filter(isGriddapHit);
      if (
        tracks.length === 1 &&
        markerHits.length === 0 &&
        gridHits.length === 0
      ) {
        popup.remove();
        // The selected track's drawing is this click's highlight, and this path
        // skips the featureQuery effect that would clear an earlier region.
        map.current
          .getSource("click-highlight")
          ?.setData(emptyFeatureCollection);
        const track = tracks[0];
        // The area the dataset page uses to list when the platform was here.
        onTrackClickRef.current(track.pk, track.trajectoryId, track.title, {
          lngLat: [e.lngLat.lng, e.lngLat.lat],
          z: Math.floor(map.current.getZoom()),
        });
        return;
      }

      const query = buildFeatureQuery(e.lngLat, hits, featureQueryContext());

      popup.remove();
      onFeatureQueryRef.current(query);

      // For empty water right after the marker path: React bails out of a no-op
      // setFeatureQuery(null), so the featureQuery effect wouldn't clear the
      // ring.
      if (!query) {
        map.current
          .getSource("click-highlight")
          ?.setData(emptyFeatureCollection);
      }

      // A click on empty water is the touch user's only undo: it closes the
      // card and drops the spatial selection (not the download selection, which
      // is derived from the results). getLayer guard: a click before
      // 'style.load' would setFilter on a layer that doesn't exist yet.
      if (!query && drawPolygon.current.getAll().features.length === 0) {
        if (map.current.getLayer("points-highlighted")) {
          map.current.setFilter("points-highlighted", ["in", "pk", ""]);
        }
        setPolygon();
      }
    };

    // The draw modes are checked at the top of the handler, so the per-layer
    // touchend workaround for mapbox-gl-draw#617 isn't needed.
    map.current.on("click", handleMapClick);

    // A tap must be told apart from the end of a pan or pinch, or a map-wide
    // touchend would clear the selection after every drag.
    const TAP_SLOP_PX = 12;
    const TAP_TIMEOUT_MS = 500;
    let touchStart = null;
    map.current.on("touchstart", (e) => {
      touchStart =
        e.originalEvent.touches.length === 1
          ? { point: e.point, at: Date.now() }
          : null;
    });
    map.current.on("touchend", (e) => {
      const start = touchStart;
      touchStart = null;
      if (!start) return;
      if (Date.now() - start.at > TAP_TIMEOUT_MS) return;
      const dx = e.point.x - start.point.x;
      const dy = e.point.y - start.point.y;
      if (dx * dx + dy * dy > TAP_SLOP_PX ** 2) return;
      handleMapClick(e);
    });
  }

  useEffect(() => {
    if (map.current) return;
    map.current = new MaplibreMap({
      container: mapContainer.current,
      // The projection is part of the style in MapLibre 5 and must be set here:
      // the projection effect's first run happens while map.current is null.
      style: {
        ...buildBasemapStyle(i18n.language, bathymetryPalette),
        projection: { type: projection === "globe" ? "globe" : "mercator" },
      },
      // The default 'high-performance' wakes the discrete GPU on dual-GPU
      // laptops; circles and fills don't need it.
      canvasContextAttributes: { powerPreference: "low-power" },
      // The canvas can't be browsed by keyboard or screen reader; its label
      // points to the list that holds the same datasets.
      locale: { "Map.Title": t("mapCanvasLabel") },
      // The legend card builds the attribution control (see LegendFooter.jsx).
      attributionControl: false,
      center: [initialView.lon, initialView.lat],
      zoom: initialView.zoom,
      // Esri serves a grey "not yet available" tile past its coverage, which is
      // z17 on remote Arctic coasts.
      maxZoom: 17,
    });
    onMapReady(map.current);

    map.current.dragRotate.disable();

    map.current.touchZoomRotate.disableRotation();

    // 'style.load', not 'load': 'load' waits for every basemap tile, and the
    // EMODnet rasters take seconds, so the data tiles queued behind them.
    map.current.once("style.load", () => {
      setColorStopsRef.current();
      addObservationLayers();
      addGriddapLayers();
      addClickHighlightLayers();
      addTrackLayers();
      addSelectedTrackLayers();
      applySelectionFilter();

      applyLayerVisibility();

      // The picker may have been toggled off before the style finished loading.
      if (!dataLayersVisibleRef.current) {
        setLayersVisibility(observationLayerIds, false);
      }
      // A share link's WMS overlay can go up before there were layers to hide.
      if (activeWmsOverlayRef.current) setDataLayersVisibility(false);
      // The style creates the depth rasters visible.
      if (!bathymetryVisibleRef.current) {
        setLayersVisibility(bathymetryLayerIds, false);
      }

      // mapbox-gl-draw only listens for clicks once map.loaded(), which waits
      // for every basemap tile, so the first clicks of a drawing were dropped.
      // Its layers need only the style, so it is re-added now with the map
      // reported loaded for that one call; re-adding resets the mode, so it's
      // re-entered.
      const draw = drawPolygon.current;
      const mode = draw.getMode();
      draw.changeMode("simple_select");
      map.current.removeControl(draw);
      map.current.loaded = () => true;
      map.current.addControl(draw, "bottom-right");
      delete map.current.loaded;
      if (mode !== "simple_select") draw.changeMode(mode);
    });

    map.current.once("load", () => {
      loadTurfUnion();
      // Puts a share link's spatial selection back into the draw control so it
      // is drawn, editable, and survives the next filter change (which
      // re-derives the selection from the control).
      const sharedSelection = polygon;
      if (sharedSelection) {
        const [featureId] = drawPolygon.current.add({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [sharedSelection] },
        });
        drawPolygon.current.changeMode("direct_select", { featureId });
        highlightPoints(sharedSelection);
      }
    });

    installHover();
    installClick();

    map.current.on("draw.create", () => {
      setLoading(true);
      if (drawPolygon.current.getAll().features.length > 1) {
        drawPolygon.current.delete(drawPolygon.current.getAll().features[0].id);
      }
      const feature = drawPolygon.current.getAll().features[0];
      const polygon = feature.geometry.coordinates[0];
      highlightPoints(polygon);
      setPolygon(polygon);
      map.current.getCanvas().style.cursor = "unset";
      // draw.create fires from inside the changeMode() that's finishing the
      // drawing; a reentrant changeMode is deferred a tick.
      setTimeout(() => {
        drawPolygon.current?.changeMode("direct_select", {
          featureId: feature.id,
        });
      }, 0);
    });

    const commitDrawUpdate = debounce(() => {
      const feature = drawPolygon.current.getAll().features[0];
      if (!feature) return;
      const polygon = feature.geometry.coordinates[0];
      highlightPoints(polygon);
      setPolygon(polygon);
    }, DRAW_UPDATE_DEBOUNCE_MS);
    map.current.on("draw.update", commitDrawUpdate);

    // New tiles were never part of the queryRenderedFeatures snapshot the focus
    // was computed from, so re-apply it as each data source loads.
    const dataSourceIds = ["cde-tiles", "cde-cells"];
    map.current.on("sourcedata", (e) => {
      if (!focusedDatasetPk.current) return;
      if (!e.isSourceLoaded || !dataSourceIds.includes(e.sourceId)) return;
      hoverHighlightPoints(focusedDatasetPk.current);
    });

    // Aborted requests (tiles left behind mid-zoom) don't fire 'error'. Any
    // listener stops MapLibre's own console.error, hence the log; the message,
    // since a minified error class logs as its two-letter name.
    const retriedSourceIds = [...HEX_SOURCE_IDS, "tracks"];
    map.current.on("error", (e) => {
      console.error(e.error?.message ?? e.error);
      if (!e.tile || !retriedSourceIds.includes(e.sourceId)) return;
      tileRetry.onError(e.sourceId, e.tile.tileID.canonical);
    });

    map.current.on("idle", () => {
      layersLoaded.current = true;
      // 'sourcedata' can land before the new tiles render, and
      // queryRenderedFeatures only sees rendered ones.
      if (focusedDatasetPk.current) {
        hoverHighlightPoints(focusedDatasetPk.current);
      }
      if (
        doFinalCheck.current &&
        drawPolygon.current.getAll().features.length > 0 &&
        map.current.getZoom() >= 7
      ) {
        setLoading(true);
        highlightPoints(
          drawPolygon.current.getAll().features[0].geometry.coordinates[0],
        );
      }
      doFinalCheck.current = false;
      setLoading(false);
    });

    // The stops depend on the zoom band; stale point-level stops would clamp
    // every hex into a single green.
    map.current.on("zoomend", () => setColorStopsRef.current());
    // Highlighted at 'idle' only: here the new zoom's tiles aren't in yet, so
    // the pass was wasted work in the middle of a wheel zoom.
    map.current.on("zoomend", () => {
      doFinalCheck.current = true;
    });
    // toArray() is [[west,south],[east,north]], the shape boundsIntersect
    // wants.
    const pushMapView = () => {
      const center = map.current.getCenter();
      setMapView({
        lat: center.lat,
        lon: center.lng,
        zoom: map.current.getZoom(),
        bounds: map.current.getBounds().toArray(),
      });
    };
    // A wheel zoom ends in a moveend at every pause; re-rendering the app and
    // rewriting the URL on each one stuttered the next notch.
    map.current.on("moveend", debounce(pushMapView, MAP_VIEW_DEBOUNCE_MS));
    // moveend doesn't fire until the first interaction, so seed at the reveal:
    // 'idle' waits on every tile, leaving the in-view count empty for as long
    // as the slowest source took.
    pushMapViewRef.current = pushMapView;
    map.current.on("mousedown", (e) => {
      if (e.originalEvent.shiftKey) {
        shiftBoxCreate.current = true;
        setBoxSelectStartCoords([e.lngLat.lng, e.lngLat.lat]);
      }
    });

    map.current.on("mouseup", (e) => {
      if (shiftBoxCreate.current) {
        setBoxSelectEndCoords([e.lngLat.lng, e.lngLat.lat]);
        map.current.getCanvas().style.cursor = "unset";
        shiftBoxCreate.current = false;
      }
    });

    // Replayed at 'idle', the earliest moment every hit-tested source is
    // rendered. Only the card is reproduced, not the click: a replayed click
    // could undo the selection and page the same link just restored.
    askAtRef.current = (lngLat) => {
      const query = buildFeatureQuery(
        { lng: lngLat[0], lat: lngLat[1] },
        hitsAt(map.current.project(lngLat)),
        featureQueryContext(),
      );
      if (query) onFeatureQueryRef.current(query);
    };
    if (sharedFeatureQueryAtRef.current) {
      map.current.once("idle", () => {
        const lngLat = sharedFeatureQueryAtRef.current;
        if (!lngLat || !map.current) return;
        sharedFeatureQueryAtRef.current = null;
        askAtRef.current(lngLat);
      });
    }

    // No visible buttons: the top bar drives the modes via changeMode/deleteAll
    // (see the drawRequest effect), but the control must be added for them to
    // exist.
    map.current.addControl(drawPolygon.current, "bottom-right");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A pan into unseen ground shows stretched parent tiles that look finished,
  // and the half-zoom basemap swap makes all the fetches land at once. Tracked
  // per layer so the badge can say which one is still fetching.
  useEffect(() => {
    if (!map.current) return;

    // Browser-cache hits resolve in a frame or two; announcing them would flash
    // the badge on every wheel notch.
    const ANNOUNCE_AFTER_MS = 300;
    // Tiles arrive in waves with empty frames between; clearing instantly would
    // flicker and keep resetting the announce countdown, so a load of several
    // short waves would never be announced.
    const SETTLE_MS = 250;

    const timers = new Map(
      WATCHED_MAP_LAYERS.map((layer) => [
        layer.id,
        { announceTimer: null, settleTimer: null, announced: false },
      ]),
    );
    let published = [];

    const publish = () => {
      const next = WATCHED_MAP_LAYERS.filter(
        (layer) => timers.get(layer.id).announced,
      ).map((layer) => layer.id);
      if (
        next.length === published.length &&
        next.every((id, index) => id === published[index])
      ) {
        return;
      }
      published = next;
      setLoadingLayers(next);
    };

    const pending = (layer) =>
      layer.sources.some(
        // isSourceLoaded throws on an unknown id (absent mid style-change).
        (id) => map.current.getSource(id) && !map.current.isSourceLoaded(id),
      );

    const sync = (layer) => {
      const state = timers.get(layer.id);
      if (pending(layer)) {
        clearTimeout(state.settleTimer);
        state.settleTimer = null;
        if (state.announced || state.announceTimer) return;
        state.announceTimer = setTimeout(() => {
          state.announceTimer = null;
          state.announced = true;
          publish();
        }, ANNOUNCE_AFTER_MS);
        return;
      }
      // See SETTLE_MS.
      if (state.settleTimer || (!state.announced && !state.announceTimer))
        return;
      state.settleTimer = setTimeout(() => {
        state.settleTimer = null;
        if (pending(layer)) return sync(layer);
        clearTimeout(state.announceTimer);
        state.announceTimer = null;
        if (state.announced) {
          state.announced = false;
          publish();
        }
      }, SETTLE_MS);
    };

    const syncAll = () => WATCHED_MAP_LAYERS.forEach(sync);

    // 'data'/'dataloading' fire per tile for every source, so each is routed to
    // its owning layer. 'idle' is the backstop, including sources dropped past
    // a layer's minzoom rather than loaded.
    const onSourceEvent = (e) => {
      if (e.dataType !== "source") return;
      const layer = WATCHED_MAP_LAYERS.find((l) =>
        l.sources.includes(e.sourceId),
      );
      if (layer) sync(layer);
    };
    map.current.on("dataloading", onSourceEvent);
    map.current.on("data", onSourceEvent);
    map.current.on("idle", syncAll);

    return () => {
      timers.forEach((state) => {
        clearTimeout(state.announceTimer);
        clearTimeout(state.settleTimer);
      });
      map.current.off("dataloading", onSourceEvent);
      map.current.off("data", onSourceEvent);
      map.current.off("idle", syncAll);
      if (published.length) setLoadingLayers([]);
    };
  }, [setLoadingLayers]);

  // The reveal's own reportFirstPaint declines if the basemap is still
  // arriving; this closes it out.
  useEffect(() => {
    if (!map.current) return;
    const check = () => reportFirstPaint();
    map.current.on("sourcedata", check);
    map.current.on("idle", check);
    return () => {
      map.current.off("sourcedata", check);
      map.current.off("idle", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Registered once so the debounce survives re-renders. 'idle' measures
  // undebounced: waiting after it put the re-colouring visibly after the map
  // stopped. The repaint -> 'idle' loop is cut by the ramp key. 'moveend' and
  // 'sourcedata' keep the debounce, for maps that never fully settle.
  useEffect(() => {
    if (!map.current) return;
    // Un-dimming stale layers rides the same pass, so new tiles come up at
    // full strength in the colours they keep.
    const measureAndSettle = () => {
      refreshViewportHexRange();
      settleStaleData();
    };
    const measure = debounce(measureAndSettle, VIEWPORT_RAMP_DEBOUNCE_MS);
    const measureNow = () => {
      measure.cancel();
      measureAndSettle();
    };
    const onDataSourceLoaded = (e) => {
      if (!e.isSourceLoaded) return;
      if (HEX_SOURCE_IDS.includes(e.sourceId)) measure();
      else if (e.sourceId === "tracks") settleStaleData();
    };
    map.current.on("moveend", measure);
    map.current.on("sourcedata", onDataSourceLoaded);
    map.current.on("idle", measureNow);
    return () => {
      measure.cancel();
      map.current.off("moveend", measure);
      map.current.off("sourcedata", onDataSourceLoaded);
      map.current.off("idle", measureNow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The initial language is baked in at construction.
  useEffect(() => {
    if (!map.current) return;
    map.current.getCanvas().setAttribute("aria-label", t("mapCanvasLabel"));
    if (!map.current.isStyleLoaded()) return;
    LABEL_LAYER_IDS.forEach((id) => {
      if (map.current.getLayer(id)) {
        map.current.setLayoutProperty(
          id,
          "text-field",
          getLabelTextField(i18n.language),
        );
      }
    });
  }, [i18n.language, t]);

  return (
    <>
      <div
        ref={mapContainer}
        className="map"
        data-testid="map-container"
        data-projection={projection}
        data-map-ready={firstPainted || undefined}
      />
      {createPortal(
        <Spinner size="lg" role="presentation" />,
        wmsSpinnerElement,
      )}
    </>
  );
}
