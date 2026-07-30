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
  DEFAULT_HEX_METRIC,
  TRAIL_ALL,
  effectiveTrailingDays
} from '../../config.js'
import platformColors from '../../platformColors'
import { DEFAULT_DATA_LAYERS } from '../../../state/dataLayers.js'
import Spinner from '../../ui/Spinner.jsx'
import Switch from '../../ui/Switch.jsx'
import { Dropdown, DropdownButton } from '../../ui/Dropdown.jsx'

import './styles.css'
import classNames from 'classnames'
import isEmpty from 'lodash/isEmpty'

// Abbreviate large counts so the color-bar ticks stay short (e.g. 12345 -> 12k).
// Goes up to billions: the ramp now counts measurements, not locations, and a
// full-catalogue maximum runs into the millions — "1700k" is not an
// improvement on "1.7M".
const COUNT_UNITS = [
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k']
]
function formatCount(value) {
  if (!Number.isFinite(value)) return ''
  for (const [size, suffix] of COUNT_UNITS) {
    if (value >= size) {
      const scaled = value / size
      return `${
        scaled >= 10
          ? Math.round(scaled)
          : scaled.toFixed(1).replace(/\.0$/, '')
      }${suffix}`
    }
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
  currentCoverageRangeLevel,
  metric = DEFAULT_HEX_METRIC,
  onMetricChange,
  loading,
  zoom,
  platformsAvailable = [],
  layerControls = [],
  dataLayerControls = [],
  basemapOptions = [],
  basemap,
  onBasemapChange,
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

  // Every ramp caption names the metric, because the ramp itself doesn't
  // change — only what it counts does. A bar that looks identical in both
  // modes has to say which one it's in.
  const hexCaption = t(
    {
      days: 'legendDaysPerHex',
      datasets: 'legendDatasetsPerHex'
    }[metric] || 'legendMeasurementsPerHex'
  )
  const pointCaption = t(
    {
      days: 'legendDaysPerLocation',
      datasets: 'legendDatasetsPerLocation'
    }[metric] || 'legendMeasurementsPerLocation'
  )
  const metricOptions = [
    {
      key: 'records',
      label: t('legendMetricRecords'),
      title: t('legendMetricRecordsTitle')
    },
    {
      key: 'days',
      label: t('legendMetricDays'),
      title: t('legendMetricDaysTitle')
    },
    {
      key: 'datasets',
      label: t('legendMetricDatasets'),
      title: t('legendMetricDatasetsTitle')
    }
  ]

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
    // /legend clamps the ramp's top to a high percentile so one outlier
    // dataset can't flatten the whole scale (see rampRange in
    // web-api/routes/legend.js). When it did clamp, the top tick is not the
    // real maximum — say "264k+", not "264k".
    const clamped = rangeLevel?.[2] > rangeLevel?.[1]
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
            const isLast = i === n - 1
            const align = i === 0 ? 'start' : isLast ? 'end' : 'mid'
            return (
              <span
                key={i}
                className={`legendTick ${align}`}
                style={{ left: `${(i / denom) * 100}%` }}
                title={
                  isLast && clamped
                    ? t('legendTopTickClamped', {
                      max: formatCount(rangeLevel[2])
                    })
                    : undefined
                }
              >
                {formatCount(colorStops[i].stop)}
                {isLast && clamped ? '+' : ''}
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
      return renderColorBar(hexCaption, colorScale, currentRangeLevel, 'hexes')
    } else {
      // Points. Marker size ramps on the same metric the hexes colour by, so
      // the key is the two ends of that ramp rather than the old fixed
      // "one day or less / more than one day" split, which stopped meaning
      // anything once the count became a measurement count.
      const [lo, hi] = currentRangeLevel
      return (
        <>
          <div className='legendSection'>
            <div className='legendSectionCaption'>{pointCaption}</div>
            <div className='legendItems'>
              <div className='legendItem'>
                <span className='legendSwatch'>
                  <span className='legendPointCircle small' />
                </span>
                <span className='legendItemLabel'>
                  {Number.isFinite(lo)
                    ? formatCount(lo)
                    : t('legendPointSizeLess')}
                </span>
              </div>
              <div className='legendItem'>
                <span className='legendSwatch'>
                  <span className='legendPointCircle large' />
                </span>
                <span className='legendItemLabel'>
                  {Number.isFinite(hi)
                    ? formatCount(hi)
                    : t('legendPointSizeMore')}
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

  // The track-line key. The coverage hexes no longer get a trajectory-specific
  // ramp — they share the one hex ramp with everything else — so this is all
  // that's left that's trajectory-specific, and it describes line styling
  // rather than a colour scale.
  function generateTrajectoryLegendElements() {
    if (!layers.trajectories || !tracksMode) return null
    return renderTrackLineKey()
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

  // Trajectory and OBIS coverage both render as hexes and share one map layer,
  // and now one ramp — so one bar, not the three (trajectory / occurrence /
  // mixed) this used to emit. What a hex actually holds is in its hover
  // tooltip; colour is reserved for how much.
  //
  // currentCoverageRangeLevel is only set at zoom >= 7 (MapStateProvider),
  // which is the only place this layer draws, so it doubles as the zoom gate.
  function generateCoverageLegendElements() {
    const showCoverageRamp =
      (layers.obis || (layers.trajectories && trajectoryHexes)) &&
      !isEmpty(currentCoverageRangeLevel)
    return (
      <>
        {generateTrajectoryLegendElements()}
        {showCoverageRamp &&
          renderColorBar(
            hexCaption,
            colorScale,
            currentCoverageRangeLevel,
            'coverage'
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
            {/* What the ramp counts. Sits above the bars because it changes
                what every one of them means. */}
            {onMetricChange && (
              <div className='legendBasemapSelector'>
                <span className='legendSectionCaption'>
                  {t('legendColourBy')}
                </span>
                <DropdownButton
                  className='legendBasemapDropdown'
                  size='sm'
                  variant='outline-secondary'
                  title={
                    metricOptions.find((option) => option.key === metric)?.label
                  }
                >
                  {metricOptions.map((option) => (
                    <Dropdown.Item
                      key={option.key}
                      active={option.key === metric}
                      title={option.title}
                      onClick={() => onMetricChange(option.key)}
                    >
                      {option.label}
                    </Dropdown.Item>
                  ))}
                </DropdownButton>
              </div>
            )}
            {generateLegendElements()}
            {generateCoverageLegendElements()}
            {/* The counts mix units and some are extrapolated from sampling
                rate rather than measured — say so once, here, instead of
                implying an exactness the harvest doesn't have. */}
            {metric === 'records' && showPointRamp && (
              <div className='legendFootnote'>{t('legendCountsApproximate')}</div>
            )}
          </div>
        )}
      </div>

      {(layerControls.length > 0 ||
        dataLayerControls.length > 0 ||
        basemapOptions.length > 0) && (
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
