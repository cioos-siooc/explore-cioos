/* eslint-disable react/prop-types */
/* eslint-disable multiline-ternary */

import * as React from 'react'
import { CheckSquare, CircleFill, Square } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import Tooltip from '../../../ui/Tooltip.jsx'
import { capitalizeFirstLetter } from '../../../../utilities'
import platformColors from '../../../platformColors'
import './styles.css'

export default function MultiCheckboxFilter({
  optionsSelected,
  setOptionsSelected,
  translatable,
  colored,
  allOptions
}) {
  const { t, i18n } = useTranslation()

  const optionsSelectedSorted = optionsSelected.sort((a, b) =>
    t(a.title).localeCompare(t(b.title), i18n.language)
  )

  // Nothing ticked constrains nothing, so an empty selection already means
  // "all of them" — which is why unticking the last box is safe and lands back
  // on the unfiltered result set rather than on an empty map. It is stored that
  // way too (a short URL, and newly harvested options are picked up
  // automatically instead of being absent from a frozen list of everything),
  // and shown that way: no ticks in the default state, so the pane reports what
  // the user has actually chosen rather than pre-answering for them.
  const universe = allOptions || optionsSelected
  const isChecked = (option) => option.isSelected

  function toggleOption (option) {
    setOptionsSelected(
      universe.map((opt) =>
        opt.pk === option.pk ? { ...opt, isSelected: !opt.isSelected } : opt
      )
    )
  }

  function selectAllSearchResultsToggle () {
    const listOfPKs = optionsSelected.map((option) => option.pk)
    const allShownChecked = optionsSelected.every(isChecked)
    setOptionsSelected(
      universe.map((option) =>
        listOfPKs.includes(option.pk)
          ? { ...option, isSelected: !allShownChecked }
          : option
      )
    )
  }

  return (
    <div className={'multiCheckboxFilter'}>
      {optionsSelected.length > 0 &&
        optionsSelected.length !== allOptions.length && ( // search results exist
        <>
          <div
            className='searchResultsButton'
            role='checkbox'
            aria-checked={optionsSelected.every(isChecked)}
            tabIndex={0}
            data-testid='filter-select-all-results'
            onClick={() => selectAllSearchResultsToggle()}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                selectAllSearchResultsToggle()
              }
            }}
          >
            {optionsSelected.every(isChecked) ? <CheckSquare /> : <Square />}
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
            <Tooltip
              key={index}
              placement='bottom'
              delay={150}
              content={hoverText}
            >
              <div
                className={`optionButton ${isChecked(option) && 'selected'}`}
                key={index}
                title={hoverText ? '' : t(title)}
                // A checkbox in everything but tag name: it was a bare div, so
                // it announced no name, no role and no state, and could not be
                // reached or toggled from the keyboard at all.
                role='checkbox'
                aria-checked={isChecked(option)}
                tabIndex={0}
                data-testid='filter-option'
                data-option-pk={option.pk}
                data-selected={isChecked(option)}
                onClick={() => toggleOption(option)}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    // Space would otherwise scroll the flyout out from under
                    // the option being ticked.
                    event.preventDefault()
                    toggleOption(option)
                  }
                }}
              >
                {isChecked(option) ? <CheckSquare /> : <Square />}
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
            </Tooltip>
          )
        })
      ) : (
        <div>{t('multiCheckboxFilterNoFilterWarning')}</div>
      )}
    </div>
  )
}
