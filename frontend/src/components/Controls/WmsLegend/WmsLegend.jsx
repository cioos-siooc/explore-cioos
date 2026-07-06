import React, { useEffect, useState } from 'react'
import { X } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import { abbreviateString } from '../../../utilities'
import { buildGriddapLegendUrl } from '../../../wmsUtilities'
import './styles.css'

// Floating colorbar card shown over the map while a griddap WMS overlay is
// active — stays visible when the selection panel is collapsed and is the
// overlay's always-available off switch.
export default function WmsLegend({ overlay, onClose }) {
  const { t } = useTranslation()
  const [legendFailed, setLegendFailed] = useState(false)

  useEffect(() => setLegendFailed(false), [overlay.variable?.name])

  const legendUrl = buildGriddapLegendUrl({
    erddapUrl: overlay.erddapUrl,
    variable: overlay.variable?.name,
    dimensions: overlay.dimensions
  })

  return (
    <div className='wmsLegend'>
      <div className='wmsLegendHeader'>
        <span className='wmsLegendTitle' title={overlay.title}>
          {abbreviateString(overlay.title, 45)}
        </span>
        <button
          className='wmsLegendCloseButton'
          onClick={onClose}
          title={t('wmsLegendCloseTitle')}
        >
          <X size='20px' />
        </button>
      </div>
      <div className='wmsLegendVariable'>
        {overlay.variable?.long_name ||
          overlay.variable?.standard_name ||
          overlay.variable?.name}
        {overlay.variable?.units ? ` (${overlay.variable.units})` : ''}
      </div>
      {legendUrl && !legendFailed ? (
        <img
          className='wmsLegendImage'
          src={legendUrl}
          alt={`${overlay.variable?.name} ${t('griddapLegendAltText')}`}
          onError={() => setLegendFailed(true)}
        />
      ) : (
        <div className='wmsLegendUnavailable'>
          {t('griddapLegendUnavailable')}
        </div>
      )}
    </div>
  )
}
