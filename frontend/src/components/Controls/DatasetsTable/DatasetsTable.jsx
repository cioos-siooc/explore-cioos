import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CaretDownFill,
  CaretRightFill,
  CaretUpFill,
  Search
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import DatasetCard from './DatasetCard.jsx'
import './styles.css'

// How many cards to render before the incremental "grow on scroll" kicks in.
// Keeps large result sets cheap to paint on mobile without a pager.
const PAGE_SIZE = 60
// Distance (px) from the bottom of the scroll area at which we reveal more.
const SCROLL_THRESHOLD = 400
// Stable default so an absent datasetsInViewPks prop (e.g. the download modal)
// doesn't create a new Set every render and thrash memo deps.
const EMPTY_SET = new Set()
// Group-by dimensions. 'none' is the flat default; the array-valued dims
// (organization, eov) place a dataset under each of its values.
const GROUP_NONE = 'none'

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
  downloadSizeEstimates,
  datasetsInViewPks = EMPTY_SET
}) {
  const { t, i18n } = useTranslation()
  // Lifted to SelectionProvider so it can surface as a removable chip
  // (ActiveFilterChips) alongside the rest of the active filters.
  const { datasetTitleSearchText: searchText, setDatasetTitleSearchText: setSearchText } =
    useSelection()
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
  // Group-by: 'none' plus the five category dimensions. Not offered in the
  // download modal, which is a flat review list.
  const [groupBy, setGroupBy] = useState(GROUP_NONE)
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())

  const groupOptions = useMemo(
    () => [
      { id: GROUP_NONE, label: t('datasetsCardGroupNoneText') },
      { id: 'type', label: t('datasetsTableHeaderTypeText') },
      { id: 'platform', label: t('datasetsCardSortPlatformText') },
      { id: 'organization', label: t('datasetsCardGroupOrganizationText') },
      { id: 'eov', label: t('datasetsCardGroupEovText') },
      { id: 'source', label: t('datasetsCardGroupSourceText') },
      { id: 'inView', label: t('datasetsCardOnlyInViewText') }
    ],
    [i18n.language]
  )

  const otherLabel = t('datasetsCardGroupOtherText')
  const uncategorizedLabel = t('datasetsCardGroupUncategorizedText')

  // The group label(s) a dataset belongs to under the active dimension.
  // Array-valued dims return several so a dataset shows under each of its
  // organizations / EOVs; scalar dims return one.
  function groupKeysFor(row) {
    const isGrid = row.cdm_data_type === 'Grid'
    switch (groupBy) {
    case 'type':
      return [
        isGrid
          ? t('griddapTypeLabel')
          : (row.cdm_data_type || otherLabel)
            .replace('TimeSeriesProfile', 'Time series / Profile')
            .replace('TimeSeries', 'Time series')
      ]
    case 'platform':
      return [isGrid ? t('griddapTypeLabel') : row.platform || otherLabel]
    case 'source':
      return [row.source_type === 'obis' ? 'OBIS' : 'ERDDAP']
    case 'organization':
      return row.organizations?.length ? row.organizations : [uncategorizedLabel]
    case 'eov':
      return row.eovs?.length ? row.eovs : [uncategorizedLabel]
    case 'inView':
      return [
        datasetsInViewPks.has(row.pk)
          ? t('datasetsCardOnlyInViewText')
          : t('datasetsCardGroupOutOfViewText')
      ]
    default:
      return []
    }
  }

  // Tap a chip to sort by it; tap the active chip again to flip direction.
  const handleSortClick = (fieldId) => {
    setSort((prev) =>
      prev.field === fieldId
        ? { field: fieldId, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field: fieldId, dir: 'asc' }
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

  // Search filtering happens upstream (SelectionProvider's filteredDatasets),
  // so it's reflected in the shared dataset counters too — this just sorts
  // whatever it's handed.
  const visibleRows = useMemo(() => {
    const field = sortFields.find((f) => f.id === sort.field)
    const factor = sort.dir === 'asc' ? 1 : -1
    const sorted = [...(datasets || [])].sort((a, b) => {
      const va = sortValue(a, sort.field)
      const vb = sortValue(b, sort.field)
      if (field?.type === 'number') return (va - vb) * factor
      return String(va).localeCompare(String(vb), i18n.language) * factor
    })
    return sorted
  }, [datasets, sort, downloadSizeEstimates, i18n.language])

  // Flat render list: without grouping it's just the sorted rows; with grouping
  // it's the rows bucketed under headers. Each entry is either
  // { header, group, count } or { row, group }. Rows stay in their sorted order
  // within a group; groups are alphabetical with Other/Uncategorized last.
  // Array-valued dims place a dataset under each of its values, so the total
  // row entries can exceed the unique dataset count (the toolbar count stays
  // unique — see below).
  const renderItems = useMemo(() => {
    if (groupBy === GROUP_NONE) return visibleRows.map((row) => ({ row }))
    const byGroup = new Map()
    for (const row of visibleRows) {
      for (const g of groupKeysFor(row)) {
        if (!byGroup.has(g)) byGroup.set(g, [])
        byGroup.get(g).push(row)
      }
    }
    const lastGroups = new Set([otherLabel, uncategorizedLabel])
    const groups = [...byGroup.keys()].sort((a, b) => {
      const aLast = lastGroups.has(a)
      const bLast = lastGroups.has(b)
      if (aLast !== bLast) return aLast ? 1 : -1
      return a.localeCompare(b, i18n.language)
    })
    const items = []
    for (const g of groups) {
      const rows = byGroup.get(g)
      items.push({ header: true, group: g, count: rows.length })
      if (!collapsedGroups.has(g)) {
        for (const row of rows) items.push({ row, group: g })
      }
    }
    return items
  }, [visibleRows, groupBy, collapsedGroups, datasetsInViewPks, i18n.language])

  // Total data rows currently expanded (excludes headers and collapsed groups),
  // used to drive the grow-on-scroll window.
  const totalRowCount = useMemo(
    () => renderItems.reduce((n, item) => (item.header ? n : n + 1), 0),
    [renderItems]
  )

  // Take render entries up to visibleCount *rows* (headers don't consume the
  // window), then drop any trailing header left with no rows beneath it.
  const shownItems = useMemo(() => {
    const out = []
    let rows = 0
    for (const item of renderItems) {
      if (item.header) {
        out.push(item)
      } else {
        if (rows >= visibleCount) break
        out.push(item)
        rows++
      }
    }
    // Drop a trailing header only when it's orphaned by the row window — a
    // collapsed group legitimately shows a header with no rows, and must keep
    // it so the group can be reopened.
    while (
      out.length &&
      out[out.length - 1].header &&
      !collapsedGroups.has(out[out.length - 1].group)
    ) {
      out.pop()
    }
    return out
  }, [renderItems, visibleCount, collapsedGroups])

  const toggleGroupCollapsed = (group) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  // Reset the render window whenever the result set or ordering changes so we
  // don't leave a stale partial list scrolled off the top.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [datasets, sort, isDownloadModal, groupBy])

  const handleScroll = (e) => {
    const el = e.currentTarget
    if (
      el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD &&
      visibleCount < totalRowCount
    ) {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, totalRowCount))
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

      {!isDownloadModal && (
        <div className='datasetsCardGroupRow'>
          <label className='datasetsCardGroupLabel' htmlFor='datasetsGroupBy'>
            {t('datasetsCardGroupByLabel')}
          </label>
          <select
            id='datasetsGroupBy'
            className='datasetsCardGroupSelect'
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            {groupOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )

  return (
    <div className={classNames('datasetsTable', { downloadModal: isDownloadModal })}>
      {controls}
      <div className='datasetsCardList' ref={listRef} onScroll={handleScroll}>
        {visibleRows.length === 0 ? (
          <div className='datasetsCardEmpty'>{t('datasetsCardNoResultsText')}</div>
        ) : (
          shownItems.map((item) =>
            item.header ? (
              <button
                key={`group:${item.group}`}
                type='button'
                className='datasetsCardGroupHeader'
                onClick={() => toggleGroupCollapsed(item.group)}
                aria-expanded={!collapsedGroups.has(item.group)}
              >
                {collapsedGroups.has(item.group) ? (
                  <CaretRightFill size={10} aria-hidden='true' />
                ) : (
                  <CaretDownFill size={10} aria-hidden='true' />
                )}
                <span className='datasetsCardGroupTitle' title={item.group}>
                  {item.group}
                </span>
                <span className='datasetsCardGroupCount'>{item.count}</span>
              </button>
            ) : (
              <DatasetCard
                key={`${item.group ?? ''}:${item.row.pk ?? item.row.dataset_id ?? item.row.title}`}
                row={item.row}
                isDownloadModal={isDownloadModal}
                downloadSizeEstimates={downloadSizeEstimates}
                inViewport={datasetsInViewPks.has(item.row.pk)}
                onSelect={handleSelectDataset}
                onInspect={isDownloadModal ? undefined : setInspectDataset}
                onHover={setHoveredDataset}
                onHoverEnd={() => setHoveredDataset()}
                t={t}
                i18n={i18n}
              />
            )
          )
        )}
      </div>
    </div>
  )
}
