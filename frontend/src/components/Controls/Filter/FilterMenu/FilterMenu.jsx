/* eslint-disable react/prop-types */
import * as React from 'react'
import { useRef, useState } from 'react'
import { Funnel, X } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import { useOutsideAlerter } from '../../../../utilities'

import './styles.css'

// Single launcher that collapses the whole filter set behind one button.
// Opening it reveals the filters organised into labelled subgroups; each
// individual filter still opens its own options as a flyout to the side
// (styled in this folder's stylesheet).
export default function FilterMenu({
  activeFilters = [],
  onReset,
  resetTitle,
  loading,
  children
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  useOutsideAlerter(wrapperRef, setOpen, false)

  const hasActive = activeFilters.length > 0
  const buttonClassName = `filterMenuButton ${hasActive ? 'active' : ''} ${
    open ? 'open' : ''
  }`

  return (
    <div className='filterMenu' ref={wrapperRef}>
      <div className='filterMenuBar'>
        <button
          className={buttonClassName}
          onClick={() => setOpen(!open)}
          title={t('filtersMenuButtonTitle')}
        >
          <Funnel />
          <span className='filterMenuButtonLabel'>
            {t('filtersMenuButton')}
          </span>
        </button>
        {hasActive && (
          <ul className='activeFilterBullets'>
            {activeFilters.map((f) => (
              <li key={f.key} className='activeFilterGroup'>
                <button
                  type='button'
                  className='activeFilterGroupLabel'
                  onClick={() => f.removeAll && f.removeAll()}
                  title={t('activeFilterRemoveAllTitle', { filter: f.label })}
                >
                  {f.label}
                </button>
                {f.items.map((item) => (
                  <span key={item.id} className='activeFilterItem'>
                    <span className='activeFilterItemLabel' title={item.label}>
                      {item.label}
                    </span>
                    <button
                      type='button'
                      className='activeFilterItemRemove'
                      onClick={() => item.remove && item.remove()}
                      title={t('activeFilterRemoveItemTitle')}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
        {hasActive && (
          <button
            className='filterMenuReset'
            onClick={() => onReset && onReset()}
            disabled={loading}
            title={resetTitle}
          >
            {t('resetButtonText')}
          </button>
        )}
      </div>
      {open && (
        <div className='filterMenuPanel'>
          <div className='filterMenuPanelBody'>{children}</div>
        </div>
      )}
    </div>
  )
}
