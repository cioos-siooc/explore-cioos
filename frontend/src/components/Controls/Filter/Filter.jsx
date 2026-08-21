import * as React from 'react'
import { useRef, useState, useEffect } from 'react'
import {
  ChevronCompactDown,
  ChevronCompactUp,
  X,
  BoxArrowUpRight
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import noop from 'lodash/noop'

import { abbreviateString, useOutsideAlerter } from '../../../utilities'
import Tooltip from '../../ui/Tooltip.jsx'

import './styles.css'

export default function Filter({
  active,
  badgeTitle,
  tooltip,
  // A filter that has nothing to narrow right now (Scientific Name with OBIS
  // switched off): shown greyed rather than hidden, so it doesn't come and go
  // from the list, with `disabledTooltip` saying what would bring it back.
  disabled,
  disabledTooltip,
  icon,
  controlled,
  openFilter,
  setOpenFilter,
  filterName,
  searchable,
  searchTerms,
  setSearchTerms,
  searchPlaceholder,
  resetButton,
  selectAllButton,
  numberOfOptions,
  infoButton,
  children
}) {
  const { t } = useTranslation()

  // Open/Closed state for filter dropdown
  const [filterOpen, setFilterOpen] = useState(controlled ? openFilter : false)
  const wrapperRef = useRef(null)
  useOutsideAlerter(wrapperRef, setFilterOpen, false)

  useEffect(() => {
    controlled ? setFilterOpen(openFilter) : noop()
  }, [openFilter])

  // `active` (this filter constrains something) and `open` (this is the filter
  // whose options the pane is showing) are different facts and get different
  // styling — in the master/detail panel especially, where several rows can be
  // active at once and exactly one is being edited.
  const filterButton = (
    <button
      className={`filterHeader ${active && !disabled ? 'active' : ''} ${
        filterOpen && (!controlled || openFilter) ? 'open' : ''
      } ${disabled ? 'disabled' : ''}`}
      aria-current={filterOpen && (!controlled || openFilter) ? 'true' : undefined}
      // aria-disabled rather than the `disabled` attribute: a disabled button
      // takes no pointer events, and the tooltip explaining why it is off is
      // the whole point of leaving the row there.
      aria-disabled={disabled ? 'true' : undefined}
      onClick={() => {
        if (disabled) return
        setFilterOpen(!filterOpen)
        if (controlled) setOpenFilter(filterName)
      }}
    >
      {icon}
      <div className='badgeTitle' title={badgeTitle}>
        {abbreviateString(badgeTitle, 35)}
      </div>
      {filterOpen ? <ChevronCompactUp /> : <ChevronCompactDown />}
    </button>
  )

  // Using tabIndex to enable onBlur() focus loss capturing: https://stackoverflow.com/a/37491578
  return (
    <div className='filter' ref={wrapperRef}>
      {/* Tooltip text shown on hover (desktop) and on focus/tap (mobile),
          replacing the old "?" help icon. Suppressed while the dropdown is
          open so it doesn't overlap the options. */}
      {(disabled ? disabledTooltip || tooltip : tooltip) && !filterOpen ? (
        <Tooltip
          placement='bottom'
          content={disabled ? disabledTooltip || tooltip : tooltip}
        >
          {filterButton}
        </Tooltip>
      ) : (
        filterButton
      )}
      {!disabled && (controlled ? filterOpen && openFilter : filterOpen) && (
        <div className='filterOptions'>
          {searchable && (
            <>
              <input
                autoFocus
                className='filterSearch'
                type='text'
                value={searchTerms}
                onChange={(e) => setSearchTerms(e.target.value)}
                placeholder={searchPlaceholder}
              />
              {searchTerms && (
                <X
                  size='25px'
                  color='darkgrey'
                  className='clearFilter'
                  onClick={() => setSearchTerms('')}
                  title={t('filterClearSearchTitle')} // 'Clear search terms'
                />
              )}
            </>
          )}
          {/* The options themselves are the one scrolling region: the pane
              fills the modal, so the list grows into it and the actions below
              stay put instead of being pushed off the end of a long list. */}
          <div className='filterOptionsBody'>{children}</div>
          {(selectAllButton || resetButton || infoButton) && (
            <div className='filterOptionsActions'>
              {selectAllButton && (
                <button onClick={() => selectAllButton()}>
                  {t('selectAllButtonText', {
                    total: numberOfOptions
                  })}
                </button>
              )}
              {resetButton && (
                <button onClick={() => resetButton()}>
                  {t('resetButtonText')}
                </button>
              )}
              {/* No Close button: the filter row toggles itself shut, clicking
                  outside closes it, and filters apply live — so a button whose
                  only job was to dismiss a pane you can leave by looking away
                  was just one more thing between the user and the options. */}
              {infoButton && (
                <a
                  className='filterInfoButton'
                  href={infoButton}
                  target='_blank'
                  title={t('filterInfoButtonTitle')}
                  rel='noreferrer'
                >
                  Info&nbsp;
                  <BoxArrowUpRight color='#52A79B' size={17.5} />
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
