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

  // This is the filter being edited. Controlled, that also takes the panel
  // agreeing it is the open one; either way a disabled row never opens.
  const isOpen = filterOpen && (!controlled || Boolean(openFilter))
  const paneShown = isOpen && !disabled

  // `active` (this filter constrains something) and `open` (this is the filter
  // whose options the pane is showing) are different facts and get different
  // styling — in the master/detail panel especially, where several rows can be
  // active at once and exactly one is being edited.
  const filterButton = (
    <button
      data-testid='filter-header'
      className={`filterHeader ${active && !disabled ? 'active' : ''} ${
        isOpen ? 'open' : ''
      } ${disabled ? 'disabled' : ''}`}
      aria-current={isOpen ? 'true' : undefined}
      // aria-disabled rather than the `disabled` attribute: a disabled button
      // takes no pointer events, and the caption explaining why it is off is
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
      {isOpen ? <ChevronCompactUp /> : <ChevronCompactDown />}
    </button>
  )

  // Using tabIndex to enable onBlur() focus loss capturing: https://stackoverflow.com/a/37491578
  return (
    <div className='filter' ref={wrapperRef} data-testid='filter' data-filter-name={filterName}>
      {filterButton}
      {/* A disabled row never opens, so its explanation has nowhere else to
          live — shown as plain text right under the row itself, always
          readable, no hover or tap needed. */}
      {disabled && (disabledTooltip || tooltip) && (
        <div className='filterCaption'>{disabledTooltip || tooltip}</div>
      )}
      {paneShown && (
        <div className='filterOptions' data-testid='filter-options'>
          {/* What this filter does, at the top of its section and above the
              inputs below — plain text again, not a hover/tap tooltip. */}
          {tooltip && <div className='filterOptionsCaption'>{tooltip}</div>}
          {/* The field and its clear button are one unit, so the button can
              be positioned against the field rather than against the pane —
              whose first child is a caption of unpredictable height, which is
              what used to leave the button sitting on the caption instead of
              in the field. */}
          {searchable && (
            <div className='filterSearchRow'>
              <input
                autoFocus
                className='filterSearch'
                type='text'
                value={searchTerms}
                onChange={(e) => setSearchTerms(e.target.value)}
                placeholder={searchPlaceholder}
              />
              {searchTerms && (
                <button
                  type='button'
                  className='clearFilter'
                  onClick={() => setSearchTerms('')}
                  title={t('filterClearSearchTitle')} // 'Clear search terms'
                  aria-label={t('filterClearSearchTitle')}
                >
                  <X size={20} aria-hidden='true' />
                </button>
              )}
            </div>
          )}
          {/* The options themselves are the one scrolling region: the pane
              fills the modal, so the list grows into it and the actions below
              stay put instead of being pushed off the end of a long list. */}
          <div className='filterOptionsBody'>{children}</div>
          {/* No Select all: an all-ticked selection and an empty one both
              narrow nothing (see MultiCheckboxFilter on why empty means all),
              so the button was a second, wordier Reset — and the one way they
              differ ran the wrong way, an explicit list of every current option
              excluding the records that have none and the options harvested
              after it was built. */}
          {(resetButton || infoButton) && (
            <div className='filterOptionsActions'>
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
