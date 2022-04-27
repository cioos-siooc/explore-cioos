import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import { capitalizeFirstLetter, abbreviateString } from '../../../../utilities'

import './styles.css'

export default function MultiCheckboxFilter({ optionsSelected, setOptionsSelected, searchable, allOptions, titles={} }) {
  const { t , i18n} = useTranslation()

const optionsSelectedSorted = Object.entries(optionsSelected)
  .sort((a, b) => t(a[0]).localeCompare(t(b[0]),i18n.language))
  .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

  return (
    <div className='multiCheckboxFilter'>
      <div className="filterCount">
        ({Object.keys(optionsSelected).length})
      </div>
      {Object.keys(optionsSelected).length > 0 ? Object.keys(optionsSelectedSorted).map((option, index) => (
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
            {titles[option] || capitalizeFirstLetter(abbreviateString(option, 30))}
          </span>
        </div>
      ))
        : (
          <div>{t('multiCheckboxFilterNoFilterWarning')}No filter options</div>
        )
      }
    </div>
  )
}