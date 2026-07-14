import * as React from 'react'
import { useEffect, useState } from 'react'
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
import { useUI } from '../../../state/ui/UIProvider.jsx'

// Maps each active-filter group key to the filterName FiltersPanel opens it
// under (see FiltersPanel.jsx — most groups key off a stable i18n key, but
// time/depth key off their own translated label, so those two are computed
// with t() rather than hardcoded).
function filterNameForKey (key, t) {
  switch (key) {
  case 'eovs': return 'oceanVariablesFiltername'
  case 'platforms': return 'platformsFilterName'
  case 'orgs': return 'organizationFilterName'
  case 'datasets': return 'datasetsFilterName'
  case 'sources': return 'sourceFilterName'
  case 'time': return t('timeframeFilterName')
  case 'depth': return t('depthRangeFilterName')
  case 'scientificName': return 'scientificNameFilterName'
  default: return undefined
  }
}

// Removable chips for every filter currently constraining the map, flowing
// after the Filters button. Clicking a group's label jumps to that filter's
// page (the Filters modal, or the datasets sidebar for the text search);
// the trailing x on each chip clears the whole group, and each value can
// still be dropped on its own. A final link resets everything including the
// polygon.
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
  const { polygon, setPolygon, datasetTitleSearchText, setDatasetTitleSearchText } =
    useSelection()
  const { setShowFiltersModal, setOpenFilter, setSidebarOpen } = useUI()

  // The chips can be collapsed behind a Show/Hide toggle. They start hidden on
  // phones — where they would eat most of the map — and shown on desktop. The
  // live listener flips the default when the viewport crosses the breakpoint.
  const [collapsed, setCollapsed] = useState(
    () => window.matchMedia('(max-width: 700px)').matches
  )
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 700px)')
    const onChange = (e) => setCollapsed(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

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

  const activeFilters = [
    ...buildActiveFilters({ timeframesBadgeTitle, depthRangeBadgeTitle }),
    datasetTitleSearchText && {
      key: 'search',
      label: t('textSearchFilterName'),
      goToFilter: () => setSidebarOpen(true),
      removeAll: () => setDatasetTitleSearchText(''),
      items: [
        {
          id: 'search',
          label: datasetTitleSearchText,
          remove: () => setDatasetTitleSearchText('')
        }
      ]
    }
  ]
    .filter(Boolean)
    .map((f) => ({
      ...f,
      goToFilter:
        f.goToFilter ||
        (() => {
          setOpenFilter(filterNameForKey(f.key, t))
          setShowFiltersModal(true)
        })
    }))

  if (activeFilters.length === 0 && !polygon) return null

  return (
    <ul className='activeFilterBullets' aria-label={t('activeFiltersLabel')}>
      {!collapsed && activeFilters.map((f) => (
        <li key={f.key} className='activeFilterGroup'>
          <button
            type='button'
            className='activeFilterGroupLabel'
            onClick={f.goToFilter}
            title={t('activeFilterGoToFilterTitle', { filter: f.label })}
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
          <button
            type='button'
            className='activeFilterGroupRemove'
            onClick={f.removeAll}
            title={t('activeFilterRemoveAllTitle', { filter: f.label })}
          >
            <X size={14} aria-hidden='true' />
          </button>
        </li>
      ))}
      {!collapsed && polygon && (
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
      <li className='activeFilterResetItem'>
        <button
          type='button'
          className='filterMenuReset'
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          {collapsed ? t('activeFiltersShow') : t('activeFiltersHide')}
        </button>
        <button
          type='button'
          className='filterMenuReset'
          onClick={() => {
            resetFilters()
            setPolygon()
            setDatasetTitleSearchText('')
          }}
          title={t('resetFiltersButtonTooltipText')}
        >
          {t('resetButtonText')}
        </button>
      </li>
    </ul>
  )
}
