import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import { capitalizeFirstLetter, abbreviateString } from '../../../../utilities'

import './styles.css'

export default function MultiCheckboxFilter({ optionsSelected, setOptionsSelected, searchable, translatable, allOptions }) {
  const { t, i18n } = useTranslation()

  const optionsSelectedSorted = optionsSelected.sort((a, b) => t(a.title).localeCompare(t(b.title), i18n.language))

  function setIsSelectedTo(isSelected, allOptions, listOfTitles) {
    return allOptions.map(option => {
      if (listOfTitles.includes(option.title)) {
        return {
          ...option,
          isSelected: isSelected
        }
      } else {
        return option
      }
    })
  }

  function selectAllSearchResultsToggle() {
    // Get a list of all the titles in the optionsSelected subset of allOptions
    const listOfTitles = optionsSelected.reduce((accumulatedTitles, currentOption) => {
      accumulatedTitles.push(currentOption.title)
      return accumulatedTitles
    }, [])

    // Set all isSelected to false if all isSelected === true
    if (optionsSelected.every(option => option.isSelected)) {
      setOptionsSelected(setIsSelectedTo(false, allOptions, listOfTitles))
    } else { // Set all isSelected to true if some isSelected === false
      setOptionsSelected(setIsSelectedTo(true, allOptions, listOfTitles))
    }
  }

  return (
    <div className={`multiCheckboxFilter`}>
      {optionsSelected.length > 0 && optionsSelected.length !== allOptions.length && // search results exist
        <>
          <div className="searchResultsButton" onClick={() => selectAllSearchResultsToggle()}>
            {optionsSelected.every(option => option.isSelected) ? <CheckSquare /> : <Square />}
            {t('multiCheckboxFilterSelectSearchResults')} {`(${optionsSelected.length})`}
            <hr />
          </div>
        </>
      }
      {optionsSelected.length > 0 ? optionsSelectedSorted.map((option, index) => {
        let title
        if (translatable) {
          // Translation in title_translation
          if (option.titleTranslated && option.titleTranslated[i18n.languages[0]] && option.titleTranslated[i18n.languages[1]]) {
            title = option.titleTranslated[i18n.language]
          } else if (t(option.title)) { // Translation in t(title)
            title = t(option.title)
          } else {
            title = option.title // this shouldn't really happen
          }
        } else {
          title = option.title
        }

        // No translation
        return (
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
              {capitalizeFirstLetter(abbreviateString(title, 30))}
            </span>
          </div>
        )
      })
        : (
          <div>{t('multiCheckboxFilterNoFilterWarning')}</div>
        )
      }
    </div>
  )
}