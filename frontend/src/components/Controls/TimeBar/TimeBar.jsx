import React, { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'react-bootstrap-icons'

import {
  defaultStartDate,
  tracksMinDate,
  trailingWindowOptions,
  TRAIL_ALL,
  effectiveTrailingDays
} from '../../config.js'
import { anyTrajectoryLayerOn } from '../../../state/dataLayers.js'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import usePublishedFootprint from '../../../state/ui/usePublishedFootprint.js'
import TimeRail, {
  DateField,
  IntervalSelect,
  useTimeAxis,
  matchQuickPick,
  slideRange
} from '../TimeRail/TimeRail.jsx'
import { MS_PER_DAY, isoToMs, clampIso } from '../TimeRail/timeAxis.js'
import './styles.css'

// How far up the bar reaches from the bottom of the viewport: its own offset
// plus its height, which changes with the locale's label lengths, with the
// tighter phone layout, and with whether the trajectory pill is shown.
// Everything else sitting over the lower map — the datasets sidebar, the legend
// on narrow screens, the zoom-to-dataset pill, MapLibre's own bottom-right
// stack — holds clearance from this rather than from a hardcoded height.
function measureBarSpace ({ top, height }) {
  return Math.max(window.innerHeight - top, height)
}

// The bottom time bar: one axis carrying both time controls the app has.
//
//   * the time-range filter (teal) — two handles bounding what the map, the
//     datasets list and the counts are filtered to;
//   * the trajectory scrub date (purple, only while the track layers are
//     drawing) — the instant each platform's position is drawn at, with its
//     trailing window shaded behind it.
//
// They share an axis but not a value: the scrub deliberately ignores the
// filter range (Map.jsx keeps timeMin/timeMax off the tracks request), so a
// narrow filter never strands the scrub outside its own domain.
//
// Two floating pieces with map showing between them: the input pills on top,
// the slider card beneath. Full bleed along the bottom edge on phones, a
// centered bubble once there is room for one.
//
// It costs a strip of map, so it is only there when it has something to say:
// either a time filter is narrowing what is drawn — and then it shows what
// that range is and lets it be moved or cleared — or trajectories are drawing
// and the scrub is what dates them. With neither, the range is set from the
// Time entry in the Filters panel and the map keeps the room.
export default function TimeBar () {
  const { timeFilterActive } = useFilters()
  const { tracksMode, dataLayers } = useMapState()

  const scrubActive = tracksMode && anyTrajectoryLayerOn(dataLayers)
  if (!timeFilterActive && !scrubActive) return null

  return <TimeBarSurface scrubActive={scrubActive} />
}

// Split out so the bar's footprint is published by a component that only
// exists while the bar does: the property is cleared on unmount, which is what
// lets the sidebar, the legend and MapLibre's corners reclaim the bottom edge
// the moment it goes away.
function TimeBarSurface ({ scrubActive }) {
  const { t } = useTranslation()
  const {
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    timeFilterActive,
    timeExtent
  } = useFilters()
  const { zoom, scrubTime, setScrubTime, trailingDays, setTrailingDays } =
    useMapState()

  const barRef = useRef(null)
  usePublishedFootprint(barRef, '--cioos-time-bar-space', measureBarSpace)

  const { axis, maxIso, domainStart, domainEnd } = useTimeAxis({
    timeExtent,
    timeFilterActive,
    startDate,
    endDate,
    includeToday: scrubActive
  })

  // The scrub has its own floor (the tracks only go back so far) but can never
  // leave the drawn axis either.
  const scrubMinIso = tracksMinDate > domainStart ? tracksMinDate : domainStart
  const scrubIso = clampIso(scrubTime, scrubMinIso, domainEnd)

  // Zoomed out, the long windows load clamped (see effectiveTrailingDays), so
  // say so on the picker rather than let the choice look like it did nothing.
  const loadedTrailDays = effectiveTrailingDays(trailingDays, zoom)
  const zoomClamped = loadedTrailDays !== trailingDays

  // A chosen window is a window, so the rail moves it as one: dragging either
  // end takes the other with it and the span keeps its length. Typing a date
  // still moves that one end on its own — and the span it leaves behind is no
  // longer one of the ready-made ones, which is what releases the hold.
  const windowLocked = !['', 'all'].includes(
    matchQuickPick(startDate, endDate, defaultStartDate)
  )

  // What the typed date fields do. Each moves its own end, bounded by the other
  // and by the filter's own legal domain rather than by the drawn axis: a date
  // typed in here may reach outside the data, and then widens the axis to meet
  // it.
  const setFieldValue = useCallback(
    (handle, iso) => {
      if (handle === 'start') setStartDate(clampIso(iso, defaultStartDate, endDate))
      else setEndDate(clampIso(iso, startDate, maxIso))
    },
    [setStartDate, setEndDate, startDate, endDate, maxIso]
  )

  // What the rail does: the same, except that a dragged handle can't leave the
  // axis in the first place, that a chosen window moves whole, and that the
  // scrub — which only ever lives on the rail — has its own bounds.
  const setHandleValue = useCallback(
    (handle, iso) => {
      if (handle === 'scrub') {
        setScrubTime(clampIso(iso, scrubMinIso, domainEnd))
      } else if (windowLocked) {
        const { start, end } = slideRange(handle, iso, {
          startDate,
          endDate,
          minIso: defaultStartDate,
          maxIso
        })
        setStartDate(start)
        setEndDate(end)
      } else {
        setFieldValue(handle, iso)
      }
    },
    [
      setFieldValue,
      setStartDate,
      setEndDate,
      setScrubTime,
      windowLocked,
      startDate,
      endDate,
      maxIso,
      scrubMinIso,
      domainEnd
    ]
  )

  return (
    <div className='timeBar' ref={barRef} aria-label={t('timeBarAriaLabel')}>
      {/* One row for the two input groups, above the slider they drive. Each is
          named, and tinted in the colour of its handle — the label says which
          control it is, the colour says which mark on the rail it moves. */}
      <div className='timeBarFields'>
        <div className='timeRailField timeRailFieldRange' role='group'>
          <span className='timeRailFieldLabel'>{t('timeBarRangeLabel')}</span>
          <DateField
            label={t('timeSelectorStartDate')}
            value={startDate}
            min={defaultStartDate}
            max={endDate}
            onCommit={(value) => setFieldValue('start', value)}
          />
          <span className='timeRailFieldSep'>–</span>
          <DateField
            label={t('timeSelectorEndDate')}
            value={endDate}
            min={startDate}
            max={maxIso}
            onCommit={(value) => setFieldValue('end', value)}
          />
          {/* The ready-made windows the Filters panel spells out as a labelled
              row. There is no room for a label here, so the picker names itself
              until a window is chosen. */}
          <IntervalSelect
            className='timeRailPresetSelect'
            ariaLabel={t('timeBarPresetLabel')}
            startDate={startDate}
            endDate={endDate}
            defaultStart={defaultStartDate}
            maxIso={maxIso}
            onSelect={(start, end) => {
              setStartDate(start)
              setEndDate(end)
            }}
          />
          {timeFilterActive && (
            <button
              type='button'
              className='timeRailReset'
              title={t('timeBarResetRangeTitle')}
              aria-label={t('timeBarResetRangeTitle')}
              onClick={() => {
                setStartDate(defaultStartDate)
                setEndDate(maxIso)
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {scrubActive && (
          <div className='timeRailField timeRailFieldScrub' role='group'>
            <span className='timeRailFieldLabel'>{t('timeBarScrubLabel')}</span>
            <DateField
              label={t('timeBarScrubLabel')}
              value={scrubIso}
              min={scrubMinIso}
              max={domainEnd}
              onCommit={(value) => setHandleValue('scrub', value)}
            />
            {/* The trail window: its own name is dropped — every option reads as
                a duration already — but it keeps the tooltip that explains a
                window the zoom gate is currently clamping. */}
            <select
              className='timeRailTrailSelect'
              aria-label={t('timeBarTrailingWindowLabel')}
              title={
                zoomClamped
                  ? t('legendTrackTrailZoomGated')
                  : t('timeBarTrailingWindowLabel')
              }
              value={trailingDays}
              onChange={(event) =>
                setTrailingDays(
                  event.target.value === TRAIL_ALL
                    ? TRAIL_ALL
                    : Number(event.target.value)
                )
              }
            >
              {trailingWindowOptions.map((days) => (
                <option key={days} value={days}>
                  {days === TRAIL_ALL
                    ? t('timeBarTrailAll')
                    : days === 365
                      ? t('timeBarOneYear')
                      : `${days} ${t('timeBarDays')}`}
                </option>
              ))}
            </select>
            {zoomClamped && (
              <span
                className='timeRailTrailClamped'
                title={t('legendTrackTrailZoomGated')}
              >
                *
              </span>
            )}
          </div>
        )}
      </div>

      <div className='timeBarSlider'>
        <TimeRail
          axis={axis}
          startDate={startDate}
          endDate={endDate}
          scrub={
            scrubActive
              ? {
                value: scrubIso,
                // The stretch of history the tracks actually cover behind the
                // scrub date — the same window the tiles are built from,
                // clamp included.
                trailStartMs: Math.max(
                  isoToMs(scrubIso) - loadedTrailDays * MS_PER_DAY,
                  isoToMs(scrubMinIso)
                )
              }
              : undefined
          }
          onCommit={setHandleValue}
        />
      </div>
    </div>
  )
}
