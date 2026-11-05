import * as React from "react";

import DrawHint from "./DrawHint/DrawHint.jsx";
import Map from "./Map.jsx";
import Spinner from "../ui/Spinner.jsx";
import { server } from "../../config";
import fetchJson from "../../state/fetchJson.js";
import reportError from "../../state/reportError.js";
import { useMapState, useMapView } from "../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../state/selection/SelectionProvider.jsx";

// Map.jsx's WATCHED_MAP_LAYERS ids that draw data rather than basemap.
const DATA_LAYER_IDS = ["observations", "tracks", "griddap", "wmsOverlay"];

export default function MapContainer() {
  const {
    mapQueryString,
    rangeLevels,
    coverageRangeLevels,
    griddapCoverageVisible,
    griddapCoverage,
    dataLayersVisible,
    bathymetryVisible,
    bathymetryPalette,
    activeWmsOverlay,
    projection,
    zoomTarget,
    drawRequest,
    featureQueryRequest,
    mapInstance,
    setMapInstance,
    readDepthAt,
    depthReading,
    depthToolActive,
    setDepthToolActive,
    featureQuery,
    setFeatureQuery,
    sharedFeatureQueryAt,
    tracksMode,
    debouncedScrubTime,
    trailingDays,
    dataLayers,
  } = useMapState();
  const {
    setLoading,
    reportFirstPaint,
    setLoadingLayers,
    mapView,
    loadingLayers,
    firstPaintPending,
    setMapView,
    setViewportHexRange,
  } = useMapView();
  const {
    polygon,
    setPolygon,
    hoveredDataset,
    setHoveredDataset,
    inspectDataset,
    setInspectDataset,
    setHighlightedRecord,
    setInspectRecordID,
    selectedTrajectory,
    setSelectedTrajectory,
    selectTrajectoryFromMap,
    mappedRecord,
    pointsData,
    combinedQueries,
  } = useSelection();

  // Basemap layers still arriving don't count; the splash covers the first
  // load.
  const dataLoading =
    !firstPaintPending &&
    loadingLayers.some((id) => DATA_LAYER_IDS.includes(id));

  // While a dataset is open the card hides itself, but the click still names
  // the area its record list pins trajectories by, so it is recorded.
  const handleFeatureQuery = (query) => {
    // The newest click names the area, so it replaces a track click's.
    if (selectedTrajectory?.area) {
      setSelectedTrajectory((prev) => prev && { ...prev, area: undefined });
    }
    setFeatureQuery(query);
  };

  // 'points' tile features are grouped by point_pk (location), not by record,
  // so the record a marker meant is resolved afterwards; only a single match is
  // highlighted.
  const onMarkerClick = async (datasetPk, pointPk, highlightQuery) => {
    const row = pointsData.find((point) => Number(point.pk) === datasetPk);
    if (!row) return;
    // Cleared here because the dataset-change effect is a no-op when the new
    // marker is in the same dataset; history is replaced so Back doesn't replay
    // every marker visited. Clearing inspectRecordID also closes the preview.
    setInspectRecordID(undefined);
    setHighlightedRecord(undefined);
    setInspectDataset(row, { replace: true });
    setFeatureQuery(highlightQuery);
    try {
      const params = new URLSearchParams(combinedQueries);
      params.set("datasetPKs", datasetPk);
      params.set("pointPKs", pointPk);
      const record = await fetchJson(
        `${server}/datasetRecordsList?${params.toString()}`,
      );
      const profiles = record?.profiles || [];
      if (profiles.length === 1) {
        setHighlightedRecord({ datasetPk, profileId: profiles[0].profile_id });
      }
    } catch (error) {
      reportError("datasetRecordsList fetch failed", error);
    }
  };

  return (
    <>
      <Map
        polygon={polygon}
        setPolygon={setPolygon}
        setLoading={setLoading}
        setLoadingLayers={setLoadingLayers}
        mapQueryString={mapQueryString}
        initialView={mapView}
        setMapView={setMapView}
        rangeLevels={rangeLevels}
        coverageRangeLevels={coverageRangeLevels}
        onViewportHexRange={setViewportHexRange}
        onFeatureQuery={handleFeatureQuery}
        featureQuery={featureQuery}
        sharedFeatureQueryAt={sharedFeatureQueryAt}
        onMarkerClick={onMarkerClick}
        onTrackClick={selectTrajectoryFromMap}
        onDepthQuery={readDepthAt}
        depthReading={depthReading}
        depthToolActive={depthToolActive}
        onDepthToolExit={() => setDepthToolActive(false)}
        setHoveredDataset={setHoveredDataset}
        hoveredDataset={hoveredDataset}
        inspectDataset={inspectDataset}
        tracksMode={tracksMode}
        scrubTime={debouncedScrubTime}
        trailingDays={trailingDays}
        selectedTrajectory={selectedTrajectory}
        mappedRecord={mappedRecord}
        dataLayers={dataLayers}
        griddapCoverage={griddapCoverageVisible ? griddapCoverage : null}
        dataLayersVisible={dataLayersVisible}
        bathymetryVisible={bathymetryVisible}
        bathymetryPalette={bathymetryPalette}
        activeWmsOverlay={activeWmsOverlay}
        projection={projection}
        zoomTarget={zoomTarget}
        drawRequest={drawRequest}
        featureQueryRequest={featureQueryRequest}
        onMapReady={setMapInstance}
        onFirstPaint={reportFirstPaint}
      />
      <DrawHint map={mapInstance} />
      {/* The bottom activity panel names what is loading; this is the mark
          over the map itself, where the eye is. */}
      {dataLoading && (
        <div
          className="mapLoadingSpinner cioosSpinnerDisc"
          data-testid="map-loading-spinner"
        >
          <Spinner size="lg" role="presentation" />
        </div>
      )}
    </>
  );
}
