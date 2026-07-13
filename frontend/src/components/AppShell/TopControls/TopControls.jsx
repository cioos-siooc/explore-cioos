import * as React from 'react'
import { Filter, ListUl } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import BrandSearch from '../TopLeft/BrandSearch.jsx'
import ActiveFilterChips from './ActiveFilterChips.jsx'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// Centered top header. First layer: the brand bar. Second layer, merged into a
// single segmented pill directly below it: the Datasets toggle (opens/closes
// the left datasets sidebar) and the Filters button (opens the filters modal).
// Both segments carry a dimmed-primary wash so they read as the map's primary
// entry points. The active-filter chips flow beneath, staying centered.
export default function TopControls () {
  const { t } = useTranslation()
  const {
    eovsSelected,
    orgsSelected,
    datasetsSelected,
    platformsSelected,
    erddapServersSelected,
    obisNodesSelected,
    scientificNamesSelected,
    timeFilterActive,
    depthFilterActive,
    totalNumberOfDatasets
  } = useFilters()
  const { pointsData } = useSelection()
  const { setShowFiltersModal, sidebarOpen, setSidebarOpen } = useUI()

  const activeFilterCount = [
    eovsSelected.some((o) => o.isSelected),
    orgsSelected.some((o) => o.isSelected),
    datasetsSelected.some((o) => o.isSelected),
    platformsSelected.some((o) => o.isSelected),
    erddapServersSelected.some((o) => o.isSelected) ||
      obisNodesSelected.some((o) => o.isSelected),
    scientificNamesSelected.length > 0,
    timeFilterActive,
    depthFilterActive
  ].filter(Boolean).length

  const filteredCount = pointsData?.length ?? 0

  return (
    <div className='topBar'>
      <BrandSearch>
        <div className='topBarActions'>
          <button
            type='button'
            className={classNames('topBarButton', { active: sidebarOpen })}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-pressed={sidebarOpen}
            title={t('dockDatasetsCountTitle', {
              filtered: filteredCount,
              total: totalNumberOfDatasets || 0
            })}
          >
            <ListUl size={18} aria-hidden='true' />
            <span className='topBarButtonLabel'>{t('datasetsFilterName')}</span>
            <span className='topBarCount'>
              {totalNumberOfDatasets
                ? `${filteredCount} / ${totalNumberOfDatasets}`
                : filteredCount}
            </span>
          </button>
          <button
            type='button'
            className='topBarButton'
            onClick={() => setShowFiltersModal(true)}
            title={t('dockFiltersCountTitle', { count: activeFilterCount })}
          >
            <Filter size={18} aria-hidden='true' />
            <span className='topBarButtonLabel'>{t('filtersMenuButton')}</span>
            {activeFilterCount > 0 && (
              <span className='topBarCount'>{activeFilterCount}</span>
            )}
          </button>
        </div>
      </BrandSearch>
      <ActiveFilterChips />
    </div>
  )
}
