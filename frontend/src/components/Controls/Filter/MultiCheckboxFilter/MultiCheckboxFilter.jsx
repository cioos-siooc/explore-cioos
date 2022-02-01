import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { capitalizeFirstLetter, abbreviateString } from '../../../../utilities'

import './styles.css'

export default function MultiCheckboxFilter({ optionsSelected, setOptionsSelected }) {
  return (
    <div className='multiCheckboxFilter'>
      {Object.keys(optionsSelected).length > 0 && Object.keys(optionsSelected).map(option => (
        <div className='optionButton' key={option} title={option}
          onClick={() => setOptionsSelected({
            ...optionsSelected,
            [option]: !optionsSelected[option]
          })}
        >
          {optionsSelected[option] ? <CheckSquare /> : <Square />}
          <span className='optionName'>
            {capitalizeFirstLetter(abbreviateString(option, 30))}
          </span>
        </div>
      ))
      }
    </div>
  )
}