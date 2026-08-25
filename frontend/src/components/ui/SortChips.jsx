import React from 'react'
import classNames from 'classnames'
import { CaretDownFill, CaretUpFill } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import './sortChipsStyles.css'

// Sort controls for a card list: one chip per field, tap to sort by it, tap the
// active chip again to flip the direction. A card has no column headers to
// click, so this row is where a list's sort lives.
//
// `fields` is [{ id, label }] and `sort` is { field, dir } — the same shape
// `onChange` is handed back. Which values those fields read off a row is the
// list's business, not this control's.
export default function SortChips ({ fields, sort, onChange, label }) {
  const { t } = useTranslation()

  const handleClick = (fieldId) =>
    onChange(
      sort.field === fieldId
        ? { field: fieldId, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { field: fieldId, dir: 'asc' }
    )

  return (
    <div className='sortChips'>
      <span className='sortChipsLabel'>
        {label ?? t('datasetsCardSortByLabel')}
      </span>
      {fields.map((field) => {
        const active = sort.field === field.id
        return (
          <button
            key={field.id}
            type='button'
            className={classNames('sortChip', { active })}
            onClick={() => handleClick(field.id)}
            aria-pressed={active}
            title={
              active
                ? sort.dir === 'asc'
                  ? t('datasetsCardSortAscendingTitle')
                  : t('datasetsCardSortDescendingTitle')
                : undefined
            }
          >
            {field.label}
            {active &&
              (sort.dir === 'asc' ? (
                <CaretUpFill size={10} aria-hidden='true' />
              ) : (
                <CaretDownFill size={10} aria-hidden='true' />
              ))}
          </button>
        )
      })}
    </div>
  )
}
