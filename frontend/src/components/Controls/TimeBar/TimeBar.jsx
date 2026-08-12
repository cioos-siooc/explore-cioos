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
  useTimeAxis,
  QUICK_PICKS,
  lastDaysRange,
  matchQuickPick
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
export default function TimeBar () {
  const { t } = useTranslation()
  const {
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    timeFilterActive,
    timeExtent
  } = useFilters()
  const {
    zoom,
    tracksMode,
    dataLayers,
    scrubTime,
    setScrubTime,
    trailingDays,
    setTrailingDays
  } = useMapState()

  const barRef = useRef(null)
  usePublishedFootprint(barRef, '--cioos-time-bar-space', measureBarSpace)

  // The scrub only means something while the trajectory layers are drawing
  // their tracks; the range filter always does, which is why the bar itself is
  // always mounted and only this pill comes and goes.
  const scrubActive = tracksMode && anyTrajectoryLayerOn(dataLayers)

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

  // Which ready-made window the range currently is, for the preset dropdown.
  const presetValue = matchQuickPick(startDate, endDate, defaultStartDate)

  // Zoomed out, the long windows load clamped (see effectiveTrailingDays), so
  // say so on the picker rather than let the choice look like it did nothing.
  const loadedTrailDays = effectiveTrailingDays(trailingDays, zoom)
  const zoomClamped = loadedTrailDays !== trailingDays

  // The range handles are bounded by the filter's own legal domain rather than
  // by the drawn axis: a date typed into the inputs may reach outside the data
  // (and then widens the axis to meet it), while a dragged handle can't leave
  // the axis in the first place.
  const setHandleValue = useCallback(
    (handle, iso) => {
      if (handle === 'start') {
        setStartDate(clampIso(iso, defaultStartDate, endDate))
      } else if (handle === 'end') {
        setEndDate(clampIso(iso, startDate, maxIso))
      } else {
        setScrubTime(clampIso(iso, scrubMinIso, domainEnd))
      }
    },
    [
      setStartDate,
      setEndDate,
      setScrubTime,
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
            onCommit={(value) => setHandleValue('start', value)}
          />
          <span className='timeRailFieldSep'>–</span>
          <DateField
            label={t('timeSelectorEndDate')}
            value={endDate}
            min={startDate}
            max={maxIso}
            onCommit={(value) => setHandleValue('end', value)}
          />
          {/* The ready-made windows the Filters panel lays out as a row of
              buttons. There is no room for a row here, so they fold into a
              dropdown — the same set, one line high. It shows the current
              range's own window when it is one of these; an unfiltered range
              is "All", which is what a first visit reads. */}
          <select
            className='timeRailPresetSelect'
            aria-label={t('timeBarPresetLabel')}
            title={t('timeBarPresetLabel')}
            value={presetValue}
            onChange={(event) => {
              const { value } = event.target
              if (value === 'all') {
                setStartDate(defaultStartDate)
                setEndDate(maxIso)
              } else if (value) {
                const { start, end } = lastDaysRange(Number(value))
                setStartDate(start)
                setEndDate(end)
              }
            }}
          >
            {/* A range set by hand or by the handles is not one of these, so
                the closed select falls back to naming what it is for. */}
            {!presetValue && (
              <option value='' disabled>
                {t('timeBarPresetLabel')}
              </option>
            )}
            <option value='all'>{t('timeBarPresetAll')}</option>
            {QUICK_PICKS.map(({ days, labelKey }) => (
              <option key={days} value={days}>
                {t(labelKey)}
              </option>
            ))}
          </select>
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
