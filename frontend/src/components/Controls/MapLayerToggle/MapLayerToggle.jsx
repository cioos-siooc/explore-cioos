import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'react-bootstrap-icons'
import classNames from 'classnames'

import Switch from '../../ui/Switch.jsx'
import './styles.css'

// Map-corner layer picker: a button stacked above the rectangle tool that
// opens a small menu of visibility switches (gridded coverage, observation
// hexes/points, legend). Follows the boxQueryButton pattern: absolutely
// positioned over the map, above the navigation-control cluster.
export default function MapLayerToggle({ controls }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  // Close when clicking/tapping anywhere else (including the map canvas).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div className='mapLayerControl' ref={rootRef}>
      {open && (
        <div
          className='mapLayerMenu'
          role='group'
          aria-label={t('layersMenuTitle')}
        >
          <div className='mapLayerMenuTitle'>{t('layersMenuTitle')}</div>
          {controls.map((control) => (
            <div className='mapLayerMenuItem' key={control.key}>
              <Switch
                id={`mapLayer-${control.key}`}
                label={control.label}
                checked={control.checked}
                onChange={control.onChange}
              />
            </div>
          ))}
        </div>
      )}
      <button
        className={classNames('mapLayerToggle', { active: open })}
        onClick={() => setOpen(!open)}
        title={t('layersButtonTitle')}
        aria-expanded={open}
      >
        <Layers size='24px' color={open ? '#52a79b' : '#555555'} />
      </button>
    </div>
  )
}
