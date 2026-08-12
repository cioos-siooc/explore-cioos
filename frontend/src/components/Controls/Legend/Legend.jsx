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
  isMarkerTier,
  bathymetryColorScale,
  bathymetryLegendMinZoom,
  bathymetryScaleMin,
  bathymetryScaleMax,
  bathymetryTicks,
  TRAIL_ALL,
  effectiveTrailingDays
} from '../../config.js'
import platformColors from '../../platformColors'
import {
  DEFAULT_DATA_LAYERS,
  anyTrajectoryLayerOn
} from '../../../state/dataLayers.js'
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
// `singleDigit` drops the fraction — "4k", never "4.2k". The marker size key
// lays its two values out side by side, where width is the scarce dimension and
// a decimal buys precision nobody reads off a pair of circles.
function formatCount(value, singleDigit = false) {
  if (!Number.isFinite(value)) return ''
  for (const [size, suffix] of COUNT_UNITS) {
    if (value >= size) {
      const scaled = value / size
      return `${
        scaled >= 10 || singleDigit
          ? Math.round(scaled)
          : scaled.toFixed(1).replace(/\.0$/, '')
      }${suffix}`
    }
  }
  return `${value}`
}

// Abbreviate the depth ticks the same way, so "1000" doesn't run into the end
// of the compact bar.
function formatDepth(metres) {
  return metres >= 1000 ? `${metres / 1000}k` : `${metres}`
}

// Position along the bathymetry bar, 0..1, for a depth in metres. The bar is
// logarithmic (see bathymetryColorScale) so this is a log interpolation.
const LOG_MIN = Math.log10(bathymetryScaleMin)
const LOG_SPAN = Math.log10(bathymetryScaleMax) - LOG_MIN
function depthPosition(metres) {
  return (Math.log10(metres) - LOG_MIN) / LOG_SPAN
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
// groups: the legend proper — the ramp's title (which is the metric picker),
// the ramp with its tick labels, and the keys for whatever else the map is
// drawing (platform colours above the hex band, track lines, the coverage
// ramp) — and the map-layer switches. Each group is all-or-nothing: its header
// shows the whole key or none of it.
export default function Legend({
  currentRangeLevel,
  currentCoverageRangeLevel,
  metric = DEFAULT_HEX_METRIC,
  onMetricChange,
  loading,
  zoom,
  platformsAvailable = [],
  observationsControl,
  layerControls = [],
  tracksMode,
  trajectoryHexes,
  trailingDays,
  dataLayers
}) {
  const { t } = useTranslation()
  // The header's collapse, and the only thing that hides any of this: open, the
  // section shows its whole key — title, ramp, ticks, platform colours, track
  // lines, the coverage ramp; closed, it is the header row alone.
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
    (anyTrajectoryLayerOn(layers) && trajectoryHexes)
  // Trajectory and OBIS coverage share one hex layer and one ramp.
  // currentCoverageRangeLevel is only set at the marker tier (MapStateProvider),
  // which is the only place that layer draws, so it doubles as the zoom gate.
  const showCoverageRamp =
    (layers.obis || (anyTrajectoryLayerOn(layers) && trajectoryHexes)) &&
    !isEmpty(currentCoverageRangeLevel)

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
  const activeMetric = metricOptions.find((option) => option.key === metric)
  // The hex/point layer is switched off (the toggle in the ramp title row).
  // Its key stays put — the switch has to keep something to sit beside, and the
  // numbers are still worth reading — but muted: a fully saturated ramp under
  // an off switch reads as a live layer. Scoped to what the switch actually
  // hides (hexes, points, coverage hexes); the track lines are deliberately not
  // in observationLayerIds, so their key keeps its colour.
  const observationsHidden = observationsControl
    ? !observationsControl.checked
    : false
  const dimClass = classNames('legendSection', {
    legendDimmed: observationsHidden
  })
  // The caption is the metric and nothing else — no "per hexagon" / "per
  // location" qualifier. Which shape is carrying the count is obvious from the
  // map and from the swatches right below it, and spelling it out made the one
  // line in this card that changes with the zoom read as if the *metric* had
  // changed when only the geometry had.
  const metricCaption = activeMetric?.label || t('legendMetricRecords')

  // Continuous color bar for a hex ramp. The hex counts follow a non-linear
  // (power/log) scale, so the colors are spaced evenly by their scale index
  // rather than by value — a linear-value axis would collapse the ramp into the
  // dominant high-count color. Count ticks are drawn at each stop (thinned to
  // keep the compact bar legible), which naturally reads as a log axis.
  // `caption` is omitted for the primary ramp, which the metric picker above
  // already titles.
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
      <div className={dimClass} key={key}>
        {caption && <div className='legendSectionCaption'>{caption}</div>}
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
    } else if (!isMarkerTier(zoom)) {
      // Hexes. No caption — the metric dropdown above titles this ramp.
      return renderColorBar(null, colorScale, currentRangeLevel, 'hexes')
    } else {
      // Points, always keyed to days of data (MARKER_METRIC). One line rather
      // than a stacked pair, and one number rather than both ends of the ramp:
      // "○ ≤ 1 < ●" — at or below the ramp's floor a marker is drawn at the
      // small radius, and it grows from there. radiusExpression (Map.jsx)
      // clamps below `lo`, so the floor is the value worth naming; the top of
      // the ramp is what "bigger circle" already says.
      const [lo, hi] = currentRangeLevel
      // That same expression drops to one flat radius when the range is
      // degenerate — every location holding the same number of days, which is
      // common zoomed right in, where the answer is usually "1". There is no
      // "grows from there" to show then, so the large circle goes away.
      const ramped = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo
      return (
        <>
          <div className={dimClass}>
            {/* titled by the metric dropdown above, like the hex ramp */}
            <div className='legendSizeKey'>
              <span className='legendSwatch'>
                <span className='legendPointCircle small' />
              </span>
              <span className='legendItemLabel'>
                {Number.isFinite(lo)
                  ? `≤ ${formatCount(lo, true)}`
                  : t('legendPointSizeLess')}
              </span>
              {ramped && (
                <>
                  <span className='legendItemLabel'>&lt;</span>
                  <span className='legendSwatch'>
                    <span className='legendPointCircle large' />
                  </span>
                </>
              )}
            </div>
          </div>
          {platformSwatches.length > 0 && (
            <div className={dimClass}>
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
    if (!anyTrajectoryLayerOn(layers) || !tracksMode) return null
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

  // One bar, not the three (trajectory / occurrence / mixed) this used to
  // emit. What a hex actually holds is in its hover tooltip; colour is
  // reserved for how much.
  function generateCoverageLegendElements() {
    return (
      <>
        {generateTrajectoryLegendElements()}
        {/* Captioned by the layer it keys, not by its metric: it counts the same
            metric as the ramp above, so repeating that name would put two bars
            with different domains under one title. Naming the layer is also
            what tells them apart, now that the "per hexagon" / "per location"
            qualifier is gone. */}
        {showCoverageRamp &&
          renderColorBar(
            t('legendCoverageRamp'),
            colorScale,
            currentCoverageRangeLevel,
            'coverage'
          )}
      </>
    )
  }

  // The CHS NONNA depth ramp. Not dimmed by the observations switch and not
  // titled by the metric picker: it keys the bathymetry raster, which is part of
  // the basemap rather than of the data this card otherwise describes.
  function renderBathymetryBar() {
    // zoom is undefined until the map first reports its view, and `undefined <
    // n` is false — so test for the zoom being known as well, or the bar
    // flashes on before the raster it describes exists.
    if (!Number.isFinite(zoom) || zoom < bathymetryLegendMinZoom) return null
    // Anchors sit at their own depths, so the gradient is uneven by design:
    // the first stop's colour flats out to the left edge (everything shallower
    // than it is that red) and the last stop's to the right edge.
    const gradient = `linear-gradient(to right, ${bathymetryColorScale
      .map(
        ({ depth, color }) =>
          `${color} ${(depthPosition(depth) * 100).toFixed(1)}%`
      )
      .join(', ')})`
    return (
      <div className='legendSection' key='bathymetry'>
        <div
          className='legendSectionCaption'
          title={t('legendBathymetryTitle')}
        >
          {t('legendBathymetry')}
        </div>
        <div
          className='legendColorBar'
          style={{ background: gradient }}
          aria-hidden='true'
        />
        <div className='legendColorBarTicks'>
          {bathymetryTicks.map((metres, i) => {
            const align =
              i === 0
                ? 'start'
                : i === bathymetryTicks.length - 1
                  ? 'end'
                  : 'mid'
            return (
              <span
                key={metres}
                className={`legendTick ${align}`}
                style={{ left: `${depthPosition(metres) * 100}%` }}
              >
                {formatDepth(metres)}
              </span>
            )
          })}
        </div>
      </div>
    )
  }

  // The metric picker doubles as the ramp's title: the bar looks the same
  // whatever it counts, so the line naming what it counts is the only thing
  // that changes — make that line the control.
  function renderMetricTitle() {
    // Nothing on the map is keyed to a count (tracks only, say): a title for a
    // ramp that isn't there names nothing.
    if (!showPointRamp && !showCoverageRamp) return null
    // The hex/point layer's visibility switch, unlabelled: the caption beside it
    // is the label. It rides here rather than with the other layer switches
    // because the ramp describes that one layer, so this is the control that
    // turns off what the ramp is a key to.
    const visibilitySwitch = observationsControl && (
      <Switch
        id={`mapLayer-${observationsControl.key}`}
        title={observationsControl.label}
        checked={observationsControl.checked}
        onChange={observationsControl.onChange}
      />
    )
    // The counts mix units and some are extrapolated from sampling rate rather
    // than measured. That caveat used to be a footnote under the ramp, which
    // spent three lines of a card this small on a sentence most people read
    // once — it hangs off the label it qualifies instead.
    const tooltip =
      metric === 'records'
        ? t('legendCountsApproximate')
        : metricOptions.find((option) => option.key === metric)?.title
    // No handler = the metric is pinned (the marker tier always counts days of
    // data). Say why, rather than describing a metric the user didn't pick.
    if (!onMetricChange) {
      return (
        <div className='legendMetricRow'>
          {visibilitySwitch}
          <div
            className='legendSectionCaption'
            title={t('legendMarkerDaysPinned')}
          >
            {metricCaption}
          </div>
        </div>
      )
    }
    return (
      <div className='legendMetricRow'>
        {visibilitySwitch}
        <DropdownButton
          className='legendMetricDropdown'
          size='sm'
          variant='outline-secondary'
          title={metricCaption}
          tooltip={tooltip}
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
            {renderMetricTitle()}
            {generateLegendElements()}
            {generateCoverageLegendElements()}
            {renderBathymetryBar()}
          </div>
        )}
      </div>

      {layerControls.length > 0 && (
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}
