/* eslint-disable react/prop-types */
/* eslint-disable multiline-ternary */

import * as React from 'react'
import { CheckSquare, CircleFill, Square } from 'react-bootstrap-icons'
import { Tooltip, OverlayTrigger } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import { capitalizeFirstLetter } from '../../../../utilities'
import platformColors from '../../../platformColors'
import './styles.css'

export default function MultiCheckboxFilter({
  optionsSelected,
  setOptionsSelected,
  searchable,
  translatable,
  colored,
  allOptions
}) {
  const { t, i18n } = useTranslation()

  const optionsSelectedSorted = optionsSelected.sort((a, b) =>
    t(a.title).localeCompare(t(b.title), i18n.language)
  )

  function setIsSelectedTo(isSelected, allOptions, listOfKeys) {
    return allOptions.map((option) => {
      const key = option.id ?? option.pk
      if (listOfKeys.includes(key)) {
        return {
          ...option,
          isSelected
        }
      } else {
        return option
      }
    })
  }

  function selectAllSearchResultsToggle () {
    // Get a list of all the pks in the optionsSelected subset of allOptions
    const listOfKeys = optionsSelected.reduce(
      (accumulatedPKs, currentOption) => {
        const key = currentOption.id ?? currentOption.pk
        accumulatedPKs.push(key)
        return accumulatedPKs
      },
      []
    )

    // Set all isSelected to false if all isSelected === true
    if (optionsSelected.every((option) => option.isSelected)) {
      setOptionsSelected(setIsSelectedTo(false, allOptions, listOfKeys))
    } else {
      // Set all isSelected to true if some isSelected === false
      setOptionsSelected(setIsSelectedTo(true, allOptions, listOfKeys))
    }
  }

  return (
    <div className={'multiCheckboxFilter'}>
      {optionsSelected.length > 0 &&
        optionsSelected.length !== allOptions.length && ( // search results exist
        <>
          <div
            className='searchResultsButton'
            onClick={() => selectAllSearchResultsToggle()}
          >
            {optionsSelected.every((option) => option.isSelected) ? (
              <CheckSquare />
            ) : (
              <Square />
            )}
            {t('multiCheckboxFilterSelectSearchResults')}{' '}
            {`(${optionsSelected.length})`}
            <hr />
          </div>
        </>
      )}
      {optionsSelected.length > 0 ? (
        optionsSelectedSorted.map((option, index) => {
          let title
          if (translatable) {
            // Translation in title_translation
            if (
              option.titleTranslated &&
              option.titleTranslated[i18n.languages[0]] &&
              option.titleTranslated[i18n.languages[1]]
            ) {
              title = option.titleTranslated[i18n.language]
            } else if (t(option.title)) {
              // Translation in t(title)
              title = t(option.title)
            } else {
              title = option.title // this shouldn't really happen, but its a catch-all fallback
            }
          } else {
            title = option.title
          }

          let platformColor
          if (colored) {
            platformColor = platformColors.filter(
              (pc) => pc.platform === option.title
            )
            if (colored && !platformColor.length) {
              platformColor = '#000000'
            } else {
              platformColor = platformColor[0].color
            }
          }
          const hoverText = option[`hover_${i18n.language}`] || title

          // No translation
          return (
            <OverlayTrigger
              key={index}
              placement='bottom'
              delay={{ show: 150, hide: 0 }}
              overlay={
                <Tooltip style={{ display: hoverText ? '' : 'none' }}>
                  {hoverText}
                </Tooltip>
              }
            >
              <div
                className={`optionButton ${option.isSelected && 'selected'}`}
                key={index}
                title={hoverText ? '' : t(title)}
                onClick={() => {
                  if (searchable) {
                    setOptionsSelected(
                      allOptions.map((opt) => {
                        const optKey = opt.id ?? opt.pk
                        const optionKey = option.id ?? option.pk
                        if (optKey === optionKey) {
                          return {
                            ...opt,
                            isSelected: !opt.isSelected
                          }
                        } else return opt
                      })
                    )
                  } else {
                    setOptionsSelected(
                      optionsSelected.map((opt) => {
                        const optKey = opt.id ?? opt.pk
                        const optionKey = option.id ?? option.pk
                        if (optKey === optionKey) {
                          return {
                            ...opt,
                            isSelected: !opt.isSelected
                          }
                        } else return opt
                      })
                    )
                  }
                }}
              >
                {option.isSelected ? <CheckSquare /> : <Square />}
                <span className='optionName'>
                  {capitalizeFirstLetter(title)}
                </span>
                {colored && (
                  <CircleFill
                    className='optionColorCircle'
                    fill={platformColor}
                    size='15'
                  />
                )}
              </div>
            </OverlayTrigger>
          )
        })
      ) : (
        <div>{t('multiCheckboxFilterNoFilterWarning')}</div>
      )}
    </div>
  )
}
