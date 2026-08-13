import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { defaultStartDate } from '../../config.js'
import Rail from '../Rail/Rail.jsx'
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
// window shaded behind it. The track, the handles and the tick row are the
// shared Rail, which knows nothing about dates; this file is what makes that
// rail a calendar.

// Keyboard step per key, in days. Arrows walk a day at a time for the exact
// date; the coarser steps are what make a decades-wide domain navigable
// without a mouse.
function keyboardStepDays (event) {
  if (event.key === 'PageUp' || event.key === 'PageDown') return 365
  return event.shiftKey ? 30 : 1
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

// The ready-made windows the Interval picker offers, each of them a length of
// time rather than a place in it. Shared so the Filters panel and the bar over
// the map offer the same set — a window that exists in one place and not the
// other is a window users learn to go looking for in the wrong one.
export const QUICK_PICKS = [
  { days: 10, labelKey: 'timeSelectorQuickSelect10Days' },
  { days: 30, labelKey: 'timeSelectorQuickSelect30Days' },
  { days: 365, labelKey: 'timeSelectorQuickSelect1Year' },
  { days: 3652, labelKey: 'timeSelectorQuickSelect10Years' }
]

// Picking a window starts it where it is most often wanted: ending today.
export function lastDaysRange (days) {
  const end = todayIso()
  const start = msToIso(isoToMs(end) - days * MS_PER_DAY)
  return { start, end }
}

// Which ready-made window the current range is, if any — so the picker shows
// the user's own choice rather than falling back to naming itself, and so the
// rail knows to move the range as one piece.
//
// Matched on the window's *length*, not on where it sits: "30 days" means a
// 30-day window, and sliding it back through the years leaves it a 30-day
// window. Requiring it to still end today would have the choice unselect itself
// the first time the window was dragged — which is the very moment the rail is
// meant to be holding its length.
export function matchQuickPick (startDate, endDate, defaultStart) {
  if (startDate === defaultStart && endDate === todayIso()) return 'all'
  const days = Math.round((isoToMs(endDate) - isoToMs(startDate)) / MS_PER_DAY)
  return QUICK_PICKS.some((pick) => pick.days === days) ? String(days) : ''
}

// Where the range lands when one end of a chosen window is dragged: the other
// end comes along, so the window keeps its length and simply moves. It stops at
// the ends of the filterable domain rather than being squeezed shorter against
// them; a window longer than the domain just fills it.
export function slideRange (handle, iso, { startDate, endDate, minIso, maxIso }) {
  const spanMs = isoToMs(endDate) - isoToMs(startDate)
  const minMs = isoToMs(minIso)
  const maxMs = isoToMs(maxIso)
  if (maxMs - minMs <= spanMs) return { start: minIso, end: maxIso }
  const wantedMs = handle === 'start' ? isoToMs(iso) : isoToMs(iso) - spanMs
  const startMs = Math.min(Math.max(wantedMs, minMs), maxMs - spanMs)
  return { start: msToIso(startMs), end: msToIso(startMs + spanMs) }
}

// The window picker itself, one line high, in both places that carry the range.
// Choosing from it sets the range; what it reads back is whatever window the
// range currently is.
export function IntervalSelect ({
  startDate,
  endDate,
  defaultStart,
  maxIso,
  onSelect,
  className,
  // Only where the control has no visible label of its own — over the map,
  // where it sits in the range pill. In the Filters panel the form's own label
  // names it, and a second name here would just talk over it.
  ariaLabel
}) {
  const { t } = useTranslation()
  const value = matchQuickPick(startDate, endDate, defaultStart)
  return (
    <select
      className={className}
      aria-label={ariaLabel}
      title={ariaLabel}
      value={value}
      onChange={(event) => {
        const picked = event.target.value
        if (picked === 'all') onSelect(defaultStart, maxIso)
        else if (picked) {
          const { start, end } = lastDaysRange(Number(picked))
          onSelect(start, end)
        }
      }}
    >
      {/* A range set by hand is not one of these, so the closed select falls
          back to naming what it is for. */}
      {!value && (
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
  )
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
  // { value, trailStartMs } while the trajectory scrub shares this rail;
  // absent everywhere else.
  scrub,
  onCommit,
  className
}) {
  const { t } = useTranslation()

  // The calendar axis, restated in the plain numbers the shared rail works in:
  // milliseconds, with the ISO dates carried alongside for the screen reader.
  const railAxis = useMemo(
    () => ({
      min: axis.minMs,
      max: axis.maxMs,
      minText: axis.minIso,
      maxText: axis.maxIso,
      toPos: axis.toPos,
      toValue: axis.toMs
    }),
    [axis]
  )

  const handles = [
    {
      key: 'start',
      value: isoToMs(startDate),
      valueText: startDate,
      label: t('timeBarRangeStartHandle'),
      className: 'railHandleRange'
    },
    {
      key: 'end',
      value: isoToMs(endDate),
      valueText: endDate,
      label: t('timeBarRangeEndHandle'),
      className: 'railHandleRange'
    },
    ...(scrub
      ? [
        {
          key: 'scrub',
          value: isoToMs(scrub.value),
          valueText: scrub.value,
          label: t('timeBarScrubLabel'),
          className: 'timeRailHandleScrub'
        }
      ]
      : [])
  ]

  const bands = [
    {
      key: 'range',
      from: isoToMs(startDate),
      to: isoToMs(endDate),
      className: 'railFill'
    },
    ...(scrub
      ? [
        {
          key: 'trail',
          from: scrub.trailStartMs,
          to: isoToMs(scrub.value),
          className: 'timeRailTrailBand',
          title: t('timeBarTrailBandTitle')
        }
      ]
      : [])
  ]

  const ticksFor = useCallback(
    (railWidth) =>
      tickYearsFor(railWidth, axis.anchorYears, axis.toPos).map((year) => ({
        key: year,
        value: isoToMs(`${year}-01-01`),
        label: year
      })),
    [axis]
  )

  return (
    <Rail
      className={className}
      axis={railAxis}
      handles={handles}
      bands={bands}
      ticksFor={ticksFor}
      snap={snapToDay}
      stepFor={(event) => keyboardStepDays(event) * MS_PER_DAY}
      onCommit={(handle, ms) => onCommit(handle, msToIso(ms))}
    />
  )
}
