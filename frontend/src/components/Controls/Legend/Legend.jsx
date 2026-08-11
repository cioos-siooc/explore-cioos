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
import {
  colorScale,
  trajectoryColorScale,
  obisColorScale,
  mixedColorScale,
  TRAIL_ALL,
  effectiveTrailingDays
} from '../../config.js'
import platformColors from '../../platformColors'
import { DEFAULT_DATA_LAYERS } from '../../../state/dataLayers.js'
import Spinner from '../../ui/Spinner.jsx'
import Switch from '../../ui/Switch.jsx'

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
  currentObisRangeLevel,
  loading,
  zoom,
  platformsAvailable = [],
  layerControls = [],
  dataLayerControls = [],
  tracksMode,
  trajectoryHexes,
  trailingDays,
  dataLayers
}) {
  const { t } = useTranslation()
  const [legendOpen, setLegendOpen] = useState(true)
  // Layers section starts collapsed on narrow viewports (where the legend
  // moves to the bottom-left corner) to keep the corner card compact.
  const [layersOpen, setLayersOpen] = useState(
    () => !window.matchMedia('(max-width: 900px)').matches
  )

  // Fall back to the default selection when the prop is absent (older callers /
  // initial render) — all-on would claim legend entries the map isn't drawing.
  const layers = dataLayers || DEFAULT_DATA_LAYERS
  // The combined green ramp / platform points carry the profile-family types
  // + OBIS, plus trajectory coverage when its hex view is on.
  const showPointRamp =
    layers.profile ||
    layers.timeseries ||
    layers.timeseriesProfile ||
    layers.obis ||
    (layers.trajectories && trajectoryHexes)

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
    // The point/hex data types are all toggled off — nothing for this ramp to
    // describe (the coverage sections below have their own gating).
    if (!showPointRamp) return null
    // /legend is still in flight and there's no ramp from a previous query to
    // fall back on: the counts are unknown, not zero. Saying "No Data" here
    // (as this did) tells the user their filters excluded everything, which is
    // a guess — and usually a wrong one.
    if (loading && isEmpty(currentRangeLevel)) {
      return (
        <div className='legendLoading'>
          <Spinner size='sm' />
          <span>{t('legendLoadingText')}</span>
        </div>
      )
    } else if (isEmpty(currentRangeLevel)) {
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

  // The trajectory entries: a track-line/arrowhead key and a coverage-hex ramp,
  // one per view switch. Both switches are independent, so this emits both keys
  // when both are on and nothing when neither is.
  function generateTrajectoryLegendElements() {
    // Trajectory layer hidden entirely — no trajectory legend.
    if (!layers.trajectories) return null
    return (
      <>
        {tracksMode && renderTrackLineKey()}
        {trajectoryHexes &&
          !isEmpty(currentTrajectoryRangeLevel) &&
          renderColorBar(
            t('legendTrajectoriesPerHex'),
            trajectoryColorScale,
            currentTrajectoryRangeLevel,
            'trajectories'
          )}
      </>
    )
  }

  // The track-line + heading-arrow swatches, matching what the map draws. The
  // window shown is the one actually loaded, not the one requested: zoomed out,
  // the long trails are clamped (see effectiveTrailingDays), and a key that
  // still claimed "All time" there would be wrong.
  function renderTrackLineKey() {
    const loadedTrail = effectiveTrailingDays(trailingDays, zoom)
    const zoomClamped = loadedTrail !== trailingDays
    const trailLabel =
      loadedTrail === TRAIL_ALL ? t('timeBarTrailAll') : `${loadedTrail}d`
    return (
      <div className='legendSection' key='tracks'>
        <div className='legendSectionCaption'>{t('layerTrajectories')}</div>
        <div className='legendItems'>
          <div
            className='legendItem'
            title={zoomClamped ? t('legendTrackTrailZoomGated') : undefined}
          >
            <svg className='legendSwatch' width='12' height='12'>
              <line
                x1='1'
                y1='10.5'
                x2='11'
                y2='1.5'
                stroke='#6749AC'
                strokeWidth='2.5'
                strokeLinecap='round'
              />
            </svg>
            <span className='legendItemLabel'>
              {`${t('legendTrackLine')} (${trailLabel}${zoomClamped ? '*' : ''})`}
            </span>
          </div>
          <div className='legendItem'>
            {/* same arrowhead the map draws, pointing along the course */}
            <svg className='legendSwatch' width='12' height='12' viewBox='0 0 16 16'>
              <path
                d='M8 1.5 L13.5 13.5 L8 10.5 L2.5 13.5 Z'
                fill='#6749AC'
                stroke='#ffffff'
                strokeWidth='1.5'
                strokeLinejoin='round'
                transform='rotate(45 8 8)'
              />
            </svg>
            <span className='legendItemLabel'>{t('legendTrackHead')}</span>
          </div>
        </div>
      </div>
    )
  }

  // Trajectory and OBIS coverage both render as hexes, and share one map
  // layer — a hex is coloured by which of the two it holds, or by a third
  // ramp when it holds both. The mixed ramp runs on the occurrence count (see
  // coverageHexFillColor in Map.jsx), so it reuses the OBIS range. With the
  // trajectory hex view off the cells tiles carry no trajectory counts, so only
  // the OBIS ramp can apply then.
  function generateCoverageLegendElements() {
    const showObisRamp = layers.obis && !isEmpty(currentObisRangeLevel)
    const showTrajectoryHexes =
      layers.trajectories &&
      trajectoryHexes &&
      !isEmpty(currentTrajectoryRangeLevel)
    return (
      <>
        {generateTrajectoryLegendElements()}
        {showObisRamp &&
          renderColorBar(
            t('legendOccurrencesPerHex'),
            obisColorScale,
            currentObisRangeLevel,
            'occurrences'
          )}
        {showTrajectoryHexes &&
          showObisRamp &&
          renderColorBar(
            t('legendMixedPerHex'),
            mixedColorScale,
            currentObisRangeLevel,
            'mixed'
          )}
      </>
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
            {generateCoverageLegendElements()}
          </div>
        )}
      </div>

      {(layerControls.length > 0 || dataLayerControls.length > 0) && (
        <div className={classNames('legendGroup', { closed: !layersOpen })}>
          {renderGroupHeader(t('layersMenuTitle'), layersOpen, () =>
            setLayersOpen(!layersOpen)
          )}
          {layersOpen && (
            <div className='legendGroupBody'>
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
              {dataLayerControls.length > 0 && (
                <>
                  <span className='legendSectionCaption'>
                    {t('layerSelectorLabel')}
                  </span>
                  <div className='legendLayerItems'>
                    {dataLayerControls.map((control) => (
                      <div
                        key={control.key}
                        className={control.sub ? 'legendLayerSub' : undefined}
                      >
                        <Switch
                          id={`dataLayer-${control.key}`}
                          label={control.label}
                          checked={control.checked}
                          onChange={control.onChange}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
