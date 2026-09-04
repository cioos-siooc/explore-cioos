/* eslint-disable react/prop-types */
import * as React from 'react'

// A labelled subgroup inside the FilterMenu: a small heading followed by its
// stacked filter rows.
export default function FilterSection({ title, children }) {
  return (
    <div className='filterSection'>
      <div className='filterSectionHeading'>{title}</div>
      <div className='filterSectionItems'>{children}</div>
    </div>
  )
}
