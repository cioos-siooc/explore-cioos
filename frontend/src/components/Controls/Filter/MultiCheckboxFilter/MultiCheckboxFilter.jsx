import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { capitalizeFirstLetter, abbreviateString } from '../../../../utilities'

import './styles.css'

export default function MultiCheckboxFilter({ optionsSelected, setOptionsSelected }) {
  return (
    <div className='multiCheckboxFilter'>
      {Object.keys(optionsSelected).length > 0 && Object.keys(optionsSelected).map(option => (
        <div className='filterCheckBoxOption' key={option}
          onClick={() => setOptionsSelected({
            ...optionsSelected,
            [option]: !optionsSelected[option]
          })}
        >
          <label className='optionButton' title={option}>
            {optionsSelected[option] ? <CheckSquare /> : <Square />}
            <div className='optionName'>
              {capitalizeFirstLetter(abbreviateString(option, 30))}
            </div>
          </label>
        </div>
      ))
      }
    </div>
  )
}