import * as React from 'react'
import { useMemo } from 'react'
import classNames from 'classnames'
import { ZoomIn } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { boundsAreFramed, boundsFromGeoJson } from '../../../utilities.jsx'
import './styles.css'

// Frames the map on the open dataset's footprint. Rendered twice, from the same
// state: floating over the lower-centre of the map (from AppShell), and inline
// in the dataset page's title block (from DatasetInspector) — whichever the
// user's eye is on, the action is there. Both read the dataset from context, so
// neither needs it passed in.
//
// The other datasets don't need filtering out of the way — an open dataset page
// already greys them on the map (see hoverHighlightPoints in Map.jsx), so the
// framed view shows this dataset in colour against them.
//
// filtered_bbox_geojson is the extent of the features the current filters
// actually matched, so the framing follows the filters — narrowing the time
// range or drawing a polygon reframes to what's left. Grids have no features,
// so theirs is the coverage bbox (see shapeQuery.js).
//
// Both copies disappear once the map is already framed on that extent: there is
// nothing left to do, and they would otherwise sit there inviting a no-op click.
// Panning or zooming away brings them back.
export default function ZoomToDataset ({ variant = 'floating' }) {
  const { t } = useTranslation()
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

  if (!bounds || framed) return null

  return (
    <button
      type='button'
      className={classNames('zoomToDatasetButton', variant)}
      onClick={() => zoomToGeometry(footprint)}
      title={t('zoomToDatasetTitle')}
    >
      <ZoomIn size={16} aria-hidden='true' />
      {t('zoomToDatasetText')}
    </button>
  )
}
