import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { defaultStartDate } from '../../config.js'
import {
  MS_PER_DAY,
  createTimeAxis,
  isoToMs,
  msToIso,
  snapToDay,
  clampIso,
  todayIso,
  tickYearsFor
} from './timeAxis.js'
import './styles.css'

// The time slider itself, shared by the bar along the bottom of the map and by
// the Time filter in the Filters panel — the same axis, the same handles and
// the same colours in both places, so moving one is recognisably the same act
// as moving the other.
//
// It draws a range (two teal handles bounding the time filter) and, optionally,
// a scrub marker (one purple handle, the trajectory date) with the trailing
// window shaded behind it. Presentational: every value comes in as a prop and
// every change goes out through onCommit.

// Keyboard step per key, in days. Arrows walk a day at a time for the exact
// date; the coarser steps are what make a decades-wide domain navigable
// without a mouse.
function keyboardStepDays (event) {
  if (event.key === 'PageUp' || event.key === 'PageDown') return 365
  return event.shiftKey ? 30 : 1
}

function useMeasuredWidth (ref) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const publish = () => setWidth(el.getBoundingClientRect().width)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

// A date input that lets you finish typing.
//
// `type=date` fires a change for every keystroke, so typing "2015" into the
// year arrives as 0002, 0020, 0201, 2015 — and a controlled input that clamps
// each of those into range writes the minimum back over the second digit, which
// reads as the field refusing to be typed into. So nothing is clamped here: a
// value is either complete and in range, in which case it commits, or it is
// still being typed, in which case it is held locally until it becomes one or
// the field is left. Leaving with an unusable value restores the committed one.
export function isCommittable (value, min, max) {
  // Four-digit year and a real date — rules out every partial year, which is
  // what makes the field typeable.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  if (Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) return false
  return (!min || value >= min) && (!max || value <= max)
}

export function DateField ({ value, min, max, onCommit, label, className }) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)

  // Follow the committed value while the field is idle — the slider and the
  // share link both move it — but never while it is being typed into.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  return (
    <input
      type='date'
      className={className || 'timeRailDateInput'}
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        setDraft(event.target.value)
        if (isCommittable(event.target.value, min, max)) {
          onCommit(event.target.value)
        }
      }}
      onBlur={() => {
        setEditing(false)
        if (isCommittable(draft, min, max)) onCommit(draft)
        else setDraft(value)
      }}
    />
  )
}

// The ready-made windows, all of them "the last N days, ending today". Shared
// so the Filters panel (which has room to lay them out as buttons) and the bar
// over the map (which does not, and folds them into a dropdown) offer the same
// set — a window that exists in one place and not the other is a window users
// learn to go looking for in the wrong one.
export const QUICK_PICKS = [
  { days: 10, labelKey: 'timeSelectorQuickSelect10Days' },
  { days: 30, labelKey: 'timeSelectorQuickSelect30Days' },
  { days: 365, labelKey: 'timeSelectorQuickSelect1Year' },
  { days: 3652, labelKey: 'timeSelectorQuickSelect10Years' }
]

export function lastDaysRange (days) {
  const end = todayIso()
  const start = msToIso(isoToMs(end) - days * MS_PER_DAY)
  return { start, end }
}

// Which ready-made window the current range is, if any — so the dropdown can
// show the user's own choice selected rather than always reading "Custom".
// Returns the day count, 'all' for the unfiltered default, or '' for a range
// that is simply a range.
export function matchQuickPick (startDate, endDate, defaultStart) {
  const today = todayIso()
  if (endDate !== today) return ''
  if (startDate === defaultStart) return 'all'
  const pick = QUICK_PICKS.find(
    ({ days }) => lastDaysRange(days).start === startDate
  )
  return pick ? String(pick.days) : ''
}

// What the axis spans. The default is the whole filterable domain, but the
// catalogue rarely fills it — /timeExtent reports where the selected data
// actually starts and ends, and the axis shrinks to that so the rail is given
// to years that hold something.
//
// An *active* filter widens it back out when it reaches past the data (a share
// link asking for 1950 on a selection that starts in 2012), because a handle
// the axis can't represent is a handle that can't be dragged back. The default
// range is not treated that way: it means "unbounded", not "the user asked for
// 1900", so it doesn't get to stretch the axis to 1900.
export function useTimeAxis ({
  timeExtent,
  timeFilterActive,
  startDate,
  endDate,
  // Whether the axis has to reach "today" whatever the data says — it does
  // while the trajectory scrub is on it, since the scrub runs to now.
  includeToday = false
}) {
  const maxIso = todayIso()
  const dataStart = clampIso(
    timeExtent?.min?.split('T')[0] || defaultStartDate,
    defaultStartDate,
    maxIso
  )
  const dataEnd = clampIso(
    timeExtent?.max?.split('T')[0] || maxIso,
    dataStart,
    maxIso
  )
  const domainStart =
    timeFilterActive && startDate < dataStart ? startDate : dataStart
  const domainEnd = [
    dataEnd,
    timeFilterActive ? endDate : '',
    includeToday ? maxIso : ''
  ]
    .filter(Boolean)
    .reduce((latest, date) => (date > latest ? date : latest))

  const axis = useMemo(
    () => createTimeAxis(domainStart, domainEnd),
    [domainStart, domainEnd]
  )
  return { axis, maxIso, domainStart, domainEnd }
}

export default function TimeRail ({
  axis,
  startDate,
  endDate,
  // { value, minIso, trailStartMs } while the trajectory scrub shares this
  // rail; absent everywhere else.
  scrub,
  onCommit,
  className
}) {
  const { t } = useTranslation()
  const railRef = useRef(null)
  const draggingRef = useRef(null)
  const railWidth = useMeasuredWidth(railRef)

  const startPos = axis.toPos(isoToMs(startDate))
  const endPos = axis.toPos(isoToMs(endDate))
  const scrubPos = scrub ? axis.toPos(isoToMs(scrub.value)) : 0
  const trailStartPos = scrub ? axis.toPos(scrub.trailStartMs) : 0

  const positionFromClientX = useCallback((clientX) => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect || !rect.width) return 0
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
  }, [])

  const setHandleFromClientX = useCallback(
    (handle, clientX) => {
      const ms = snapToDay(axis.toMs(positionFromClientX(clientX)))
      onCommit(handle, msToIso(ms))
    },
    [axis, positionFromClientX, onCommit]
  )

  function beginDrag (handle) {
    return (event) => {
      // Keep the press off the rail handler below, and off the browser's own
      // text-selection / scroll gestures while a handle is being dragged.
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus()
      draggingRef.current = handle
    }
  }

  function onHandlePointerMove (event) {
    if (!draggingRef.current) return
    setHandleFromClientX(draggingRef.current, event.clientX)
  }

  function endDrag (event) {
    if (!draggingRef.current) return
    draggingRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // A press anywhere on the rail moves whichever handle is closest to it, so
  // the common "show me from here" gesture doesn't need the handle grabbed
  // first. Closeness is measured in axis position, not in days — that's what
  // the eye is judging on a warped axis.
  function onRailPointerDown (event) {
    const pos = positionFromClientX(event.clientX)
    const candidates = [
      ['start', startPos],
      ['end', endPos],
      ...(scrub ? [['scrub', scrubPos]] : [])
    ]
    const [handle] = candidates.reduce((best, candidate) =>
      Math.abs(candidate[1] - pos) < Math.abs(best[1] - pos) ? candidate : best
    )
    setHandleFromClientX(handle, event.clientX)
  }

  function onHandleKeyDown (handle, currentIso) {
    return (event) => {
      const step = keyboardStepDays(event)
      let next
      if (event.key === 'ArrowLeft' || event.key === 'PageDown') {
        next = isoToMs(currentIso) - step * MS_PER_DAY
      } else if (event.key === 'ArrowRight' || event.key === 'PageUp') {
        next = isoToMs(currentIso) + step * MS_PER_DAY
      } else if (event.key === 'Home') {
        next = axis.minMs
      } else if (event.key === 'End') {
        next = axis.maxMs
      } else {
        return
      }
      event.preventDefault()
      onCommit(handle, msToIso(snapToDay(next)))
    }
  }

  const ticks = useMemo(() => {
    const years = tickYearsFor(railWidth, axis.anchorYears, axis.toPos)
    return years.map((year) => ({
      year,
      pos: axis.toPos(isoToMs(`${year}-01-01`))
    }))
  }, [axis, railWidth])

  const handleProps = (handle, iso, label) => ({
    type: 'button',
    role: 'slider',
    'aria-label': label,
    'aria-valuemin': axis.minIso,
    'aria-valuemax': axis.maxIso,
    'aria-valuenow': iso,
    'aria-valuetext': iso,
    onPointerDown: beginDrag(handle),
    onPointerMove: onHandlePointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown: onHandleKeyDown(handle, iso)
  })

  return (
    <div className={className ? `timeRail ${className}` : 'timeRail'}>
      <div
        className='timeRailTrack'
        ref={railRef}
        onPointerDown={onRailPointerDown}
      >
        <div className='timeRailLine' />
        <div
          className='timeRailRangeFill'
          style={{
            left: `${startPos * 100}%`,
            width: `${Math.max(endPos - startPos, 0) * 100}%`
          }}
        />
        {scrub && (
          <div
            className='timeRailTrailBand'
            title={t('timeBarTrailBandTitle')}
            style={{
              left: `${trailStartPos * 100}%`,
              width: `${Math.max(scrubPos - trailStartPos, 0) * 100}%`
            }}
          />
        )}
        <button
          className='timeRailHandle timeRailHandleRange'
          style={{ left: `${startPos * 100}%` }}
          {...handleProps('start', startDate, t('timeBarRangeStartHandle'))}
        />
        <button
          className='timeRailHandle timeRailHandleRange'
          style={{ left: `${endPos * 100}%` }}
          {...handleProps('end', endDate, t('timeBarRangeEndHandle'))}
        />
        {scrub && (
          <button
            className='timeRailHandle timeRailHandleScrub'
            style={{ left: `${scrubPos * 100}%` }}
            {...handleProps('scrub', scrub.value, t('timeBarScrubLabel'))}
          />
        )}
      </div>
      <div className='timeRailTicks' aria-hidden='true'>
        {ticks.map(({ year, pos }) => (
          <span
            key={year}
            className='timeRailTick'
            style={{ left: `${pos * 100}%` }}
          >
            {year}
          </span>
        ))}
      </div>
    </div>
  )
}
