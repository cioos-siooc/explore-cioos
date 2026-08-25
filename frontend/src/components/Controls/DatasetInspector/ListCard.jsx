import React, { useState } from 'react'
import classNames from 'classnames'
import { useTranslation } from 'react-i18next'

import './styles.css'

// One row of a dataset page's record or platform list, as a card: the item's
// id on top and its fields as label/value pairs beneath, each on its own line.
// This is the shape that survives the sidebar's width — see CardList.jsx for
// why these lists are cards at all.
//
// A div rather than a <button> (with the keyboard handling a button would have
// given for free) because the card's body is a description list, which a
// button may not contain. Same treatment DatasetCard uses.
export default function ListCard ({
  id,
  // Toggle cards (a platform, whose track the click draws or clears) say so
  // with aria-pressed; a card that opens something leaves this undefined.
  pressed,
  // Held at the top of the list because the last map click found this item —
  // wearing the same goldenrod the map put on what was clicked.
  pinned,
  onClick,
  children
}) {
  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onClick()
  }

  return (
    <div
      className={classNames('listCard', { selected: pressed, pinned })}
      role='button'
      tabIndex={0}
      aria-pressed={pressed}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <span className='listCardId' title={id}>
        {id}
      </span>
      <dl className='listCardFields'>{children}</dl>
    </div>
  )
}

// One field of a card: its name, and its value under or beside it. Renders
// nothing when the dataset has no value for the field, so a card carries only
// the lines it can actually fill.
export function CardField ({ label, children }) {
  const empty =
    children === null ||
    children === undefined ||
    children === '' ||
    (Array.isArray(children) && children.length === 0)
  if (empty) return null
  return (
    <div className='listCardField'>
      <dt className='listCardFieldLabel'>{label}</dt>
      <dd className='listCardFieldValue'>{children}</dd>
    </div>
  )
}

// The values of a list-valued field (a record's ocean variables), condensed to
// the first few with the rest behind a "+n". A record can carry a dozen
// variables, which on its own would make the card several lines taller than
// every other field on it and bury the id the card is called by — while the
// question the list usually answers is "does this record measure X", which the
// search box above the cards answers outright.
export function CardTags ({ values, limit = 3 }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  if (!values?.length) return null

  const shown = expanded ? values : values.slice(0, limit)
  const hidden = values.length - shown.length

  // The card underneath opens a record preview on click (and on Enter/Space);
  // expanding its variable list is not that, so the event stops here.
  const toggle = (e) => {
    e.stopPropagation()
    setExpanded(!expanded)
  }

  return (
    <>
      {shown.map((value) => (
        <span className='listCardTag' key={value}>
          {value}
        </span>
      ))}
      {(hidden > 0 || expanded) && (
        <button
          type='button'
          className='listCardTagsMore'
          onClick={toggle}
          onKeyDown={(e) => e.stopPropagation()}
          aria-expanded={expanded}
          title={
            expanded
              ? t('listCardTagsFewerText')
              : t('listCardTagsMoreTitle', { total: values.length })
          }
        >
          {expanded ? t('listCardTagsFewerText') : `+${hidden}`}
        </button>
      )}
    </>
  )
}

// The instants either list carries, formatted as the UTC they are: the record
// list spells them out in UTC (see shapeQuery.js) and the platform list sends
// timestamptz, which JSON serializes as UTC too, so a Z is the truth in both
// and no local-time conversion is wanted — an oceanographic record's time is
// the time it was taken at sea, not the reader's wall clock.
//
// Where the two ends share a day, the second one drops it: a cast that ran
// from 18:32 to 19:05 says so in one line rather than repeating the date.
export function formatInstantRange (min, max) {
  const from = splitInstant(min)
  const to = splitInstant(max)
  if (!from) return to ? `${to.day} ${to.time}Z` : undefined
  if (!to || (from.day === to.day && from.time === to.time)) {
    return `${from.day} ${from.time}Z`
  }
  if (from.day === to.day) return `${from.day} ${from.time} → ${to.time}Z`
  return `${from.day} ${from.time}Z → ${to.day} ${to.time}Z`
}

function splitInstant (value) {
  if (!value) return undefined
  const [day, rest] = String(value).split('T')
  return { day, time: (rest || '00:00').slice(0, 5) }
}

// "min – max", or the one bound that exists, or the single value when the two
// are the same.
export function formatRange (min, max, unit = '') {
  const suffix = unit ? ` ${unit}` : ''
  if (min === null || min === undefined) {
    return max === null || max === undefined ? undefined : `${max}${suffix}`
  }
  if (max === null || max === undefined || String(min) === String(max)) {
    return `${min}${suffix}`
  }
  return `${min} – ${max}${suffix}`
}
