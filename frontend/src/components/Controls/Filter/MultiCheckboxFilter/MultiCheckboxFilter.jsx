import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import { capitalizeFirstLetter, abbreviateString, setAllOptionsIsSelectedTo } from '../../../../utilities'

import './styles.css'

export default function MultiCheckboxFilter({ optionsSelected, setOptionsSelected, searchable, allOptions }) {
  const { t, i18n } = useTranslation()

  const optionsSelectedSorted = optionsSelected.sort((a, b) => t(a.title).localeCompare(t(b.title), i18n.language))

  function selectAllSearchResultsToggle() {
    // Set all isSelected to false if all isSelected === true
    if (optionsSelected.every(option => option.isSelected)) {
      setAllOptionsIsSelectedTo(false, optionsSelected, setOptionsSelected)
    } else {
      setAllOptionsIsSelectedTo(true, optionsSelected, setOptionsSelected)
    }
  }

  const searchResultsExist = optionsSelected.length !== allOptions.length && optionsSelected.length > 0

  return (
    <div className={`multiCheckboxFilter`}>
      {searchResultsExist &&
        <>
          <div className="searchResultsButton" onClick={() => selectAllSearchResultsToggle()}>
            {optionsSelected.every(option => option.isSelected) ? <CheckSquare /> : <Square />}
            {t('multiCheckboxFilterSelectSearchResults')}
            <hr />
          </div>
        </>
      }
      {optionsSelected.length > 0 ? optionsSelectedSorted.map((option, index) => (
        <div className='optionButton' key={index} title={t(option.title)}
          onClick={() => {
            if (searchable) {
              setOptionsSelected(allOptions.map(opt => {
                if (opt.title === option.title) {
                  return {
                    ...opt,
                    isSelected: !opt.isSelected
                  }
                } else return opt
              }))
            } else {
              setOptionsSelected(optionsSelected.map(opt => {
                if (opt.title === option.title) {
                  return {
                    ...opt,
                    isSelected: !opt.isSelected
                  }
                } else return opt
              }))
            }
          }}
        >
          {option.isSelected ? <CheckSquare /> : <Square />}
          <span className='optionName'>
            {capitalizeFirstLetter(abbreviateString(t(option.title), 30))}
          </span>
        </div>
      ))
        : (
          <div>{t('multiCheckboxFilterNoFilterWarning')}</div>
        )
      }
    </div>
  )
}