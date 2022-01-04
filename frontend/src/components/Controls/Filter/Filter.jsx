import * as React from 'react'
import { useState, useRef, useEffect, useContext } from 'react'
import { Badge, InputGroup } from 'react-bootstrap'
import { capitalizeFirstLetter } from '../../../utilities'
import { ChevronCompactDown, ChevronCompactUp } from 'react-bootstrap-icons'

import ControlsContext from '../ControlsContext.js'
import './styles.css'

export default function Filter({ badgeTitle }) {
  // Open/Closed state for filter dropdown
  const [filterOpen, setFilterOpen] = useState(false)

  // Extracting the state and setters from context
  const { eovsSelected, setEovsSelected, orgsSelected, setOrgsSelected } = useContext(ControlsContext)

  // Setting the filter and options generic variables
  let optionsSelected
  let setOptionsSelected
  switch (badgeTitle) {
    case 'Ocean Variables':
      optionsSelected = eovsSelected
      setOptionsSelected = setEovsSelected
      break;
    case 'Organizations':
      optionsSelected = orgsSelected
      setOptionsSelected = setOrgsSelected
    default:
      break;
  }

  return (
    <Badge className='filterChip' badge-color='white'>
      {badgeTitle}:{Object.keys(optionsSelected).map((key, index) => {
        if (optionsSelected[key]) {
          return capitalizeFirstLetter(key)
        }
      })}
      <button onClick={() => setFilterOpen(!filterOpen)}>
        {filterOpen ? <ChevronCompactUp /> : <ChevronCompactDown />}
      </button>
      {filterOpen &&
        <div className='filterOptions'>
          {Object.keys(optionsSelected).map(option => (
            <InputGroup key={option} className="mb-3">
              <InputGroup.Checkbox
                checked={optionsSelected[option]}
                onChange={(e) => {
                  setOptionsSelected({
                    ...optionsSelected,
                    [option]: !optionsSelected[option]
                  })
                }}
                aria-label="Checkbox for following text input"
              />
              <label className='ml-2'>{capitalizeFirstLetter(option)}</label>
            </InputGroup>))
          }
        </div>
      }
    </Badge>
  )
}