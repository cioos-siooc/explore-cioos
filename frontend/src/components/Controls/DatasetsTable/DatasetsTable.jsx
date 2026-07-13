import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CaretDownFill,
  CaretUpFill,
  Search
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import isEmpty from 'lodash/isEmpty'

import { formatErddapServerName } from '../../../utilities'
import erddapServersJSONfile from '../../../erddapServers.json'
import DatasetCard from './DatasetCard.jsx'
import './styles.css'

// How many cards to render before the incremental "grow on scroll" kicks in.
// Keeps large result sets cheap to paint on mobile without a pager.
const PAGE_SIZE = 60
// Distance (px) from the bottom of the scroll area at which we reveal more.
const SCROLL_THRESHOLD = 400

// The datasets list, rendered as cards (replaces the old data table). Used in
// two contexts: the sidebar results list and the download-review modal
// (isDownloadModal), which surfaces size estimates and download status.
export default function DatasetsTable({
  handleSelectAllDatasets,
  handleSelectDataset,
  datasets,
  selectAll,
  setInspectDataset,
  setHoveredDataset = () => {},
  isDownloadModal,
  downloadSizeEstimates
}) {
  const { t, i18n } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const listRef = useRef(null)

  // Sort fields differ by context: the download modal exposes the size and
  // downloadable status; the sidebar exposes the locations count.
  const sortFields = useMemo(() => {
    const base = [
      { id: 'title', label: t('datasetsTableHeaderTitleText'), type: 'string' },
      { id: 'type', label: t('datasetsTableHeaderTypeText'), type: 'string' },
      { id: 'platform', label: t('datasetsCardSortPlatformText'), type: 'string' }
    ]
    if (isDownloadModal) {
      base.push({ id: 'size', label: t('datasetsTableHeaderSizeText'), type: 'number' })
      base.push({
        id: 'downloadable',
        label: t('datasetsCardSortDownloadableText'),
        type: 'number'
      })
    } else {
      base.push({
        id: 'locations',
        label: t('datasetsTableHeaderLocationsText'),
        type: 'number'
      })
    }
    return base
  }, [isDownloadModal, i18n.language])

  const [sort, setSort] = useState({ field: 'title', dir: 'asc' })

  // Tap a chip to sort by it; tap the active chip again to flip direction.
  const handleSortClick = (fieldId) => {
    setSort((prev) =>
      prev.field === fieldId
        ? { field: fieldId, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field: fieldId, dir: 'asc' }
    )
  }

  // Sidebar search: match across the visible text fields. The download modal
  // has no search UI, so this is a no-op there.
  function filterBySearch(rows) {
    if (isDownloadModal || isEmpty(searchText)) return rows || []
    const query = searchText.toLowerCase()
    return (rows || []).filter((row) =>
      [
        row.title,
        row.cdm_data_type,
        formatErddapServerName(
          row.erddap_server_url || row.erddap_url,
          i18n.language,
          erddapServersJSONfile
        )
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  }

  function sortValue(row, field) {
    const isGrid = row.cdm_data_type === 'Grid'
    switch (field) {
    case 'title':
      return (row.title || '').toLowerCase()
    case 'type':
      return (isGrid ? t('griddapTypeLabel') : row.cdm_data_type || '').toLowerCase()
    case 'platform':
      return (isGrid ? t('griddapTypeLabel') : row.platform || '').toLowerCase()
    case 'locations':
      return isGrid ? -1 : Number(row.profiles_count) || 0
    case 'size':
      return Number(row?.sizeEstimate?.filteredSize) || 0
    case 'downloadable':
      return row.internalDownload ? 1 : 0
    default:
      return 0
    }
  }

  const visibleRows = useMemo(() => {
    const field = sortFields.find((f) => f.id === sort.field)
    const filtered = filterBySearch(datasets)
    const factor = sort.dir === 'asc' ? 1 : -1
    const sorted = [...filtered].sort((a, b) => {
      const va = sortValue(a, sort.field)
      const vb = sortValue(b, sort.field)
      if (field?.type === 'number') return (va - vb) * factor
      return String(va).localeCompare(String(vb), i18n.language) * factor
    })
    return sorted
  }, [datasets, searchText, sort, downloadSizeEstimates, isDownloadModal, i18n.language])

  // Reset the render window whenever the result set or ordering changes so we
  // don't leave a stale partial list scrolled off the top.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [searchText, sort, isDownloadModal])

  const handleScroll = (e) => {
    const el = e.currentTarget
    if (
      el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD &&
      visibleCount < visibleRows.length
    ) {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, visibleRows.length))
    }
  }

  const controls = (
    <div className='datasetsCardControls'>
      <div className='datasetsCardToolbar'>
        <button
          type='button'
          className={classNames('selectAllToggle', { active: selectAll })}
          onClick={handleSelectAllDatasets}
          aria-pressed={selectAll}
          title={t('datasetsTableHeaderSelectAllTitle')}
        >
          {t('datasetsTableHeaderSelectAllTitle')}
        </button>
        {!isDownloadModal && (
          <div className='datasetsTableSearchWrap'>
            <Search size={13} aria-hidden='true' />
            <input
              className='datasetsTableSearch'
              type='text'
              value={searchText}
              placeholder={t('datasetInspectorFilterText')}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        )}
        <span className='datasetsTableCount'>{visibleRows.length}</span>
      </div>

      <div className='datasetsCardSortRow'>
        <span className='datasetsCardSortLabel'>{t('datasetsCardSortByLabel')}</span>
        {sortFields.map((field) => {
          const active = sort.field === field.id
          return (
            <button
              key={field.id}
              type='button'
              className={classNames('datasetsCardSortChip', { active })}
              onClick={() => handleSortClick(field.id)}
              aria-pressed={active}
              title={
                active
                  ? sort.dir === 'asc'
                    ? t('datasetsCardSortAscendingTitle')
                    : t('datasetsCardSortDescendingTitle')
                  : undefined
              }
            >
              {field.label}
              {active &&
                (sort.dir === 'asc' ? (
                  <CaretUpFill size={10} aria-hidden='true' />
                ) : (
                  <CaretDownFill size={10} aria-hidden='true' />
                ))}
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className={classNames('datasetsTable', { downloadModal: isDownloadModal })}>
      {controls}
      <div className='datasetsCardList' ref={listRef} onScroll={handleScroll}>
        {visibleRows.length === 0 ? (
          <div className='datasetsCardEmpty'>{t('datasetsCardNoResultsText')}</div>
        ) : (
          visibleRows.slice(0, visibleCount).map((row) => (
            <DatasetCard
              key={row.pk ?? row.dataset_id ?? row.title}
              row={row}
              isDownloadModal={isDownloadModal}
              downloadSizeEstimates={downloadSizeEstimates}
              onSelect={handleSelectDataset}
              onInspect={isDownloadModal ? undefined : setInspectDataset}
              onHover={setHoveredDataset}
              onHoverEnd={() => setHoveredDataset()}
              t={t}
              i18n={i18n}
            />
          ))
        )}
      </div>
    </div>
  )
}
