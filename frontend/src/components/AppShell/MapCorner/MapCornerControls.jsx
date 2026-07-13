import * as React from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { polygonIsRectangle } from '../../../utilities.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import './styles.css'

// Lower-right map interaction cluster. The rectangle tool portals into the
// draw plugin's group (bottom-right of the map) so rectangle / polygon / trash
// present as one card, rather than tracking MapLibre's own bottom-right stack
// with hardcoded offsets. The #boxQueryButton element must be in the DOM
// before MapLibre fires 'load' — Map.js grabs it by id then and wires the
// rectangle-draw mode onto it; the portal attaches on mount, long before
// 'load' resolves. (Layer visibility switches now live in the legend card.)
export default function MapCornerControls () {
  const { t } = useTranslation()
  const { polygon } = useSelection()

  const [drawGroup, setDrawGroup] = useState(null)

  useEffect(() => {
    let cancelled = false
    let raf

    // The draw plugin's group is created when Map.jsx constructs the map (its
    // mount effect runs before this one), so the first attempt normally
    // succeeds; the rAF loop covers any slower mount ordering.
    function attach () {
      if (cancelled) return
      const corner = document.querySelector('.maplibregl-ctrl-bottom-right')
      const group = corner?.querySelector('.mapboxgl-ctrl-group')
      if (!group) {
        raf = requestAnimationFrame(attach)
        return
      }
      setDrawGroup(group)
    }
    attach()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [])

  if (!drawGroup) return null

  return createPortal(
    <button
      className={`boxQueryButton ${
        polygon && polygonIsRectangle(polygon) && 'active'
      }`}
      id='boxQueryButton'
      title={t('rectangleToolTitle')}
    >
      <div className='rectangleIcon' />
    </button>,
    drawGroup
  )
}
