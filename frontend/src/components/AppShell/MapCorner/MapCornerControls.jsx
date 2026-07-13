import * as React from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import MapLayerToggle from '../../Controls/MapLayerToggle/MapLayerToggle.jsx'
import { polygonIsRectangle } from '../../../utilities.jsx'
import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import './styles.css'

// Lower-right map interaction cluster. Rather than pinning these buttons at
// hardcoded bottom offsets (which drift out of sync with MapLibre's own
// bottom-right stack — zoom / draw / scale / attribution — and end up
// overlapping it), they portal into that stack: the layer picker as its own
// entry on top, the rectangle button into the draw plugin's group so
// rectangle / polygon / trash present as one card. The #boxQueryButton
// element must be in the DOM before MapLibre fires 'load' — Map.js grabs it
// by id then and wires the rectangle-draw mode onto it; the portals attach
// on mount, long before 'load' resolves.
export default function MapCornerControls () {
  const { t } = useTranslation()
  const {
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    legendVisible,
    setLegendVisible,
    projection,
    setProjection
  } = useMapState()
  const { polygon } = useSelection()

  const [hosts, setHosts] = useState(null)

  useEffect(() => {
    let cancelled = false
    let raf
    const el = document.createElement('div')
    el.className = 'maplibregl-ctrl mapCornerCluster'

    // The corner container and the draw plugin's group are created when
    // Map.jsx constructs the map (its mount effect runs before this one), so
    // the first attempt normally succeeds; the rAF loop covers any slower
    // mount ordering.
    function attach () {
      if (cancelled) return
      const corner = document.querySelector('.maplibregl-ctrl-bottom-right')
      // The rectangle button joins the draw group so rectangle / polygon /
      // trash present as one card (portals append, CSS `order` puts it first).
      const drawGroup = corner?.querySelector('.mapboxgl-ctrl-group')
      if (!corner || !drawGroup) {
        raf = requestAnimationFrame(attach)
        return
      }
      // Prepend: bottom-corner controls stack bottom-up, so the first child
      // renders topmost — above the draw and zoom groups.
      corner.prepend(el)
      setHosts({ cluster: el, drawGroup })
    }
    attach()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      el.remove()
    }
  }, [])

  if (!hosts) return null

  return (
    <>
      {createPortal(
        <button
          className={`boxQueryButton ${
            polygon && polygonIsRectangle(polygon) && 'active'
          }`}
          id='boxQueryButton'
          title={t('rectangleToolTitle')}
        >
          <div className='rectangleIcon' />
        </button>,
        hosts.drawGroup
      )}
      {createPortal(
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
            },
            {
              key: 'globe',
              label: t('layersGlobeView'),
              checked: projection === 'globe',
              onChange: () =>
                setProjection(projection === 'globe' ? 'mercator' : 'globe')
            }
          ]}
        />,
        hosts.cluster
      )}
    </>
  )
}
