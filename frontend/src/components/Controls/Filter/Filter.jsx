import * as React from 'react'
import { useRef, useState, useEffect } from 'react'
import * as _ from 'lodash'
import {
  ChevronCompactDown,
  ChevronCompactUp,
  X,
  BoxArrowUpRight
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import QuestionIconTooltip from '../QuestionIconTooltip/QuestionIconTooltip.jsx'
import { abbreviateString, useOutsideAlerter } from '../../../utilities'

import './styles.css'

export default function Filter({
  active,
  badgeTitle,
  tooltip,
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
    controlled ? setFilterOpen(openFilter) : _.noop()
  }, [openFilter])

  // Using tabIndex to enable onBlur() focus loss capturing: https://stackoverflow.com/a/37491578
  return (
    <div className='filter' ref={wrapperRef}>
      <div
        className={`filterHeader ${active && 'active'}`}
        onClick={() => {
          setFilterOpen(!filterOpen)
          if (controlled) setOpenFilter(filterName)
        }}
      >
        {tooltip && (
          <QuestionIconTooltip
            tooltipText={tooltip}
            tooltipPlacement={'bottom'}
            size={20}
          />
        )}
        {icon}
        <div className='badgeTitle' title={badgeTitle}>
          {abbreviateString(badgeTitle, 35)}
        </div>
        {filterOpen ? <ChevronCompactUp /> : <ChevronCompactDown />}
      </div>
      {(controlled ? filterOpen && openFilter : filterOpen) && (
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
          {children}
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
          <button onClick={() => setFilterOpen(false)}>
            {t('closeButtonText')}
          </button>
          {infoButton && (
            <a
              className='filterInfoButton'
              href={infoButton}
              target='_blank'
              title={t('filterInfoButtonTitle')}
              rel='noreferrer'
            >
              Info&nbsp;
              <BoxArrowUpRight color='#007bff' size={17.5} />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
