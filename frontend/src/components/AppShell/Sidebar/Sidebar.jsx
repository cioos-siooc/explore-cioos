import * as React from 'react'
import {
  ChevronDown,
  ChevronLeft,
  Download,
  FileEarmarkText,
  ListUl,
  X
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import isEmpty from 'lodash/isEmpty'

import DatasetsPanel from '../Panels/DatasetsPanel.jsx'
import Spinner from '../../ui/Spinner.jsx'
import useDatasetCounts from '../../../state/useDatasetCounts.js'
import useMediaQuery, { MOBILE_QUERY } from '../../../state/ui/useMediaQuery.js'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// The left column: the datasets card — a toggle header that shows/hides the
// dataset list and the counts + Download footer. (The brand and the
// Datasets/Filters entry points now live in the centered top bar.) On phones
// the same card takes the whole screen, but only once the top bar's Datasets
// button asks for it — nothing of it is left at any edge otherwise.
// Drilling into a single dataset swaps that header for a back banner: the card
// hosts two different surfaces, and the header is what names the one in view.
export default function Sidebar () {
  const { t } = useTranslation()
  const { pointsToReview, inspectDataset, returnToDatasetList } = useSelection()
  const { sidebarOpen, setSidebarOpen, setShowDownloadModal } = useUI()
  // On a phone the card is the whole screen rather than a column beside the
  // map, so the control that dismisses it is a close button in the corner
  // rather than a chevron that collapses a card back into the layout. Same
  // button, same handler — only the icon says which of the two it is.
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const DismissIcon = isMobile ? X : ChevronDown
  // Until `ready`, there is no dataset count to show — not even a zero. See
  // useDatasetCounts.
  const {
    ready: countsReady,
    updating: countsUpdating,
    filteredCount,
    total,
    allDatasetsShown,
    label: countLabel
  } = useDatasetCounts()

  const expanded = sidebarOpen
  // The panel is on a single dataset rather than the list. The banner swaps
  // with it, so the card never leaves the user guessing which of the two
  // surfaces they are on — and the way back is in the banner, not buried in
  // the page's own title block.
  const inspecting = Boolean(inspectDataset)
  const selectedCount = isEmpty(pointsToReview) ? 0 : pointsToReview.length
  const countsTitle = countsReady
    ? t('dockDatasetsCountTitle', {
      filtered: filteredCount,
      // A failed /datasets leaves no catalog total; the filtered count is
      // then all we know, and all the label shows.
      total: total ?? filteredCount
    })
    : t('datasetsCountLoadingTitle')

  return (
    <aside
      className={classNames('sidebar', { sheetExpanded: expanded })}
      aria-label={t('datasetsFilterName')}
    >
      <section className={classNames('sidebarDatasets', { expanded })}>
        {inspecting ? (
          <div className='datasetsBanner'>
            <button
              type='button'
              className='datasetsBackButton'
              onClick={returnToDatasetList}
              title={t('datasetInspectorBackButtonTitle')}
            >
              <ChevronLeft size={14} aria-hidden='true' />
              <span>{t('datasetsFilterName')}</span>
            </button>
            <span className='datasetsBannerMode'>
              <FileEarmarkText size={13} aria-hidden='true' />
              {t('sidebarDatasetPageLabel')}
            </span>
            <button
              type='button'
              className='datasetsBannerCollapse'
              onClick={() => setSidebarOpen(false)}
              title={t('sidebarCollapseTitle')}
              aria-label={t('sidebarCollapseTitle')}
            >
              <DismissIcon size={isMobile ? 22 : 16} aria-hidden='true' />
            </button>
          </div>
        ) : (
          <button
            type='button'
            className='datasetsToggle'
            onClick={() => setSidebarOpen(!expanded)}
            aria-expanded={expanded}
            title={expanded ? t('sidebarCollapseTitle') : t('sidebarShowTitle')}
          >
            <ListUl size={18} aria-hidden='true' />
            <span className='datasetsToggleLabel'>{t('datasetsFilterName')}</span>
            <span
              className={classNames('datasetsToggleCount', {
                updating: countsUpdating
              })}
              title={countsTitle}
            >
              {countsReady ? (
                countLabel
              ) : (
                <Spinner size='xs' className='countSpinner' />
              )}
            </span>
            <DismissIcon
              className='datasetsToggleChevron'
              size={isMobile ? 22 : 16}
              aria-hidden='true'
            />
          </button>
        )}
        <div className='sidebarBody'>
          <DatasetsPanel />
        </div>
        <footer className='sidebarFooter'>
          <div className='sidebarCounts'>
            <span
              className={classNames('sidebarCountsDatasets', {
                updating: countsUpdating
              })}
              title={countsTitle}
            >
              {!countsReady ? (
                <Spinner size='xs' className='countSpinner' />
              ) : allDatasetsShown ? (
                t('sidebarCountsDatasetsAll', {
                  total: total ?? filteredCount
                })
              ) : (
                t('sidebarCountsDatasets', {
                  filtered: filteredCount,
                  total
                })
              )}
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
      </section>
    </aside>
  )
}
