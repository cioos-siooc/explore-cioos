import * as React from 'react'
import { useState } from 'react'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { ChevronCompactDown, ChevronCompactUp, QuestionCircle } from 'react-bootstrap-icons'
import { abbreviateString } from '../../../utilities'

import './styles.css'

export default function Filter({ badgeTitle, optionsSelected, setOptionsSelected, tooltip, children }) {
  // Open/Closed state for filter dropdown
  const [filterOpen, setFilterOpen] = useState(false)

  function resetDefaults(optionsSelected, setOptionsSelected) {
    let copyOfOptionsSelected = { ...optionsSelected }
    Object.keys(optionsSelected).forEach(option => copyOfOptionsSelected[option] = false)
    setOptionsSelected(copyOfOptionsSelected)
  }

  return (
    <div className='filter'>
      <div className='filterHeader' >
        {tooltip &&
          <OverlayTrigger
            key={badgeTitle}
            placement='bottom'
            overlay={
              <Tooltip>
                {tooltip}
              </Tooltip>
            }
          >
            <QuestionCircle className='helpIcon' color='#007bff' size={20} />
          </OverlayTrigger>
        }
        <div className='badgeTitle' title={badgeTitle}>
          {abbreviateString(badgeTitle, 40)}
        </div>
        {filterOpen ? <ChevronCompactUp onClick={() => setFilterOpen(!filterOpen)} /> : <ChevronCompactDown onClick={() => setFilterOpen(!filterOpen)} />}
      </div>
      {filterOpen &&
        <div className='filterOptions'>
          {children}
          <button onClick={() => resetDefaults(optionsSelected, setOptionsSelected)}>
            Reset
          </button>
          <button onClick={() => setFilterOpen(false)}>
            Close
          </button>
        </div>
      }
    </div>
  )
}