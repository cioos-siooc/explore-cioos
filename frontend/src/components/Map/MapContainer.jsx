import * as React from 'react'

import Map from './Map.jsx'
import { server } from '../../config'
import fetchJson from '../../state/fetchJson.js'
import reportError from '../../state/reportError.js'
import { useFilters } from '../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../state/selection/SelectionProvider.jsx'

// Single adapter between the state providers and the imperative Map
// component — Map.js keeps its prop-based interface untouched.
export default function MapContainer () {
  const { setDatasetsSelected } = useFilters()
  const {
    mapQueryString,
    setLoading,
    reportFirstPaint,
    setLoadingLayers,
    setMapView,
    rangeLevels,
    coverageRangeLevels,
    setViewportHexRange,
    griddapCoverageVisible,
    griddapCoverage,
    dataLayersVisible,
    bathymetryVisible,
    activeWmsOverlay,
    projection,
    zoomTarget,
    drawRequest,
    mapRef,
    featureQuery,
    setFeatureQuery,
    tracksMode,
    debouncedScrubTime,
    trailingDays,
    dataLayers
  } = useMapState()
  const {
    polygon,
    setPolygon,
    hoveredDataset,
    setHoveredDataset,
    inspectDataset,
    setInspectDataset,
    setHighlightedRecord,
    setInspectRecordID,
    setShowPreviewModal,
    returnToDatasetList,
    selectedTrajectory,
    selectTrajectoryFromMap,
    pointsData,
    combinedQueries
  } = useSelection()

  // The generic click path (a hex, a coverage cell, a track, a grid, or a
  // cluster of markers too ambiguous for onMarkerClick below) reports what it
  // found through featureQuery, which the datasets list reads to sort and
  // outline the matching rows (DatasetsTable's pinnedPks) — an answer only
  // the list can give. A dataset page left open from an earlier click would
  // otherwise sit there unrelated to this one, so back out to the list first
  // whenever the click actually found something. Gated on a page actually
  // being open: returnToDatasetList still pushes a (no-op) navigation entry
  // even when there's nothing to leave, and firing it on every hex click
  // while the list is already showing would spam browser history for
  // nothing.
  const handleFeatureQuery = (query) => {
    if (query && inspectDataset) returnToDatasetList()
    setFeatureQuery(query)
  }

  // A click that landed on exactly one marker naming exactly one dataset (see
  // Map.jsx's handleMapClick) — unambiguous enough to skip the "what's here"
  // card and open the dataset page directly, with the record it named pointed
  // out in the record list rather than jumped into (the preview is one more
  // click away — see highlightedRecord). Opens the dataset page immediately
  // (the marker is necessarily one of the current results, since the map only
  // draws what pointsData holds), then resolves the exact timeseries_id/
  // profile_id at that point: 'points' tile features are grouped by point_pk
  // (the shared location), not by individual record, so a station sampled
  // more than once needs this extra lookup to know which one record the
  // marker actually meant. /datasetRecordsList already supports narrowing to
  // one point via pointPKs — reused here rather than adding a new endpoint.
  // Only a single matching record gets highlighted; more than one is
  // genuinely ambiguous and is left for the record list itself to browse.
  const onMarkerClick = async (datasetPk, pointPk) => {
    const row = pointsData.find((point) => Number(point.pk) === datasetPk)
    if (!row) return
    // A second marker click resets the page for the new one rather than
    // stacking on top of whatever the previous click left behind: any
    // preview the user opened from it closes (it would otherwise show a
    // stale record over a table that has already moved on to a different
    // station), any record it had highlighted is cleared (reset here rather
    // than left to the dataset-change effect, which is a no-op when the new
    // marker belongs to the SAME dataset as the last one), and the
    // navigation entry is replaced rather than pushed, so browsing several
    // stations by clicking around the map doesn't turn "Back" into a
    // step-by-step replay of every marker visited.
    setShowPreviewModal(false)
    setInspectRecordID(undefined)
    setHighlightedRecord(undefined)
    setInspectDataset(row, { replace: true })
    try {
      const params = new URLSearchParams(combinedQueries)
      params.set('datasetPKs', datasetPk)
      params.set('pointPKs', pointPk)
      const record = await fetchJson(
        `${server}/datasetRecordsList?${params.toString()}`
      )
      const profiles = record?.profiles || []
      if (profiles.length === 1) {
        setHighlightedRecord({ datasetPk, profileId: profiles[0].profile_id })
      }
    } catch (error) {
      reportError('datasetRecordsList fetch failed', error)
    }
  }

  // A click that landed on exactly one track (see Map.jsx's handleMapClick) is
  // handed to selectTrajectoryFromMap below — onTrackClick is to a track what
  // onMarkerClick is to a marker, and it ends where the "what's here" card's
  // track row already did: that dataset's page open, the platform's full
  // history drawn on the map, and its row pinned in the page's platform list.

  return (
    <Map
      polygon={polygon}
      setPolygon={setPolygon}
      setLoading={setLoading}
      setLoadingLayers={setLoadingLayers}
      mapQueryString={mapQueryString}
      setMapView={setMapView}
      rangeLevels={rangeLevels}
      coverageRangeLevels={coverageRangeLevels}
      onViewportHexRange={setViewportHexRange}
      onFeatureQuery={handleFeatureQuery}
      featureQuery={featureQuery}
      onMarkerClick={onMarkerClick}
      onTrackClick={selectTrajectoryFromMap}
      setHoveredDataset={setHoveredDataset}
      hoveredDataset={hoveredDataset}
      inspectDataset={inspectDataset}
      setDatasetsSelected={setDatasetsSelected}
      tracksMode={tracksMode}
      scrubTime={debouncedScrubTime}
      trailingDays={trailingDays}
      selectedTrajectory={selectedTrajectory}
      dataLayers={dataLayers}
      griddapCoverage={griddapCoverageVisible ? griddapCoverage : null}
      dataLayersVisible={dataLayersVisible}
      bathymetryVisible={bathymetryVisible}
      activeWmsOverlay={activeWmsOverlay}
      projection={projection}
      zoomTarget={zoomTarget}
      drawRequest={drawRequest}
      mapRef={mapRef}
      onFirstPaint={reportFirstPaint}
    />
  )
}
