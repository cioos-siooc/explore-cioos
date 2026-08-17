import * as React from 'react'
import { useRef } from 'react'
import { Filter, ListUl } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import BrandSearch from '../TopLeft/BrandSearch.jsx'
import ActiveFilterChips from './ActiveFilterChips.jsx'
import DatasetCounts from './DatasetCounts.jsx'
import usePublishedFootprint from '../../../state/ui/usePublishedFootprint.js'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// Gap held between the bottom of the top bar and whatever it pushes down. Half
// the 12px inset the shell uses elsewhere: this one is spent on every viewport
// narrow enough for the bar to reach over the left column, and it comes
// straight off the top of that column — where the datasets card and the
// griddap legend are stacked and the height is already spoken for.
const TOP_BAR_GAP = 6

// How far down the top bar reaches over the datasets column on the left. The bar
// is centered and grows downward as active-filter chips wrap onto new rows, so
// with a few filters applied it hangs well below the brand card and over the top
// of that column — hence a measurement rather than a fixed clearance.
//
// It only reaches the column on narrower viewports: once the screen is wide
// enough for the centered bar to sit clear of it, this is 0 and the datasets
// card starts at the top of the map again.
function measureTopBarSpace (rect) {
  const column = document.querySelector('.sidebar')?.getBoundingClientRect()
  if (column && rect.left >= column.right) return 0
  return rect.bottom + TOP_BAR_GAP
}

// Centered top header. First layer: the brand bar. Second layer: the dataset
// tally (shown / in view / total), which is what the two layers below act on.
// Third layer, merged into a single segmented pill: the Datasets toggle
// (opens/closes the left datasets sidebar) and the Filters button (opens the
// filters modal). Both segments carry a dimmed-primary wash so they read as the
// map's primary entry points. The active-filter chips flow beneath, staying
// centered.
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

  const barRef = useRef(null)
  usePublishedFootprint(barRef, '--cioos-top-bar-space', measureTopBarSpace)

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
    <div className='topBar' ref={barRef}>
      <BrandSearch>
        <DatasetCounts />
        <div className='topBarActions'>
          <button
            type='button'
            className={classNames('topBarButton', { active: sidebarOpen })}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-pressed={sidebarOpen}
            title={
              sidebarOpen ? t('sidebarCollapseTitle') : t('sidebarShowTitle')
            }
          >
            <ListUl size={18} aria-hidden='true' />
            <span className='topBarButtonLabel'>
              {t('topBarDatasetsLabel')}
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
