import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CaretDownFill,
  CaretRightFill,
  CaretUpFill,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeSlash,
  Search
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import {
  GROUP_NONE,
  HIDEABLE_DIMENSIONS,
  groupKeysFor,
  groupLabel,
  groupOptions,
  isGroupDimension,
  sortGroupKeys
} from '../../../state/datasetGroups.js'
import DatasetCard from './DatasetCard.jsx'
import './styles.css'

// The list is paged rather than grown on scroll: a page is a place the user
// can leave and come back to, and the scroll bar means the same thing on every
// result set. These are the sizes the pager offers, the first being the default.
const PAGE_SIZES = [25, 50, 100]
// How many numbered buttons the pager shows around the current page before it
// falls back to ellipses (kept small — this column is ~420px wide).
const PAGE_WINDOW = 1
// Stable default so an absent datasetsInViewPks prop (e.g. the download modal)
// doesn't create a new Set every render and thrash memo deps.
const EMPTY_SET = new Set()

// The page numbers to offer: always the first and last, the current page and
// its neighbours, with '…' standing in for the runs left out. Returns e.g.
// [1, '…', 7, 8, 9, '…', 24].
function pageButtons (current, pageCount) {
  const wanted = new Set([1, pageCount])
  for (let page = current - PAGE_WINDOW; page <= current + PAGE_WINDOW; page++) {
    if (page >= 1 && page <= pageCount) wanted.add(page)
  }
  const pages = [...wanted].sort((a, b) => a - b)
  const out = []
  let previous = 0
  for (const page of pages) {
    // A single skipped page is worth showing outright — an ellipsis standing in
    // for one number is both wider and less useful than the number.
    if (page - previous === 2) out.push(previous + 1)
    else if (page - previous > 2) out.push(`gap-${page}`)
    out.push(page)
    previous = page
  }
  return out
}

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
  estimatesLoading,
  datasetsInViewPks = EMPTY_SET
}) {
  const { t, i18n } = useTranslation()
  // Lifted to SelectionProvider so it can surface as a removable chip
  // (ActiveFilterChips) alongside the rest of the active filters. The grouping
  // lives there too: the hidden groups decide what the map draws, and both are
  // carried in the URL.
  const {
    datasetTitleSearchText: searchText,
    setDatasetTitleSearchText: setSearchText,
    groupBy: selectedGroupBy,
    setGroupBy,
    hiddenGroups,
    toggleGroupHidden,
    showAllGroups
  } = useSelection()
  // The datasets the open "what's here" card is about. They sort to the top of
  // the list, which is what ties the card to this list at all — without it the
  // card named datasets that could be on page 6 of 8, and there was no way to
  // tell which rows it meant. The download modal is reviewing an order, not
  // exploring the map, so it ignores this.
  const { featureQuery } = useMapState()
  const pinnedPks = useMemo(() => {
    if (isDownloadModal || !featureQuery?.datasetPks?.length) return EMPTY_SET
    return new Set(featureQuery.datasetPks.map(Number))
  }, [featureQuery, isDownloadModal])

  // The download modal is a flat review list — it never groups, whatever the
  // sidebar is grouped by.
  const groupBy = isDownloadModal ? GROUP_NONE : selectedGroupBy
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [page, setPage] = useState(1)
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
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())

  const groupByOptions = useMemo(() => groupOptions(t), [i18n.language])
  // Hiding a group takes its datasets off the map. Not offered for the
  // viewport-based dimension ('inView'), whose membership changes on every pan.
  const canHideGroups = HIDEABLE_DIMENSIONS.has(groupBy)

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
      // Datasets under the last map click come first, in the chosen sort order
      // among themselves. This rides on top of the sort rather than replacing
      // it, so the sort chips still do what they say — they just order the two
      // blocks separately.
      const pa = pinnedPks.has(Number(a.pk)) ? 0 : 1
      const pb = pinnedPks.has(Number(b.pk)) ? 0 : 1
      if (pa !== pb) return pa - pb
      const va = sortValue(a, sort.field)
      const vb = sortValue(b, sort.field)
      if (field?.type === 'number') return (va - vb) * factor
      return String(va).localeCompare(String(vb), i18n.language) * factor
    })
    return sorted
  }, [datasets, sort, downloadSizeEstimates, i18n.language, pinnedPks])

  // Flat render list: without grouping it's just the sorted rows; with grouping
  // it's the rows bucketed under headers. Each entry is either
  // { header, group, count } or { row, group }, where group is the stable group
  // key (see state/datasetGroups.js — labels are derived at render time). Rows
  // stay in their sorted order within a group; groups are alphabetical by label
  // with Other/Uncategorized last. Array-valued dims place a dataset under each
  // of its values, so the total row entries can exceed the unique dataset count
  // (the toolbar count stays unique — see below).
  const renderItems = useMemo(() => {
    if (!isGroupDimension(groupBy)) return visibleRows.map((row) => ({ row }))
    const byGroup = new Map()
    for (const row of visibleRows) {
      for (const key of groupKeysFor(row, groupBy, datasetsInViewPks)) {
        if (!byGroup.has(key)) byGroup.set(key, [])
        byGroup.get(key).push(row)
      }
    }
    const items = []
    for (const key of sortGroupKeys(
      byGroup.keys(),
      groupBy,
      t,
      i18n.language
    )) {
      const rows = byGroup.get(key)
      items.push({ header: true, group: key, count: rows.length })
      if (!collapsedGroups.has(key)) {
        for (const row of rows) items.push({ row, group: key })
      }
    }
    return items
  }, [visibleRows, groupBy, collapsedGroups, datasetsInViewPks, i18n.language])

  // Total data rows currently expanded (excludes headers and collapsed groups).
  // This — not the dataset count — is what the pages divide up, because an
  // array-valued grouping dimension lists a dataset under each of its values.
  const totalRowCount = useMemo(
    () => renderItems.reduce((n, item) => (item.header ? n : n + 1), 0),
    [renderItems]
  )

  const pageCount = Math.max(1, Math.ceil(totalRowCount / pageSize))
  // Clamped rather than stored: a page can vanish under the list (the filters
  // narrowed the results, a group was collapsed) between renders.
  const currentPage = Math.min(page, pageCount)
  const firstRow = (currentPage - 1) * pageSize

  // This page's slice of the render list. Headers don't consume the page's
  // budget: a group header is re-shown at the top of every page its rows run
  // onto, so a page opened mid-group still says which group it is in. A
  // collapsed group has no rows of its own, so its header shows on the page
  // its position falls into — once, never twice.
  const pageItems = useMemo(() => {
    // The last page runs to the end so that collapsed groups trailing the final
    // row still land somewhere — with an exact multiple of pageSize there is no
    // further page for them to fall onto.
    const lastRow =
      currentPage === pageCount ? Number.POSITIVE_INFINITY : firstRow + pageSize
    const out = []
    let rowIndex = 0
    let pendingHeader = null
    for (const item of renderItems) {
      if (item.header) {
        if (collapsedGroups.has(item.group)) {
          pendingHeader = null
          if (rowIndex >= firstRow && rowIndex < lastRow) out.push(item)
        } else {
          pendingHeader = item
        }
        continue
      }
      if (rowIndex >= lastRow) break
      if (rowIndex >= firstRow) {
        if (pendingHeader) {
          out.push(pendingHeader)
          pendingHeader = null
        }
        out.push(item)
      }
      rowIndex++
    }
    return out
  }, [renderItems, firstRow, pageSize, currentPage, pageCount, collapsedGroups])

  const toggleGroupCollapsed = (group) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  // Which datasets are in the results, as a value rather than an array
  // identity. Adding one to the selection rewrites every row object (the
  // provider maps over pointsData), so keying the reset below on `datasets`
  // itself sent the reader back to page 1 on every "+" — which is exactly the
  // action they are most likely to repeat.
  const datasetsKey = useMemo(
    () => (datasets || []).map((row) => row.pk).join(','),
    [datasets]
  )

  // Back to page one whenever the result set or its ordering changes: page 7 of
  // the previous results is not page 7 of these.
  useEffect(() => {
    setPage(1)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [datasetsKey, sort, isDownloadModal, groupBy, pageSize, pinnedPks])

  // Every page starts at its top — the reader is at a new place in the list,
  // not where they left the scroll bar on the page before.
  const goToPage = (next) => {
    setPage(Math.min(Math.max(next, 1), pageCount))
    if (listRef.current) listRef.current.scrollTop = 0
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
            {groupByOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          {hiddenGroups.size > 0 && (
            <button
              type='button'
              className='datasetsCardShowAllGroups'
              onClick={showAllGroups}
            >
              <Eye size={12} aria-hidden='true' />
              {t('datasetsCardGroupShowAllText', { count: hiddenGroups.size })}
            </button>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className={classNames('datasetsTable', { downloadModal: isDownloadModal })}>
      {controls}
      {/* Explains the accent DatasetCard puts on rows the last map click found
          (see .datasetCard.fromMapClick in styles.css) — otherwise the only
          place that colour is named is a hover tooltip on the row itself,
          which a touch user never sees and a mouse user has no reason to go
          looking for. Only worth saying while there is a click to explain. */}
      {!isDownloadModal && pinnedPks.size > 0 && (
        <div className='datasetsCardMapClickHint'>
          <span className='datasetsCardMapClickSwatch' aria-hidden='true' />
          {t('datasetsCardMapClickHint')}
        </div>
      )}
      <div className='datasetsCardList' ref={listRef}>
        {visibleRows.length === 0 ? (
          <div className='datasetsCardEmpty'>{t('datasetsCardNoResultsText')}</div>
        ) : (
          pageItems.map((item) => {
            if (!item.header) {
              return (
                <DatasetCard
                  key={`${item.group ?? ''}:${item.row.pk ?? item.row.dataset_id ?? item.row.title}`}
                  row={item.row}
                  isDownloadModal={isDownloadModal}
                  downloadSizeEstimates={downloadSizeEstimates}
                  estimatesLoading={estimatesLoading}
                  onSelect={handleSelectDataset}
                  onInspect={isDownloadModal ? undefined : setInspectDataset}
                  onHover={setHoveredDataset}
                  onHoverEnd={() => setHoveredDataset()}
                  hiddenFromMap={
                    item.group !== undefined && hiddenGroups.has(item.group)
                  }
                  fromMapClick={pinnedPks.has(Number(item.row.pk))}
                  t={t}
                  i18n={i18n}
                />
              )
            }
            const collapsed = collapsedGroups.has(item.group)
            const hidden = hiddenGroups.has(item.group)
            const label = groupLabel(item.group, groupBy, t)
            return (
              <div
                key={`group:${item.group}`}
                className={classNames('datasetsCardGroupHeader', { hidden })}
              >
                <button
                  type='button'
                  className='datasetsCardGroupToggle'
                  onClick={() => toggleGroupCollapsed(item.group)}
                  aria-expanded={!collapsed}
                >
                  {collapsed ? (
                    <CaretRightFill size={10} aria-hidden='true' />
                  ) : (
                    <CaretDownFill size={10} aria-hidden='true' />
                  )}
                  <span className='datasetsCardGroupTitle' title={label}>
                    {label}
                  </span>
                  <span className='datasetsCardGroupCount'>{item.count}</span>
                </button>
                {canHideGroups && (
                  <button
                    type='button'
                    className='datasetsCardGroupHide'
                    onClick={() => toggleGroupHidden(item.group)}
                    aria-pressed={hidden}
                    title={
                      hidden
                        ? t('datasetsCardGroupShowOnMapTitle')
                        : t('datasetsCardGroupHideFromMapTitle')
                    }
                  >
                    {hidden ? (
                      <EyeSlash size={13} aria-hidden='true' />
                    ) : (
                      <Eye size={13} aria-hidden='true' />
                    )}
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
      {totalRowCount > 0 && (
        <nav className='datasetsPager' aria-label={t('datasetsPagerLabel')}>
          <span className='datasetsPagerRange'>
            {t('datasetsPagerRangeText', {
              first: firstRow + 1,
              last: Math.min(firstRow + pageSize, totalRowCount),
              total: totalRowCount
            })}
          </span>
          {pageCount > 1 && (
            <div className='datasetsPagerControls'>
              <button
                type='button'
                className='datasetsPagerStep'
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                title={t('datasetsPagerPreviousTitle')}
                aria-label={t('datasetsPagerPreviousTitle')}
              >
                <ChevronLeft size={12} aria-hidden='true' />
              </button>
              {pageButtons(currentPage, pageCount).map((entry) =>
                typeof entry === 'number' ? (
                  <button
                    key={entry}
                    type='button'
                    className={classNames('datasetsPagerPage', {
                      active: entry === currentPage
                    })}
                    onClick={() => goToPage(entry)}
                    aria-current={entry === currentPage ? 'page' : undefined}
                    title={t('datasetsPagerPageTitle', { page: entry })}
                  >
                    {entry}
                  </button>
                ) : (
                  <span key={entry} className='datasetsPagerGap' aria-hidden='true'>
                    …
                  </span>
                )
              )}
              <button
                type='button'
                className='datasetsPagerStep'
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === pageCount}
                title={t('datasetsPagerNextTitle')}
                aria-label={t('datasetsPagerNextTitle')}
              >
                <ChevronRight size={12} aria-hidden='true' />
              </button>
            </div>
          )}
          <label className='datasetsPagerSize'>
            <span className='sr-only'>{t('datasetsPagerPerPageLabel')}</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              title={t('datasetsPagerPerPageLabel')}
            >
              {/* The number is put in place here rather than interpolated: a
                  numeric `count` option is i18next's pluralization trigger (see
                  the note in Map.jsx), and the unit is the only translated
                  part of "25 per page" anyway. */}
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {`${size} ${t('datasetsPagerPerPageUnitText')}`}
                </option>
              ))}
            </select>
          </label>
        </nav>
      )}
    </div>
  )
}
