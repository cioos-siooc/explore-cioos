import React, { useId } from 'react'
import { CaretDownFill } from 'react-bootstrap-icons'

import './selectPillStyles.css'

// A labelled <select> in a pill. Used for the datasets list's sort and
// grouping, which sit side by side and so have to read as the same kind of
// control — only the caption and the options differ.
//
// The caption is a short word ("Sort", "Group") rather than the phrase it
// replaced ("SORT BY" over a row of chips, "GROUP BY" beside a select on a row
// of its own). Both pills and their captions then fit one row at phone width,
// which is what these controls cost: they sit between the panel header and the
// first card, so every row they take is a row of results a phone doesn't show.
//
// `options` is [{ id, label }]. `children` is an optional trailing segment
// inside the same pill — SortSelect puts its direction toggle there.
export default function SelectPill ({ label, value, options, onChange, children }) {
  // Ties the caption to the select, so the caption is the control's name and
  // clicking it reaches the menu.
  const id = useId()
  // A <select> is otherwise as wide as its longest option, so a pill showing
  // "None" would hold the room for "Ocean variable" — and in French the two
  // pills together no longer fit the row. The sizer carries the selected label
  // and, with the select laid over it, is what decides the width.
  const selected = options.find((option) => option.id === value)

  return (
    <span className='selectPill'>
      <label className='selectPillLabel' htmlFor={id}>
        {label}
      </label>
      {/* The caret is drawn over the select's own trailing padding rather than
          set beside it, so a click anywhere across the pair opens the menu. */}
      <span className='selectPillField'>
        <span className='selectPillSizer' aria-hidden='true'>
          {selected?.label}
        </span>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <CaretDownFill className='selectPillCaret' size={8} aria-hidden='true' />
      </span>
      {children}
    </span>
  )
}
