import React, { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'react-bootstrap-icons'

import { defaultStartDate } from '../../config.js'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import TimeRail, {
  DateField,
  IntervalSelect,
  useTimeAxis,
  matchQuickPick,
  slideRange
} from '../TimeRail/TimeRail.jsx'
import { clampIso } from '../TimeRail/timeAxis.js'
import usePublishedFootprint from '../../../state/ui/usePublishedFootprint.js'
import useMediaQuery, { MOBILE_QUERY } from '../../../state/ui/useMediaQuery.js'
import './styles.css'

// How far up the bar reaches from the bottom of the viewport: its own offset
// plus its height, which changes with the locale's label lengths. Everything
// else sitting over the lower map — the datasets sidebar, the legend on narrow
// screens, the zoom-to-dataset pill, MapLibre's own bottom-right stack — holds
// clearance from this rather than from a hardcoded height.
function measureBarSpace ({ top, height }) {
  return Math.max(window.innerHeight - top, height)
}

// The bottom time bar: the time-range filter, and nothing else.
//
// It carried three controls once — the filter range, the trajectory date and
// the slice of the gridded dataset being drawn — on the grounds that everything
// time-shaped belonged on one axis. Two of those have gone to the cards that
// describe the layers they move (see TrajectoryDate and GridTimeSlice), and
// what is left is the one control that really is about the whole catalogue:
// the two dates bounding what the map, the datasets list and the counts are
// filtered to.
//
// One card, floating clear of the bottom edge: the range's own fields along
// the top of it, the rail under them. It costs a strip of map, so it is only
// mounted while the filter is actually narrowing something — otherwise the
// range is set from the Time entry in the Filters panel and the map keeps the
// room. Not on a phone at all: a full-catalogue axis a finger wide is not
// something a date can be picked off, and the Filters panel is the one place
// the range is set there.
export default function TimeBar () {
  const { timeFilterActive } = useFilters()
  const isMobile = useMediaQuery(MOBILE_QUERY)

  if (!timeFilterActive || isMobile) return null
  return <TimeBarSurface />
}

// Split out so the bar's footprint is published by a component that only
// exists while the bar does: the property is cleared on unmount, which is what
// lets the sidebar, the legend and MapLibre's corners reclaim the bottom edge
// the moment it goes away.
function TimeBarSurface () {
  const { t } = useTranslation()
  const {
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    timeFilterActive,
    timeExtent
  } = useFilters()

  const barRef = useRef(null)
  usePublishedFootprint(barRef, '--cioos-time-bar-space', measureBarSpace)

  const { axis, maxIso } = useTimeAxis({
    timeExtent,
    timeFilterActive,
    startDate,
    endDate
  })

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
      if (handle === 'start') {
        setStartDate(clampIso(iso, defaultStartDate, endDate))
      } else setEndDate(clampIso(iso, startDate, maxIso))
    },
    [setStartDate, setEndDate, startDate, endDate, maxIso]
  )

  // What the rail does: the same, except that a dragged handle can't leave the
  // axis in the first place, and that a chosen window moves whole.
  const setHandleValue = useCallback(
    (handle, iso) => {
      if (!windowLocked) return setFieldValue(handle, iso)
      const { start, end } = slideRange(handle, iso, {
        startDate,
        endDate,
        minIso: defaultStartDate,
        maxIso
      })
      setStartDate(start)
      setEndDate(end)
    },
    [
      setFieldValue,
      setStartDate,
      setEndDate,
      windowLocked,
      startDate,
      endDate,
      maxIso
    ]
  )

  return (
    <div className='timeBar' ref={barRef} aria-label={t('timeBarAriaLabel')}>
      {/* The fields sit inside the card, along the top of the rail they drive,
          rather than in a pill of their own floating above it: one surface for
          one control. */}
      <div className='timeBarFields' role='group'>
        <span className='railFieldLabel'>{t('timeBarRangeLabel')}</span>
        <DateField
          label={t('timeSelectorStartDate')}
          value={startDate}
          min={defaultStartDate}
          max={endDate}
          onCommit={(value) => setFieldValue('start', value)}
        />
        <span className='railFieldSep'>–</span>
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
          className='railPresetSelect'
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
        <button
          type='button'
          className='railReset'
          title={t('timeBarResetRangeTitle')}
          aria-label={t('timeBarResetRangeTitle')}
          onClick={() => {
            setStartDate(defaultStartDate)
            setEndDate(maxIso)
          }}
        >
          <X size={14} />
        </button>
      </div>
      <TimeRail
        axis={axis}
        startDate={startDate}
        endDate={endDate}
        onCommit={setHandleValue}
      />
    </div>
  )
}
