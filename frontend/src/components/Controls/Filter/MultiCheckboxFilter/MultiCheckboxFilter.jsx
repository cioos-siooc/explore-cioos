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

  // These filters constrain nothing when nothing is ticked, so "none ticked"
  // and "all ticked" ask for exactly the same data. Showing that state as a
  // column of empty boxes said the opposite — it read as "no variables
  // included" when every variable was — so an empty selection draws as fully
  // ticked instead, and none-ticked stays the canonical way to store it (a
  // short URL, and newly harvested options are picked up automatically rather
  // than being absent from a frozen list of everything).
  const universe = allOptions || optionsSelected
  const nothingSelected = !universe.some((option) => option.isSelected)
  const isChecked = (option) => nothingSelected || option.isSelected

  // Collapse a fully-ticked list back to the empty representation, so ticking
  // the last box lands on the same state Reset gives rather than a synonym of
  // it that the badge would report as a filter.
  const canonical = (options) =>
    options.every((option) => option.isSelected)
      ? options.map((option) => ({ ...option, isSelected: false }))
      : options

  // Ticking a box while everything is implicitly on means "just this one",
  // not "this one on top of all the others" — untick the rest.
  function toggleOption (option) {
    if (nothingSelected) {
      setOptionsSelected(
        universe.map((opt) => ({ ...opt, isSelected: opt.pk === option.pk }))
      )
      return
    }
    setOptionsSelected(
      canonical(
        universe.map((opt) =>
          opt.pk === option.pk ? { ...opt, isSelected: !opt.isSelected } : opt
        )
      )
    )
  }

  function selectAllSearchResultsToggle () {
    const listOfPKs = optionsSelected.map((option) => option.pk)
    const allShownChecked = optionsSelected.every(isChecked)
    // Starting from "all implicitly on", the base has to be materialised
    // before the search subset can be subtracted from it.
    const base = nothingSelected
      ? universe.map((option) => ({ ...option, isSelected: true }))
      : universe
    setOptionsSelected(
      canonical(
        base.map((option) =>
          listOfPKs.includes(option.pk)
            ? { ...option, isSelected: !allShownChecked }
            : option
        )
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
            onClick={() => selectAllSearchResultsToggle()}
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
                onClick={() => toggleOption(option)}
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
