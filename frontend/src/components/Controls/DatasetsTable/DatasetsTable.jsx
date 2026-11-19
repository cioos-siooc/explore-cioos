import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check2Circle,
  CheckSquare,
  ChevronRight,
  Filter,
  Grid3x3Gap,
  SlashCircle,
  Square,
  ViewList,
  ViewStacked,
  X,
  XCircle,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import useActiveFilters from "../../../state/useActiveFilters.js";
import useGroupFilter from "../../../state/useGroupFilter.js";
import useListSort from "../../../state/useListSort.js";
import {
  GRID_KEY,
  GROUP_NONE,
  groupKeysFor,
  groupLabel,
  groupOptions,
  groupParent,
  isGroupDimension,
  parentGroupKeys,
  sortGroupKeys,
} from "../../../state/datasetGroups.js";
import {
  DEFAULT_SORT,
  GROUP_SIZE,
  pinnedPksOf,
  sortDatasets,
} from "../../../state/datasetSort.js";
import { useChanged } from "../../../utilities.jsx";
import DatasetCard from "./DatasetCard.jsx";
import GridGroupHeader from "./GridGroupHeader.jsx";
import Pager, { PAGE_SIZES } from "../../ui/Pager.jsx";
import SelectPill from "../../ui/SelectPill.jsx";
import SortSelect from "../../ui/SortSelect.jsx";
import "./styles.css";
import "../../Map/ClearMapSelection/styles.css";
import { ToggleButton } from "../../ui/Button.jsx";

// The list is one Tab stop (roving tabindex): ↑/↓ move between its entries,
// Tab walks the current entry's own controls, then leaves the list.
const ENTRY = ".datasetCard, .datasetsCardGroupHeader";
const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";

// Where ↑/↓ land: the title opens the dataset, so it wins over the checkbox.
const entryStop = (entry) =>
  entry.querySelector("button.datasetCardTitle") ??
  [...entry.querySelectorAll(FOCUSABLE)].find((el) => !el.disabled);

const listEntries = (list) =>
  [...list.querySelectorAll(ENTRY)].filter((entry) => entryStop(entry));

// A list starts on its first dataset, past any group headers above it.
const firstEntry = (entries) =>
  entries.find((entry) => entry.matches(".datasetCard")) ?? entries[0] ?? null;

// Focus moved here for the reader shows its ring even after a mouse click.
const focusEntry = (entry) =>
  entryStop(entry).focus({ preventScroll: true, focusVisible: true });

export default function DatasetsTable({
  handleSelectAllDatasets,
  handleSelectDataset,
  datasets,
  selectAll,
  selectAllMixed,
  selectAllDisabled,
  setInspectDataset,
  setHoveredDataset = () => {},
  isDownloadModal,
  downloadSizeEstimates,
  estimatesLoading,
  downloadLinkByPk,
  // The format OBIS rows fall back to when the chosen one has no OBIS version.
  // Kept mounted under an open dataset page, so coming back finds the same
  // page and scroll position (see DatasetsPanel).
  hidden = false,
}) {
  const { t, i18n } = useTranslation();
  // The grouping lives in SelectionProvider: it outlives this list while a
  // dataset page replaces it, and is carried in the URL.
  const {
    groupBy: selectedGroupBy,
    setGroupBy,
    selectedPks,
    // Aliased: the modal's own `handleSelectDataset` prop only toggles a
    // dataset within this batch.
    handleSelectDataset: removeFromSelection,
    pointsError,
  } = useSelection();
  const [listSort, setListSort] = useListSort();
  const {
    openFilters,
    showFiltersModal,
    compactList,
    setListDensity,
    listFocusPending,
    setListFocusPending,
  } = useUI();
  const activeFilterCount = useActiveFilters().length;
  // The "what's here" card's datasets sort to the top, tying the card to the
  // list; the download modal ignores them.
  const { featureQuery, setFeatureQuery, griddapCoverageVisible } =
    useMapState();
  const pinnedPks = useMemo(
    () => pinnedPksOf(isDownloadModal ? null : featureQuery),
    [featureQuery, isDownloadModal],
  );
  const { tipHighlight } = useTips();

  const groupBy = isDownloadModal ? GROUP_NONE : selectedGroupBy;
  const compact = !isDownloadModal && compactList;
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const listRef = useRef(null);
  // A display:none list loses its scroll offset, so it is remembered here and
  // put back when the list shows again.
  const scrollTopRef = useRef(0);
  // The entry whose controls are in the Tab order (see syncTabStops).
  const activeEntryRef = useRef(null);
  const scrollListToTop = () => {
    scrollTopRef.current = 0;
    if (listRef.current) listRef.current.scrollTop = 0;
    activeEntryRef.current = null;
  };
  const wasHiddenRef = useRef(hidden);
  useLayoutEffect(() => {
    if (!hidden && listRef.current) {
      listRef.current.scrollTop = scrollTopRef.current;
    }
  }, [hidden]);

  // Tab stops are set on the DOM: the entries' controls come from several
  // components, and an entry that unmounts hands the stop to the first card.
  const syncTabStops = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const entries = listEntries(list);
    if (!entries.includes(activeEntryRef.current)) {
      activeEntryRef.current = firstEntry(entries);
    }
    for (const entry of entries) {
      const active = entry === activeEntryRef.current;
      for (const el of entry.querySelectorAll(FOCUSABLE)) {
        const parked = "rovingTabindex" in el.dataset;
        if (active && parked) {
          const own = el.dataset.rovingTabindex;
          if (own) el.setAttribute("tabindex", own);
          else el.removeAttribute("tabindex");
          delete el.dataset.rovingTabindex;
        } else if (!active && !parked) {
          el.dataset.rovingTabindex = el.getAttribute("tabindex") ?? "";
          el.setAttribute("tabindex", "-1");
        }
      }
    }
  }, []);
  useLayoutEffect(syncTabStops);
  // Back from a dataset page, whose unmount dropped focus on the body, the
  // card it was opened from takes focus again.
  useEffect(() => {
    const shown = wasHiddenRef.current && !hidden;
    wasHiddenRef.current = hidden;
    if (!shown || document.activeElement !== document.body) return;
    const entries = listEntries(listRef.current);
    if (entries.includes(activeEntryRef.current)) {
      focusEntry(activeEntryRef.current);
    }
  }, [hidden]);
  const activateEntryOf = (target) => {
    const entry = target.closest(ENTRY);
    if (entry && entry !== activeEntryRef.current) {
      activeEntryRef.current = entry;
      syncTabStops();
    }
  };
  const handleListKeyDown = (event) => {
    if (
      !["ArrowDown", "ArrowUp"].includes(event.key) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    const entries = listEntries(listRef.current);
    if (entries.length === 0) return;
    const current = event.target.closest(ENTRY);
    const index = entries.indexOf(current);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next =
      index === -1
        ? entries.includes(activeEntryRef.current)
          ? activeEntryRef.current
          : firstEntry(entries)
        : entries[Math.min(Math.max(index + step, 0), entries.length - 1)];
    event.preventDefault();
    entryStop(next).focus();
  };

  const grouped = isGroupDimension(groupBy);
  const sortFields = useMemo(() => {
    const base = [
      ...(grouped
        ? [
            {
              id: GROUP_SIZE,
              label: t("datasetsCardSortGroupSizeText"),
              type: "number",
            },
          ]
        : []),
      { id: "title", label: t("datasetsTableHeaderTitleText"), type: "string" },
      { id: "type", label: t("datasetsTableHeaderTypeText"), type: "string" },
      {
        id: "platform",
        label: t("datasetsCardSortPlatformText"),
        type: "string",
      },
    ];
    if (isDownloadModal) {
      base.push({
        id: "size",
        label: t("datasetsTableHeaderSizeText"),
        type: "number",
      });
      base.push({
        id: "downloadable",
        label: t("datasetsCardSortDownloadableText"),
        type: "number",
      });
    } else {
      base.push({
        id: "locations",
        label: t("datasetsTableHeaderLocationsText"),
        type: "number",
      });
      base.push({
        id: "days",
        label: t("datasetsCardSortDaysText"),
        type: "number",
      });
    }
    return base;
  }, [isDownloadModal, grouped, t]);

  // The sidebar's sort is shared with the "what's here" card; the download
  // modal's batch and fields are its own.
  const [modalSort, setModalSort] = useState(DEFAULT_SORT);
  const sort = isDownloadModal ? modalSort : listSort;
  const setSort = isDownloadModal ? setModalSort : setListSort;
  const [toggledGroups, setToggledGroups] = useState(() => new Set());

  const groupByOptions = useMemo(() => groupOptions(t), [t]);
  const {
    filterFor,
    filteredKeys: ownFilterKeys,
    narrowed: ownFilterSet,
  } = useGroupFilter(groupBy);
  const ownFilterId = ownFilterKeys.join("\n");

  // Filtering happens upstream (SelectionProvider's filteredDatasets).
  const visibleRows = useMemo(
    () =>
      sortDatasets(datasets, sort, {
        pinnedPks,
        t,
        language: i18n.language,
      }),
    [datasets, sort, pinnedPks, t, i18n.language],
  );

  const byGroup = useMemo(() => {
    const groups = new Map();
    if (!isGroupDimension(groupBy)) return groups;
    for (const row of visibleRows) {
      for (const key of groupKeysFor(row, groupBy)) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
    }
    return groups;
  }, [visibleRows, groupBy]);

  // Groups start closed unless every row fits on one page; a nested dimension
  // opens its parents. A new grouping, or results that cross the one-page
  // line, drop the reader's own toggles.
  const fitsOnePage =
    [...byGroup.values()].reduce((n, rows) => n + rows.length, 0) <= pageSize;
  if (useChanged(groupBy, fitsOnePage)) setToggledGroups(new Set());
  // Ungrouped, the grids lead the in-situ rows as one group of their own,
  // closed unless they are all there is or their coverage layer is on.
  const gridGroupOpen =
    griddapCoverageVisible ||
    visibleRows.every((row) => row.cdm_data_type === "Grid");
  const isExpanded = useCallback(
    (key) =>
      (grouped
        ? fitsOnePage || parentGroupKeys(groupBy).includes(key)
        : gridGroupOpen) !== toggledGroups.has(key),
    [grouped, fitsOnePage, gridGroupOpen, groupBy, toggledGroups],
  );

  // Groups seen while the dimension's own filter was not narrowing it, so the
  // groups that filter removed stay listed (empty) and can be added or undone.
  // Refreshed only when new results land: until the refetch, the results still
  // lack the group being brought back.
  const [knownGroups, setKnownGroups] = useState({ groupBy, keys: [] });
  if (knownGroups.groupBy !== groupBy || knownGroups.datasets !== datasets) {
    setKnownGroups({
      groupBy,
      datasets,
      keys:
        ownFilterSet && knownGroups.groupBy === groupBy
          ? knownGroups.keys
          : [...byGroup.keys()],
    });
  }
  const emptyKeys = useMemo(
    () =>
      [
        ...new Set([
          ...knownGroups.keys,
          ...ownFilterId.split("\n").filter(Boolean),
        ]),
      ].filter((key) => !byGroup.has(key)),
    [knownGroups, ownFilterId, byGroup],
  );

  // Entries are { header, group, count, depth, expandable } or { row, group }
  // (group = stable key, see state/datasetGroups.js). Array-valued dims list a
  // dataset under each of its values, so row entries can exceed the unique
  // dataset count; a parent header's count is its unique datasets.
  const renderItems = useMemo(() => {
    if (!isGroupDimension(groupBy)) {
      // Grids sort first (see sortDatasets), folded into a single row.
      const gridCount = visibleRows.filter(
        (row) => row.cdm_data_type === "Grid",
      ).length;
      if (isDownloadModal || gridCount === 0) {
        return visibleRows.map((row) => ({ row }));
      }
      const grids = visibleRows.slice(0, gridCount);
      return [
        {
          header: true,
          group: GRID_KEY,
          count: gridCount,
          here: grids.filter((row) => pinnedPks.has(Number(row.pk))).length,
          depth: 0,
          expandable: true,
        },
        ...(isExpanded(GRID_KEY)
          ? grids.map((row) => ({ row, group: GRID_KEY }))
          : []),
        ...visibleRows.slice(gridCount).map((row) => ({ row })),
      ];
    }
    const rowsOf = (key) => byGroup.get(key) ?? [];
    const sortKeys = (keys, sizeOf) => {
      const sorted = sortGroupKeys(keys, groupBy, t, i18n.language);
      if (sort.field === GROUP_SIZE) {
        const factor = sort.dir === "asc" ? 1 : -1;
        sorted.sort((a, b) => (sizeOf(a) - sizeOf(b)) * factor);
      }
      if (sorted.includes(GRID_KEY)) {
        sorted.splice(sorted.indexOf(GRID_KEY), 1);
        sorted.unshift(GRID_KEY);
      }
      // The groups the results no longer hold go under the ones they do.
      return [
        ...sorted.filter((key) => sizeOf(key) > 0),
        ...sorted.filter((key) => sizeOf(key) === 0),
      ];
    };
    const items = [];
    const pushGroups = (keys, depth) => {
      for (const key of sortKeys(keys, (k) => rowsOf(k).length)) {
        const rows = rowsOf(key);
        items.push({
          header: true,
          group: key,
          count: rows.length,
          depth,
          expandable: rows.length > 0,
        });
        if (rows.length > 0 && isExpanded(key)) {
          for (const row of rows) items.push({ row, group: key });
        }
      }
    };
    const keys = [...byGroup.keys(), ...emptyKeys];
    if (parentGroupKeys(groupBy).length === 0) {
      pushGroups(keys, 0);
    } else {
      const childrenByParent = new Map();
      for (const key of keys) {
        const parent = groupParent(key, groupBy);
        if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
        childrenByParent.get(parent).push(key);
      }
      // A group with no parent (datasets without an EOV) is a plain group
      // among the parents.
      const topLevel = childrenByParent.get(null) ?? [];
      childrenByParent.delete(null);
      const parentSize = (parent) =>
        childrenByParent.has(parent)
          ? new Set(childrenByParent.get(parent).flatMap(rowsOf)).size
          : rowsOf(parent).length;
      for (const parent of sortKeys(
        [...childrenByParent.keys(), ...topLevel],
        parentSize,
      )) {
        if (!childrenByParent.has(parent)) {
          pushGroups([parent], 0);
          continue;
        }
        items.push({
          header: true,
          group: parent,
          count: parentSize(parent),
          depth: 0,
          expandable: true,
        });
        if (isExpanded(parent)) {
          pushGroups(childrenByParent.get(parent), 1);
        }
      }
    }
    // Each header's share of the largest group at its depth sizes its data bar.
    const maxByDepth = [];
    for (const item of items) {
      if (item.header) {
        maxByDepth[item.depth] = Math.max(
          maxByDepth[item.depth] ?? 0,
          item.count,
        );
      }
    }
    for (const item of items) {
      if (item.header) item.share = item.count / (maxByDepth[item.depth] || 1);
    }
    return items;
  }, [
    visibleRows,
    groupBy,
    byGroup,
    emptyKeys,
    isExpanded,
    sort,
    pinnedPks,
    isDownloadModal,
    i18n.language,
    t,
  ]);

  // Total data rows currently expanded (excludes headers and collapsed groups).
  // This — not the dataset count — is what the pages divide up, because an
  // array-valued grouping dimension lists a dataset under each of its values.
  const totalRowCount = useMemo(
    () => renderItems.reduce((n, item) => (item.header ? n : n + 1), 0),
    [renderItems],
  );

  const foldedGridCount = renderItems.find(
    (item) => item.header && item.group === GRID_KEY && !isExpanded(GRID_KEY),
  )?.count;

  const pageCount = Math.max(1, Math.ceil(totalRowCount / pageSize));
  // Clamped rather than stored: a page can vanish under the list (the filters
  // narrowed the results, a group was collapsed) between renders.
  const currentPage = Math.min(page, pageCount);
  const firstRow = (currentPage - 1) * pageSize;

  // This page's slice of the render list. Headers don't consume the page's
  // budget: an open group's header (and its parent's) is re-shown at the top
  // of every page its rows run onto, so a page opened mid-group still says
  // which group it is in. A collapsed group has no rows of its own, so its
  // header shows on the page its position falls into — once, never twice.
  const pageItems = useMemo(() => {
    // The last page runs to the end so that collapsed groups trailing the final
    // row still land somewhere — with an exact multiple of pageSize there is no
    // further page for them to fall onto.
    const lastRow =
      currentPage === pageCount
        ? Number.POSITIVE_INFINITY
        : firstRow + pageSize;
    const out = [];
    let rowIndex = 0;
    // The open headers enclosing the current position, one per depth, and
    // whether this page has shown each yet.
    let openHeaders = [];
    const emitted = new Set();
    const emit = (item) => {
      for (const header of openHeaders) {
        if (!emitted.has(header)) {
          out.push(header);
          emitted.add(header);
        }
      }
      out.push(item);
    };
    for (const item of renderItems) {
      if (item.header) {
        openHeaders = openHeaders.slice(0, item.depth);
        if (item.expandable && isExpanded(item.group)) {
          openHeaders.push(item);
        } else if (rowIndex >= firstRow && rowIndex < lastRow) {
          emit(item);
        }
        continue;
      }
      if (rowIndex >= lastRow) break;
      if (rowIndex >= firstRow) emit(item);
      rowIndex++;
    }
    return out;
  }, [renderItems, firstRow, pageSize, currentPage, pageCount, isExpanded]);

  // The what's here tip points at one of the click's datasets that can be
  // ticked in, while this list rather than the card holds them (see Sidebar).
  const whatsHereTarget = pageItems.find(
    (item) =>
      !item.header &&
      item.row.cdm_data_type !== "Grid" &&
      pinnedPks.has(Number(item.row.pk)),
  );

  const toggleGroupExpanded = (group) => {
    setToggledGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // Which datasets are in the results, as a value rather than an array
  // identity. Snapshot refreshes can replace every row object without changing
  // the result set, which should not send the reader back to page 1.
  const datasetsKey = useMemo(
    () => (datasets || []).map((row) => row.pk).join(","),
    [datasets],
  );

  useEffect(() => {
    // Paired with the scroll reset, a DOM write that needs an effect anyway.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
    scrollListToTop();
    // setPage(1) on page 1 doesn't re-render, which would leave the old stop.
    syncTabStops();
  }, [
    datasetsKey,
    sort,
    isDownloadModal,
    groupBy,
    pageSize,
    pinnedPks,
    syncTabStops,
  ]);

  // Set by the pager: the new page opens on its first card, not the button.
  const focusFirstRef = useRef(false);
  // From the Datasets button, the sidebar's list does the same once it shows.
  const openedFocus = !isDownloadModal && listFocusPending;
  useEffect(() => {
    if (hidden || !(openedFocus || focusFirstRef.current)) return;
    const done = () => {
      focusFirstRef.current = false;
      if (openedFocus) setListFocusPending(false);
    };
    // With no results there is nothing to land on; don't keep the request
    // for a later list the reader didn't just open.
    if (visibleRows.length === 0) {
      done();
      return;
    }
    const entries = listEntries(listRef.current);
    if (entries.length === 0) return;
    done();
    // The card may be sliding in: a scroll-into-view would shift its clipped
    // parents instead of the list.
    scrollListToTop();
    activeEntryRef.current = firstEntry(entries);
    syncTabStops();
    focusEntry(activeEntryRef.current);
  }, [
    hidden,
    openedFocus,
    setListFocusPending,
    visibleRows,
    pageItems,
    syncTabStops,
  ]);

  const goToPage = (next) => {
    const target = Math.min(Math.max(next, 1), pageCount);
    // On the same page nothing re-renders to consume the request.
    if (target !== currentPage) focusFirstRef.current = true;
    setPage(target);
    scrollListToTop();
  };

  const sortControl = (
    <SortSelect fields={sortFields} sort={sort} onChange={setSort} />
  );

  const controls = (
    <div className="datasetsCardControls" data-testid="datasets-controls">
      {isDownloadModal ? (
        <>
          <label
            className="selectAllToggle"
            title={t("datasetsTableHeaderSelectAllTitle")}
          >
            <input
              type="checkbox"
              checked={selectAll}
              disabled={selectAllDisabled}
              ref={(input) => {
                if (input) input.indeterminate = Boolean(selectAllMixed);
              }}
              onChange={handleSelectAllDatasets}
            />
            {t("datasetsTableHeaderSelectAllTitle")}
          </label>
          <div className="datasetsCardArrange">{sortControl}</div>
        </>
      ) : (
        <div className="datasetsCardToolbar">
          <ToggleButton
            className={classNames("datasetsCardFilters", {
              active: showFiltersModal,
              applied: !showFiltersModal && activeFilterCount > 0,
            })}
            data-testid="datasets-filters-button"
            onChange={() => openFilters()}
            isSelected={showFiltersModal}
            title={t("dockFiltersCountTitle", { count: activeFilterCount })}
          >
            <Filter size={13} aria-hidden="true" />
            {t("filtersMenuButton")}
            {activeFilterCount > 0 && (
              <span className="datasetsCardFiltersCount">
                {activeFilterCount}
              </span>
            )}
          </ToggleButton>
          {sortControl}
          <SelectPill
            label={t("datasetsCardGroupByLabel")}
            value={groupBy}
            options={groupByOptions}
            onChange={setGroupBy}
          />
          <ToggleButton
            className="datasetsCardDensity"
            data-testid="datasets-density-toggle"
            onChange={() => setListDensity(compact ? "full" : "compact")}
            isSelected={compact}
            aria-label={t("datasetsCardDensityCompactTitle")}
            title={t(
              compact
                ? "datasetsCardDensityComfortableTitle"
                : "datasetsCardDensityCompactTitle",
            )}
          >
            {compact ? (
              <ViewList size={14} aria-hidden="true" />
            ) : (
              <ViewStacked size={14} aria-hidden="true" />
            )}
          </ToggleButton>
        </div>
      )}

      {isDownloadModal && (
        <div className="downloadLegend">
          <span className="downloadLegendItem">
            <Check2Circle
              className="legendIcon success"
              size={16}
              aria-hidden="true"
            />
            <span className="legendBadge success">
              {t("downloadDetailsDownloadLimitsDownloadableMessagePart2")}
            </span>
            {t("downloadDetailsDownloadLimitsDownloadableMessagePart3")}
          </span>
          <span className="downloadLegendItem">
            <XCircle
              className="legendIcon error"
              size={16}
              aria-hidden="true"
            />
            <span className="legendBadge error">
              {t("downloadDetailsDownloadLimitsNotDownloadableMessagePart2")}
            </span>
            {t("downloadDetailsDownloadLimitsNotDownloadableMessagePart3")}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={classNames("datasetsTable", {
        downloadModal: isDownloadModal,
      })}
    >
      {controls}
      {/* Otherwise the map-click accent is named only in a hover tooltip,
          which a touch user never sees. */}
      {!isDownloadModal && pinnedPks.size > 0 && (
        <div className="datasetsCardMapClickHint">
          <span className="datasetsCardMapClickSwatch" aria-hidden="true" />
          {t("datasetsCardMapClickHint")}
          <button
            type="button"
            className="mapClickClear mapClickClearCompact"
            data-testid="datasets-map-click-clear"
            onClick={() => setFeatureQuery(null)}
            title={t("mapSelectionClearTitle")}
          >
            <span className="mapClickClearIcon" aria-hidden="true">
              <X size={18} />
            </span>
            {t("mapSelectionClearText")}
          </button>
        </div>
      )}
      {/* Focusable (-1) so a click on a card's blank space, or between cards,
          hands focus to a card instead of leaving ↑/↓ to scroll. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- keyboard handling for the entries inside, each a real control */}
      <div
        className={classNames("datasetsCardList", { compact })}
        ref={listRef}
        tabIndex={-1}
        onKeyDown={handleListKeyDown}
        onFocus={(event) => {
          if (event.target !== listRef.current) {
            activateEntryOf(event.target);
            return;
          }
          // The list itself is never the stop: focus goes on to the current
          // entry (the clicked card, else the first), without scrolling away.
          const entries = listEntries(listRef.current);
          const entry = entries.includes(activeEntryRef.current)
            ? activeEntryRef.current
            : firstEntry(entries);
          if (entry) entryStop(entry).focus({ preventScroll: true });
        }}
        onMouseDown={(event) => activateEntryOf(event.target)}
        onScroll={(event) => {
          if (!hidden) scrollTopRef.current = event.currentTarget.scrollTop;
        }}
      >
        {visibleRows.length === 0 ? (
          <div className="datasetsCardEmpty">
            {t(
              pointsError && !isDownloadModal
                ? "datasetsCardLoadFailedText"
                : "datasetsCardNoResultsText",
            )}
          </div>
        ) : (
          pageItems.map((item) => {
            if (!item.header) {
              return (
                <DatasetCard
                  key={`${item.group ?? ""}:${item.row.pk ?? item.row.dataset_id ?? item.row.title}`}
                  row={item.row}
                  selected={
                    isDownloadModal
                      ? item.row.selected
                      : selectedPks.has(item.row.pk)
                  }
                  isDownloadModal={isDownloadModal}
                  downloadSizeEstimates={downloadSizeEstimates}
                  estimatesLoading={estimatesLoading}
                  downloadLink={downloadLinkByPk?.get(item.row.pk)}
                  onSelect={handleSelectDataset}
                  onRemove={isDownloadModal ? removeFromSelection : undefined}
                  onInspect={isDownloadModal ? undefined : setInspectDataset}
                  onHover={setHoveredDataset}
                  onHoverEnd={() => setHoveredDataset()}
                  fromMapClick={pinnedPks.has(Number(item.row.pk))}
                  tipHighlight={tipHighlight(
                    item === whatsHereTarget && "whatsHere",
                  )}
                  t={t}
                  i18n={i18n}
                />
              );
            }
            if (!grouped) {
              return (
                <GridGroupHeader
                  key="group:grid"
                  count={item.count}
                  here={item.here}
                  open={isExpanded(GRID_KEY)}
                  onToggle={() => toggleGroupExpanded(GRID_KEY)}
                />
              );
            }
            const collapsed = !isExpanded(item.group);
            const filter = filterFor(item.group);
            const label = groupLabel(item.group, groupBy, t, i18n.language);
            return (
              <div
                key={`group:${item.group}`}
                className={classNames("datasetsCardGroupHeader", {
                  open: !collapsed && item.expandable,
                  empty: item.count === 0,
                  included: filter?.state === "include",
                  excluded: filter?.state === "exclude",
                  nested: item.depth > 0,
                })}
                style={{ "--group-share": item.share }}
              >
                <button
                  type="button"
                  className="datasetsCardGroupToggle"
                  onClick={() => toggleGroupExpanded(item.group)}
                  aria-expanded={item.expandable ? !collapsed : undefined}
                  disabled={!item.expandable}
                >
                  <ChevronRight
                    className="datasetsCardGroupCaret"
                    size={11}
                    aria-hidden="true"
                  />
                  {item.group === GRID_KEY && (
                    <Grid3x3Gap
                      className="datasetsCardGroupIcon"
                      size={13}
                      aria-hidden="true"
                    />
                  )}
                  <span className="datasetsCardGroupTitle" title={label}>
                    {label}
                  </span>
                  <span className="datasetsCardGroupCount">{item.count}</span>
                </button>
                {filter && (
                  <>
                    <ToggleButton
                      className="datasetsCardGroupFilter"
                      onChange={() => filter.toggle("include")}
                      isSelected={filter.state === "include"}
                      aria-label={`${t("datasetsCardGroupIncludeAction")}: ${label}`}
                      title={t(
                        filter.state === "include"
                          ? "datasetsCardGroupUnincludeTitle"
                          : "datasetsCardGroupIncludeTitle",
                      )}
                    >
                      {filter.state === "include" ? (
                        <CheckSquare size={13} aria-hidden="true" />
                      ) : (
                        <Square size={13} aria-hidden="true" />
                      )}
                    </ToggleButton>
                    <ToggleButton
                      className="datasetsCardGroupFilter exclude"
                      onChange={() => filter.toggle("exclude")}
                      isSelected={filter.state === "exclude"}
                      aria-label={`${t("filterOptionExcludeAction")}: ${label}`}
                      title={t(
                        filter.state === "exclude"
                          ? "filterOptionUnexcludeTitle"
                          : "filterOptionExcludeTitle",
                      )}
                    >
                      <SlashCircle size={13} aria-hidden="true" />
                    </ToggleButton>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
      <Pager
        page={currentPage}
        pageCount={pageCount}
        pageSize={pageSize}
        total={totalRowCount}
        onPageChange={goToPage}
        onPageSizeChange={setPageSize}
        label={t("datasetsPagerLabel")}
        perPageLabel={t("datasetsPagerPerPageLabel")}
        rangeTitle={
          foldedGridCount
            ? t("datasetsPagerFoldedGrids", { count: foldedGridCount })
            : undefined
        }
      />
    </div>
  );
}
