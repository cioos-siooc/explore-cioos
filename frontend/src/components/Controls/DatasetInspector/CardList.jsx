import React, { useEffect, useMemo, useRef, useState } from "react";

import { useChanged } from "../../../utilities.jsx";
import TableFilter, { filterRows } from "../../ui/TableFilter.jsx";
import SortSelect from "../../ui/SortSelect.jsx";
import Pager, { PAGE_SIZES } from "../../ui/Pager.jsx";

// Cards rather than a table: in a ~420px column a six-column table could only
// be read by scrolling sideways.
//
// `sortFields` is [{ id, label, type: 'string' | 'number', value(item) }].
// `pinnedKeys` hold the top of the first page whatever the sort; `focusKey`
// is paged to wherever it falls.
export default function CardList({
  items,
  keyOf,
  sortFields,
  defaultSort,
  renderItem,
  filterPlaceholder,
  emptyText,
  pinnedKeys,
  focusKey,
  pagerLabel,
  perPageLabel,
}) {
  const [filterText, setFilterText] = useState("");
  const [sort, setSort] = useState(defaultSort);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const field = sortFields.find((f) => f.id === sort.field);
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...(filterRows(items, filterText) || [])].sort((a, b) => {
      const pa = pinnedKeys?.has(keyOf(a)) ? 0 : 1;
      const pb = pinnedKeys?.has(keyOf(b)) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const va = field?.value(a);
      const vb = field?.value(b);
      if (field?.type === "number") return ((va ?? 0) - (vb ?? 0)) * factor;
      return String(va ?? "").localeCompare(String(vb ?? "")) * factor;
    });
  }, [items, filterText, sort, pinnedKeys, keyOf, sortFields]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // Clamped rather than stored: the search can narrow the results between
  // renders.
  const currentPage = Math.min(page, pageCount);
  const firstRow = (currentPage - 1) * pageSize;

  if (useChanged(items, filterText, sort, pageSize)) setPage(1);

  // Runs on `items` too: the pick usually precedes the list's arrival, which
  // the reset above sends back to page one.
  if (useChanged(focusKey, items, pageSize) && focusKey !== undefined) {
    const index = rows.findIndex((row) => keyOf(row) === focusKey);
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1);
  }

  // Whether the toolbar is pinned against the top of the scrolling body: the
  // sentinel above it is what scrolls out of view first.
  const sentinelRef = useRef(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = sentinel?.closest(".datasetInspectorBody");
    if (!root) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setStuck(
          !entry.isIntersecting &&
            entry.boundingClientRect.top < entry.rootBounds.top,
        ),
      { root },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="cardListSentinel" ref={sentinelRef} aria-hidden="true" />
      <div className="cardListToolbar" data-stuck={stuck || undefined}>
        <TableFilter
          value={filterText}
          onChange={setFilterText}
          placeholder={filterPlaceholder}
        />
        <SortSelect fields={sortFields} sort={sort} onChange={setSort} />
      </div>
      {rows.length === 0 ? (
        <div className="cardListEmpty">{emptyText}</div>
      ) : (
        <div className="cardList">
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
  );
}
