import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronCompactDown,
  ChevronCompactUp,
  CircleFill
} from 'react-bootstrap-icons'

import {
  capitalizeFirstLetter,
  generateColorStops,
  rangeLevelHasData
} from '../../../utilities.jsx'
import {
  colorScale,
  trajectoryColorScale,
  obisColorScale,
  mixedColorScale,
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

import './styles.css'
import classNames from 'classnames'

// Abbreviate large counts so the color-bar ticks stay short (e.g. 12345 -> 12k).
function formatCount(value) {
  if (value >= 1000) {
    const k = value / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
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
// groups: the legend proper (a hex color bar below z7, point size + platform
// colors above) and the map-layer switches — how the map is drawn. Which data
// families are drawn at all is a filter, and lives in the Filters panel; the
// dataLayers prop is read here only to decide which colour keys this card is
// entitled to show.
export default function Legend({
  currentRangeLevel,
  currentTrajectoryRangeLevel,
  currentObisRangeLevel,
  loading,
  zoom,
  platformsAvailable = [],
  layerControls = [],
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
    (anyTrajectoryLayerOn(layers) && trajectoryHexes)

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

  // The CHS NONNA depth ramp. Unlike the hex ramps this one is not derived
  // from the current query — it describes a basemap raster, so it appears
  // whenever that raster is drawn (and only then) rather than following the
  // data layers. Colours are CHS's own; the depth axis is calibrated, which is
  // what the caption's tooltip is there to say.
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
              i === 0 ? 'start' : i === bathymetryTicks.length - 1 ? 'end' : 'mid'
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

  // Only the platform types the current result set actually contains — the
  // catalog's full palette would otherwise promise markers the map never draws.
  const platformSwatches = platformColors.filter((pc) =>
    platformsAvailable.includes(pc.platform)
  )

  function generateLegendElements() {
    // The point/hex data types are all toggled off — nothing for this ramp to
    // describe (the coverage sections below have their own gating).
    if (!showPointRamp) return null
    // "No Data" is a claim about the user's filters, so it is only ever made
    // about a /legend answer that came back holding nothing (a null max — see
    // rangeLevelHasData). Anything else the ramp can't be built from — the
    // query still in flight, a failed fetch — is a state the app is in, not
    // something the user did, and says so instead.
    const hasRange = rangeLevelHasData(currentRangeLevel)
    if (!hasRange && loading) {
      return (
        <div className='legendLoading'>
          <Spinner size='sm' />
          <span>{t('legendLoadingText')}</span>
        </div>
      )
    } else if (!currentRangeLevel) {
      // No answer at all — the fetch failed (ApiErrorBanner has already said
      // so). Nothing truthful to put here, so put nothing.
      return null
    } else if (!hasRange) {
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
            {/* Two short labels either side of a size cue — they read as a
                single "small vs large" comparison, so they share one row
                rather than stacking. */}
            <div className='legendItems inline'>
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
    if (!anyTrajectoryLayerOn(layers)) return null
    return (
      <>
        {tracksMode && renderTrackLineKey()}
        {trajectoryHexes &&
          rangeLevelHasData(currentTrajectoryRangeLevel) &&
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
    const showObisRamp = layers.obis && rangeLevelHasData(currentObisRangeLevel)
    const showTrajectoryHexes =
      anyTrajectoryLayerOn(layers) &&
      trajectoryHexes &&
      rangeLevelHasData(currentTrajectoryRangeLevel)
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
