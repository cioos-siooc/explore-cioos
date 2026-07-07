import * as React from 'react'
import { Filter, ListUl, Download } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import isEmpty from 'lodash/isEmpty'

import DockItem from './DockItem.jsx'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { useUI, PANELS } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// Bottom-center dock — the app's primary navigation: Datasets, the prominent
// Filters action in the middle, and Download. Minor actions (intro, feedback,
// language) live in the top-left cluster with the logo and search.
export default function BottomDock () {
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
  const { pointsData, pointsToReview } = useSelection()
  const { activePanel, togglePanel } = useUI()

  const activeFilterCount =
    [
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
  const selectedCount = isEmpty(pointsToReview) ? 0 : pointsToReview.length

  return (
    <nav
      className='bottomDock'
      role='navigation'
      aria-label={t('dockNavLabel')}
    >
      <DockItem
        id={PANELS.datasets}
        icon={<ListUl size={20} />}
        label={t('datasetsFilterName')}
        count={
          totalNumberOfDatasets
            ? `${filteredCount} / ${totalNumberOfDatasets}`
            : filteredCount
        }
        countTitle={t('dockDatasetsCountTitle', {
          filtered: filteredCount,
          total: totalNumberOfDatasets || 0
        })}
        active={activePanel === PANELS.datasets}
        onClick={() => togglePanel(PANELS.datasets)}
      />
      <DockItem
        id={PANELS.filters}
        icon={<Filter size={28} />}
        label={t('filtersMenuButton')}
        count={activeFilterCount > 0 ? activeFilterCount : null}
        countTitle={t('dockFiltersCountTitle', { count: activeFilterCount })}
        active={activePanel === PANELS.filters}
        prominent
        onClick={() => togglePanel(PANELS.filters)}
      />
      <DockItem
        id={PANELS.download}
        icon={<Download size={20} />}
        label={t('downloadModalButtonText')}
        count={selectedCount > 0 ? selectedCount : null}
        countTitle={t('dockDownloadCountTitle', { count: selectedCount })}
        active={activePanel === PANELS.download}
        disabled={selectedCount === 0}
        onClick={() => togglePanel(PANELS.download)}
      />
    </nav>
  )
}
