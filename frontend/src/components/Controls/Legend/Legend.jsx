import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronCompactDown,
  ChevronCompactUp,
  CircleFill
} from 'react-bootstrap-icons'

import {
  capitalizeFirstLetter,
  generateColorStops
} from '../../../utilities.jsx'
import { colorScale, trajectoryColorScale } from '../../config.js'
import platformColors from '../../platformColors'
import Switch from '../../ui/Switch.jsx'
import { Dropdown, DropdownButton } from '../../ui/Dropdown.jsx'

import './styles.css'
import classNames from 'classnames'
import isEmpty from 'lodash/isEmpty'

// Abbreviate large counts so the color-bar ticks stay short (e.g. 12345 -> 12k).
function formatCount(value) {
  if (value >= 1000) {
    const k = value / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
  }
  return `${value}`
}

// Choose which stop indices get a tick label. Keeps every stop when there are
// few, otherwise thins to an evenly spaced subset (always including the first
// and last) so labels don't overlap on the compact bar.
function pickTickIndices(n, maxTicks = 5) {
  if (n <= maxTicks) return Array.from({ length: n }, (_, i) => i)
  const step = (n - 1) / (maxTicks - 1)
  const indices = new Set()
  for (let i = 0; i < maxTicks; i++) indices.add(Math.round(i * step))
  return [...indices]
}

// Compact floating legend card (top-right). Two independently collapsible
// groups: the legend proper (a hex color bar below z7, point size + platform
// colors above) and the map-layer switches.
export default function Legend({
  currentRangeLevel,
  currentTrajectoryRangeLevel,
  zoom,
  platformsAvailable = [],
  layerControls = [],
  basemapOptions = [],
  basemap,
  onBasemapChange
}) {
  const { t } = useTranslation()
  const [legendOpen, setLegendOpen] = useState(true)
  // Layers section starts collapsed on narrow viewports (where the legend
  // moves to the bottom-left corner) to keep the corner card compact.
  const [layersOpen, setLayersOpen] = useState(
    () => !window.matchMedia('(max-width: 900px)').matches
  )

  // Continuous color bar for a hex ramp. The hex counts follow a non-linear
  // (power/log) scale, so the colors are spaced evenly by their scale index
  // rather than by value — a linear-value axis would collapse the ramp into
  // the dominant high-count color. Count ticks are drawn at each stop (thinned
  // to keep the compact bar legible), which naturally reads as a log axis.
  function renderColorBar(caption, scale, rangeLevel, key) {
    const colorStops = generateColorStops(scale, rangeLevel)
    if (!colorStops || !colorStops.length) return null
    const n = colorStops.length
    const denom = n > 1 ? n - 1 : 1
    const gradient =
      n === 1
        ? colorStops[0].color
        : `linear-gradient(to right, ${colorStops
          .map((cs, i) => `${cs.color} ${((i / denom) * 100).toFixed(1)}%`)
          .join(', ')})`
    const tickIndices = pickTickIndices(n)
    return (
      <div className='legendSection' key={key}>
        <div className='legendSectionCaption'>{caption}</div>
        <div
          className='legendColorBar'
          style={{ background: gradient }}
          aria-hidden='true'
        />
        <div className='legendColorBarTicks'>
          {tickIndices.map((i) => {
            const align = i === 0 ? 'start' : i === n - 1 ? 'end' : 'mid'
            return (
              <span
                key={i}
                className={`legendTick ${align}`}
                style={{ left: `${(i / denom) * 100}%` }}
              >
                {formatCount(colorStops[i].stop)}
              </span>
            )
          })}
        </div>
      </div>
    )
  }

  // Only the platform types the current result set actually contains — the
  // catalog's full palette would otherwise promise markers the map never draws.
  const platformSwatches = platformColors.filter((pc) =>
    platformsAvailable.includes(pc.platform)
  )

  function generateLegendElements() {
    if (isEmpty(currentRangeLevel)) {
      return (
        <div className='legendNoData' title={t('legendNoDataWarningTitle')}>
          {t('legendNoDataWarningText')}
        </div>
      )
    } else if (zoom < 7) {
      // Hexes
      return renderColorBar(
        t('legendPointsPerHex'),
        colorScale,
        currentRangeLevel,
        'hexes'
      )
    } else {
      // Points
      return (
        <>
          <div className='legendSection'>
            <div className='legendSectionCaption'>{t('legendDaysOfData')}</div>
            <div className='legendItems'>
              <div
                className='legendItem'
                title={t('legendSectionTitleLessOneDayOfData')}
              >
                <span className='legendSwatch'>
                  <span className='legendPointCircle small' />
                </span>
                <span className='legendItemLabel'>
                  {t('legendOneDayOrLess')}
                </span>
              </div>
              <div
                className='legendItem'
                title={t('legendSectionTitleMoreOneDayOfData')}
              >
                <span className='legendSwatch'>
                  <span className='legendPointCircle large' />
                </span>
                <span className='legendItemLabel'>
                  {t('legendMoreThanOneDay')}
                </span>
              </div>
            </div>
          </div>
          {platformSwatches.length > 0 && (
            <div className='legendSection'>
              <div className='legendSectionCaption'>
                {t('legendPlatformType')}
              </div>
              <div className='legendItems'>
                {platformSwatches.map((pc) => (
                  <div className='legendItem' key={pc.platform}>
                    <CircleFill
                      className='legendSwatch'
                      size={10}
                      fill={pc.color}
                      aria-hidden='true'
                    />
                    <span className='legendItemLabel'>
                      {capitalizeFirstLetter(t(pc.platform))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )
    }
  }

  function generateTrajectoryLegendElements() {
    if (isEmpty(currentTrajectoryRangeLevel)) return null
    // Trajectory coverage always renders as hexes, at every zoom level.
    return renderColorBar(
      t('legendTrajectoriesPerHex'),
      trajectoryColorScale,
      currentTrajectoryRangeLevel,
      'trajectories'
    )
  }

  function renderGroupHeader(title, open, onToggle, tooltip) {
    return (
      <button
        className='legendGroupHeader'
        onClick={onToggle}
        title={tooltip}
        aria-expanded={open}
      >
        <span>{title}</span>
        {open ? (
          <ChevronCompactUp size={14} aria-hidden='true' />
        ) : (
          <ChevronCompactDown size={14} aria-hidden='true' />
        )}
      </button>
    )
  }

  return (
    <div className='legend'>
      <div className={classNames('legendGroup', { closed: !legendOpen })}>
        {renderGroupHeader(
          t('legendTitle'),
          legendOpen,
          () => setLegendOpen(!legendOpen),
          legendOpen ? t('closeLegendTooltip') : t('openLegendTooltip')
        )}
        {legendOpen && (
          <div className='legendGroupBody'>
            {generateLegendElements()}
            {generateTrajectoryLegendElements()}
          </div>
        )}
      </div>

      {(layerControls.length > 0 || basemapOptions.length > 0) && (
        <div className={classNames('legendGroup', { closed: !layersOpen })}>
          {renderGroupHeader(t('layersMenuTitle'), layersOpen, () =>
            setLayersOpen(!layersOpen)
          )}
          {layersOpen && (
            <div className='legendGroupBody'>
              {basemapOptions.length > 0 && (
                <div className='legendBasemapSelector'>
                  <span className='legendSectionCaption'>
                    {t('basemapLabel')}
                  </span>
                  <DropdownButton
                    className='legendBasemapDropdown'
                    size='sm'
                    variant='outline-secondary'
                    title={
                      basemapOptions.find((option) => option.key === basemap)
                        ?.label
                    }
                  >
                    {basemapOptions.map((option) => (
                      <Dropdown.Item
                        key={option.key}
                        active={option.key === basemap}
                        onClick={() => onBasemapChange(option.key)}
                      >
                        {option.label}
                      </Dropdown.Item>
                    ))}
                  </DropdownButton>
                </div>
              )}
              <div className='legendLayerItems'>
                {layerControls.map((control) => (
                  <Switch
                    key={control.key}
                    id={`mapLayer-${control.key}`}
                    label={control.label}
                    checked={control.checked}
                    onChange={control.onChange}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
