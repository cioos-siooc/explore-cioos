import React, { useEffect, useState } from 'react'
import { X } from 'react-bootstrap-icons'
import classNames from 'classnames'
import { Dropdown, DropdownButton } from '../../ui/Dropdown.jsx'
import { useTranslation } from 'react-i18next'

import { abbreviateString } from '../../../utilities'
import { buildGriddapLegendUrl } from '../../../wmsUtilities'
import './styles.css'

// Floating card shown over the map while a griddap WMS overlay is active:
// clickable dataset title (opens the ERDDAP page), variable picker, colorbar,
// and the overlay's always-available off switch.
//
// Which slice of the grid is drawn is not set here. Time and depth are axes the
// app already has controls for — the bars along the bottom of the map — and the
// grid's marks now ride those, beside the filters they should be read against;
// a pair of index-numbered range inputs on this card could say neither where
// the slice sat in the record nor how it related to anything else on screen.
export default function WmsLegend({
  overlay,
  onClose,
  setActiveWmsOverlay,
  variant = 'floating'
}) {
  const { t } = useTranslation()
  const [legendFailed, setLegendFailed] = useState(false)

  useEffect(() => setLegendFailed(false), [overlay.variable?.name])

  const variables = overlay.variables || []

  // "long_name (units)" on a single line — the units are folded into the
  // picker label rather than shown on a separate line beneath it.
  function variableLabel(variable) {
    const name =
      variable.long_name || variable.standard_name || variable.name
    return variable.units ? `${name} (${variable.units})` : name
  }

  const legendUrl = buildGriddapLegendUrl({
    erddapUrl: overlay.erddapUrl,
    variable: overlay.variable?.name,
    dimensions: overlay.dimensions
  })

  return (
    <div className={classNames('wmsLegend', variant)}>
      <div className='wmsLegendHeader'>
        <a
          className='wmsLegendTitle'
          href={overlay.erddapUrl}
          target='_blank'
          rel='noreferrer'
          title={overlay.erddapUrl}
        >
          {abbreviateString(overlay.title, 45)}
        </a>
        <button
          className='wmsLegendCloseButton'
          onClick={onClose}
          title={t('wmsLegendCloseTitle')}
        >
          <X size='20px' />
        </button>
      </div>
      {variables.length > 1 ? (
        <DropdownButton
          className='wmsLegendVariableSelector'
          size='sm'
          variant='outline-secondary'
          title={overlay.variable ? variableLabel(overlay.variable) : ''}
        >
          {variables.map((variable) => (
            <Dropdown.Item
              key={variable.name}
              active={variable.name === overlay.variable?.name}
              onClick={() => setActiveWmsOverlay({ ...overlay, variable })}
            >
              {variableLabel(variable)}
            </Dropdown.Item>
          ))}
        </DropdownButton>
      ) : (
        <div className='wmsLegendVariable'>
          {overlay.variable && variableLabel(overlay.variable)}
        </div>
      )}
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
