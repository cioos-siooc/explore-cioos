import * as React from 'react'
import { useState } from 'react'
import { ChevronCompactDown, ChevronCompactUp } from 'react-bootstrap-icons'

import './styles.css'

export default function Filter({ badgeTitle, optionsSelected, setOptionsSelected, children }) {
  // Open/Closed state for filter dropdown
  const [filterOpen, setFilterOpen] = useState(false)

  function resetDefaults(optionsSelected, setOptionsSelected) {
    let copyOfOptionsSelected = { ...optionsSelected }
    Object.keys(optionsSelected).forEach(option => copyOfOptionsSelected[option] = false)
    setOptionsSelected(copyOfOptionsSelected)
  }

  return (
    <div className='filter'>
      {badgeTitle}
      <button onClick={() => setFilterOpen(!filterOpen)}>
        {filterOpen ? <ChevronCompactUp /> : <ChevronCompactDown />}
      </button>
      {filterOpen &&
        <div className='filterOptions'>
          {children}
          <hr />
          <div>
            <button onClick={() => resetDefaults(optionsSelected, setOptionsSelected)}>
              Reset
            </button>
            <button onClick={() => setFilterOpen(false)}>
              Close
            </button>
          </div>
        </div>
      }
    </div>
  )
}