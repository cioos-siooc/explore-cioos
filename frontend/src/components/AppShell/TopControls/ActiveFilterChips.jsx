import * as React from 'react'
import { useState } from 'react'
import { X } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import { generateRangeSelectBadgeTitle } from '../../../utilities.jsx'
import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth
} from '../../config.js'
import {
  DATA_LAYER_LABEL_KEYS,
  selectedDataLayerKeys
} from '../../../state/dataLayers.js'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../../state/map/MapStateProvider.jsx'
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
  case 'dataLayers': return 'layerSelectorLabel'
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
  const {
    polygon,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView
  } = useSelection()
  const { setShowFiltersModal, setOpenFilter, setSidebarOpen } = useUI()
  const { dataLayers, toggleDataLayer, resetDataLayers, requestDraw } = useMapState()

  // What is filtering the map, at every width. The chips used to start
  // collapsed on phones, on the reasoning that they would eat the map — but
  // they are the only thing on screen that says which filters are on, and a
  // filtered map with nothing saying so is worse than a smaller one. The
  // Show/Hide toggle below is still here for putting them away by hand; it is
  // no longer the screen size's decision to make.
  const [collapsed, setCollapsed] = useState(false)

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

  // The geometry selection, announced the same way every other filter's is: one
  // item per chosen value, and nothing at all while the filter is unfiltered
  // (every geometry drawn). Dropping an item unticks that geometry; dropping
  // the last one returns to all, via commitDataLayers.
  const chosenDataLayers = selectedDataLayerKeys(dataLayers)
  const dataLayersFilter = chosenDataLayers.length > 0 && {
    key: 'dataLayers',
    label: t('layerSelectorLabel'),
    removeAll: resetDataLayers,
    items: chosenDataLayers.map((key) => ({
      id: key,
      label: t(DATA_LAYER_LABEL_KEYS[key]),
      remove: () => toggleDataLayer(key)
    }))
  }

  const activeFilters = [
    dataLayersFilter,
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
    },
    onlyInView && {
      key: 'onlyInView',
      label: t('datasetsCardOnlyInViewText'),
      goToFilter: () => {
        setOpenFilter(t('datasetsCardOnlyInViewText'))
        setShowFiltersModal(true)
      },
      removeAll: () => setOnlyInView(false),
      items: [
        {
          id: 'onlyInView',
          label: t('datasetsCardOnlyInViewChipText'),
          remove: () => setOnlyInView(false)
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
          <div className='activeFilterItems'>
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
          </div>
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
              onClick={() => requestDraw('clear')}
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
            resetDataLayers()
            requestDraw('clear')
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
