import { useState, useEffect } from "react";
import {
  useLocation,
  useNavigate,
  useNavigationType,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  createDataFilterQueryString,
  createSelectionQueryString,
} from "../utilities.jsx";
import { wmsSliceParams } from "../wmsUtilities.js";
import { anyTrajectoryLayerOn, chosenDataLayerKeys } from "./dataLayers.js";
import { GROUP_NONE } from "./datasetGroups.js";
import {
  PERIOD_PARAM,
  PLOT_PARAMS,
  RECORD_PARAM,
  TAB_PARAM,
} from "./selection/previewParams.js";
import { defaultTrailingDays } from "../components/config.js";
import { useFilters } from "./filters/FilterProvider.jsx";
import { useMapState } from "./map/MapStateProvider.jsx";
import { useSelection } from "./selection/SelectionProvider.jsx";
import { useUI } from "./ui/UIProvider.jsx";

// Sole owner of the URL format; reading it back happens where each state lives,
// from the opening address. It rebuilds the whole search string on every pan,
// so params owned elsewhere (SelectionProvider, usePreviewPlotParams) must be
// listed here or they vanish when the map moves.
const PRESERVED_PARAMS = [
  "server",
  TAB_PARAM,
  RECORD_PARAM,
  PERIOD_PARAM,
  ...PLOT_PARAMS,
];

export default function UrlSync() {
  const [searchParams] = useSearchParams();
  const { i18n } = useTranslation();
  // No ?lang= means the user's stored choice (already resolved by i18n), not
  // English.
  const lang = searchParams.get("lang") || i18n.resolvedLanguage;
  const dataset = searchParams.get("dataset");
  const navigate = useNavigate();
  const location = useLocation();
  // Back/Forward land on an address written when that entry was left — before
  // the filters changed inside a sheet that Back has just closed, say — so a
  // pop is rewritten from the current state like any change to it. Held until
  // the next pop: the replace that ends one (the page load counts as a pop)
  // must not rewrite too, or it drops a param its writer just set.
  const navigationType = useNavigationType();
  const [poppedTo, setPoppedTo] = useState(location.key);
  if (navigationType === "POP" && location.key !== poppedTo) {
    setPoppedTo(location.key);
  }

  const { query } = useFilters();
  const {
    mapView,
    tracksMode,
    scrubTime,
    debouncedScrubTime,
    trailingDays,
    dataLayers,
    dataLayerChoices,
    dataLayersVisible,
    bathymetryVisible,
    griddapCoverageVisible,
    projection,
    activeWmsOverlay,
    featureQuery,
  } = useMapState();
  const {
    polygon,
    datasetTitleSearchText,
    onlyInView,
    groupBy,
    highlightedRecord,
    selectedTrajectory,
    mappedRecord,
  } = useSelection();
  const { coverageAxis, taxonomyView } = useUI();
  const [isPageLoad, setIsPageLoad] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsPageLoad(false);
    if (isPageLoad) return;
    const filterParams = new URLSearchParams(
      createDataFilterQueryString(query),
    );
    // Rectangle or coordinate ring; the API takes either (see /pointQuery).
    const selectionParams = new URLSearchParams(
      polygon ? createSelectionQueryString(polygon) : "",
    );
    const obj = {
      ...mapView,
      ...Object.fromEntries(filterParams),
      ...Object.fromEntries(selectionParams),
      lang,
      ...(datasetTitleSearchText ? { search: datasetTitleSearchText } : {}),
      ...(onlyInView ? { onlyInView: "true" } : {}),
      ...(groupBy && groupBy !== GROUP_NONE ? { groupBy } : {}),
      ...(dataset ? { dataset } : {}),
      // Carried through only while a dataset is open, so they don't linger as
      // stale keys for a closed page.
      ...(dataset
        ? Object.fromEntries(
            PRESERVED_PARAMS.map((param) => [
              param,
              searchParams.get(param),
            ]).filter(([, value]) => value !== null),
          )
        : {}),
      // Derived from state and likewise keyed to ?dataset=. These are the
      // HIGHLIGHT, distinct from ?preview=: they point a row out without
      // opening its plot.
      ...(activeWmsOverlay ? wmsSliceParams(activeWmsOverlay) : {}),
      ...(highlightedRecord ? { record: highlightedRecord.profileId } : {}),
      ...(selectedTrajectory ? { track: selectedTrajectory.trajectoryId } : {}),
      ...(mappedRecord ? { onMap: mappedRecord.recordId } : {}),
      // Map re-asks the question on load. Six decimals (~0.1 m) is past what
      // the hit-test can distinguish.
      ...(featureQuery
        ? { at: featureQuery.lngLat.map((n) => Number(n.toFixed(6))).join(",") }
        : {}),
    };
    // Only meaningful while a trajectory geometry is on; defaults on, so
    // 'tracks=false' is what needs saying.
    if (anyTrajectoryLayerOn(dataLayers) && !tracksMode) {
      obj.tracks = "false";
    }
    if (tracksMode && anyTrajectoryLayerOn(dataLayers)) {
      obj.scrubTime = scrubTime;
      if (trailingDays !== defaultTrailingDays) obj.trail = trailingDays;
    }
    const layersChosen = (choice) =>
      chosenDataLayerKeys(dataLayerChoices)
        .filter((key) => dataLayerChoices[key] === choice)
        .join(",");
    if (layersChosen("include")) obj.layers = layersChosen("include");
    if (layersChosen("exclude")) obj.excludeLayers = layersChosen("exclude");
    // Only non-default states, so an untouched map keeps its short link.
    if (!dataLayersVisible) obj.obs = "false";
    if (!bathymetryVisible) obj.bathy = "false";
    if (griddapCoverageVisible) obj.griddap = "true";
    if (projection === "globe") obj.globe = "true";
    if (coverageAxis !== "timeline") obj.coverageAxis = coverageAxis;
    if (taxonomyView !== "sunburst") obj.taxonomy = taxonomyView;
    const combined = new URLSearchParams(obj);
    // Replace, never push: an entry per pan would bury the entries that mean
    // something, and the entry's state rides along for back-to-list.
    navigate("?" + combined.toString(), {
      replace: true,
      state: location.state,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    query,
    mapView,
    polygon,
    datasetTitleSearchText,
    onlyInView,
    groupBy,
    tracksMode,
    debouncedScrubTime,
    trailingDays,
    dataLayers,
    dataLayerChoices,
    dataLayersVisible,
    bathymetryVisible,
    griddapCoverageVisible,
    projection,
    activeWmsOverlay,
    featureQuery,
    highlightedRecord,
    selectedTrajectory,
    mappedRecord,
    coverageAxis,
    taxonomyView,
    dataset,
    poppedTo,
  ]);

  // `i18n` deliberately excluded: `lang` can still read last render's
  // resolvedLanguage on the render a changeLanguage() commits, and re-running
  // on it would switch the language straight back (FilterProvider.test.jsx's
  // language-switch case).
  useEffect(() => {
    if (lang !== i18n.language) {
      i18n.changeLanguage(lang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  return null;
}
