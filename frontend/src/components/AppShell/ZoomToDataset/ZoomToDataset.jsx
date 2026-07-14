import * as React from 'react'
import { ZoomIn } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import './styles.css'

// Bottom-center action shown while a dataset page is open: frames the map on
// that dataset's footprint. Only griddap datasets carry one
// (coverage_bbox_geojson) — tabledap/OBIS datasets have no extent in the
// /pointQuery response, so the button simply doesn't appear for them.
export default function ZoomToDataset () {
  const { t } = useTranslation()
  const { inspectDataset } = useSelection()
  const { zoomToGeometry } = useMapState()

  const footprint = inspectDataset?.coverage_bbox_geojson
  if (!footprint) return null

  return (
    <button
      type='button'
      className='zoomToDatasetButton'
      onClick={() => zoomToGeometry(footprint)}
      title={t('zoomToDatasetTitle')}
    >
      <ZoomIn size={16} aria-hidden='true' />
      {t('zoomToDatasetText')}
    </button>
  )
}
