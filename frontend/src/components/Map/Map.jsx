import * as React from "react";
import { Map as MaplibreMap, Marker, Popup, setWorkerUrl } from "maplibre-gl";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { useState, useEffect, useLayoutEffect, useRef } from "react";

import * as helpers from "@turf/helpers";
import turfPointsWithinPolygon from "@turf/points-within-polygon";

import debounce from "lodash-es/debounce";
import { useTranslation } from "react-i18next";
import "./styles.css";

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
  viewportCountRange,
  rangesEqual,
  revealOffset,
  zoomToDatasetCamera,
} from "../../utilities";
import {
  buildWmsGetMapUrl,
  clampBoundsForWms,
  intersectBoundsWithPolygonBbox,
  warpEquirectToMercator,
} from "../../wmsUtilities";
import {
  colorScale,
  defaultBathymetryPalette,
  defaultMapBounds,
} from "../config";
import { platformLabel } from "../../platformVocab.js";
import DepthProbe from "./DepthProbe.jsx";
import useMapDataLoading from "./useMapDataLoading.js";
import {
  TRAJECTORY_TYPE_KEYS,
  anyTrajectoryLayerOn,
} from "../../state/dataLayers.js";
import {
  buildBasemapStyle,
  getLabelTextField,
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
  gridsCovering,
  dedupeGriddapByPk,
  featureHasDataset,
  griddapHitLayers,
  griddapTitle,
  idsOutsideDataset,
  isGriddapHit,
  isOnAPointIn,
  loadTurfUnion,
  nearestFeature,
  selectedTrackLayers,
  trackClickLayers,
  trackItemsIn,
} from "./hitTest.js";
import { toRampStops } from "./hexRamp.js";
import { focusedPointFeatures } from "./focusedPoints.js";
import { selectedTrackFeatures } from "./selectedTrack.js";
import { selectionLayerFilter } from "./selectionFilter.js";
import { createTileRetry } from "./tileRetry.js";
import { drawControlOptions } from "./drawControl.js";
import {
  BASEMAP_SOURCE_IDS,
  DATA_SOURCE_IDS,
  HEX_HOVER_LAYERS,
  HEX_LAYER_IDS,
  HEX_MAX_ZOOM,
  HEX_SOURCE_IDS,
  NO_HEX_HOVERED,
  NOTHING_SELECTED,
  POINT_LAYER_IDS,
  SELECTION_FILTERED_LAYERS,
  addDataLayers,
  applyStyle,
  bathymetryLayerIds,
  emptyFeatureCollection,
  focusTargets,
  griddapLayerIds,
  observationLayerIds,
  rampStyle,
  revealStyle,
  trackFocusStyle,
  trackLayerIds,
  visibilityStyle,
} from "./mapLayers.js";

// maplibre 6 can't find its worker from inside a bundle.
setWorkerUrl(maplibreWorkerUrl);

// A debounce, not a throttle: one measurement at the end of a gesture, so a
// hesitant pan doesn't renumber the legend halfway through.
const VIEWPORT_RAMP_DEBOUNCE_MS = 400;
const MAP_VIEW_DEBOUNCE_MS = 250;

// direct_select fires draw.update on every drag tick, and setPolygon feeds
// the /pointQuery fetch.
const DRAW_UPDATE_DEBOUNCE_MS = 300;
// Hit-testing and re-filtering the hover layers on every frame of a sweep
// trailed the cursor; settle first.
const HOVER_DEBOUNCE_MS = 50;
// Zoomed in, one or two cells are often all there is; falling back to the
// catalogue-wide domain painted them pale. generateColorStops gives a
// one-value range a mid shade.
const MIN_VIEWPORT_HEXES = 1;
// How far the visible maximum may drift from the painted one before a pan
// re-shades. Counts snap to nice steps (quantizeCountRange), so within 2x the
// re-shade would mostly just flicker.
const PAN_RESCALE_FACTOR = 2;
// The round trip is exact to float noise for a point really on the surface,
// off by tens of pixels for one that isn't (see viewportQueryIsReliable).
const SURFACE_ROUND_TRIP_TOLERANCE_PX = 1;

// A share link routinely resolves before the style adds a source, and nothing
// else re-runs the effect, so `fn` waits for the load. Registered from an
// effect, so it runs after the mount's handler that adds the sources.
function whenSource(map, sourceId, fn) {
  if (map.getSource(sourceId)) {
    fn(map.getSource(sourceId));
    return () => {};
  }
  const retry = () => fn(map.getSource(sourceId));
  map.once("style.load", retry);
  // Evented.off clears once-listeners too.
  return () => map.off("style.load", retry);
}

const boundsOfFeatures = (features) =>
  boundsFromGeoJson({
    coordinates: features.map((feature) => feature.geometry.coordinates),
  });

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
  setDataLoading = () => {},
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
  onViewportPointRange = () => {},
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
  // Every matching grid's box, drawn or not: a click lists the grids over it.
  griddapExtents,
  dataLayersVisible = true,
  bathymetryVisible = true,
  bathymetryPalette = defaultBathymetryPalette,
  activeWmsOverlay,
  projection = "mercator",
  zoomTarget,
  drawRequest,
  // (failed: boolean): whether any data tile is a hole the retries gave up on.
  onTilesFailed = () => {},
  tileRetryRequest,
  featureQueryRequest,
  onMapReady = () => {},
  // See reportFirstPaint.
  onFirstPaint = () => {},
}) {
  const { t, i18n } = useTranslation();

  // The props as of the last commit, for map handlers registered once and for
  // helpers called from them. Written in a layout effect so a render React
  // throws away never leaks in; it runs before every effect and map event.
  // Includes t: useTranslation's is fixed to the language it rendered in.
  const latest = useRef(null);
  const mapContainer = useRef(null);
  const map = useRef(null);
  const creatingPolygon = useRef(false);

  const [draw] = useState(() => new MapboxDraw(drawControlOptions));
  // refreshTiles is the one public call that reloads an errored tile.
  const [tileRetry] = useState(() => {
    const retry = createTileRetry({
      refresh: (sourceId, tile) => {
        if (map.current?.getSource(sourceId)) {
          map.current.refreshTiles(sourceId, [tile]);
        }
      },
      // The basemap's holes are its own; only data holes would pass for
      // "nothing here".
      onChange: () =>
        latest.current.onTilesFailed(retry.hasExhausted(DATA_SOURCE_IDS)),
    });
    return retry;
  });
  const drawPolygon = useRef(draw);
  const layersLoaded = useRef(false);
  const colorStops = useRef([]);
  const coverageColorStops = useRef([]);
  // A ref, not state: a re-render isn't what it should cause; the legend hears
  // via onViewportHexRange.
  const viewportHexRange = useRef(undefined);
  const viewportPointRange = useRef(undefined);
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
  // Set by 'moveend', spent by the next settled measurement.
  const panSettlePending = useRef(false);
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
    const layers = latest.current.dataLayers;
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

  // Guarded on the source, NOT map.loaded(): loaded() is false whenever any
  // tile is in flight, which on heavy coverage/track tiles silently dropped
  // filter changes. setTiles works fine while other tiles load, and clears the
  // source's tile cache.
  function reloadHexTiles() {
    if (!map.current?.getSource("cde-tiles")) return false;
    invalidateHexRamp();
    const { tileQuery, cellTileQuery } = tileUrls(
      latest.current.mapQueryString,
    );
    HEX_SOURCE_IDS.forEach((id) => tileRetry.reset(id));
    map.current.getSource("cde-tiles").setTiles([tileQuery]);
    map.current.getSource("cde-cells").setTiles([cellTileQuery]);
    return true;
  }

  // Hidden tracks are left alone; whatever shows them refetches.
  function reloadTrackTiles() {
    const { mapQueryString, scrubTime, trailingDays, tracksMode, dataLayers } =
      latest.current;
    if (!tracksMode || !anyTrajectoryLayerOn(dataLayers)) return;
    if (!map.current?.getSource("tracks")) return;
    tileRetry.reset("tracks");
    map.current
      .getSource("tracks")
      .setTiles([buildTracksTileUrl(mapQueryString, scrubTime, trailingDays)]);
  }

  // The ONLY thing that hides the tracks: the "Hexes & points" picker owns
  // observationLayerIds alone. Which track types draw is decided server-side
  // (buildTileSuffix).
  function applyLayerVisibility() {
    if (!map.current || !map.current.getLayer("track-lines")) return;
    const trajOn = anyTrajectoryLayerOn(latest.current.dataLayers);
    applyStyle(
      map.current,
      visibilityStyle(
        ["track-lines", "track-heads", "track-heads-fixed"],
        trajOn && latest.current.tracksMode,
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
  // later filter changes repaint in place.
  function revealData() {
    if (dataRevealed.current || !map.current) return;
    dataRevealed.current = true;
    reportFirstPaint();
    applyStyle(map.current, revealStyle(true));
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
    if (measuredRange === undefined && !latest.current.rangeLevels) return;
    revealData();
  }

  // False while a source is missing: its tiles are still on their way.
  function hexSourcesLoaded() {
    return HEX_SOURCE_IDS.every(
      (id) => map.current.getSource(id) && map.current.isSourceLoaded(id),
    );
  }

  // Own class so the frame-stripping in styles.css is scoped to this popup.
  const [popup] = useState(
    () =>
      new Popup({
        closeButton: false,
        closeOnClick: true,
        className: "mapChipPopup",
        // Clears the largest marker and its click ring, which the chip used
        // to sit on.
        offset: 16,
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

  useEffect(() => {
    setColorStops();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeLevels, coverageRangeLevels]);

  function deleteAllShapes() {
    drawPolygon.current?.deleteAll();
    setPolygon();
  }

  function endDrawing() {
    if (!map.current) return;
    map.current.getCanvas().style.cursor = "unset";
    drawPolygon.current.changeMode("simple_select");
    deleteAllShapes();
  }

  const metricCountLabel = (value) =>
    latest.current.t("mapHexCountDays", { count: Number(value || 0) });

  const rampState = () => ({
    stops: colorStops.current,
    coverageStops: coverageColorStops.current,
    radiusRange: pointRadiusRange.current,
  });

  function setColorStops() {
    if (!map.current) return;
    const { rangeLevels, coverageRangeLevels } = latest.current;
    // Placeholder ranges until /legend resolves (see defaultRangeLevels).
    const effectiveRangeLevels = rangeLevels || defaultRangeLevels;
    // Zoomed into a quiet corner, the global maximum comes from elsewhere and
    // every cell in view lands in the ramp's palest decade. One measurement
    // serves both layers, since only one is ever on screen.
    const hexDomain =
      viewportHexRange.current ||
      getCurrentRangeLevel(effectiveRangeLevels, map.current.getZoom());
    colorStops.current = toRampStops(generateColorStops(colorScale, hexDomain));

    // Coverage hexes only render at zoom >= HEX_MAX_ZOOM, always on the hex_1
    // grid.
    const effectiveCoverageRangeLevels =
      coverageRangeLevels || defaultCoverageRangeLevels;
    const coverageDomain =
      viewportHexRange.current || effectiveCoverageRangeLevels.zoom1;
    coverageColorStops.current = toRampStops(
      generateColorStops(colorScale, coverageDomain),
    );

    pointRadiusRange.current =
      viewportPointRange.current ||
      getCurrentRangeLevel(effectiveRangeLevels, HEX_MAX_ZOOM);

    applyStyle(map.current, rampStyle(rampState()));
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
  function measureVisibleHexRange(focusPk, layerIds = HEX_LAYER_IDS) {
    const layers = layerIds.filter((id) => map.current.getLayer(id));
    if (!layers.length) return undefined;
    // Only with the whole globe in view, where the catalogue-wide tier is the
    // honest domain anyway.
    if (!viewportQueryIsReliable()) return undefined;
    // Hidden layers and layers outside their zoom range return nothing.
    const features = map.current.queryRenderedFeatures({ layers });
    if (features.length < MIN_VIEWPORT_HEXES) return undefined;
    const counts = [];
    // A plain loop: chained filter/map arrays would be the expensive part over
    // every rendered hex. Duplicates across tile boundaries barely move a
    // percentile.
    for (const feature of features) {
      // Greyed cells carry none of the ramp's colours, so they don't set its
      // domain.
      if (focusPk !== undefined && !featureHasDataset(feature, focusPk))
        continue;
      const count = Number(feature.properties?.count);
      if (Number.isFinite(count) && count > 0) counts.push(count);
    }
    return viewportCountRange(counts);
  }

  // Re-measure when the counts change meaning (rampQueryEpoch), the ramp is
  // scaled to another dataset (rampFocusPk), or the integer zoom changes. A pan
  // isn't part of the key: re-shading on every settle flickered. It re-shades
  // only when the view's maximum leaves the painted one by PAN_RESCALE_FACTOR
  // (rescaleIfPannedOut). Integer zoom, not the hex tier: z0 and z4 share a
  // grid but show wildly different extents.
  function rampKey() {
    return [
      rampQueryEpoch.current,
      rampFocusPk.current ?? "",
      Math.floor(map.current.getZoom()),
    ].join("|");
  }

  function applyViewportHexRange(range) {
    if (rangesEqual(viewportHexRange.current, range)) return;
    viewportHexRange.current = range;
    setColorStops();
    latest.current.onViewportHexRange(range);
  }

  // Marker size follows the view like the hex shades: the catalogue's point
  // range is set by single-day casts, so every long-running mooring in view
  // drew at full size.
  function applyViewportPointRange(range) {
    if (rangesEqual(viewportPointRange.current, range)) return;
    viewportPointRange.current = range;
    setColorStops();
    latest.current.onViewportPointRange(range);
  }

  function rescalePointsIfPannedOut() {
    const painted = viewportPointRange.current;
    const range = measureVisibleHexRange(rampFocusPk.current, POINT_LAYER_IDS);
    if (!range) return;
    const ratio = painted ? range[1] / painted[1] : Infinity;
    if (ratio > PAN_RESCALE_FACTOR || ratio < 1 / PAN_RESCALE_FACTOR) {
      applyViewportPointRange(range);
    }
  }

  // Once per settled pan. An absent measurement (nothing on screen) keeps the
  // painted ramp: the global tier would re-shade empty water for nothing.
  function rescaleIfPannedOut() {
    if (!hexSourcesLoaded()) return;
    panSettlePending.current = false;
    rescalePointsIfPannedOut();
    const painted = viewportHexRange.current;
    if (!painted) return;
    const range = measureVisibleHexRange(rampFocusPk.current);
    if (!range) return;
    const ratio = range[1] / painted[1];
    if (ratio > PAN_RESCALE_FACTOR || ratio < 1 / PAN_RESCALE_FACTOR) {
      applyViewportHexRange(range);
    }
  }

  // Cheap to call spuriously: the key test stops the loop, since repainting a
  // data-driven property re-renders the map, which calls this.
  function refreshViewportHexRange() {
    if (!map.current) return;
    const key = rampKey();
    if (rampMeasuredFor.current === key) {
      if (panSettlePending.current) rescaleIfPannedOut();
      return;
    }
    // Tiles still in flight: hold what's painted and measure at the next idle.
    // Mid-load the rendered hexes include the previous zoom's stand-in tiles,
    // and each re-colouring relayouts every loaded tile (see IS_DIMMED), which
    // slowed the very tiles being waited on.
    if (!hexSourcesLoaded()) return;
    const range = measureVisibleHexRange(rampFocusPk.current);
    applyViewportPointRange(
      measureVisibleHexRange(rampFocusPk.current, POINT_LAYER_IDS),
    );
    // Pinned, holding colours through a drag.
    if (range !== undefined) rampMeasuredFor.current = key;
    // Loaded and empty IS an answer, so the global tier takes over. Not pinned:
    // panning into data at this zoom should find it at the next idle.

    applyViewportHexRange(range);
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
  const trackFocus = () =>
    latest.current.selectedTrajectory ? "selection" : focusedDatasetPk.current;

  function applyTrackFocus() {
    if (!map.current || !map.current.getLayer("track-lines")) return;
    const pk = trackFocus();
    if (trackFocusApplied.current === pk) return;
    trackFocusApplied.current = pk;
    applyStyle(map.current, trackFocusStyle(pk));
  }

  function hoverHighlightPoints(pk) {
    if (!map.current || !layersLoaded.current) return;
    applyTrackFocus();

    // Every loaded tile, not just drawn ones: re-run as each tile loads, this
    // greys it before its first frame. Below z7 profiles are merged into
    // 'hexes'; the geometry type keeps hex and marker pks, which share the
    // source layer, from dimming each other across the z7 hand-off.
    const pointLevel = map.current.getZoom() >= 7;
    const dimmedLayers = [pointLevel ? "points" : "hexes", "coverage-hexes"];
    const sourceFilters = {
      points: ["==", ["geometry-type"], "Point"],
      hexes: ["==", ["geometry-type"], "Polygon"],
    };

    const dimmed = {};
    let focusedPoints = emptyFeatureCollection;
    dimmedLayers.forEach((layerId) => {
      const { source, sourceLayer } = focusTargets[layerId];
      if (!pk || !map.current.getSource(source)) {
        dimmed[layerId] = [];
        return;
      }
      const features = map.current.querySourceFeatures(source, {
        sourceLayer,
        filter: sourceFilters[layerId],
      });
      // promoteId puts pk on the id, which setFeatureState addresses.
      dimmed[layerId] = idsOutsideDataset(features, pk);
      // 'points' sort-key can't depend on feature-state, so focused markers
      // were buried under grey ones; they're redrawn on top from a copy, since
      // a filtered tile layer would relayout the whole source per focus change.
      if (layerId === "points") {
        focusedPoints = focusedPointFeatures(features, pk);
      }
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

  const wmsMoveHandler = useRef(null);
  // Bumped on every overlay change so stale in-flight GetMap loads are dropped.
  const wmsRenderToken = useRef(0);
  // Read by map event handlers and the layer filters.
  // An overlay set before the style loaded hid layers that did not exist yet.
  const revealedWmsPk = useRef();
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
  // click's hex or grid box would read as part of it. A clicked marker keeps
  // its ring: a single click opens its dataset straight away, and without the
  // ring the dot is lost among the dataset's own markers while the page still
  // points at it.
  const revealedQueryNonce = useRef();
  useEffect(() => {
    const source = map.current?.getSource("click-highlight");
    if (!source) return;
    const highlight = featureQuery?.highlight;
    source.setData(
      !highlight
        ? emptyFeatureCollection
        : inspectDataset
          ? {
              ...highlight,
              features: highlight.features.filter(
                (feature) => feature.geometry?.type === "Point",
              ),
            }
          : highlight,
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
  // The style creates these layers visible; 'style.load' applies the switch.

  function setLayersVisibility(layerIds, visible) {
    applyStyle(map.current, visibilityStyle(layerIds, visible));
    // A hidden layer returns nothing from queryRenderedFeatures, so showing one
    // needs a re-measure without the ramp key changing; only the following
    // 'idle' is left to act on it.
    if (visible) rampMeasuredFor.current = undefined;
  }

  // Restoring hands each group back to its owner: the switches for hex/point
  // layers and the depth wash, applyLayerVisibility for the tracks. The depth
  // wash goes too: its colours would read as the overlay's own.
  function setDataLayersVisibility(visible) {
    setLayersVisibility(griddapLayerIds, visible);
    if (!visible) {
      setLayersVisibility(observationLayerIds, false);
      setLayersVisibility(trackLayerIds, false);
      setLayersVisibility(bathymetryLayerIds, false);
      return;
    }
    setLayersVisibility(observationLayerIds, latest.current.dataLayersVisible);
    setLayersVisibility(bathymetryLayerIds, latest.current.bathymetryVisible);
    setLayersVisibility(trackLayerIds, true);
    applyLayerVisibility();
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
    const source = map.current?.getSource("griddap-coverage");
    if (source) source.setData(griddapCoverage || emptyFeatureCollection);
  }, [griddapCoverage]);

  // Owns the hex and point layers only; the ref keeps the choice through a WMS
  // overlay.
  useEffect(() => {
    if (!map.current || activeWmsOverlay) return;
    setLayersVisibility(observationLayerIds, dataLayersVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayersVisible]);

  // The ref keeps the choice through a WMS overlay, which hides the depth wash.
  useEffect(() => {
    if (!map.current || activeWmsOverlay) return;
    setLayersVisibility(bathymetryLayerIds, bathymetryVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // A place's outline or a pasted area rests as an outline: its many
      // vertices show as handles only once the shape is clicked to edit.
      drawPolygon.current.add({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [drawRequest.ring] },
      });
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
    if (tileRetryRequest) tileRetry.retryExhausted();
  }, [tileRetryRequest, tileRetry]);

  useEffect(() => {
    if (!map.current) return;
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
    applySelectionFilter();
  }, [polygon]);

  // A ref so replaying it can't be re-triggered by a later render.
  const sharedFeatureQueryAtRef = useRef(sharedFeatureQueryAt);

  // Written after commit so a render React throws away never leaks into them;
  // layout effects run before every effect and map event that reads them.
  useLayoutEffect(() => {
    latest.current = {
      activeWmsOverlay,
      bathymetryVisible,
      coverageRangeLevels,
      dataLayers,
      dataLayersVisible,
      depthToolActive,
      griddapCoverage,
      griddapExtents,
      mapQueryString,
      onDepthQuery,
      onFeatureQuery,
      onMarkerClick,
      onTilesFailed,
      onTrackClick,
      onViewportHexRange,
      onViewportPointRange,
      polygon,
      rangeLevels,
      scrubTime,
      selectedTrajectory,
      t,
      tracksMode,
      trailingDays,
    };
  });

  useEffect(() => {
    if (!depthToolActive) return undefined;
    popup.remove();
    const canvas = map.current?.getCanvas();
    if (canvas) canvas.style.cursor = "crosshair";
    const exitOnEscape = (e) => {
      if (e.key === "Escape") onDepthToolExit();
    };
    window.addEventListener("keydown", exitOnEscape); // eslint-disable-line no-restricted-syntax -- keep: Escape leaves the depth-tool map mode
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
    const filterSuffix = buildTileSuffix(
      queryString,
      latest.current.dataLayers,
    );
    return {
      tileQuery: `${server}/tiles/{z}/{x}/{y}.mvt${filterSuffix}`,
      cellTileQuery: `${server}/tiles/cells/{z}/{x}/{y}.mvt${filterSuffix}`,
    };
  }

  useEffect(() => {
    if (!reloadHexTiles()) return;
    setLoading(true);
    setPolygon(
      drawPolygon.current.getAll().features[0]?.geometry.coordinates[0],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapQueryString]);

  // The track tiles carry trajectoryTypes too, so they refetch here, or a
  // switched-off geometry's lines would linger until the next scrub.
  useEffect(() => {
    if (!reloadHexTiles()) return;
    reloadTrackTiles();
    applyLayerVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayers]);

  // Track lines come from their own /tiles/tracks source.
  useEffect(() => {
    applyLayerVisibility();
    reloadTrackTiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksMode, mapQueryString, scrubTime, trailingDays]);

  // Framed only when the selection asks.
  useEffect(() => {
    if (!map.current) return undefined;
    // Picking a second platform mid-fetch is routine from the map, so the
    // in-flight request is abandoned rather than landing under the newer name.
    const abortController = new AbortController();
    const cancelWait = whenSource(
      map.current,
      "selected-track",
      async (source) => {
        if (!selectedTrajectory) {
          rawTrackRef.current = null;
          // Forgotten so re-picking the same platform frames it again.
          framedTrackRef.current = null;
          source.setData(emptyFeatureCollection);
          applyTrackFocus();
          return;
        }
        const { datasetPk, trajectoryId } = selectedTrajectory;
        const cacheKey = `${datasetPk}|${trajectoryId}`;
        if (rawTrackRef.current?.key !== cacheKey) {
          try {
            const track = await fetchJson(
              `${server}/trajectories/track?datasetPKs=${datasetPk}&trajectoryId=${encodeURIComponent(trajectoryId)}`,
              { signal: abortController.signal },
            );
            if (abortController.signal.aborted) return;
            rawTrackRef.current = {
              key: cacheKey,
              coordinates: track.coordinates,
              times: track.times,
              // null per fix for a plain Trajectory dataset; only
              // TrajectoryProfile fixes are records with an id.
              profileIds: track.profile_ids,
            };
          } catch (error) {
            if (error.name !== "AbortError") {
              reportError("track fetch failed", error);
            }
            return;
          }
        }
        // The full response stays cached; only the drawing is clipped. An empty
        // window draws nothing rather than leaving the last selection on screen.
        const features = selectedTrackFeatures(
          rawTrackRef.current,
          filterTimeWindow(mapQueryString),
          selectedTrajectory,
        );
        source.setData({ type: "FeatureCollection", features });
        applyTrackFocus();

        // A track clicked on the map is already under the cursor, so flying out
        // to the whole voyage would throw away the view; only a list pick asks
        // to frame. Once per selection: this re-runs as the time rail drags.
        if (!features.length || !selectedTrajectory.frameView) return;
        if (framedTrackRef.current === cacheKey) return;
        framedTrackRef.current = cacheKey;
        revealBounds(boundsOfFeatures(features), { frame: true });
      },
    );
    return () => {
      abortController.abort();
      cancelWait();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrajectory, mapQueryString]);

  useEffect(() => {
    if (!map.current) return undefined;
    const abortController = new AbortController();
    const cancelWait = whenSource(
      map.current,
      "mapped-record",
      async (source) => {
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
        const features = coordinates.map((coordinate) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: coordinate },
          properties: {},
        }));
        source.setData({ type: "FeatureCollection", features });
        if (frameView)
          revealBounds(boundsOfFeatures(features), { frame: true });
      },
    );
    return () => {
      abortController.abort();
      cancelWait();
    };
  }, [mappedRecord]);

  // 'points-highlighted' rings what the drawn shape selects, so without one
  // it shows nothing.
  function applySelectionFilter() {
    const ring = latest.current.polygon;
    Object.entries({
      ...SELECTION_FILTERED_LAYERS,
      "points-highlighted": undefined,
    }).forEach(([layerId, filter]) => {
      if (!map.current?.getLayer(layerId)) return;
      map.current.setFilter(
        layerId,
        layerId === "points-highlighted" && !ring
          ? NOTHING_SELECTED
          : selectionLayerFilter(filter, ring),
      );
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
      latest.current.griddapExtents?.features?.find(
        (feature) => Number(feature.properties.pk) === pk,
      )?.geometry,
    gridsAt: (lngLat) => gridsCovering(latest.current.griddapExtents, lngLat),
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

  // Re-filtered only when the hovered cell changes.
  const hexHovered = useRef("");
  function setHexHover(layerId, pk) {
    const key = layerId ? `${layerId}:${pk}` : "";
    if (hexHovered.current === key || !map.current) return;
    hexHovered.current = key;
    HEX_HOVER_LAYERS.forEach(({ id, of }) => {
      if (!map.current.getLayer(id)) return;
      map.current.setFilter(
        id,
        of === layerId ? ["==", ["get", "pk"], pk] : NO_HEX_HOVERED,
      );
    });
  }

  function installHover() {
    const t = (...args) => latest.current.t(...args);
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

    const showGriddapTooltip = (e, features) => {
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
    };

    // One handler, one hit-test, once the cursor settles. MapLibre's per-layer listeners
    // each run queryRenderedFeatures per raw mousemove (and 'mouseleave' adds
    // another), which over dense coastline was the most expensive thing the map
    // did. Precedence, highest first:
    //
    //   1. the selected platform's own fixes, deliberately unguarded
    //   2. track lines, unless a point, a head or a selected fix is
    //   3. track heads, unless a point is
    //   4. points
    //   5. coverage hexes, unless a point is — points draw over them
    //   6. profile hexes
    //   7. griddap rectangles, which the others name in their own chip
    const hoverRules = [
      {
        id: "selected-fixes",
        layers: ["selected-track-fixes", "selected-track-fixes-nocog"],
        // The record id is absent on a plain Trajectory dataset. Falls back to
        // the platform where a fix carries no time.
        chip: (e, features) => {
          const {
            dataset_title: datasetTitle,
            profile_id: profileId,
            time,
            trajectory_id: trajectoryId,
          } = features[0].properties;
          return [
            e.lngLat,
            [datasetTitle, profileId, formatInstant(time) || trajectoryId],
          ];
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
        chip: (e, features) => {
          const {
            dataset_title: datasetTitle,
            trajectory_id: trajectoryId,
            time_min: timeMin,
            time_max: timeMax,
          } = features[0].properties;
          return [
            e.lngLat,
            [datasetTitle, trajectoryId, formatInstantRange(timeMin, timeMax)],
          ];
        },
      },
      {
        id: "track-heads",
        layers: ["track-heads", "track-heads-fixed"],
        when: (hits, point) => !isOnAPointIn(hits, point, pointHitContext()),
        // A head is the platform's last fix in the scrubbed window.
        chip: (e, features) => {
          const {
            dataset_title: datasetTitle,
            trajectory_id: trajectoryId,
            profile_id: profileId,
            head_time: headTime,
          } = features[0].properties;
          return [
            e.lngLat,
            [datasetTitle, trajectoryId, profileId, formatInstant(headTime)],
          ];
        },
      },
      {
        id: "points",
        layers: ["points"],
        // Named as well as coloured: the hue alone is the platform otherwise.
        chip: (e, features) => {
          const { platform, count } = features[0].properties;
          return [
            // the circle's centre, not the cursor
            features[0].geometry.coordinates.slice(),
            [
              !platform || platform === "unknown"
                ? t("mapChipPlatformUnknown")
                : platformLabel(platform, i18n.language),
              metricCountLabel(count),
            ],
          ];
        },
      },
      {
        id: "coverage-hexes",
        layers: ["coverage-hexes"],
        when: (hits) => !hits.some((feature) => feature.layer.id === "points"),
        chip: (e, features) => [
          e.lngLat,
          [metricCountLabel(features[0].properties.count)],
        ],
      },
      {
        id: "hexes",
        layers: ["hexes"],
        chip: (e, features) => [
          e.lngLat,
          [metricCountLabel(features[0].properties.count)],
        ],
      },
      {
        id: "griddap",
        layers: griddapHitLayers,
        show: (e, features) =>
          showGriddapTooltip(e, dedupeGriddapByPk(features)),
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
      if (draw.getMode().includes("draw") || latest.current.depthToolActive) {
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
        setGriddapHovered([]);
      }

      const hexWinner = HEX_LAYER_IDS.includes(winner?.id);
      setHexHover(
        hexWinner ? winner.id : null,
        hexWinner
          ? hits.find((feature) => feature.layer.id === winner.id).properties.pk
          : null,
      );

      if (!winner) {
        map.current.getCanvas().style.cursor = "grab";
        popup.remove();
        return;
      }

      map.current.getCanvas().style.cursor = "pointer";
      const winnerHits = hits.filter((feature) =>
        winner.layers.includes(feature.layer.id),
      );
      if (winner.show) {
        winner.show(e, winnerHits);
        return;
      }
      // Whatever wins, the grids it sits inside are still named.
      const grids = dedupeGriddapByPk(hits.filter(isGriddapHit));
      const [at, lines] = winner.chip(e, winnerHits);
      showChip(at, [
        ...lines,
        grids.length > 1
          ? t("mapChipGridStack", { n: grids.length })
          : grids.length === 1
            ? t("mapChipInGrid", {
                title: griddapTitle(grids[0], i18n.language),
              })
            : null,
      ]);
    };

    const debouncedHover = debounce((e) => {
      if (map.current) handleHover(e);
    }, HOVER_DEBOUNCE_MS);
    map.current.on("mousemove", (e) => {
      setHoveredDataset();
      debouncedHover(e);
    });

    // No mousemove fires once the cursor leaves the canvas.
    map.current.on("mouseout", () => {
      debouncedHover.cancel();
      setGriddapHovered([]);
      setHexHover(null);
      if (!draw.getMode().includes("draw") && !latest.current.depthToolActive) {
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
      if (latest.current.depthToolActive) {
        latest.current.onDepthQuery(e.lngLat.wrap());
        return;
      }

      // Outside the drawn shape is out of the selection.
      const ring = latest.current.polygon;
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

      const nearestMarker = nearestFeature(markerHits, e.point, (lngLat) =>
        map.current.project(lngLat),
      );

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
          latest.current.onMarkerClick(
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
        latest.current.onTrackClick(track.pk, track.trajectoryId, track.title, {
          lngLat: [e.lngLat.lng, e.lngLat.lat],
          z: Math.floor(map.current.getZoom()),
        });
        return;
      }

      const query = buildFeatureQuery(e.lngLat, hits, featureQueryContext());

      popup.remove();
      latest.current.onFeatureQuery(query);

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
      ...(initialView.lat === undefined
        ? {}
        : {
            center: [initialView.lon, initialView.lat],
            zoom: initialView.zoom,
          }),
      // Esri serves a grey "not yet available" tile past its coverage, which is
      // z17 on remote Arctic coasts.
      maxZoom: 17,
    });
    // Not the constructor's `bounds`: the padding that keeps the box clear of
    // the sidebar needs the canvas.
    if (initialView.lat === undefined) {
      map.current.fitBounds(defaultMapBounds, {
        padding: mapCoverPadding(map.current),
        animate: false,
      });
    }
    onMapReady(map.current);

    map.current.dragRotate.disable();

    map.current.touchZoomRotate.disableRotation();

    // 'style.load', not 'load': 'load' waits for every basemap tile, and the
    // EMODnet rasters take seconds, so the data tiles queued behind them.
    map.current.once("style.load", () => {
      setColorStops();
      // Created via refs so the current switch, scrub window and focus apply
      // even though this handler runs once.
      trackFocusApplied.current = trackFocus();
      addDataLayers(
        map.current,
        {
          ...tileUrls(latest.current.mapQueryString),
          tracksQuery: buildTracksTileUrl(
            latest.current.mapQueryString,
            latest.current.scrubTime,
            latest.current.trailingDays,
          ),
          griddapCoverage: latest.current.griddapCoverage,
          tracksVisible: latest.current.tracksMode,
        },
        [
          revealStyle(dataRevealed.current),
          rampStyle(rampState()),
          trackFocusStyle(trackFocusApplied.current),
        ],
      );
      applySelectionFilter();

      applyLayerVisibility();

      // The picker may have been toggled off before the style finished loading.
      if (!latest.current.dataLayersVisible) {
        setLayersVisibility(observationLayerIds, false);
      }
      // A share link's WMS overlay can go up before there were layers to hide.
      if (latest.current.activeWmsOverlay) setDataLayersVisibility(false);
      // The style creates the depth rasters visible.
      if (!latest.current.bathymetryVisible) {
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
      // is drawn, editable (click it), and survives the next filter change
      // (which re-derives the selection from the control).
      if (polygon) {
        drawPolygon.current.add({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [polygon] },
        });
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
      setPolygon(feature.geometry.coordinates[0]);
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
      if (feature) setPolygon(feature.geometry.coordinates[0]);
    }, DRAW_UPDATE_DEBOUNCE_MS);
    map.current.on("draw.update", commitDrawUpdate);

    // A tile's 'data' event fires before its first frame, so dimming it here
    // keeps out-of-focus cells from flashing their colour while panning.
    const dataSourceIds = ["cde-tiles", "cde-cells"];
    map.current.on("sourcedata", (e) => {
      if (!focusedDatasetPk.current) return;
      if (!e.tile || !dataSourceIds.includes(e.sourceId)) return;
      hoverHighlightPoints(focusedDatasetPk.current);
    });

    // Aborted requests (tiles left behind mid-zoom) don't fire 'error'. Any
    // listener stops MapLibre's own console.error, hence the log; the message,
    // since a minified error class logs as its two-letter name.
    // Esri imagery throws the odd transient 502 (logged as a CORS block, since
    // its error responses carry no Access-Control-Allow-Origin).
    const retriedSourceIds = [...DATA_SOURCE_IDS, "imagery"];
    map.current.on("error", (e) => {
      console.error(e.error?.message ?? e.error);
      if (!e.tile || !retriedSourceIds.includes(e.sourceId)) return;
      tileRetry.onError(e.sourceId, e.tile.tileID.canonical);
    });
    map.current.on("sourcedata", (e) => {
      if (!e.tile || !retriedSourceIds.includes(e.sourceId)) return;
      tileRetry.onLoad(e.sourceId, e.tile.tileID.canonical);
    });

    map.current.on("idle", () => {
      layersLoaded.current = true;
      // A focus set before the layers settled was skipped, and a zoom across
      // z7 switches the dimmed band without loading a tile.
      if (focusedDatasetPk.current) {
        hoverHighlightPoints(focusedDatasetPk.current);
      }
      setLoading(false);
    });

    // The stops depend on the zoom band; stale point-level stops would clamp
    // every hex into a single green.
    map.current.on("zoomend", () => setColorStops());
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
    // Replayed at 'idle', the earliest moment every hit-tested source is
    // rendered. Only the card is reproduced, not the click: a replayed click
    // could undo the selection and page the same link just restored.
    askAtRef.current = (lngLat) => {
      const query = buildFeatureQuery(
        { lng: lngLat[0], lat: lngLat[1] },
        hitsAt(map.current.project(lngLat)),
        featureQueryContext(),
      );
      if (query) latest.current.onFeatureQuery(query);
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
  // and the half-zoom basemap swap makes all the fetches land at once.
  const setWmsPending = useMapDataLoading(map, setDataLoading);

  function removeWmsOverlay() {
    wmsRenderToken.current += 1;
    setWmsPending(false);
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
    setWmsPending(false);
    const viewportBounds = clampBoundsForWms(map.current.getBounds());
    if (
      viewportBounds.south >= viewportBounds.north ||
      viewportBounds.west >= viewportBounds.east
    ) {
      return;
    }
    const bounds = intersectBoundsWithPolygonBbox(
      viewportBounds,
      latest.current.polygon,
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
    setWmsPending(true);
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
      setWmsPending(false);
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
      if (token === wmsRenderToken.current) setWmsPending(false);
      console.warn(`WMS GetMap failed: ${url}`);
    };
    img.src = url;
  }

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
    const measure = debounce(
      refreshViewportHexRange,
      VIEWPORT_RAMP_DEBOUNCE_MS,
    );
    const measureNow = () => {
      measure.cancel();
      refreshViewportHexRange();
    };
    const onDataSourceLoaded = (e) => {
      if (e.isSourceLoaded && HEX_SOURCE_IDS.includes(e.sourceId)) measure();
    };
    const onMoveEnd = () => {
      panSettlePending.current = true;
      measure();
    };
    map.current.on("moveend", onMoveEnd);
    map.current.on("sourcedata", onDataSourceLoaded);
    map.current.on("idle", measureNow);
    return () => {
      measure.cancel();
      map.current.off("moveend", onMoveEnd);
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
    <div
      ref={mapContainer}
      className="map"
      data-testid="map-container"
      data-projection={projection}
      data-map-ready={firstPainted || undefined}
    />
  );
}
