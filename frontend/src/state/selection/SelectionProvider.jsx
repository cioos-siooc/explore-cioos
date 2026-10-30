import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import isEmpty from "lodash-es/isEmpty";

import { server } from "../../config.js";
import reportError from "../reportError.js";
import {
  boundsFromGeoJson,
  boundsIntersect,
  createDataFilterQueryString,
  createSelectionQueryString,
  datasetMatchesUrlKey,
  datasetUrlKey,
  formatErddapServerName,
  selectionFromSearchParams,
  useDebounce,
} from "../../utilities.jsx";
import erddapServersJSONfile from "../../erddapServers.json";
import { useFilters } from "../filters/FilterProvider.jsx";
import { useMapState, useViewportBounds } from "../map/MapStateProvider.jsx";
import { GROUP_NONE, isGroupDimension } from "../datasetGroups.js";
import { allDataLayersOn, datasetInDataLayers } from "../dataLayers.js";
import {
  COLOR_LAYOUT,
  LAYOUT_PARAM,
  PERIOD_PARAM,
  RECORD_PARAM,
  STEP_PARAM,
  TAB_PARAM,
  parsePeriod,
  withoutPreviewParams,
} from "./previewParams.js";
import { useViewportDatasetPks } from "./viewportDatasetPks.js";
import {
  PREVIEW_ERROR,
  networkPreviewError,
  previewErrorFrom,
} from "../../components/Controls/DatasetPreview/previewErrors.js";
import { hasColorPlotFor } from "../../components/Controls/DatasetPreview/previewFacetPlan.js";

const SelectionContext = createContext();

// cdm_data_types that never render as platform-coloured point markers: grids
// draw as a coverage footprint / WMS overlay, trajectories as coverage hexes.
const PLATFORMLESS_DATASET_TYPES = new Set([
  "Grid",
  "Trajectory",
  "TrajectoryProfile",
]);

// OBIS datasets draw as coverage hexes too but carry cdm_data_type 'Point',
// like some ERDDAP datasets, so they're matched on source.
const isPlatformlessDataset = (row) =>
  PLATFORMLESS_DATASET_TYPES.has(row.cdm_data_type) ||
  row.source_type === "obis";

// `query` is already lowercased. Shared by the list and the map narrowing so
// both agree on what a search term keeps.
function datasetMatchesSearch(row, query, language) {
  return [
    row.title,
    row.cdm_data_type,
    formatErddapServerName(
      row.erddap_server_url || row.erddap_url,
      language,
      erddapServersJSONfile,
    ),
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function datasetInLanguage(point, language) {
  return {
    ...point,
    title: point.title_translated?.[language] || point.title,
  };
}

export function useSelection() {
  return useContext(SelectionContext);
}

export default function SelectionProvider({ children }) {
  const { i18n } = useTranslation();
  const languageRef = useRef(i18n.language);
  const { query, catalogLoaded } = useFilters();
  const {
    setActiveWmsOverlay,
    zoomToGeometry,
    pendingDatasetZoom,
    setPendingDatasetZoom,
    setMapDatasetPKs,
    dataLayers,
  } = useMapState();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    languageRef.current = i18n.language;
  }, [i18n.language]);

  // Read once from the opening address: UrlSync owns the URL afterwards and
  // rewrites it from this state, so re-reading it would be circular.
  const initialParams = useState(
    () => new URL(window.location.href).searchParams,
  )[0];

  const [polygon, setPolygon] = useState(() =>
    selectionFromSearchParams(initialParams),
  );
  // The place an area filter was picked from ({name, cgndbid, ring}). It names
  // the filter only while the filter is that very ring: any edit or new
  // drawing sets a new array, and the name goes with it.
  const [areaPlaceShape, setAreaPlace] = useState();
  const areaPlace =
    polygon && areaPlaceShape?.ring === polygon ? areaPlaceShape : undefined;
  const [pointsToDownload, setPointsToDownload] = useState();
  // Debounced so sweeping the cursor across the list doesn't repaint the map
  // highlight per card crossed (and flash "all datasets" in the gaps).
  const [hoveredDatasetTarget, setHoveredDataset] = useState();
  const hoveredDataset = useDebounce(hoveredDatasetTarget, 120);

  // {datasetPk, datasetTitle, trajectoryId, frameView, area} | undefined.
  // `area` ({lngLat, z}) is set only by a click on the track itself.
  const [selectedTrajectory, setSelectedTrajectory] = useState();

  // {datasetPk, profileId} | undefined, set by an unambiguous marker click.
  // Unlike inspectRecordID (open the preview), this only marks a row for the
  // inspector to highlight and scroll to.
  const [highlightedRecord, setHighlightedRecord] = useState();

  // {datasetPk, recordId, frameView} | undefined.
  const [mappedRecord, setMappedRecord] = useState();

  // A share link's ?record= / ?track= / ?onMap= waits here until its dataset
  // resolves out of pointsData. Consumed once, by the effect below.
  const [pendingHighlight, setPendingHighlight] = useState(() => {
    // A trajectory_id is legitimately '' (a dataset with a single unnamed
    // trajectory — the schema default), so presence is the test, not truth.
    const record = initialParams.get("record") || undefined;
    const track = initialParams.has("track")
      ? initialParams.get("track")
      : undefined;
    const onMap = initialParams.get("onMap") || undefined;
    return record !== undefined || track !== undefined || onMap !== undefined
      ? { record, track, onMap }
      : undefined;
  });

  const [pointsData, setPointsData] = useState([]);
  const [shortlist, setShortlist] = useState([]);
  const [selectionLoading, setSelectionLoading] = useState(true);
  const [initialPointsQueryComplete, setInitialPointsQueryComplete] =
    useState(false);
  // Keeps a failed /pointQuery from reading as "no datasets match".
  const [pointsError, setPointsError] = useState(false);
  const [pointsAttempt, setPointsAttempt] = useState(0);
  const retryPointQuery = useCallback(
    () => setPointsAttempt((attempt) => attempt + 1),
    [],
  );
  // Seeded from the URL because a shared link arrives with the record open,
  // and true until the payload lands so the modal shows a spinner, not "no data".
  const [recordLoading, setRecordLoading] = useState(() =>
    Boolean(initialParams.get(RECORD_PARAM)),
  );
  const [datasetPreview, setDatasetPreview] = useState();
  // Why the last /preview came back with nothing, or undefined when it did not.
  // Set and cleared in the same tick as datasetPreview, so the modal can never
  // hold one record's rows beside another's excuse.
  const [previewError, setPreviewError] = useState();
  const [datasetTitleSearchText, setDatasetTitleSearchText] = useState(
    () => initialParams.get("search") || "",
  );
  const [combinedQueries, setCombinedQueries] = useState([]);
  const [onlyInView, setOnlyInView] = useState(
    () => initialParams.get("onlyInView") === "true",
  );

  // Lives here rather than in DatasetsTable so it survives the list unmounting
  // while a dataset page replaces it.
  const [groupBy, setGroupBy] = useState(() => {
    const initialGroupBy = initialParams.get("groupBy");
    return isGroupDimension(initialGroupBy) ? initialGroupBy : GROUP_NONE;
  });

  // Falls back to the coverage bbox, the only one grids carry.
  const datasetBounds = useMemo(
    () =>
      pointsData.map((row) => ({
        pk: row.pk,
        bounds: boundsFromGeoJson(
          row.filtered_bbox_geojson || row.coverage_bbox_geojson,
        ),
      })),
    [pointsData],
  );

  // Platform types the map can draw a platform-coloured marker for under the
  // active filters; the legend keys off this so it never advertises a colour
  // that isn't on the map (e.g. 'spacecraft', which only grids carry).
  const platformsAvailable = useMemo(
    () =>
      [
        ...new Set(
          pointsData
            .filter((row) => !isPlatformlessDataset(row))
            .map((row) => row.platform)
            .filter(Boolean),
        ),
      ].sort(),
    [pointsData],
  );

  const viewportBounds = useDebounce(useViewportBounds(), 300);

  // The instant answer, used until the server's exact one for this view lands
  // (or where it can't ask).
  const bboxInViewPks = useMemo(() => {
    const inView = new Set();
    if (!viewportBounds) return inView;
    for (const { pk, bounds } of datasetBounds) {
      if (boundsIntersect(bounds, viewportBounds)) inView.add(pk);
    }
    return inView;
  }, [datasetBounds, viewportBounds]);
  const exactInViewPks = useViewportDatasetPks({
    viewportBounds,
    query,
    polygon,
    enabled: catalogLoaded,
  });
  const datasetsInViewPks = exactInViewPks ?? bboxInViewPks;

  // Derived here rather than in DatasetsTable so the counters reflect it too.
  // The data-layer switches narrow it as well, so the list never offers
  // datasets absent from the map (Grid datasets belong to no switch).
  const filteredDatasets = useMemo(() => {
    const query = datasetTitleSearchText.toLowerCase();
    const hasSearch = !isEmpty(datasetTitleSearchText);
    const layersNarrowed = !allDataLayersOn(dataLayers);
    if (!hasSearch && !onlyInView && !layersNarrowed) return pointsData;
    return pointsData.filter((row) => {
      if (layersNarrowed && !datasetInDataLayers(row, dataLayers)) return false;
      if (onlyInView && !datasetsInViewPks.has(row.pk)) return false;
      if (!hasSearch) return true;
      return datasetMatchesSearch(row, query, i18n.language);
    });
  }, [
    pointsData,
    datasetTitleSearchText,
    onlyInView,
    datasetsInViewPks,
    dataLayers,
    i18n.language,
  ]);

  // Over filteredDatasets rather than pointsData: the title search and the
  // data-layer switches narrow only client-side.
  const inViewCount = useMemo(
    () =>
      filteredDatasets.filter((row) => datasetsInViewPks.has(row.pk)).length,
    [filteredDatasets, datasetsInViewPks],
  );

  const realtimeCount = useMemo(
    () => filteredDatasets.filter((row) => row.is_realtime).length,
    [filteredDatasets],
  );

  // For routes that answer about the filtered data rather than draw it: the
  // search, "only in view" and data-layer switches are client-side, so this
  // list is how they reach the API. Undefined when filteredDatasets is
  // pointsData itself (nothing narrows). Not mapDatasetPks: that one drops
  // "only in view", which would rewrite every tile URL on every pan.
  const filteredDatasetPks = useMemo(
    () =>
      filteredDatasets === pointsData
        ? undefined
        : filteredDatasets.map((row) => row.pk),
    [filteredDatasets, pointsData],
  );

  const selectedPks = useMemo(
    () =>
      new Set(
        shortlist.filter((entry) => entry.selected).map((entry) => entry.pk),
      ),
    [shortlist],
  );
  const pointsToReview = useMemo(
    () =>
      shortlist
        .filter((entry) => entry.selected)
        .map((entry) => ({ ...entry.row, selected: true })),
    [shortlist],
  );

  // Undefined while nothing narrows leaves the tile/legend/coverage queries as
  // the filters wrote them. Only the search narrows it: the data-layer switches
  // already reach the map via the tile query, and "only in view" would rewrite
  // every map query on every pan. Each distinct search text is a fresh round of
  // map requests, which is why every search box submits on Enter rather than
  // publishing as typed.
  const mapDatasetPks = useMemo(() => {
    const query = datasetTitleSearchText.toLowerCase();
    const hasSearch = !isEmpty(datasetTitleSearchText);
    if (!hasSearch) return undefined;
    return pointsData
      .filter((row) => datasetMatchesSearch(row, query, i18n.language))
      .map((row) => row.pk);
  }, [pointsData, datasetTitleSearchText, i18n.language]);

  useEffect(() => {
    setMapDatasetPKs(mapDatasetPks);
  }, [mapDatasetPks, setMapDatasetPKs]);

  // The open dataset page lives in the URL so Back/Forward move through it
  // natively. A filter that excludes the open dataset doesn't close its page:
  // the last resolved row is kept and inspectDatasetExcluded flags it.
  const resolvedInspectDataset = useMemo(
    () => pointsData.find((point) => datasetMatchesUrlKey(point, searchParams)),
    [pointsData, searchParams],
  );
  const [retainedInspectDataset, setRetainedInspectDataset] = useState();
  if (
    resolvedInspectDataset &&
    resolvedInspectDataset !== retainedInspectDataset
  ) {
    setRetainedInspectDataset(resolvedInspectDataset);
  }
  const inspectDataset = useMemo(() => {
    if (resolvedInspectDataset) return resolvedInspectDataset;
    if (!datasetMatchesUrlKey(retainedInspectDataset, searchParams)) return;
    return datasetInLanguage(retainedInspectDataset, i18n.language);
  }, [
    resolvedInspectDataset,
    retainedInspectDataset,
    searchParams,
    i18n.language,
  ]);
  const inspectDatasetExcluded = Boolean(
    inspectDataset &&
    !filteredDatasets.some((row) => row.pk === inspectDataset.pk),
  );

  // Read by setInspectDataset at call time, so it can stay stable across pans.
  const onListRef = useRef(!searchParams.get("dataset"));
  const fromListRef = useRef(Boolean(location.state?.fromList));
  useEffect(() => {
    onListRef.current = !searchParams.get("dataset");
    fromListRef.current = Boolean(location.state?.fromList);
  }, [searchParams, location.state]);

  // A share link that named a dataset but no camera frames its footprint once
  // it resolves. Consumed once.
  useEffect(() => {
    if (!pendingDatasetZoom || !inspectDataset) return;
    const footprint =
      inspectDataset.filtered_bbox_geojson ||
      inspectDataset.coverage_bbox_geojson;
    if (footprint) zoomToGeometry(footprint);
    setPendingDatasetZoom(false);
  }, [
    pendingDatasetZoom,
    inspectDataset,
    setPendingDatasetZoom,
    zoomToGeometry,
  ]);

  // User opens push a history entry; automatic opens/closes pass replace: true
  // so Back skips steps the user never took. fromList lets
  // returnToDatasetList go back to that list entry instead of stacking a new one.
  // Going from one dataset to another (the list beside the page) takes over
  // the open one's entry and its fromList, so one Back still reaches the list.
  const setInspectDataset = useCallback(
    (dataset, { replace = false } = {}) => {
      const switching = Boolean(dataset) && !onListRef.current;
      setSearchParams(
        (previous) => {
          // The open record and its plot params belong to the previous
          // dataset's columns, so they never carry over.
          const next = withoutPreviewParams(previous);
          // A different dataset opens on its metadata, not on the tab left open.
          next.delete(TAB_PARAM);
          const key = datasetUrlKey(dataset);
          if (key) {
            next.set("dataset", key.dataset);
            if (key.server) next.set("server", key.server);
            else next.delete("server");
          } else {
            next.delete("dataset");
            next.delete("server");
          }
          return next;
        },
        switching
          ? { replace: true, state: { fromList: fromListRef.current } }
          : { replace, state: { fromList: !replace && onListRef.current } },
      );
    },
    [setSearchParams],
  );

  const inspectRecordID = searchParams.get(RECORD_PARAM) || undefined;
  const periodParam = searchParams.get(PERIOD_PARAM) || undefined;
  const inspectRecordPeriod = useMemo(
    () => parsePeriod(periodParam),
    [periodParam],
  );

  // Closing drops the plot params in the SAME write: react-router hands a
  // functional updater the params from the last render, so two calls in one
  // tick would lose one of them.
  const setInspectRecordID = useCallback(
    (recordId, { replace = false, period } = {}) => {
      // Set before navigating so the modal never renders "no data" in the
      // frame before the fetch starts.
      if (recordId) setRecordLoading(true);
      setSearchParams(
        (previous) => {
          if (!recordId) return withoutPreviewParams(previous);
          const next = new URLSearchParams(previous);
          next.set(RECORD_PARAM, recordId);
          // A profile id belongs to the record it came from: carrying one to
          // the next station names a cast that station never took, and
          // /preview answers NO_DATA for it.
          next.delete(STEP_PARAM);
          if (period) next.set(PERIOD_PARAM, `${period.start}~${period.end}`);
          else next.delete(PERIOD_PARAM);
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  // Back to the list entry the page was opened from when there is one, so
  // browser Back afterwards doesn't reopen it; otherwise close in place.
  // Deliberately leaves the datasets filter alone.
  const returnToDatasetList = useCallback(() => {
    if (location.state?.fromList) navigate(-1);
    else setInspectDataset(undefined, { replace: true });
    setSelectedTrajectory();
  }, [location.state, navigate, setInspectDataset]);

  // Both writes in one call so React batches them, which stops the
  // [inspectDataset] effect below from clearing the selection just made.
  const selectTrajectoryFromMap = useCallback(
    (datasetPk, trajectoryId, datasetTitle, area) => {
      // Not a toggle: track-lines stays hit-testable under the selected track,
      // so a toggle would clear it on any click along it (e.g. reading a fix
      // tooltip). Re-clicking only moves the clicked area.
      if (
        selectedTrajectory?.datasetPk === datasetPk &&
        selectedTrajectory?.trajectoryId === trajectoryId
      ) {
        if (area) setSelectedTrajectory((prev) => ({ ...prev, area }));
        return;
      }

      // Tracks tiles apply only dataset-level filters, so they can carry a
      // dataset pointQuery dropped; draw its track anyway and leave the URL
      // alone. Never setInspectDataset(undefined) here: it would close the open
      // page and take the new selection with it.
      const dataset = pointsData.find((row) => row.pk === datasetPk);
      // Skipped when already open, so repeat clicks don't each push history.
      if (
        dataset &&
        inspectDataset?.pk !== datasetPk &&
        datasetUrlKey(dataset)
      ) {
        setInspectDataset(dataset);
      }

      // No frameView: the user clicked the track where it is drawn, so framing
      // the whole voyage would pull them away from it.
      setSelectedTrajectory({
        datasetPk,
        datasetTitle: dataset?.title || datasetTitle,
        trajectoryId,
        // Resolved by the dataset page to the clicked hex (useTrajectoryPasses).
        area,
      });
    },
    [pointsData, inspectDataset, selectedTrajectory, setInspectDataset],
  );

  // Adds to the download selection, deliberately NOT the datasets filter: a
  // narrowed list leaves nothing else to pick on the next map click. Griddap
  // datasets never enter pointsToReview, so they're skipped here too.
  const addDatasetsToSelection = useCallback(
    (pks) => {
      const wanted = new Set(pks.map(Number));
      if (wanted.size === 0) return;
      setShortlist((previous) => {
        let changed = false;
        const existingPks = new Set(previous.map((entry) => Number(entry.pk)));
        const next = previous.map((entry) => {
          if (!wanted.has(Number(entry.pk)) || entry.selected) return entry;
          changed = true;
          return { ...entry, selected: true };
        });

        for (const row of pointsData) {
          const pk = Number(row.pk);
          if (
            wanted.has(pk) &&
            !existingPks.has(pk) &&
            row.cdm_data_type !== "Grid"
          ) {
            next.push({ pk: row.pk, row, selected: true, inResults: true });
            existingPks.add(pk);
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    },
    [pointsData],
  );

  useEffect(() => {
    if (isEmpty(pointsToReview)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing effect; converting to render-phase adjustment is a behaviour change, tracked separately
      setPointsToDownload();
    }
  }, [pointsToReview]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing effect; converting to render-phase adjustment is a behaviour change, tracked separately
    setSelectionLoading(false);
    // A single remaining result deliberately does NOT auto-open its page:
    // opening one is always an explicit act.
    if (
      !isEmpty(pointsData) &&
      searchParams.get("dataset") &&
      !inspectDataset
    ) {
      // The URL names a dataset never among the results: clear the dead params.
      setSearchParams(
        (previous) => {
          const next = withoutPreviewParams(previous);
          next.delete("dataset");
          next.delete("server");
          return next;
        },
        { replace: true },
      );
    }
  }, [pointsData, searchParams, inspectDataset, setSearchParams]);

  useEffect(() => {
    const resultByPk = new Map(pointsData.map((row) => [row.pk, row]));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShortlist((previous) => {
      let changed = false;
      const next = previous.map((entry) => {
        const row = resultByPk.get(entry.pk);
        if (row) {
          if (entry.row === row && entry.inResults) return entry;
          changed = true;
          return { ...entry, row, inResults: true };
        }
        if (!entry.inResults) return entry;
        changed = true;
        return { ...entry, inResults: false };
      });
      return changed ? next : previous;
    });
  }, [pointsData]);

  // Waits for the catalog so filters are hydrated from the URL first, but not
  // for a non-empty EOV list: OBIS datasets carry no EOVs, so an OBIS-only
  // database would never query. catalogLoaded resolves even when fetches fail.
  useEffect(() => {
    if (catalogLoaded) {
      const filtersQuery = createDataFilterQueryString(query);
      let shapeQuery = [];
      if (polygon) {
        shapeQuery = createSelectionQueryString(polygon);
      }
      const combinedQueries = [filtersQuery, shapeQuery]
        .filter((e) => e)
        .join("&");
      // An open dataset page survives a filter change; it closes only if the
      // new results exclude it (see the pointsData effect).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing effect; converting to render-phase adjustment is a behaviour change, tracked separately
      setSelectionLoading(true);
      setCombinedQueries(combinedQueries);
      const urlString = `${server}/pointQuery${
        combinedQueries ? "?" + combinedQueries : ""
      }`;
      const controller = new AbortController();
      let current = true;

      async function loadPoints() {
        try {
          const response = await fetch(urlString, {
            signal: controller.signal,
          });
          if (!current) return;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          // Aborting a fetch after its response arrived does not necessarily
          // cancel response.json(), so check again before publishing it.
          if (!current) return;
          setPointsData(
            data.map((point) => datasetInLanguage(point, languageRef.current)),
          );
          setPointsError(false);
          setInitialPointsQueryComplete(true);
        } catch (error) {
          if (!current || error.name === "AbortError") return;
          reportError("pointQuery failed", error);
          setPointsData([]);
          setPointsError(true);
          setInitialPointsQueryComplete(true);
        }
      }

      loadPoints();
      return () => {
        current = false;
        controller.abort();
      };
    }
  }, [query, polygon, catalogLoaded, pointsAttempt]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPointsData((previous) =>
      previous.map((point) => datasetInLanguage(point, i18n.language)),
    );
    setShortlist((previous) =>
      previous.map((entry) => ({
        ...entry,
        row: datasetInLanguage(entry.row, i18n.language),
      })),
    );
  }, [i18n.language]);

  function handleSelectDataset(point) {
    // Griddap data access is on ERDDAP directly.
    if (point.cdm_data_type === "Grid") return;
    setShortlist((previous) => {
      const index = previous.findIndex((entry) => entry.pk === point.pk);
      if (index === -1) {
        return [
          ...previous,
          { pk: point.pk, row: point, selected: true, inResults: true },
        ];
      }
      return previous.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry;
        return { ...entry, selected: !entry.selected };
      });
    });
  }

  // Functional update on purpose: GriddapDetails auto-shows the overlay from a
  // child effect that runs first, so this render's closure value is stale.
  useEffect(() => {
    setActiveWmsOverlay((current) =>
      current && current.pk !== inspectDataset?.pk ? undefined : current,
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing effect; converting to render-phase adjustment is a behaviour change, tracked separately
    setSelectedTrajectory((current) =>
      current && current.datasetPk !== inspectDataset?.pk ? undefined : current,
    );
    setHighlightedRecord((current) =>
      current && current.datasetPk !== inspectDataset?.pk ? undefined : current,
    );
    setMappedRecord((current) =>
      current && current.datasetPk !== inspectDataset?.pk ? undefined : current,
    );
  }, [inspectDataset, setActiveWmsOverlay]);

  // Declared after the effect above so it runs second on the render where the
  // page resolves, and its highlight isn't the one that effect clears.
  useEffect(() => {
    if (!pendingHighlight || !inspectDataset) return;
    const { record, track, onMap } = pendingHighlight;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing effect; converting to render-phase adjustment is a behaviour change, tracked separately
    setPendingHighlight(undefined);
    if (record !== undefined) {
      setHighlightedRecord({ datasetPk: inspectDataset.pk, profileId: record });
    }
    // No frameView: the link carries its own camera.
    if (track !== undefined) {
      setSelectedTrajectory({
        datasetPk: inspectDataset.pk,
        datasetTitle: inspectDataset.title,
        trajectoryId: track,
      });
    }
    if (onMap !== undefined) {
      setMappedRecord({ datasetPk: inspectDataset.pk, recordId: onMap });
    }
  }, [pendingHighlight, inspectDataset]);

  // Keyed on dataset_id, not inspectDataset: pointsData is re-mapped on every
  // language change and fresh identities would refetch payloads up to 59 MB.
  // A record left with no dataset is cleaned up by setInspectDataset, not here,
  // or a cold shared link would lose its record before its dataset loads.
  const inspectDatasetId = inspectDataset?.dataset_id;
  // Which profile INSIDE the record is drawn, and whether the colour plot wants
  // every profile in the window instead. Read here rather than in
  // usePreviewPlotParams: they change what is fetched, not how the rows are
  // drawn, so they ride this fetch instead of a second one — one request, one
  // previewError, one recordLoading.
  const inspectAllProfiles =
    searchParams.get(LAYOUT_PARAM) === COLOR_LAYOUT &&
    hasColorPlotFor(inspectDataset);
  const inspectRecordStep = inspectAllProfiles
    ? undefined
    : searchParams.get(STEP_PARAM) || undefined;

  useEffect(() => {
    if (!inspectDatasetId || !inspectRecordID) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing effect; converting to render-phase adjustment is a behaviour change, tracked separately
    setRecordLoading(true);
    const previewUrl =
      `${server}/preview?dataset=${encodeURIComponent(inspectDatasetId)}` +
      `&profile=${encodeURIComponent(inspectRecordID)}` +
      (inspectRecordStep
        ? `&at=${encodeURIComponent(inspectRecordStep)}`
        : "") +
      (inspectAllProfiles ? "&allProfiles=true" : "") +
      (inspectRecordPeriod
        ? `&timeMin=${inspectRecordPeriod.start}T00:00:00Z&timeMax=${inspectRecordPeriod.end}T23:59:59Z`
        : "");
    fetch(previewUrl)
      .then((response) => {
        if (response.ok) {
          return response.json().then((preview) => ({ preview }));
        }
        // /preview says WHY it refused — four codes — and the modal has a
        // sentence for each. The body is read here rather than discarded: a
        // failure with no reason is the one thing the modal cannot explain.
        // Anything that is not JSON (a proxy's HTML 502) reads as no body,
        // which previewErrorFrom answers from the status alone.
        return response
          .json()
          .catch(() => null)
          .then((body) => ({
            previewError: previewErrorFrom(response.status, body),
          }));
      })
      .catch((error) => {
        reportError("preview fetch failed", error);
        return { previewError: networkPreviewError() };
      })
      .then(({ preview, previewError: failure }) => {
        // Cleared together, always: a failure that left the previous record's
        // rows in state showed them under the new record's title.
        setDatasetPreview(preview);
        setPreviewError(failure);
        setRecordLoading(false);
        if (failure && failure.code === PREVIEW_ERROR.ERDDAP_UNAVAILABLE) {
          // An outage is worth reporting; an empty or unknown record is not.
          reportError("preview upstream failure", new Error(previewUrl));
        }
      });
  }, [
    inspectRecordID,
    inspectDatasetId,
    inspectRecordStep,
    inspectAllProfiles,
    inspectRecordPeriod,
  ]);

  const value = {
    polygon,
    setPolygon,
    areaPlace,
    setAreaPlace,
    pointsToReview,
    pointsToDownload,
    setPointsToDownload,
    hoveredDataset,
    setHoveredDataset,
    selectedTrajectory,
    setSelectedTrajectory,
    selectTrajectoryFromMap,
    highlightedRecord,
    setHighlightedRecord,
    mappedRecord,
    setMappedRecord,
    pointsData,
    inspectDataset,
    inspectDatasetExcluded,
    setInspectDataset,
    returnToDatasetList,
    addDatasetsToSelection,
    selectedPks,
    selectionLoading,
    initialPointsQueryComplete,
    pointsError,
    retryPointQuery,
    inspectRecordID,
    inspectRecordPeriod,
    setInspectRecordID,
    // Both halves deliberately: recordLoading is seeded true by a shared link,
    // so ORing it would leave an empty modal open forever if the link's
    // dataset never resolves.
    showPreviewModal: Boolean(inspectDataset && inspectRecordID),
    previewError,
    recordLoading,
    setRecordLoading,
    datasetPreview,
    setDatasetPreview,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    filteredDatasets,
    filteredDatasetPks,
    platformsAvailable,
    datasetsInViewPks,
    inViewCount,
    realtimeCount,
    onlyInView,
    setOnlyInView,
    groupBy,
    setGroupBy,
    combinedQueries,
    handleSelectDataset,
  };

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}
