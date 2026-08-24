import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronCompactDown,
  ChevronCompactUp,
  Circle,
  CircleFill,
  HexagonFill
} from 'react-bootstrap-icons'

import {
  capitalizeFirstLetter,
  generateColorStops
} from '../../../utilities.jsx'
import {
  colorScale,
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
import LegendFooter from './LegendFooter.jsx'
import usePublishedFootprint from '../../../state/ui/usePublishedFootprint.js'

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

// The hex entry's icon colour: a cell from the middle of the ramp, which is what
// an average hexagon looks like on the map. Picking an end of the ramp would have
// made the icon claim a count.
const HEX_ICON_COLOR = colorScale[Math.floor(colorScale.length / 2)]

// Where a surface stacking with this card starts, published as a pair because
// this card changes corners: top-right on a wide screen, bottom-left under
// 900px (see the stylesheet). Whichever corner it holds, the surface stacking
// with it goes on the far side — under the card's foot when it is anchored to
// the top, over its head when it is anchored to the bottom — so the two
// measurements are `top:` and `bottom:` values respectively.
//
// It collapses to its header row and grows with what is on the map, so its
// height has to be told rather than assumed. The griddap legend's button is the
// one thing reading these today (see the WmsLegend stylesheet).
const LEGEND_STACK_GAP = 8
function measureLegendBelowSpace (rect) {
  return rect.bottom + LEGEND_STACK_GAP
}
function measureLegendAboveSpace (rect) {
  return window.innerHeight - rect.top + LEGEND_STACK_GAP
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

// Compact floating legend card (top-right), under one collapse.
//
// Its contents are grouped by the KIND OF THING on the map, each group under its
// own label: the observations (the hex ramp, the marker size and platform
// keys), the trajectory tracks, the seafloor depth ramp, and the layers with no
// key of their own. A flat list of captions could not say which of them belonged
// together — "Platform type" sat at the same level as "Depth (m)" though one
// describes the data and the other the basemap under it.
//
// A group's label row carries the switch for everything in that group, so a
// group is exactly what one switch hides, and each entry inside is a sub-caption
// one level down. That is also why the marker keys live with the hex ramp rather
// than in a group of their own: hexes and markers are the same observations at
// different zooms, under the same switch.
//
// There is exactly one switch for the hexagons, on the observations group, and
// it covers every hexagon whatever kind of data it holds.
//
// Under all of it, outside the collapse, the card's foot carries what the map
// itself is measured and made from: the scale bar and the basemap credits (see
// LegendFooter).
export default function Legend({
  // The point-tier range, which the marker size key reads.
  currentRangeLevel,
  // The one domain every hexagon on the map is coloured over, whatever kind of
  // data it holds — see MapStateProvider.
  hexRangeLevel,
  // True when that domain is the extent of the hexes on screen rather than the
  // whole catalogue's, which is what makes the bar's numbers move with the
  // camera. It earns a tooltip, not a line: it is the answer to a question the
  // bar raises only for the people who notice it.
  hexRangeScaledToView = false,
  loading,
  zoom,
  platformsAvailable = [],
  // { observations, bathymetry, tracks }, each { key, label, checked, onChange }
  // — the switches that ride on legend captions. Absent members simply render
  // their entry without a switch.
  controls = {},
  layerControls = [],
  trailingDays,
  dataLayers,
  // The date the time bar's scrub handle is on, named in the trajectory keys —
  // the track lines and the heading arrows are drawn relative to it.
  scrubTime
}) {
  const { t } = useTranslation()
  // The card's collapse, and the only thing that hides any of this: open, it
  // shows the whole list — the ramps, their ticks, the marker keys, the track
  // lines, the remaining layer switches; closed, it is the header row alone.
  const [legendOpen, setLegendOpen] = useState(true)
  const cardRef = useRef(null)
  usePublishedFootprint(
    cardRef,
    '--cioos-legend-below-space',
    measureLegendBelowSpace
  )
  usePublishedFootprint(
    cardRef,
    '--cioos-legend-above-space',
    measureLegendAboveSpace
  )

  // Fall back to the default selection when the prop is absent (older callers /
  // initial render) — all-on would claim legend entries the map isn't drawing.
  const layers = dataLayers || DEFAULT_DATA_LAYERS
  const markerTier = isMarkerTier(zoom)
  const trajectoryOn = anyTrajectoryLayerOn(layers)
  // Read off the control rather than passed twice: it is the same boolean.
  const tracksMode = Boolean(controls.tracks?.checked)
  // The hex/point layer is switched off (the toggle in the ramp title row).
  // Its key stays put — the switch has to keep something to sit beside, and the
  // numbers are still worth reading — but muted: a fully saturated ramp under
  // an off switch reads as a live layer.
  const observationsHidden = controls.observations
    ? !controls.observations.checked
    : false

  // Which geometries are drawn as hexagons right now. Below the marker tier
  // everything is: the profile families, the trajectory cells and the
  // occurrence cells are summed into one hexes layer. At the marker tier the
  // profile families have become individual points, so the only hexes left are
  // the trajectory/occurrence coverage cells.
  //
  // Nothing here is gated on a per-geometry display switch: the selection in the
  // geometry filter is the only thing that decides which kinds of data reach the
  // hexagons (see buildTileSuffix).
  const profileFamilyOn =
    layers.profile || layers.timeseries || layers.timeseriesProfile
  const cellsAsHexes = layers.obis || trajectoryOn
  const hexesOnMap = markerTier ? cellsAsHexes : profileFamilyOn || cellsAsHexes
  // The marker keys (size, platform colours) describe the point tier only.
  const pointsOnMap = markerTier && profileFamilyOn

  // One group: its label row — the switch for everything in the group, then the
  // group's title — and its contents. The label row is never dimmed; it holds
  // the control that turns the group back on.
  //
  // `label` may be absent, for a group whose rows are already self-describing
  // switches — a label there would only name the leftovers.
  function renderGroup(key, label, { control, tooltip } = {}, children) {
    return (
      <div className='legendGroup' key={key}>
        {(label || control) && (
          <div className='legendGroupLabelRow'>
            {control && (
              <Switch
                id={`mapLayer-${control.key}`}
                title={control.label}
                checked={control.checked}
                onChange={control.onChange}
              />
            )}
            {typeof label === 'string' ? (
              <div className='legendGroupLabel' title={tooltip}>
                {label}
              </div>
            ) : (
              label
            )}
          </div>
        )}
        {children}
      </div>
    )
  }

  // A caption one level down from a group label: it names one entry inside the
  // group, with the shape that entry draws on the map beside it. Sentence case
  // against the group labels' upper case, which is what keeps the two levels
  // apart at this size; the icon is what tells the entries apart at a glance,
  // since "Hexes" and "Markers" are the same length and weight.
  function renderSubCaption(caption, { icon, tooltip } = {}) {
    return (
      <div className='legendSubCaption' title={tooltip}>
        {icon}
        <span>{caption}</span>
      </div>
    )
  }

  // Continuous color bar for a hex ramp. The hex counts follow a non-linear
  // (power/log) scale, so the colors are spaced evenly by their scale index
  // rather than by value — a linear-value axis would collapse the ramp into the
  // dominant high-count color. Count ticks are drawn at each stop (thinned to
  // keep the compact bar legible), which naturally reads as a log axis.
  function renderColorBar(scale, rangeLevel, dimmed) {
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
      <div
        className={classNames({ legendDimmed: dimmed })}
        // Why the numbers under the bar move when the map does. Only when they
        // do: a bar drawn over the catalogue's domain has nothing to explain.
        title={hexRangeScaledToView ? t('legendScaledToView') : undefined}
      >
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

  // The observations group's title: what the hex colours and the marker sizes
  // count, which is days of data everywhere on the map (see HEX_METRIC). It was
  // a dropdown while the ramp could count records or datasets instead; now it
  // is the plain label it titles. The entries under it say which shape is
  // carrying the count (see renderSubCaption), so the title doesn't have to.
  function renderMetricTitle() {
    // Nothing on the map is keyed to a count (tracks only, say): a title for a
    // ramp that isn't there names nothing.
    if (!hexesOnMap && !pointsOnMap) return null
    return t('legendMetricDays')
  }

  // Stands in for the ramp when this tier has no counts to show yet. /legend is
  // still in flight and there's no ramp from a previous query to fall back on:
  // the counts are unknown, not zero. Saying "No Data" then (as this did) tells
  // the user their filters excluded everything, which is a guess — and usually a
  // wrong one.
  function renderMissingCounts() {
    if (loading) {
      return (
        <div className='legendLoading'>
          <Spinner size='sm' />
          <span>{t('legendLoadingText')}</span>
        </div>
      )
    }
    return (
      <div className='legendNoData' title={t('legendNoDataWarningTitle')}>
        {t('legendNoDataWarningText')}
      </div>
    )
  }

  // No counts at all for this tier yet — the group's title still says what they
  // would have counted, so this stands where its entries would be rather than
  // under one of them. The tier's primary count is the hexes below the marker
  // tier and the points at it.
  function renderCountStatus() {
    if (!hexesOnMap && !pointsOnMap) return null
    if (!isEmpty(markerTier ? currentRangeLevel : hexRangeLevel)) return null
    return renderMissingCounts()
  }

  // The one hex gradient. It is shown whenever there are hexagons on the map,
  // and it is the same gradient for all of them — profile families, trajectory
  // cells and occurrence records alike. There is deliberately no second ramp
  // for the coverage cells: colour means "how much data" everywhere on the map,
  // and WHAT a hexagon holds is in its hover tooltip, where a second colour
  // domain under the same green scale could never have said it.
  //
  // A missing hex domain at the marker tier is not an error to report: the points
  // carry the reading there and the hexes are the coverage cells drawn over them,
  // so there is simply no bar to draw (see renderCountStatus for the case where
  // the tier has no counts at all).
  //
  // `labelled` is false when the markers are not on screen: the bar is then the
  // only thing in the group, the title above it already says what its colours
  // count, and a caption naming the one entry present is a line spent saying
  // nothing. The label earns its place only where there is a second entry — the
  // markers — for it to tell the bar apart from.
  function renderHexEntry(labelled) {
    if (!hexesOnMap || isEmpty(hexRangeLevel)) return null
    return (
      <div className='legendSubsection'>
        {labelled &&
          renderSubCaption(t('legendHexes'), {
            icon: (
              <HexagonFill
                className='legendSubIcon'
                size={9}
                fill={HEX_ICON_COLOR}
                aria-hidden='true'
              />
            )
          })}
        {renderColorBar(colorScale, hexRangeLevel, observationsHidden)}
      </div>
    )
  }

  // The CHS NONNA depth ramp. It keys a basemap raster rather than the data, so
  // it is its own group — named and switched at group level like the rest, and
  // untouched by the observations switch.
  function renderBathymetryBar() {
    // zoom is undefined until the map first reports its view, and `undefined <
    // n` is false — so test for the zoom being known as well, or the bar
    // flashes on before the raster it describes exists.
    if (!Number.isFinite(zoom) || zoom < bathymetryLegendMinZoom) return null
    const hidden = controls.bathymetry ? !controls.bathymetry.checked : false
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
      <div className={classNames({ legendDimmed: hidden })}>
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

  // The marker keys: how big a circle is, and what colour it is. Both describe
  // the markers, which are the same observations as the hexes at a closer zoom —
  // so they are sub-entries of the observations group rather than a group of
  // their own, under its switch, and they dim with it.
  function renderMarkerKeys() {
    // A missing range is reported by renderHexRamp, which owns the status line
    // for this tier — the keys just stay away.
    if (!pointsOnMap || isEmpty(currentRangeLevel)) return null
    // Points are keyed to days of data, like the hexes (HEX_METRIC). One line
    // rather than a stacked pair, and one number rather than both ends of the ramp:
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
    const dimClass = classNames('legendSubsection', {
      legendDimmed: observationsHidden
    })
    return (
      <>
        <div className={dimClass}>
          {renderSubCaption(t('legendMarkers'), {
            icon: (
              <Circle className='legendSubIcon' size={8} aria-hidden='true' />
            ),
            tooltip: t('legendMarkerDaysPinned')
          })}
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
            {/* No icon: a neutral filled circle here is the same shape as the
                swatches right below, and in grey it read as the "Unknown"
                platform rather than as a heading for all of them. */}
            {renderSubCaption(t('legendPlatformType'))}
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

  // The track-line swatches: the line and the heading arrowhead. They are one
  // drawing, named and switched by their group label — the switch was on the
  // line's own row once, where it looked like it hid only the line.
  //
  // The group appears while at least one trajectory geometry is in the filter
  // selection; the trajectory cells themselves are keyed by the hex ramp in the
  // observations group, like every other geometry's.
  //
  // The window shown is the one actually loaded, not the one requested: zoomed
  // out, the long trails are clamped (see effectiveTrailingDays), and a key that
  // still claimed "All time" there would be wrong.
  function renderTrackKeys() {
    if (!trajectoryOn) return null
    const loadedTrail = effectiveTrailingDays(trailingDays, zoom)
    const zoomClamped = loadedTrail !== trailingDays
    const trailLabel =
      loadedTrail === TRAIL_ALL ? t('timeBarTrailAll') : `${loadedTrail}d`
    return (
      <div className={classNames('legendItems', { legendDimmed: !tracksMode })}>
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
          <svg
            className='legendSwatch'
            width='12'
            height='12'
            viewBox='0 0 16 16'
          >
            <path
              d='M8 1.5 L13.5 13.5 L8 10.5 L2.5 13.5 Z'
              fill='#6749AC'
              stroke='#ffffff'
              strokeWidth='1.5'
              strokeLinejoin='round'
              transform='rotate(45 8 8)'
            />
          </svg>
          <span className='legendItemLabel'>
            {scrubTime
              ? t('legendTrackHeadAt', { date: scrubTime })
              : t('legendTrackHead')}
          </span>
        </div>
      </div>
    )
  }

  // The switches with nothing on the map keyed to them (gridded coverage, the
  // globe view). They are a group like the rest, labelled as what they are —
  // layers with no key — rather than left as loose rows at the foot of the card
  // where they read as trailing off the group above them.
  function renderLayerSwitches() {
    if (!layerControls.length) return null
    return (
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
    )
  }

  // Built up front so a group can be left out entirely when it would be empty —
  // a label with nothing under it is worse than no label.
  const countStatus = renderCountStatus()
  // Markers first: whether they are on screen decides whether the hex bar needs
  // naming (see renderHexEntry).
  const markerKeys = renderMarkerKeys()
  const hexEntry = renderHexEntry(Boolean(markerKeys))
  const trackKeys = renderTrackKeys()
  const bathymetryBar = renderBathymetryBar()
  const layerSwitches = renderLayerSwitches()

  // In order: the data, then how the moving platforms among it are drawn, then
  // the seafloor under it, then the layers that key nothing. Ordered from the
  // reader's question outwards — "what am I looking at" before "what is under
  // it" — rather than by which entries happen to be colour ramps.
  //
  // The last group has no label: its rows are labelled switches already, and any
  // name for them would be a name for "the rest".
  const groups = [
    (countStatus || hexEntry || markerKeys) &&
      renderGroup(
        'observations',
        renderMetricTitle(),
        {
          control: controls.observations,
          tooltip: t('legendMetricDaysTitle')
        },
        <>
          {countStatus}
          {hexEntry}
          {markerKeys}
        </>
      ),
    trackKeys &&
      renderGroup(
        'trajectories',
        t('legendGroupTrajectories'),
        { control: controls.tracks },
        trackKeys
      ),
    bathymetryBar &&
      renderGroup(
        'seafloor',
        t('legendBathymetry'),
        { control: controls.bathymetry, tooltip: t('legendBathymetryTitle') },
        bathymetryBar
      ),
    layerSwitches && renderGroup('layers', null, {}, layerSwitches)
  ].filter(Boolean)

  return (
    <div className='legend' ref={cardRef}>
      <button
        className='legendHeader'
        onClick={() => setLegendOpen(!legendOpen)}
        title={legendOpen ? t('closeLegendTooltip') : t('openLegendTooltip')}
        aria-expanded={legendOpen}
      >
        <span>{t('legendTitle')}</span>
        {legendOpen ? (
          <ChevronCompactUp size={14} aria-hidden='true' />
        ) : (
          <ChevronCompactDown size={14} aria-hidden='true' />
        )}
      </button>
      {legendOpen && <div className='legendBody'>{groups}</div>}
      {/* Outside the collapse: the scale bar reads the map rather than the
          keys, so it is as useful with the card shut as open — closed, the card
          is its header row and the scale row, and nothing more. */}
      <LegendFooter />
    </div>
  )
}
