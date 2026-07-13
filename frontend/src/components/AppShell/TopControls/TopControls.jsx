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

// The top-left control row beside the sidebar: the prominent Filters button
// (opens the filter modal) followed by the active-filter chips. While the
// sidebar is closed, the brand + search cluster and a Datasets button to
// reopen it lead the row.
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
  const { sidebarOpen, setSidebarOpen, setShowFiltersModal } = useUI()

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
    <div className={classNames('topControls', { withSidebar: sidebarOpen })}>
      {!sidebarOpen && (
        <>
          <BrandSearch floating />
          <button
            type='button'
            className='topControlButton'
            onClick={() => setSidebarOpen(true)}
            title={t('dockDatasetsCountTitle', {
              filtered: filteredCount,
              total: totalNumberOfDatasets || 0
            })}
          >
            <ListUl size={18} aria-hidden='true' />
            <span className='topControlLabel'>{t('datasetsFilterName')}</span>
            <span className='topControlCount'>
              {totalNumberOfDatasets
                ? `${filteredCount} / ${totalNumberOfDatasets}`
                : filteredCount}
            </span>
          </button>
        </>
      )}
      <button
        type='button'
        className='topControlButton'
        onClick={() => setShowFiltersModal(true)}
        title={t('dockFiltersCountTitle', { count: activeFilterCount })}
      >
        <Filter size={20} aria-hidden='true' />
        <span className='topControlLabel'>{t('filtersMenuButton')}</span>
        {activeFilterCount > 0 && (
          <span className='topControlCount'>{activeFilterCount}</span>
        )}
      </button>
      <ActiveFilterChips />
    </div>
  )
}
