import React, { useEffect, useState } from 'react'
import { X } from 'react-bootstrap-icons'
import classNames from 'classnames'
import { Dropdown, DropdownButton } from '../../ui/Dropdown.jsx'
import { useTranslation } from 'react-i18next'

import { abbreviateString, useDebounce } from '../../../utilities'
import { buildGriddapLegendUrl } from '../../../wmsUtilities'
import './styles.css'

// Floating card shown over the map while a griddap WMS overlay is active: the
// colorbar, the variable picker under it, and the overlay's always-available
// off switch.
//
// The card carries no caption of its own. ERDDAP draws one into the legend
// image — the variable and its units, the dataset title, and the slice being
// shown — so anything written beside it would only be the same words in a
// second typeface. The image is the title, and it links where the title used
// to: the dataset's page on ERDDAP.
//
// Which slice of the grid is drawn is not set here either. Time and depth are
// axes the app already has controls for — the bars along the edges of the map —
// and the grid's own rails ride those, beside the filters they should be read
// against; a pair of index-numbered range inputs on this card could say neither
// where the slice sat in the record nor how it related to anything else on
// screen.
export default function WmsLegend({
  overlay,
  onClose,
  setActiveWmsOverlay,
  variant = 'floating'
}) {
  const { t } = useTranslation()
  const [legendFailed, setLegendFailed] = useState(false)

  const variables = overlay.variables || []

  // "long_name (units)" on a single line — the units are folded into the
  // picker label rather than shown on a separate line beneath it.
  function variableLabel(variable) {
    const name =
      variable.long_name || variable.standard_name || variable.name
    return variable.units ? `${name} (${variable.units})` : name
  }

  // The legend is asked for the slice actually on the map, so its caption
  // stays true while the grid rails are moved — but it is asked once the
  // moving stops. Each request has ERDDAP read a strided slab of the grid,
  // which is not something to spend on every step of a drag.
  const legendUrl = useDebounce(
    buildGriddapLegendUrl({
      erddapUrl: overlay.erddapUrl,
      variable: overlay.variable?.name,
      dimensions: overlay.dimensions,
      time: overlay.time,
      elevation: overlay.elevation
    }),
    400
  )

  useEffect(() => setLegendFailed(false), [legendUrl])

  return (
    <div className={classNames('wmsLegend', variant)}>
      {/* One row above the image, holding the two controls: what is drawn, and
          the way out. It sits above rather than over the image because the top
          of the image is the colorbar, edge to edge, with no corner to cover
          without covering a reading. A dataset serving one variable has
          nothing to pick, and the image has already named it — then the row is
          the close button alone. */}
      <div className='wmsLegendHeader'>
        {variables.length > 1 && (
          <DropdownButton
            className='wmsLegendVariableSelector'
            size='sm'
            variant='outline-secondary'
            tooltip={t('griddapVariableSelect')}
            title={
              <span className='wmsLegendVariableName'>
                {overlay.variable ? variableLabel(overlay.variable) : ''}
              </span>
            }
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
        )}
        <button
          className='wmsLegendCloseButton'
          onClick={onClose}
          title={t('wmsLegendCloseTitle')}
          aria-label={t('wmsLegendCloseTitle')}
        >
          <X size={16} />
        </button>
      </div>
      {legendUrl && !legendFailed ? (
        <a
          className='wmsLegendFigure'
          href={overlay.erddapUrl}
          target='_blank'
          rel='noreferrer'
          title={overlay.erddapUrl}
        >
          <img
            className='wmsLegendImage'
            src={legendUrl}
            alt={`${overlay.variable?.name} ${t('griddapLegendAltText')}`}
            onError={() => setLegendFailed(true)}
          />
        </a>
      ) : (
        // With no image there is nothing to read the dataset off, so the card
        // says it itself — the one case it has to.
        <div className='wmsLegendFallback'>
          <a
            className='wmsLegendTitle'
            href={overlay.erddapUrl}
            target='_blank'
            rel='noreferrer'
            title={overlay.erddapUrl}
          >
            {abbreviateString(overlay.title, 45)}
          </a>
          {overlay.variable && (
            <div className='wmsLegendVariable'>
              {variableLabel(overlay.variable)}
            </div>
          )}
          <div className='wmsLegendUnavailable'>
            {t('griddapLegendUnavailable')}
          </div>
        </div>
      )}
    </div>
  )
}
