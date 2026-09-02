import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'react-bootstrap-icons'

import {
  gridAxisNodes,
  getTimeDimension,
  getVerticalDimension,
  snapToGridNode,
  toElevation
} from '../../../wmsUtilities'
import Rail from '../Rail/Rail.jsx'
import { DateField } from '../TimeRail/TimeRail.jsx'
import { DepthField } from '../DepthRail/DepthRail.jsx'
import { MS_PER_DAY, msToIso } from '../TimeRail/timeAxis.js'
import gridTimeTicks from './gridTimeTicks.js'
import './styles.css'

// Which slice of the drawn grid the map is painting, in each of the two axes a
// griddap dataset can have — set on the griddap card that already carries
// everything else about that overlay: the variable, the colorbar, the way out.
//
// Both used to live on the bars along the edges of the map, beside the filters
// for the same axes, on the grounds that a date belongs with the other dates
// and a depth with the other depths. What that cost was context: the controls
// sat a screen away from the colorbar whose caption they change, and the time
// one made the bottom bar grow a second rail to hold it, because a dataset's
// own span is usually a sliver of the catalogue's and a mark on a sliver can be
// read but never moved. Here each axis is the whole width, and the reading the
// shared bars gave — where in the record this slice sits — is what the count
// beside each row says instead.

// A slice's endpoints as evenly spaced nodes, or null when the dataset has no
// such axis (most griddap datasets have both, but a single-level field or a
// static climatology is a grid too). Guarded on the numbers as well as on the
// dimension: the harvest can carry a vertical axis whose bounds it never
// learned, and a NaN node would place the marker nowhere.
function finiteNodes (min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return gridAxisNodes(min, max, count)
}

export function gridTimeNodes (overlay) {
  const dimension = getTimeDimension(overlay?.dimensions)
  if (!dimension) return null
  return finiteNodes(
    Date.parse(dimension.min),
    Date.parse(dimension.max),
    dimension.n_values
  )
}

// In depth — positive down, which is what the rail and the filter both work in.
// ERDDAP's WMS ELEVATION is altitude, so the two are each other's negation
// whichever way round the dataset labels its own axis, and the endpoints swap
// over on an altitude grid.
export function gridDepthNodes (overlay) {
  const dimension = getVerticalDimension(overlay?.dimensions)
  if (!dimension) return null
  const ends = [dimension.min, dimension.max].map(
    (value) => -toElevation(dimension, value)
  )
  return finiteNodes(
    Math.min(...ends),
    Math.max(...ends),
    dimension.n_values
  )
}

// One row: the two steppers, whatever field the axis reads in, and how far
// through the dataset the drawn slice is.
//
// The steppers are the row's reason for existing. A grid can hold thousands of
// slices, which is more than any rail gives a pixel each to, and the count is
// the only thing on the card that says whether there is another one on either
// side.
function SliceRow ({
  className,
  index,
  count,
  prevLabel,
  nextLabel,
  countTitle,
  onStep,
  children
}) {
  return (
    <div className={`gridSliceRow ${className}`}>
      <button
        type='button'
        className='railStep'
        title={prevLabel}
        aria-label={prevLabel}
        disabled={index <= 0}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft size={10} />
      </button>
      {children}
      <button
        type='button'
        className='railStep'
        title={nextLabel}
        aria-label={nextLabel}
        disabled={index >= count - 1}
        onClick={() => onStep(1)}
      >
        <ChevronRight size={10} />
      </button>
      <span className='gridSliceCount' title={countTitle}>
        {index + 1} / {count}
      </span>
    </div>
  )
}

export function GridTimeSlice ({ overlay, onChange }) {
  const nodes = gridTimeNodes(overlay)
  if (!nodes) return null
  return <TimeSlice nodes={nodes} time={overlay.time} onChange={onChange} />
}

// Split out so the hooks below never run for an overlay without the axis.
function TimeSlice ({ nodes, time, onChange }) {
  const { t } = useTranslation()

  // What the map is painting, snapped: a share link or the harvest could hand
  // over an instant between two slices.
  const valueMs = snapToGridNode(nodes, Date.parse(time))
  const iso = new Date(valueMs).toISOString()
  // A grid with slices closer together than a day has a time of day worth
  // showing; a daily or monthly one does not, and the date says it all.
  const subDaily = nodes.step < MS_PER_DAY
  const index = Math.round((valueMs - nodes.min) / nodes.step)

  const commit = useCallback(
    (ms) => onChange(new Date(snapToGridNode(nodes, ms)).toISOString()),
    [nodes, onChange]
  )

  // Plain linear: this is one dataset's own axis, evenly spaced by construction
  // (see gridAxisNodes), with no era to compress.
  const axis = useMemo(
    () => ({
      min: nodes.min,
      max: nodes.max,
      minText: new Date(nodes.min).toISOString(),
      maxText: new Date(nodes.max).toISOString(),
      toPos: (ms) => (ms - nodes.min) / (nodes.max - nodes.min),
      toValue: (pos) => nodes.min + pos * (nodes.max - nodes.min)
    }),
    [nodes]
  )

  const ticksFor = useCallback(
    (railLength) => gridTimeTicks(railLength, nodes.min, nodes.max),
    [nodes]
  )

  return (
    <div className='gridSlice'>
      <SliceRow
        className='gridSliceTime'
        index={index}
        count={nodes.count}
        prevLabel={t('gridTimePrev')}
        nextLabel={t('gridTimeNext')}
        countTitle={t('gridTimeCountTitle', {
          index: index + 1,
          total: nodes.count
        })}
        onStep={(delta) => commit(valueMs + delta * nodes.step)}
      >
        <DateField
          className='railValueInput timeRailDateInput gridSliceDateInput'
          label={t('gridTimeLabel')}
          value={iso.slice(0, 10)}
          min={msToIso(nodes.min)}
          max={msToIso(nodes.max)}
          // A typed date names a day; which of that day's slices it lands on is
          // the axis's business, and the clock beside it reports the answer.
          onCommit={(value) => commit(Date.parse(`${value}T00:00:00Z`))}
        />
        {subDaily && <span className='gridSliceClock'>{iso.slice(11, 16)}</span>}
      </SliceRow>
      {/* Time gets a rail and depth does not, which is the difference between
          the two axes rather than an inconsistency: a reanalysis carries
          thousands of time slices, where the marker's position is the only
          thing that says whereabouts in seven years of daily fields you are,
          while its levels are counted in tens and the figure names each one.
          A depth rail here would also have to be drawn on its side, which is
          the one way round a water column cannot be read (see DepthBar). */}
      <Rail
        className='gridSliceRail'
        axis={axis}
        handles={[
          {
            key: 'grid',
            value: valueMs,
            valueText: iso,
            label: t('gridTimeLabel'),
            className: 'railHandleMarker railHandleGrid'
          }
        ]}
        // How far into the dataset the drawn slice sits. Nothing is filtered
        // here — the band is the read the marker's position alone is too small
        // to give at a glance.
        bands={[
          {
            key: 'elapsed',
            from: nodes.min,
            to: valueMs,
            className: 'gridSliceFill'
          }
        ]}
        ticksFor={ticksFor}
        // Only the slices the dataset actually holds, so dragging steps through
        // the grid rather than scrubbing past it.
        snap={(ms) => snapToGridNode(nodes, ms)}
        // A slice per arrow press — the point of this rail — and ten to a
        // shifted or paged one, for the grids that hold thousands.
        stepFor={(event) =>
          nodes.step * (event.shiftKey || event.key.startsWith('Page') ? 10 : 1)}
        onCommit={(handle, ms) => commit(ms)}
      />
    </div>
  )
}

export function GridDepthSlice ({ overlay, onChange }) {
  const dimension = getVerticalDimension(overlay?.dimensions)
  const nodes = gridDepthNodes(overlay)
  if (!nodes) return null
  return (
    <DepthSlice
      nodes={nodes}
      elevation={overlay.elevation}
      // Which way the dataset counts its own axis. The nodes are always in
      // depth so that stepping runs the same way for both — level 1 at the top
      // of the column, level N at the bottom — but the figure shown is the
      // dataset's own, and an altitude grid counting up from the ground must
      // not be reported as a stack of negative depths.
      positiveUp={dimension.name !== 'depth'}
      units={dimension.units || 'm'}
      onChange={onChange}
    />
  )
}

function DepthSlice ({ nodes, elevation, positiveUp, units, onChange }) {
  const { t } = useTranslation()

  const depth = snapToGridNode(nodes, -elevation)
  const index = Math.round((depth - nodes.min) / nodes.step)

  // Between the axis (depth, positive down) and the figure on the card (the
  // dataset's own). Its own negation either way round, so one pair of helpers
  // covers both directions.
  const shown = (value) => (positiveUp ? -value : value)
  const bounds = [shown(nodes.min), shown(nodes.max)].sort((a, b) => a - b)

  function commit (value) {
    onChange(-snapToGridNode(nodes, shown(value)))
  }

  return (
    <SliceRow
      className='gridSliceDepth'
      index={index}
      count={nodes.count}
      prevLabel={t('gridDepthPrev')}
      nextLabel={t('gridDepthNext')}
      countTitle={t('gridDepthCountTitle', {
        index: index + 1,
        total: nodes.count
      })}
      onStep={(delta) => onChange(-snapToGridNode(nodes, depth + delta * nodes.step))}
    >
      <DepthField
        className='railValueInput gridSliceDepthInput'
        label={t('gridDepthLabel')}
        value={Math.round(shown(depth))}
        min={Math.ceil(bounds[0])}
        max={Math.floor(bounds[1])}
        onCommit={commit}
      />
      {/* Metres unless the dataset says otherwise, in which case it has to say
          so: the figure is the dataset's own, not a converted one. */}
      <span className='gridSliceUnits'>{units}</span>
    </SliceRow>
  )
}
