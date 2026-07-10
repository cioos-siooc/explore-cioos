import * as React from 'react'
import { X } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import {
  generateRangeSelectBadgeTitle
} from '../../../utilities.jsx'
import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth
} from '../../config.js'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'

// Removable chips for every filter currently constraining the map, docked
// just above the BottomDock. Each group can be cleared whole (its label) or
// value-by-value; a trailing link resets everything including the polygon.
export default function ActiveFilterChips () {
  const { t } = useTranslation()
  const {
    buildActiveFilters,
    resetFilters,
    startDate,
    endDate,
    startDepth,
    endDepth
  } = useFilters()
  const { polygon, setPolygon } = useSelection()

  const timeframesBadgeTitle = generateRangeSelectBadgeTitle(
    t('timeframeFilterName'),
    [startDate, endDate],
    [defaultStartDate, defaultEndDate]
  )
  const depthRangeBadgeTitle = generateRangeSelectBadgeTitle(
    t('depthRangeFilterName'),
    [startDepth, endDepth],
    [defaultStartDepth, defaultEndDepth],
    '(m)'
  )

  const activeFilters = buildActiveFilters({
    timeframesBadgeTitle,
    depthRangeBadgeTitle
  })

  if (activeFilters.length === 0 && !polygon) return null

  return (
    <ul className='activeFilterBullets' aria-label={t('activeFiltersLabel')}>
      {activeFilters.map((f) => (
        <li key={f.key} className='activeFilterGroup'>
          <button
            type='button'
            className='activeFilterGroupLabel'
            onClick={f.removeAll}
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
                onClick={item.remove}
                title={t('activeFilterRemoveItemTitle')}
              >
                <X size={14} aria-hidden='true' />
              </button>
            </span>
          ))}
        </li>
      ))}
      {polygon && (
        <li className='activeFilterGroup'>
          <span className='activeFilterItem'>
            <span className='activeFilterItemLabel'>
              {t('chipMapSelectionLabel')}
            </span>
            <button
              type='button'
              className='activeFilterItemRemove'
              onClick={() => setPolygon()}
              title={t('activeFilterRemoveItemTitle')}
            >
              <X size={14} aria-hidden='true' />
            </button>
          </span>
        </li>
      )}
      {(activeFilters.length > 0 || polygon) && (
        <li className='activeFilterResetItem'>
          <button
            type='button'
            className='filterMenuReset'
            onClick={() => {
              resetFilters()
              setPolygon()
            }}
            title={t('resetFiltersButtonTooltipText')}
          >
            {t('resetButtonText')}
          </button>
        </li>
      )}
    </ul>
  )
}
