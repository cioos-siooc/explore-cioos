import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { capitalizeFirstLetter, abbreviateString } from '../../../../utilities'

import './styles.css'

export default function MultiCheckboxFilter({ optionsSelected, setOptionsSelected, searchable, allOptions }) {
  return (
    <div className='multiCheckboxFilter'>
      <div className="filterCount">
        ({Object.keys(optionsSelected).length})
      </div>
      {Object.keys(optionsSelected).length > 0 ? Object.keys(optionsSelected).map((option, index) => (
        <div className='optionButton' key={index} title={option}
          onClick={() => {
            if (searchable) {
              let tempData = { ...allOptions }
              // Go through each of the elements in the subset
              // Find the corresponding element in the total set and set its selection status
              tempData[option] = !optionsSelected[option]
              // Set the total set 
              setOptionsSelected(tempData)
            } else {
              setOptionsSelected({
                ...optionsSelected,
                [option]: !optionsSelected[option]
              })
            }
          }}
        >
          {optionsSelected[option] ? <CheckSquare /> : <Square />}
          <span className='optionName'>
            {capitalizeFirstLetter(abbreviateString(option, 30))}
          </span>
        </div>
      ))
        : (
          <div>No filter options</div>
        )
      }
    </div>
  )
}