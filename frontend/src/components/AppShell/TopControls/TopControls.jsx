import * as React from 'react'
import { Filter, ListUl } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import BrandSearch from '../TopLeft/BrandSearch.jsx'
import ActiveFilterChips from './ActiveFilterChips.jsx'
import Spinner from '../../ui/Spinner.jsx'
import useDatasetCounts from '../../../state/useDatasetCounts.js'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
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
    depthFilterActive
  } = useFilters()
  const { setShowFiltersModal, sidebarOpen, setSidebarOpen } = useUI()
  // No count is shown until there is a real one — see useDatasetCounts.
  const {
    ready: countsReady,
    updating: countsUpdating,
    filteredCount,
    total,
    label: countLabel
  } = useDatasetCounts()

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

  return (
    <div className='topBar'>
      <BrandSearch>
        <div className='topBarActions'>
          <button
            type='button'
            className={classNames('topBarButton', { active: sidebarOpen })}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-pressed={sidebarOpen}
            title={
              countsReady
                ? t('dockDatasetsCountTitle', {
                  filtered: filteredCount,
                  total: total ?? filteredCount
                })
                : t('datasetsCountLoadingTitle')
            }
          >
            <ListUl size={18} aria-hidden='true' />
            <span className='topBarButtonLabel'>{t('datasetsFilterName')}</span>
            <span
              className={classNames('topBarCount', {
                updating: countsUpdating
              })}
            >
              {countsReady ? (
                countLabel
              ) : (
                <Spinner size='sm' className='countSpinner' />
              )}
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
