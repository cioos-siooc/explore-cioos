import React, { useEffect, useState } from 'react'
import { Dropdown, DropdownButton } from 'react-bootstrap'
import { X } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import { abbreviateString } from '../../../utilities'
import {
  buildGriddapLegendUrl,
  getTimeDimension,
  getVerticalDimension,
  toElevation
} from '../../../wmsUtilities'
import './styles.css'

const MAX_SLIDER_STEPS = 500

// Floating card shown over the map while a griddap WMS overlay is active:
// clickable dataset title (opens the ERDDAP page), variable picker, time and
// depth sliders (when the grid has those axes), colorbar, and the overlay's
// always-available off switch. Slider values are linearly interpolated
// between the harvested axis endpoints — ERDDAP's WMS snaps TIME/ELEVATION
// to the nearest grid node, so intermediate values are safe.
export default function WmsLegend({ overlay, onClose, setActiveWmsOverlay }) {
  const { t } = useTranslation()
  const [legendFailed, setLegendFailed] = useState(false)

  useEffect(() => setLegendFailed(false), [overlay.variable?.name])

  const variables = overlay.variables || []
  const timeDimension = getTimeDimension(overlay.dimensions)
  const verticalDimension = getVerticalDimension(overlay.dimensions)

  const timeMinMs = timeDimension ? Date.parse(timeDimension.min) : NaN
  const timeMaxMs = timeDimension ? Date.parse(timeDimension.max) : NaN
  const hasTimeSlider =
    Number.isFinite(timeMinMs) &&
    Number.isFinite(timeMaxMs) &&
    timeMaxMs > timeMinMs
  const timeSteps = Math.min(timeDimension?.n_values || 2, MAX_SLIDER_STEPS)

  const hasDepthSlider =
    verticalDimension &&
    Number.isFinite(verticalDimension.min) &&
    Number.isFinite(verticalDimension.max) &&
    verticalDimension.max > verticalDimension.min
  const depthSteps = Math.min(
    verticalDimension?.n_values || 2,
    MAX_SLIDER_STEPS
  )

  // slider positions while dragging; the overlay only re-renders on release
  const [timeIndex, setTimeIndex] = useState(timeSteps - 1)
  const [depthIndex, setDepthIndex] = useState(0)
  useEffect(() => {
    setTimeIndex(timeSteps - 1)
    setDepthIndex(0)
  }, [overlay.pk])

  const sliderTimeMs =
    timeMinMs + (timeIndex / Math.max(timeSteps - 1, 1)) * (timeMaxMs - timeMinMs)
  const sliderTime = hasTimeSlider
    ? new Date(sliderTimeMs).toISOString()
    : undefined

  const sliderDepthValue = hasDepthSlider
    ? verticalDimension.min +
      (depthIndex / Math.max(depthSteps - 1, 1)) *
        (verticalDimension.max - verticalDimension.min)
    : undefined

  function commitTime() {
    setActiveWmsOverlay({ ...overlay, time: sliderTime })
  }

  function commitDepth() {
    setActiveWmsOverlay({
      ...overlay,
      elevation: toElevation(verticalDimension, sliderDepthValue)
    })
  }

  function variableLabel(variable) {
    return variable.long_name || variable.standard_name || variable.name
  }

  const legendUrl = buildGriddapLegendUrl({
    erddapUrl: overlay.erddapUrl,
    variable: overlay.variable?.name,
    dimensions: overlay.dimensions
  })

  return (
    <div className='wmsLegend'>
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
      {overlay.variable?.units && (
        <div className='wmsLegendVariable'>({overlay.variable.units})</div>
      )}
      {hasTimeSlider && (
        <div className='wmsLegendSlider'>
          <label htmlFor='wmsLegendTimeSlider'>
            {t('griddapTimeSliderLabel')}:{' '}
            {sliderTime.replace('T', ' ').slice(0, 16)}
          </label>
          <input
            id='wmsLegendTimeSlider'
            type='range'
            min={0}
            max={timeSteps - 1}
            value={timeIndex}
            onChange={(event) => setTimeIndex(Number(event.target.value))}
            onMouseUp={commitTime}
            onTouchEnd={commitTime}
            onKeyUp={commitTime}
          />
        </div>
      )}
      {hasDepthSlider && (
        <div className='wmsLegendSlider'>
          <label htmlFor='wmsLegendDepthSlider'>
            {t('griddapDepthSliderLabel')}:{' '}
            {sliderDepthValue.toFixed(1)}
            {verticalDimension.units ? ` ${verticalDimension.units}` : ' m'}
          </label>
          <input
            id='wmsLegendDepthSlider'
            type='range'
            min={0}
            max={depthSteps - 1}
            value={depthIndex}
            onChange={(event) => setDepthIndex(Number(event.target.value))}
            onMouseUp={commitDepth}
            onTouchEnd={commitDepth}
            onKeyUp={commitDepth}
          />
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
