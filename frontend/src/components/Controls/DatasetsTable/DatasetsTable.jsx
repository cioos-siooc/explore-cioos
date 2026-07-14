import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CaretDownFill,
  CaretRightFill,
  CaretUpFill,
  Eye,
  EyeSlash,
  Search
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

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

// How many cards to render before the incremental "grow on scroll" kicks in.
// Keeps large result sets cheap to paint on mobile without a pager.
const PAGE_SIZE = 60
// Distance (px) from the bottom of the scroll area at which we reveal more.
const SCROLL_THRESHOLD = 400
// Stable default so an absent datasetsInViewPks prop (e.g. the download modal)
// doesn't create a new Set every render and thrash memo deps.
const EMPTY_SET = new Set()

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
  // The download modal is a flat review list — it never groups, whatever the
  // sidebar is grouped by.
  const groupBy = isDownloadModal ? GROUP_NONE : selectedGroupBy
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
      const va = sortValue(a, sort.field)
      const vb = sortValue(b, sort.field)
      if (field?.type === 'number') return (va - vb) * factor
      return String(va).localeCompare(String(vb), i18n.language) * factor
    })
    return sorted
  }, [datasets, sort, downloadSizeEstimates, i18n.language])

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
      <div className='datasetsCardList' ref={listRef} onScroll={handleScroll}>
        {visibleRows.length === 0 ? (
          <div className='datasetsCardEmpty'>{t('datasetsCardNoResultsText')}</div>
        ) : (
          shownItems.map((item) => {
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
    </div>
  )
}
