import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, ListUl } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import isEmpty from 'lodash/isEmpty'

import DatasetsPanel from '../Panels/DatasetsPanel.jsx'
import Spinner from '../../ui/Spinner.jsx'
import useDatasetCounts from '../../../state/useDatasetCounts.js'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// Height of the collapsed drag zone on mobile — an invisible strip of the
// datasets sheet left at the bottom edge to catch the swipe-up. Nothing is
// drawn there (no handle, no chrome); it only exists to start the drag that
// reveals the list. Kept in sync with --sheet-peek in the stylesheet so the
// drag math and the resting position agree.
const SHEET_PEEK = 28
// A pointer has to travel this far before we treat the gesture as a drag
// rather than a tap on the toggle.
const DRAG_THRESHOLD = 6

// The left column: the datasets card — a toggle header that shows/hides the
// dataset list and the counts + Download footer. (The brand and the
// Datasets/Filters entry points now live in the centered top bar.) On phones
// the datasets card becomes a bottom sheet dragged up from the base of the
// screen.
export default function Sidebar () {
  const { t } = useTranslation()
  const { pointsToReview } = useSelection()
  const { sidebarOpen, setSidebarOpen, setShowDownloadModal } = useUI()
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
  const selectedCount = isEmpty(pointsToReview) ? 0 : pointsToReview.length
  const countsTitle = countsReady
    ? t('dockDatasetsCountTitle', {
      filtered: filteredCount,
      // A failed /datasets leaves no catalog total; the filtered count is
      // then all we know, and all the label shows.
      total: total ?? filteredCount
    })
    : t('datasetsCountLoadingTitle')

  // Track the mobile breakpoint so the toggle doubles as a drag handle only
  // where the datasets card is a bottom sheet.
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 700px)').matches
  )
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 700px)')
    const onChange = (e) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // Bottom-sheet drag (mobile only). While dragging we follow the finger with
  // an inline translateY; on release we snap to expanded/collapsed and hand the
  // resting position back to CSS.
  const sheetRef = useRef(null)
  const dragRef = useRef({ startY: 0, base: 0, range: 0, moved: false })
  const suppressClickRef = useRef(false)
  const [dragOffset, setDragOffset] = useState(null)

  const onPointerDown = (e) => {
    if (!isMobile || e.button === 2) return
    const height = sheetRef.current?.getBoundingClientRect().height ?? 0
    const range = Math.max(height - SHEET_PEEK, 0)
    dragRef.current = {
      startY: e.clientY,
      base: expanded ? 0 : range,
      range,
      moved: false
    }
    suppressClickRef.current = false
    setDragOffset(expanded ? 0 : range)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e) => {
    if (dragOffset === null) return
    const { startY, base, range } = dragRef.current
    const delta = e.clientY - startY
    if (Math.abs(delta) > DRAG_THRESHOLD) dragRef.current.moved = true
    setDragOffset(Math.min(Math.max(base + delta, 0), range))
  }

  const onPointerUp = (e) => {
    if (dragOffset === null) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (dragRef.current.moved) {
      // Snap to whichever end is nearer, then suppress the click that a
      // pointerup would otherwise fire so we don't toggle twice.
      setSidebarOpen(dragOffset < dragRef.current.range / 2)
      suppressClickRef.current = true
    }
    setDragOffset(null)
  }

  const onToggleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setSidebarOpen(!expanded)
  }

  return (
    <aside
      className={classNames('sidebar', { sheetExpanded: expanded })}
      aria-label={t('datasetsFilterName')}
    >
      <section
        ref={sheetRef}
        className={classNames('sidebarDatasets', { expanded })}
        style={
          dragOffset !== null
            ? { transform: `translateY(${dragOffset}px)`, transition: 'none' }
            : undefined
        }
      >
        <button
          type='button'
          className='datasetsToggle'
          onClick={onToggleClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
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
              <Spinner size='sm' className='countSpinner' />
            )}
          </span>
          <ChevronDown
            className='datasetsToggleChevron'
            size={16}
            aria-hidden='true'
          />
        </button>
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
                <Spinner size='sm' className='countSpinner' />
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
