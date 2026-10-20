import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useChanged } from "../../utilities.jsx";

import MapContainer from "../Map/MapContainer.jsx";
import FeatureCard from "../Map/FeatureCard/FeatureCard.jsx";
import ApiErrorBanner from "./ApiErrorBanner.jsx";
import ActivityIndicator from "./ActivityIndicator.jsx";
import Sidebar from "./Sidebar/Sidebar.jsx";
import TopControls from "./TopControls/TopControls.jsx";
import FiltersModal from "./Modals/FiltersModal.jsx";
import DownloadModal from "./Modals/DownloadModal.jsx";
import CoverageModal from "./Modals/CoverageModal.jsx";
import SelectionHelpModal from "./Modals/SelectionHelpModal.jsx";
import PrivacyModal from "./Modals/PrivacyModal.jsx";
import PreviewHost from "./Panels/PreviewHost.jsx";
import Loading from "../Controls/Loading/Loading.jsx";
import Legend from "../Controls/Legend/Legend.jsx";
import { DatasetMapCorner } from "./DatasetMapCard/DatasetMapCard.jsx";
import DepthBar from "../Controls/DepthBar/DepthBar.jsx";
import TimeBar from "../Controls/TimeBar/TimeBar.jsx";
import IntroModal from "../Controls/IntroModal/IntroModal.jsx";
import TipCard from "../Controls/Tips/TipCard.jsx";
import { useFilters } from "../../state/filters/FilterProvider.jsx";
import { useMapState, useMapView } from "../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../state/ui/UIProvider.jsx";
import "./styles.css";

// The splash and legend follow the camera, so they subscribe to it here rather
// than re-rendering the whole shell on every move.
function Splash() {
  const { firstPaintPending } = useMapView();
  const [splashMounted, setSplashMounted] = useState(firstPaintPending);

  // Lowered by the splash itself once faded. Keyed on the condition rather
  // than assuming it runs once, in case a later wait earns a splash too.
  if (useChanged(firstPaintPending) && firstPaintPending)
    setSplashMounted(true);

  // Later redraws are reported by the brand logo's mark instead. The splash
  // itself says when its fade is done, so the map and chrome arrive together
  // (see Loading).
  return (
    splashMounted && (
      <Loading
        dismissed={!firstPaintPending}
        onDismissed={() => setSplashMounted(false)}
      />
    )
  );
}

function CameraLegend(props) {
  const { zoom, currentRangeLevel, hexRangeLevel, hexRangeScaledToView } =
    useMapView();
  return (
    <Legend
      {...props}
      zoom={zoom}
      currentRangeLevel={currentRangeLevel}
      hexRangeLevel={hexRangeLevel}
      hexRangeScaledToView={hexRangeScaledToView}
    />
  );
}

export default function AppShell() {
  const { t } = useTranslation();
  const {
    legendLoading,
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    bathymetryVisible,
    setBathymetryVisible,
    tracksMode,
    toggleTrackLines,
    dataLayers,
  } = useMapState();
  const { startDate, endDate, timeFilterActive } = useFilters();
  const { showIntroModal, setShowIntroModal } = useUI();
  const { platformsAvailable } = useSelection();

  // Each turns off exactly what one legend entry describes, so it rides on
  // that entry. Display only: none of them touches the geometry filter.
  const legendControls = {
    observations: {
      key: "observations",
      label: t("layersObservations"),
      checked: dataLayersVisible,
      onChange: () => setDataLayersVisible(!dataLayersVisible),
    },
    bathymetry: {
      key: "bathymetry",
      label: t("layersBathymetry"),
      checked: bathymetryVisible,
      onChange: () => setBathymetryVisible(!bathymetryVisible),
    },
    tracks: {
      key: "tracks",
      label: t("layerTracksMode"),
      checked: tracksMode,
      onChange: toggleTrackLines,
    },
  };

  // Switches with no legend entry of their own.
  const layerControls = [
    {
      key: "griddap",
      label: t("layersGriddedCoverage"),
      checked: griddapCoverageVisible,
      onChange: () => setGriddapCoverageVisible(!griddapCoverageVisible),
    },
  ];

  return (
    <>
      <Splash />
      {/* Mounted immediately rather than waiting for /legend, the heaviest
          query; Map's setColorStops applies the ramp once ranges arrive. */}
      <MapContainer />
      {/* Directly after the map: it is anchored to the canvas, and the rest
          of the chrome outranks it. */}
      <FeatureCard />
      <DatasetMapCorner />
      <ApiErrorBanner />
      <ActivityIndicator />
      <Sidebar />
      <TopControls />
      <TipCard />
      <FiltersModal />
      <DownloadModal />
      <CoverageModal />
      <SelectionHelpModal />
      <CameraLegend
        loading={legendLoading}
        platformsAvailable={platformsAvailable}
        controls={legendControls}
        layerControls={layerControls}
        dataLayers={dataLayers}
        startDate={startDate}
        endDate={endDate}
        timeFilterActive={timeFilterActive}
      />
      <TimeBar />
      <DepthBar />
      <IntroModal showModal={showIntroModal} setShowModal={setShowIntroModal} />
      {/* After the intro and the download window, both of which link to it. */}
      <PrivacyModal />
      <PreviewHost />
    </>
  );
}
