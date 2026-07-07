import * as React from 'react'
import { useTranslation } from 'react-i18next'

import MapLayerToggle from '../../Controls/MapLayerToggle/MapLayerToggle.jsx'
import { polygonIsRectangle } from '../../../utilities.js'
import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import './styles.css'

// Lower-right map interaction cluster. The #boxQueryButton element must be in
// the DOM before MapLibre fires 'load' — Map.js grabs it by id then and wires
// the rectangle-draw mode onto it.
export default function MapCornerControls () {
  const { t } = useTranslation()
  const {
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    legendVisible,
    setLegendVisible
  } = useMapState()
  const { polygon } = useSelection()

  return (
    <>
      <button
        className={`boxQueryButton ${
          polygon && polygonIsRectangle(polygon) && 'active'
        }`}
        id='boxQueryButton'
        title={t('rectangleToolTitle')}
      >
        <div className='rectangleIcon' />
      </button>
      <MapLayerToggle
        controls={[
          {
            key: 'griddap',
            label: t('layersGriddedCoverage'),
            checked: griddapCoverageVisible,
            onChange: () => setGriddapCoverageVisible(!griddapCoverageVisible)
          },
          {
            key: 'observations',
            label: t('layersObservations'),
            checked: dataLayersVisible,
            onChange: () => setDataLayersVisible(!dataLayersVisible)
          },
          {
            key: 'legend',
            label: t('layersLegend'),
            checked: legendVisible,
            onChange: () => setLegendVisible(!legendVisible)
          }
        ]}
      />
    </>
  )
}
