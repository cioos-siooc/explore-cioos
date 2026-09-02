import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'react-bootstrap-icons'

import {
  TRAIL_ALL,
  effectiveTrailingDays,
  trackLineColor,
  tracksMinDate,
  trailingWindowOptions
} from '../../config.js'
import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import TimeRail, { DateField } from '../TimeRail/TimeRail.jsx'
import {
  MS_PER_DAY,
  clampIso,
  createTimeAxis,
  isoToMs,
  msToIso,
  todayIso
} from '../TimeRail/timeAxis.js'
import './styles.css'

// The trajectory group of the map legend: the two keys it has always drawn —
// the track line and the heading arrowhead — with the controls that set what
// they draw sitting on the keys themselves.
//
// It used to be a tinted pill floating over the bottom of the map, on the same
// rail as the time filter. Reading the scrub date against the filtered range
// was the argument for that, and it was a thin one: the tracks deliberately
// ignore the filter (see Map.jsx), so the two dates on one axis invited a
// comparison that means nothing. What the date does belong beside is the thing
// it moves — the line and the arrowhead the legend was already naming, in a
// card that is only ever there when they are.
//
// Three rows. The trail window rides the line it shortens; the date rides the
// arrowhead it moves; and under them the rail, which is how a date is picked by
// eye rather than typed. The rail spans the tracks' own domain (2000 → today,
// see tracksMinDate) rather than the catalogue's: this card is 190px wide, and
// the century of empty axis the bottom bar has room to show would leave the
// Argo era a thumbnail.
export default function TrajectoryDate () {
  const { t } = useTranslation()
  const { zoom, scrubTime, setScrubTime, trailingDays, setTrailingDays } =
    useMapState()

  const maxIso = todayIso()
  const axis = useMemo(() => createTimeAxis(tracksMinDate, maxIso), [maxIso])
  const value = clampIso(scrubTime, tracksMinDate, maxIso)

  // Zoomed out the long windows load clamped (see effectiveTrailingDays), so
  // both the trail band below and the mark beside the picker report the window
  // actually drawn rather than the one asked for.
  const loadedTrail = effectiveTrailingDays(trailingDays, zoom)
  const zoomClamped = loadedTrail !== trailingDays

  function commit (iso) {
    setScrubTime(clampIso(iso, tracksMinDate, maxIso))
  }

  function stepDay (delta) {
    commit(msToIso(isoToMs(value) + delta * MS_PER_DAY))
  }

  return (
    <div className='trajectoryDate'>
      <div className='legendItem trajectoryDateRow'>
        <svg className='legendSwatch' width='12' height='12'>
          <line
            x1='1'
            y1='10.5'
            x2='11'
            y2='1.5'
            stroke={trackLineColor}
            strokeWidth='2.5'
            strokeLinecap='round'
          />
        </svg>
        <span className='legendItemLabel'>{t('legendTrackLine')}</span>
        {/* The window's own name is dropped — every option reads as a duration
            already — but it keeps the tooltip that explains a window the zoom
            gate is currently clamping. */}
        <select
          className='trajectoryTrailSelect'
          aria-label={t('trajectoryTrailLabel')}
          title={
            zoomClamped
              ? t('legendTrackTrailZoomGated')
              : t('trajectoryTrailLabel')
          }
          value={trailingDays}
          onChange={(event) =>
            setTrailingDays(
              event.target.value === TRAIL_ALL
                ? TRAIL_ALL
                : Number(event.target.value)
            )}
        >
          {trailingWindowOptions.map((days) => (
            <option key={days} value={days}>
              {days === TRAIL_ALL
                ? t('trajectoryTrailAll')
                : days === 365
                  ? t('trajectoryTrailOneYear')
                  : `${days} ${t('trajectoryTrailDays')}`}
            </option>
          ))}
        </select>
        {zoomClamped && (
          <span
            className='trajectoryTrailClamped'
            title={t('legendTrackTrailZoomGated')}
          >
            *
          </span>
        )}
      </div>

      {/* The arrowhead's row carries no written name: the date field takes the
          width one would need, and at 190px the card has none to spare. What
          the mark means is the row's tooltip, and the field's own label. */}
      <div
        className='legendItem trajectoryDateRow'
        title={t('legendTrackHead')}
      >
        {/* the same arrowhead the map draws, pointing along the course */}
        <svg className='legendSwatch' width='12' height='12' viewBox='0 0 16 16'>
          <path
            d='M8 1.5 L13.5 13.5 L8 10.5 L2.5 13.5 Z'
            fill={trackLineColor}
            stroke='#ffffff'
            strokeWidth='1.5'
            strokeLinejoin='round'
            transform='rotate(45 8 8)'
          />
        </svg>
        <DateField
          className='railValueInput timeRailDateInput trajectoryDateInput'
          label={t('trajectoryDateLabel')}
          value={value}
          min={tracksMinDate}
          max={maxIso}
          onCommit={commit}
        />
        {/* A day either way. The rail beneath gives the whole domain 160-odd
            pixels, so a single day is a fraction of one and cannot be dragged
            to; these are how it is reached without typing the date. Chevrons
            rather than the filled carets the rest of the app steps with: the
            filled triangle is the heading arrow's own swatch, two places left
            of here, and two solid triangles on one row read as one control. */}
        <button
          type='button'
          className='railStep'
          title={t('trajectoryDatePrevDay')}
          aria-label={t('trajectoryDatePrevDay')}
          disabled={value <= tracksMinDate}
          onClick={() => stepDay(-1)}
        >
          <ChevronLeft size={10} />
        </button>
        <button
          type='button'
          className='railStep'
          title={t('trajectoryDateNextDay')}
          aria-label={t('trajectoryDateNextDay')}
          disabled={value >= maxIso}
          onClick={() => stepDay(1)}
        >
          <ChevronRight size={10} />
        </button>
      </div>

      <TimeRail
        className='trajectoryDateRail'
        axis={axis}
        scrub={{
          value,
          // The stretch of history the tracks actually cover behind the date —
          // the same window the tiles are built from, clamp included. 'All time'
          // is the whole axis rather than a number of days.
          trailStartMs:
            loadedTrail === TRAIL_ALL
              ? axis.minMs
              : Math.max(
                isoToMs(value) - loadedTrail * MS_PER_DAY,
                axis.minMs
              )
        }}
        onCommit={(handle, iso) => commit(iso)}
      />
    </div>
  )
}
