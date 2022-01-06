import * as React from 'react'
import { useState } from 'react'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { ChevronCompactDown, ChevronCompactUp, QuestionCircle } from 'react-bootstrap-icons'
import { abbreviateString } from '../../../utilities'

import './styles.css'

export default function Filter({ badgeTitle, optionsSelected, setOptionsSelected, tooltip, icon, children }) {
  // Open/Closed state for filter dropdown
  const [filterOpen, setFilterOpen] = useState(false)

  function resetDefaults(optionsSelected, setOptionsSelected) {
    let copyOfOptionsSelected = { ...optionsSelected }
    Object.keys(optionsSelected).forEach(option => copyOfOptionsSelected[option] = false)
    setOptionsSelected(copyOfOptionsSelected)
  }

  // Using tabIndex to enable onBlur() focus loss capturing: https://stackoverflow.com/a/37491578
  return (
    <div className='filter' tabIndex={0} onBlur={() => setFilterOpen(false)}>
      <div className='filterHeader' onClick={() => setFilterOpen(!filterOpen)} >
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
        {icon}
        <div className='badgeTitle' title={badgeTitle}>
          {abbreviateString(badgeTitle, 40)}
        </div>
        {filterOpen ? <ChevronCompactUp /> : <ChevronCompactDown />}
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