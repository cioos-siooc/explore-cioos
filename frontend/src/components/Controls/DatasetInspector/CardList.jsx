import React, { useEffect, useMemo, useState } from 'react'

import TableFilter, { filterRows } from '../../ui/TableFilter.jsx'
import SortChips from '../../ui/SortChips.jsx'
import Pager, { PAGE_SIZES } from '../../ui/Pager.jsx'

// A searchable, sortable, paged list of cards — the dataset page's records and
// its trajectory platforms are both one of these. Cards rather than a data
// table because this page lives in a ~420px column (a phone gives it the whole
// viewport): a table of six columns could only be read by scrolling it
// sideways, while a card lays the same fields out down the page and is legible
// whole at any width. Same reason the datasets list and the griddap dimensions
// are cards.
//
// The list owns searching, sorting and paging; the caller owns what one item
// looks like (`renderItem`) and what clicking it does.
//
// `sortFields` is [{ id, label, type, value }] — `value(item)` reads the field
// off an item and `type` ('string' | 'number') says how to compare it.
// `pinnedKey` names one item to hold at the top of the first page whatever the
// sort (the record a map click resolved to), and `focusKey` one to page to
// wherever it falls (the platform whose track is drawn).
export default function CardList ({
  items,
  keyOf,
  sortFields,
  defaultSort,
  renderItem,
  filterPlaceholder,
  emptyText,
  pinnedKey,
  focusKey,
  pagerLabel,
  perPageLabel
}) {
  const [filterText, setFilterText] = useState('')
  const [sort, setSort] = useState(defaultSort)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [page, setPage] = useState(1)

  const rows = useMemo(() => {
    const field = sortFields.find((f) => f.id === sort.field)
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...(filterRows(items, filterText) || [])].sort((a, b) => {
      // The pinned item rides on top of the sort rather than replacing it, so
      // the sort chips still do what they say — the pin just puts one item in
      // front of the order they produce.
      const pa = pinnedKey !== undefined && keyOf(a) === pinnedKey ? 0 : 1
      const pb = pinnedKey !== undefined && keyOf(b) === pinnedKey ? 0 : 1
      if (pa !== pb) return pa - pb
      const va = field?.value(a)
      const vb = field?.value(b)
      if (field?.type === 'number') return ((va ?? 0) - (vb ?? 0)) * factor
      return String(va ?? '').localeCompare(String(vb ?? '')) * factor
    })
  }, [items, filterText, sort, pinnedKey])

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  // Clamped rather than stored: a page can vanish under the list when the
  // search narrows the results between renders.
  const currentPage = Math.min(page, pageCount)
  const firstRow = (currentPage - 1) * pageSize

  // Back to page one whenever the list or its ordering changes: page 7 of the
  // previous results is not page 7 of these.
  useEffect(() => setPage(1), [items, filterText, sort, pageSize])

  // An item picked on the map can sit on any page of the list — turn to the
  // page holding it, so the highlighted card is one the user can actually see.
  // Runs on `items` too: the pick is usually already made when the list is
  // still loading, and the effect above sends that arrival back to page one.
  useEffect(() => {
    if (focusKey === undefined) return
    const index = rows.findIndex((row) => keyOf(row) === focusKey)
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1)
  }, [focusKey, items, pageSize])

  return (
    <>
      <TableFilter
        value={filterText}
        onChange={setFilterText}
        placeholder={filterPlaceholder}
      />
      <SortChips fields={sortFields} sort={sort} onChange={setSort} />
      {rows.length === 0 ? (
        <div className='cardListEmpty'>{emptyText}</div>
      ) : (
        <div className='cardList'>
          {rows.slice(firstRow, firstRow + pageSize).map((row) => (
            <React.Fragment key={keyOf(row)}>{renderItem(row)}</React.Fragment>
          ))}
        </div>
      )}
      <Pager
        page={currentPage}
        pageCount={pageCount}
        pageSize={pageSize}
        total={rows.length}
        onPageChange={(next) => setPage(Math.min(Math.max(next, 1), pageCount))}
        onPageSizeChange={setPageSize}
        label={pagerLabel}
        perPageLabel={perPageLabel}
      />
    </>
  )
}
