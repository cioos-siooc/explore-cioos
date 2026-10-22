import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";

import { server } from "../../config.js";
import {
  defaultMapCenter,
  defaultMapZoom,
  defaultTrailingDays,
  HEX_METRIC,
  isMarkerTier,
  trailingWindowOptions,
} from "../../components/config.js";
import {
  applyDatasetPKs,
  createDataFilterQueryString,
  getCurrentRangeLevel,
  rangesEqual,
  useDebounce,
} from "../../utilities.jsx";
import { wmsSliceFromParams } from "../../wmsUtilities.js";
import fetchJson from "../fetchJson.js";
import reportError from "../reportError.js";
import { useUrlSeededPersistentState } from "../usePersistentState.js";

// Always written out, never omitted: the API counts something else when the
// param is absent (see HEX_METRIC), and the tile URLs spell it out the same way.
function legendUrl(legendQuery) {
  const params = new URLSearchParams(legendQuery || "");
  params.set("metric", HEX_METRIC);
  return `${server}/legend?${params.toString()}`;
}
import { useFilters } from "../filters/FilterProvider.jsx";
import {
  DATA_LAYER_KEYS,
  currentDataLayerKey,
  DEFAULT_TRACKS_MODE,
  dataLayersFromChoices,
  toggledDataLayerChoice,
} from "../dataLayers.js";

const MapStateContext = createContext();
const MapViewContext = createContext();
const ViewportBoundsContext = createContext();

export function useMapState() {
  return useContext(MapStateContext);
}

// The camera and load state change several times a second while the map
// moves. Kept out of useMapState so that churn re-renders only the components
// that read it, not every filter and list component.
export function useMapView() {
  return useContext(MapViewContext);
}

// Changes only when the camera settles (Map.jsx debounces setMapView), unlike
// the rest of useMapView, which also flips with every tile-loading wave.
export function useViewportBounds() {
  return useContext(ViewportBoundsContext);
}

function MapViewProvider({ rangeLevels, coverageRangeLevels, children }) {
  // mapLoaded: settled at least once. The first load earns the full splash;
  // later redraws only the brand logo's pulse.
  const [loading, setLoadingState] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const setLoading = useCallback((value) => {
    setLoadingState(value);
    if (!value) setMapLoaded(true);
  }, []);

  // The path the first load actually takes. 'idle' is wrong both ways: it waits
  // for the CHS soundings, and can arrive before hex sources are requested. It
  // stays as the backstop for a load that never reports a first paint.
  const reportFirstPaint = useCallback(() => setMapLoaded(true), []);

  const firstPaintPending = loading && !mapLoaded;
  // Layer ids from Map.jsx's WATCHED_MAP_LAYERS currently fetching tiles, so
  // the activity badge can name what is on the wire.
  const [loadingLayers, setLoadingLayers] = useState([]);

  // Seeded from the share link (or default view) rather than empty: MapLibre
  // only pushes a view on 'idle'/'moveend', and zoom-keyed consumers like the
  // legend would read `undefined` as "no data matched". Number() because
  // Number.isFinite('12') is false.
  const [mapView, setMapView] = useState(() => {
    const params = new URL(window.location.href).searchParams;
    const asNumber = (name, fallback) => {
      const value = Number(params.get(name));
      return Number.isFinite(value) && params.get(name) !== null
        ? value
        : fallback;
    };
    return {
      lat: asNumber("lat", defaultMapCenter.lat),
      lon: asNumber("lon", defaultMapCenter.lon),
      zoom: asNumber("zoom", defaultMapZoom),
    };
  });
  const { zoom } = mapView;

  // Derived during render, not mirrored by an effect, which would paint one
  // frame with the previous zoom's domain.
  const currentRangeLevel = useMemo(
    () => getCurrentRangeLevel(rangeLevels, zoom),
    [rangeLevels, zoom],
  );

  // Below the marker tier coverage counts merge into the main hex ramp.
  const currentCoverageRangeLevel = useMemo(
    () =>
      coverageRangeLevels && isMarkerTier(zoom)
        ? coverageRangeLevels.zoom1
        : undefined,
    [coverageRangeLevels, zoom],
  );

  // Quantized and debounced at the source (Map.jsx refreshViewportHexRange);
  // the setter drops equal values so a re-report can't re-render the legend.
  const [viewportHexRange, setViewportHexRangeState] = useState();
  const setViewportHexRange = useCallback((range) => {
    setViewportHexRangeState((previous) =>
      rangesEqual(previous, range) ? previous : range,
    );
  }, []);

  // Below the marker tier every cell kind is summed into the hexes layer; at
  // the marker tier only coverage cells remain, with their own tier.
  const globalHexRangeLevel = isMarkerTier(zoom)
    ? currentCoverageRangeLevel
    : currentRangeLevel;

  // The visible extent wins: a catalogue-wide domain paints a zoomed-in view
  // in one flat shade. Global is the fallback before the first measurement or
  // with too few hexes on screen.
  const hexRangeLevel = viewportHexRange || globalHexRangeLevel;

  const value = useMemo(
    () => ({
      loading,
      setLoading,
      reportFirstPaint,
      firstPaintPending,
      loadingLayers,
      mapLoaded,
      mapView,
      setMapView,
      zoom,
      currentRangeLevel,
      hexRangeLevel,
      // Lets the legend explain why its numbers move with the camera.
      hexRangeScaledToView: Boolean(viewportHexRange),
      setViewportHexRange,
      setLoadingLayers,
    }),
    [
      loading,
      setLoading,
      reportFirstPaint,
      firstPaintPending,
      loadingLayers,
      mapLoaded,
      mapView,
      zoom,
      currentRangeLevel,
      hexRangeLevel,
      viewportHexRange,
      setViewportHexRange,
    ],
  );

  return (
    <MapViewContext.Provider value={value}>
      <ViewportBoundsContext.Provider value={mapView.bounds}>
        {children}
      </ViewportBoundsContext.Provider>
    </MapViewContext.Provider>
  );
}

export default function MapStateProvider({ children }) {
  const { query } = useFilters();

  // Pushed from SelectionProvider (downstream of this provider). Map-only on
  // purpose: the list, its counts and the download selection keep hidden
  // datasets. undefined = nothing hidden.
  const [mapDatasetPKs, setMapDatasetPKs] = useState();
  // Memoized: the query string build does full passes over every filter
  // array.
  const mapQueryString = useMemo(
    () => applyDatasetPKs(createDataFilterQueryString(query), mapDatasetPKs),
    [query, mapDatasetPKs],
  );
  const [rangeLevels, setRangeLevels] = useState();
  // The whole dedupe test for the refetch effect below.
  const requestedLegendQuery = useRef(undefined);
  const legendRequest = useRef(undefined);
  const [legendLoading, setLegendLoading] = useState(true);
  // Trajectory + OBIS coverage cells at zoom >= 7, sharing one ramp.
  const [coverageRangeLevels, setCoverageRangeLevels] = useState();
  // The map-appearance switches below persist in localStorage, and UrlSync
  // writes non-default ones into the link (a link param wins over storage).
  // The WMS overlay is per-dataset and dies with the dataset page, so it is
  // deliberately not persisted.
  const [griddapCoverageVisible, setGriddapCoverageVisible] =
    useUrlSeededPersistentState(
      "griddapCoverageVisible",
      "griddap",
      false,
      (raw) => raw === "true",
    );
  const [griddapCoverage, setGriddapCoverage] = useState();
  const [activeWmsOverlay, setActiveWmsOverlay] = useState();
  // A share link's ?var=&date=&z= slice. Consumed once, by the first overlay
  // built, so a later dataset doesn't inherit a slice from an unrelated grid.
  const [pendingWmsSlice, setPendingWmsSlice] = useState(() =>
    wmsSliceFromParams(new URL(window.location.href).searchParams),
  );
  const [dataLayersVisible, setDataLayersVisible] = useUrlSeededPersistentState(
    "dataLayersVisible",
    "obs",
    true,
    (raw) => raw !== "false",
  );
  // Part of the basemap rather than the data, so independent of the switch above.
  const [bathymetryVisible, setBathymetryVisible] = useUrlSeededPersistentState(
    "bathymetryVisible",
    "bathy",
    true,
    (raw) => raw !== "false",
  );
  // The param is the switch the user sees ('globe=true'), not the internal value.
  const [projection, setProjection] = useUrlSeededPersistentState(
    "projection",
    "globe",
    "mercator",
    (raw) => (raw === "true" ? "globe" : "mercator"),
  );
  // The nonce lets the same extent be re-requested after panning away.
  const [zoomTarget, setZoomTarget] = useState();
  // mode is 'box', 'polygon', 'clear', or 'shape' with a ready-made `ring`
  // (a region picked by name); the nonce lets the same mode be re-requested.
  const [drawRequest, setDrawRequest] = useState();
  // For a caller with no click to give (the tips tour). Answered once the map
  // has settled, so a camera move requested alongside it lands first.
  const [featureQueryRequest, setFeatureQueryRequest] = useState();
  // A share link with ?dataset= but no camera: SelectionProvider frames the
  // footprint once the dataset resolves instead of the default world view.
  const [pendingDatasetZoom, setPendingDatasetZoom] = useState(() => {
    const params = new URL(window.location.href).searchParams;
    return (
      Boolean(params.get("dataset")) &&
      !(params.get("lat") || params.get("lon") || params.get("zoom"))
    );
  });
  // cameraForBounds depends on the canvas size, which only the map knows.
  // State, not a ref: ZoomToDataset derives `framed` from it during render.
  const [mapInstance, setMapInstance] = useState(null);

  // The "what's here" card payload; null = nothing open. Lives here, not in
  // SelectionProvider, because opening the card changes no selection.
  const [featureQuery, setFeatureQuery] = useState(null);

  // ?at=lng,lat: everything in the card derives from what is drawn there, so
  // Map replays the query once drawn. Read at mount only.
  const sharedFeatureQueryAt = useState(() => {
    const parts = (new URL(window.location.href).searchParams.get("at") || "")
      .split(",")
      .map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? parts : null;
  })[0];

  // Stable for the provider's life so consumers can list them as deps.
  // `camera` overrides the zoom-to-dataset framing (see zoomToDatasetCamera).
  const zoomToGeometry = useCallback((geometry, camera) => {
    if (geometry) setZoomTarget({ geometry, camera, nonce: Date.now() });
  }, []);

  const requestDraw = useCallback((mode, ring) => {
    setDrawRequest({ mode, ring, nonce: Date.now() });
  }, []);

  const requestFeatureQueryAt = useCallback((lngLat) => {
    setFeatureQueryRequest({ lngLat, nonce: Date.now() });
  }, []);

  const urlParams = new URL(window.location.href).searchParams;
  // On by default, so the param records the OFF case; old 'tracks=true' links
  // still read as on.
  const [tracksMode, setTracksMode] = useState(
    urlParams.has("tracks")
      ? urlParams.get("tracks") !== "false"
      : DEFAULT_TRACKS_MODE,
  );
  const [scrubTime, setScrubTime] = useState(
    urlParams.get("scrubTime") || new Date().toISOString().split("T")[0],
  );
  const debouncedScrubTime = useDebounce(scrubTime, 250);
  // Off-menu values (old links' 'all') fall back, or the select would show a
  // window the map isn't drawing.
  const [trailingDays, setTrailingDays] = useState(() => {
    const days = Number.parseInt(urlParams.get("trail"));
    return trailingWindowOptions.includes(days) ? days : defaultTrailingDays;
  });

  // An empty ?layers= is how older links said "all off", i.e. exclude all.
  const [dataLayerChoices, setDataLayerChoices] = useState(() => {
    const listParam = (name) =>
      (urlParams.get(name) ?? "")
        .split(",")
        .filter(Boolean)
        .map(currentDataLayerKey);
    const included = listParam("layers");
    const excluded =
      urlParams.get("layers") === ""
        ? DATA_LAYER_KEYS
        : listParam("excludeLayers");
    // Every geometry included is how older links said "everything".
    const includesAll = DATA_LAYER_KEYS.every((key) => included.includes(key));
    return Object.fromEntries(
      DATA_LAYER_KEYS.flatMap((key) =>
        excluded.includes(key)
          ? [[key, "exclude"]]
          : included.includes(key) && !includesAll
            ? [[key, "include"]]
            : [],
      ),
    );
  });
  const dataLayers = useMemo(
    () => dataLayersFromChoices(dataLayerChoices),
    [dataLayerChoices],
  );

  function setDataLayerChoice(key, choice) {
    const { [key]: _previous, ...others } = dataLayerChoices;
    setDataLayerChoices(choice ? { ...others, [key]: choice } : others);
  }
  const toggleDataLayer = (key, target) =>
    setDataLayerChoice(
      key,
      toggledDataLayerChoice(dataLayerChoices[key], target),
    );
  const clearDataLayer = (key) => setDataLayerChoice(key, undefined);

  // One switch for Trajectory and TrajectoryProfile jointly (one set of layers
  // fed by both). Map appearance only: it must not narrow the filter selection.
  const toggleTrackLines = () => setTracksMode(!tracksMode);

  // The trajectory view switches are map appearance, not part of this filter,
  // so a reset deliberately leaves them alone.
  function resetDataLayers() {
    setDataLayerChoices({});
  }

  // A failed legend fetch leaves the current ramp in place; loadLegend() is
  // exposed for the retry banner. legendLoading exists because "no ranges yet"
  // and "no data matches" are otherwise indistinguishable.
  // Only the newest request may write the ranges: responses can land out of
  // order and the stale one would number the bar for old filters. The previous
  // request is aborted so rapid changes don't stack the heaviest query.
  const loadLegend = useCallback((legendQuery) => {
    legendRequest.current?.abort();
    const controller = new AbortController();
    legendRequest.current = controller;
    requestedLegendQuery.current = legendQuery;
    setLegendLoading(true);
    fetchJson(legendUrl(legendQuery), { signal: controller.signal })
      .then((legend) => {
        if (legend) {
          setRangeLevels(legend.recordsCount);
          setCoverageRangeLevels(legend.coverageCount);
        }
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        reportError("legend fetch failed", error);
        // A failed fetch leaves no ranges, so let the effect below retry it.
        requestedLegendQuery.current = undefined;
      })
      .finally(() => {
        if (legendRequest.current !== controller) return;
        legendRequest.current = undefined;
        setLegendLoading(false);
      });
    // Only refs and setters, so stable: the refetch effect depends on it.
  }, []);

  // Refetch on mount, on (debounced) query change and on group hide/restore.
  // The guard is the requested query and nothing else: gating on `loading`
  // (the tiles) dropped changes arriving mid-redraw, and gating on empty
  // rangeLevels froze the ramp after a failed first response.
  useEffect(() => {
    if (requestedLegendQuery.current === mapQueryString) return;
    loadLegend(mapQueryString);
  }, [mapQueryString, loadLegend]);

  // Data is kept when toggled off so re-showing it is instant.
  useEffect(() => {
    if (!griddapCoverageVisible) return;
    const controller = new AbortController();
    fetch(`${server}/griddapCoverage?${mapQueryString}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((coverage) => {
        if (coverage) setGriddapCoverage(coverage);
      })
      .catch((error) => {
        reportError("griddap coverage fetch failed", error);
      });
    return () => controller.abort();
  }, [mapQueryString, griddapCoverageVisible]);

  const value = {
    rangeLevels,
    legendLoading,
    coverageRangeLevels,
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    bathymetryVisible,
    setBathymetryVisible,
    projection,
    setProjection,
    // Read-only outside: flipped through toggleTrackLines, not the raw setter.
    tracksMode,
    toggleTrackLines,
    scrubTime,
    setScrubTime,
    debouncedScrubTime,
    trailingDays,
    setTrailingDays,
    dataLayers,
    dataLayerChoices,
    toggleDataLayer,
    clearDataLayer,
    resetDataLayers,
    griddapCoverage,
    activeWmsOverlay,
    setActiveWmsOverlay,
    pendingWmsSlice,
    setPendingWmsSlice,
    zoomTarget,
    zoomToGeometry,
    drawRequest,
    requestDraw,
    featureQueryRequest,
    requestFeatureQueryAt,
    pendingDatasetZoom,
    setPendingDatasetZoom,
    mapInstance,
    setMapInstance,
    featureQuery,
    sharedFeatureQueryAt,
    setFeatureQuery,
    mapDatasetPKs,
    setMapDatasetPKs,
    mapQueryString,
    loadLegend: () => loadLegend(mapQueryString),
  };

  return (
    <MapStateContext.Provider value={value}>
      <MapViewProvider
        rangeLevels={rangeLevels}
        coverageRangeLevels={coverageRangeLevels}
      >
        {children}
      </MapViewProvider>
    </MapStateContext.Provider>
  );
}
