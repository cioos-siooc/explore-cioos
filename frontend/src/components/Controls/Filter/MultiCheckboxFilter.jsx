import * as React from 'react'
import { useContext } from 'react'
import { InputGroup } from 'react-bootstrap'
import { capitalizeFirstLetter } from '../../../utilities'

export default function MultiCheckboxFilter({ optionsSelected, setOptionsSelected }) {
  return (
    <div className='multiCheckboxFilter'>
      {Object.keys(optionsSelected).length > 0 && Object.keys(optionsSelected).map(option => (
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
  )
}