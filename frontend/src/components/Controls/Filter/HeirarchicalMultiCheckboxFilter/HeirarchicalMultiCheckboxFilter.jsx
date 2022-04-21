import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import { capitalizeFirstLetter, abbreviateString } from '../../../../utilities'

import './styles.css'

export default function HeirarchicalMultiCheckboxFilter({ optionsSelected, setOptionsSelected, searchable, allOptions }) {
  const { t } = useTranslation()

  return (
    <div className='heirarchicalMultiCheckboxFilter'>
      <div className="filterCount">
        ({Object.keys(optionsSelected).length})
      </div>
      {Object.keys(optionsSelected).length > 0 ? Object.keys(optionsSelected).map((option, index) => (
        < div className='optionButton' key={index} title={option}
          onClick={() => {
            if (searchable) {
              let tempData = { ...allOptions }
              tempData[option] = !optionsSelected[option]
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
          <div>{t('heirarchicalMultiCheckboxFilterNoFilterWarning')}</div>
        )
      }
    </div >
  )
}