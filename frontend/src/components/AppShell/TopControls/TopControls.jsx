import * as React from 'react'
import { Filter } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import ActiveFilterChips from './ActiveFilterChips.jsx'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// The control row at the top of the map, beside the sidebar: the Filters
// button (opens the filter modal) followed by the active-filter chips. The
// brand + search and the datasets toggle now live permanently in the sidebar.
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
  const { setShowFiltersModal } = useUI()

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
    <div className='topControls'>
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
