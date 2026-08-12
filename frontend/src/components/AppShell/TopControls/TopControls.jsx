import * as React from 'react'
import { useRef } from 'react'
import { Filter, ListUl } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import BrandSearch from '../TopLeft/BrandSearch.jsx'
import ActiveFilterChips from './ActiveFilterChips.jsx'
import Spinner from '../../ui/Spinner.jsx'
import useDatasetCounts from '../../../state/useDatasetCounts.js'
import usePublishedFootprint from '../../../state/ui/usePublishedFootprint.js'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// Gap held between the bottom of the top bar and whatever it pushes down.
const TOP_BAR_GAP = 12

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
    // "1832 / 1834", collapsing to a single number when nothing is filtered
    // out — the same string the sidebar footer shows.
    label: countLabel
  } = useDatasetCounts()

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
            {/* Label over counts, not label beside counts: on its own line the
                "shown / total" pair has the segment's full width, so it stays
                legible as one horizontal reading in both languages instead of
                being folded to fit next to "Jeux de données". */}
            <span className='topBarButtonStack'>
              <span className='topBarButtonLabel'>
                {t('topBarDatasetsLabel')}
              </span>
              <span
                className={classNames('topBarCounts', {
                  updating: countsUpdating
                })}
              >
                {countsReady ? (
                  countLabel
                ) : (
                  <Spinner size='sm' className='countSpinner' />
                )}
              </span>
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
