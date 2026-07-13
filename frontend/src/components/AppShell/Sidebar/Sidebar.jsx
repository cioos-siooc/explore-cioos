import * as React from 'react'
import { ChevronLeft, Download } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import isEmpty from 'lodash/isEmpty'

import BrandSearch from '../TopLeft/BrandSearch.jsx'
import DatasetsPanel from '../Panels/DatasetsPanel.jsx'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// The left sidebar: brand + search header, the dataset list (or the
// single-dataset inspector drill-in), and a footer summarizing the counts —
// datasets shown / total, datasets selected — with the Download action.
export default function Sidebar () {
  const { t } = useTranslation()
  const { totalNumberOfDatasets } = useFilters()
  const { pointsData, pointsToReview } = useSelection()
  const { sidebarOpen, setSidebarOpen, setShowDownloadModal } = useUI()

  if (!sidebarOpen) return null

  const filteredCount = pointsData?.length ?? 0
  const selectedCount = isEmpty(pointsToReview) ? 0 : pointsToReview.length

  return (
    <aside className='sidebar' aria-label={t('datasetsFilterName')}>
      <header className='sidebarHeader'>
        <BrandSearch />
        <button
          type='button'
          className='sidebarCollapse'
          onClick={() => setSidebarOpen(false)}
          title={t('sidebarCollapseTitle')}
          aria-label={t('sidebarCollapseTitle')}
        >
          <ChevronLeft size={16} aria-hidden='true' />
        </button>
      </header>
      <div className='sidebarBody'>
        <DatasetsPanel />
      </div>
      <footer className='sidebarFooter'>
        <div className='sidebarCounts'>
          <span
            className='sidebarCountsDatasets'
            title={t('dockDatasetsCountTitle', {
              filtered: filteredCount,
              total: totalNumberOfDatasets || 0
            })}
          >
            {t('sidebarCountsDatasets', {
              filtered: filteredCount,
              total: totalNumberOfDatasets || 0
            })}
          </span>
          <span
            className='sidebarCountsSelected'
            title={t('dockDownloadCountTitle', { count: selectedCount })}
          >
            {t('sidebarCountsSelected', { count: selectedCount })}
          </span>
        </div>
        <button
          type='button'
          className='sidebarDownloadButton'
          disabled={selectedCount === 0}
          onClick={() => setShowDownloadModal(true)}
          title={t('dockDownloadCountTitle', { count: selectedCount })}
        >
          <Download size={16} aria-hidden='true' />
          {t('downloadModalButtonText')}
          {selectedCount > 0 && (
            <span className='sidebarDownloadCount'>{selectedCount}</span>
          )}
        </button>
      </footer>
    </aside>
  )
}
