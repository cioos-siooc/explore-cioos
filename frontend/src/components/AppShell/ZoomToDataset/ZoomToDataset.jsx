import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { ZoomIn } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { boundsAreFramed, boundsFromGeoJson } from '../../../utilities.jsx'

// Framing the map on the open dataset's footprint. The map never does this on
// its own — opening a dataset page only highlights that dataset among the rest
// (see hoverHighlightPoints in Map.jsx), it doesn't move the camera — so this
// is the one place the camera is asked to travel, from the button below or
// from a double-click on the dataset's title (DatasetInspector).
//
// The button renders into the dataset page's title bar and is styled there,
// alongside the filter action it sits with (see DatasetInspector/styles.css).
//
// filtered_bbox_geojson is the extent of the features the current filters
// actually matched, so the framing follows the filters — narrowing the time
// range or drawing a polygon reframes to what's left. Grids have no features,
// so theirs is the coverage bbox (see shapeQuery.js).
//
// `framed` is true once the map already shows that extent: there is nothing
// left to do, and the button hides itself rather than sit there inviting a
// no-op click. Panning or zooming away brings it back.
export function useZoomToDataset () {
  const { inspectDataset } = useSelection()
  const { zoomToGeometry, mapRef, mapView } = useMapState()

  const footprint =
    inspectDataset?.filtered_bbox_geojson ||
    inspectDataset?.coverage_bbox_geojson
  const bounds = useMemo(() => boundsFromGeoJson(footprint), [footprint])

  // mapView changes on every moveend, which is the cue to re-check the camera.
  const framed = useMemo(
    () => boundsAreFramed(mapRef.current, bounds),
    [bounds, mapView]
  )

  const zoomToDataset = useCallback(() => {
    if (footprint) zoomToGeometry(footprint)
  }, [footprint, zoomToGeometry])

  return { zoomToDataset, canZoom: Boolean(bounds), framed }
}

export default function ZoomToDataset () {
  const { t } = useTranslation()
  const { zoomToDataset, canZoom, framed } = useZoomToDataset()

  if (!canZoom || framed) return null

  return (
    <button
      type='button'
      className='zoomToDatasetButton'
      onClick={zoomToDataset}
      title={t('zoomToDatasetTitle')}
      aria-label={t('zoomToDatasetText')}
    >
      <ZoomIn size={15} aria-hidden='true' />
    </button>
  )
}
