import * as React from 'react'
import { useState, useRef, useEffect, useContext } from 'react'
import { Badge, InputGroup } from 'react-bootstrap'
import { capitalizeFirstLetter } from '../../../utilities'
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

  function generateBadgeTitle(optionsSelected, badgeTitle) {
    let count = 0
    let newBadge
    Object.keys(optionsSelected).forEach(key => {
      if (optionsSelected[key] === true) {
        count++
      }
    })
    if (count === 0) {
      return capitalizeFirstLetter(badgeTitle)
    } else if (count === 1) {
      Object.keys(optionsSelected).forEach(key => {
        if (optionsSelected[key]) {
          newBadge = capitalizeFirstLetter(key)
        }
      })
      return newBadge
    } else if (count > 1) {
      return (badgeTitle === 'Ocean Variables' ? count + ' variables' : count + ' organizations')
    }
  }

  return (
    <div className='filter'>
      {generateBadgeTitle(optionsSelected, badgeTitle)}
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