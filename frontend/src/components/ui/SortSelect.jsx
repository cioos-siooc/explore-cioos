import React from 'react'
import { CaretDownFill, CaretUpFill } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import SelectPill from './SelectPill.jsx'
import './sortSelectStyles.css'

// Sort controls for a card list: the field to sort on, and a toggle for the
// direction. A card has no column headers to click, so this is where a list's
// sort lives.
//
// The fields were a row of chips, one per field. That row grew with every
// field a list added and wrapped to two and three lines in a phone-width
// column, spending the top of the screen on controls before a single card. A
// select is one line whether a list sorts on three fields or six.
//
// `fields` is [{ id, label }] and `sort` is { field, dir } — the same shape
// `onChange` is handed back. Which values those fields read off a row is the
// list's business, not this control's.
export default function SortSelect ({ fields, sort, onChange, label }) {
  const { t } = useTranslation()
  const ascending = sort.dir === 'asc'
  const directionTitle = ascending
    ? t('datasetsCardSortAscendingTitle')
    : t('datasetsCardSortDescendingTitle')

  return (
    <SelectPill
      label={label ?? t('datasetsCardSortByLabel')}
      value={sort.field}
      options={fields}
      // Picking a different field keeps the direction: it is a choice about
      // this list, not about the field it was made on.
      onChange={(field) => onChange({ field, dir: sort.dir })}
    >
      <button
        type='button'
        className='sortSelectDirection'
        onClick={() =>
          onChange({ field: sort.field, dir: ascending ? 'desc' : 'asc' })
        }
        title={directionTitle}
        aria-label={directionTitle}
      >
        {ascending ? (
          <CaretUpFill size={9} aria-hidden='true' />
        ) : (
          <CaretDownFill size={9} aria-hidden='true' />
        )}
      </button>
    </SelectPill>
  )
}
