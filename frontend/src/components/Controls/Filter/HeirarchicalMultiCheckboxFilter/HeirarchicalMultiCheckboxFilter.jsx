import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { capitalizeFirstLetter, abbreviateString } from '../../../../utilities'

import './styles.css'

export default function HeirarchicalMultiCheckboxFilter({ optionsSelected, setOptionsSelected, searchable, allOptions }) {
  return (
    <div className='heirarchicalMultiCheckboxFilter'>
      {optionsSelected.length > 0 ? optionsSelected.map((option, index) => (
        < div className='optionButton' key={index} title={option.title}
          onClick={() => {
            if (searchable) {
              let tempData = [...allOptions]
              setOptionsSelected(tempData.map(opt => {
                if (opt.pk === option.pk) {
                  return {
                    ...opt,
                    selected: !option.selected
                  }
                } else {
                  return {
                    ...opt
                  }
                }
              }
              ))
            } else {
              setOptionsSelected({
                ...optionsSelected,
                [option]: !optionsSelected[option]
              })
            }
          }}
        >
          {option.selected ? <CheckSquare /> : <Square />}
          <span className='optionName'>
            {capitalizeFirstLetter(abbreviateString(option.title, 30))}
          </span>
        </div>
      ))
        : (
          <div>No filter options</div>
        )
      }
    </div >
  )
}