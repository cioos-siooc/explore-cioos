import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check2Circle,
  CheckSquare,
  ChevronRight,
  Filter,
  SlashCircle,
  Square,
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
import { cdmDataTypeLabel } from "../../../state/dataLayers.js";
import {
  GROUP_NONE,
  groupKeysFor,
  groupLabel,
  groupOptions,
  groupParent,
  isGroupDimension,
  parentGroupKeys,
  sortGroupKeys,
} from "../../../state/datasetGroups.js";
import { useChanged } from "../../../utilities.jsx";
import DatasetCard from "./DatasetCard.jsx";
import Pager, { PAGE_SIZES } from "../../ui/Pager.jsx";
import SelectPill from "../../ui/SelectPill.jsx";
import SortSelect from "../../ui/SortSelect.jsx";
import "./styles.css";

// Orders the groups by how many datasets each holds, not the rows — offered
// only while the list is grouped, and its default then.
const GROUP_SIZE = "groupSize";
const DEFAULT_SORT = { field: "title", dir: "asc" };
const GROUP_SIZE_SORT = { field: GROUP_SIZE, dir: "desc" };

// Stable empty set, so an unpinned list doesn't create a new Set every render
// and thrash memo deps.
const EMPTY_SET = new Set();

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
  // The built direct-download link per dataset pk (download modal only), so a
  // card can show the query its own dataset would be fetched with. Built by
  // DownloadDetails, which owns the format choice the strip below shares.
  downloadLinksByPk,
}) {
  const { t, i18n } = useTranslation();
  // The grouping lives in SelectionProvider: it outlives this list while a
  // dataset page replaces it, and is carried in the URL.
  const {
    groupBy: selectedGroupBy,
    setGroupBy,
    selectedPks,
    // Drops a dataset from the selection outright — aliased because the
    // download modal's own `handleSelectDataset` prop means something
    // narrower: whether this batch includes a dataset already in the order,
    // not whether it is in the order at all.
    handleSelectDataset: removeFromSelection,
    pointsError,
  } = useSelection();
  // The list has no search of its own: narrowing it is the Filters modal's
  // job, so there is one way to narrow the datasets, not two.
  const { openFilters, showFiltersModal } = useUI();
  const activeFilterCount = useActiveFilters().length;
  // The datasets the open "what's here" card is about. They sort to the top of
  // the list, which is what ties the card to this list at all — without it the
  // card named datasets that could be on page 6 of 8, and there was no way to
  // tell which rows it meant. The download modal is reviewing an order, not
  // exploring the map, so it ignores this.
  const { featureQuery } = useMapState();
  const pinnedPks = useMemo(() => {
    if (isDownloadModal || !featureQuery?.datasetPks?.length) return EMPTY_SET;
    return new Set(featureQuery.datasetPks.map(Number));
  }, [featureQuery, isDownloadModal]);
  const { tipHighlight } = useTips();

  // The download modal is a flat review list — it never groups, whatever the
  // sidebar is grouped by.
  const groupBy = isDownloadModal ? GROUP_NONE : selectedGroupBy;
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const listRef = useRef(null);

  // Sort fields differ by context: the download modal exposes the size and
  // downloadable status; the sidebar exposes the locations and days counts.
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

  const [sort, setSort] = useState(grouped ? GROUP_SIZE_SORT : DEFAULT_SORT);
  // Groups start closed, so a grouping reads first as its list of groups; a new
  // grouping starts closed again. A nested dimension opens its parents, so it
  // reads as the list of groups inside them.
  const [expandedGroups, setExpandedGroups] = useState(
    () => new Set(parentGroupKeys(groupBy)),
  );
  if (useChanged(groupBy)) setExpandedGroups(new Set(parentGroupKeys(groupBy)));
  if (useChanged(grouped)) setSort(grouped ? GROUP_SIZE_SORT : DEFAULT_SORT);
  // Group size orders the groups (renderItems); the rows within them go by
  // title.
  const rowSort = sort.field === GROUP_SIZE ? DEFAULT_SORT : sort;

  const groupByOptions = useMemo(() => groupOptions(t), [t]);
  // Each group header includes or excludes its group in the main filters.
  const {
    filterFor,
    filteredKeys: ownFilterKeys,
    narrowed: ownFilterSet,
  } = useGroupFilter(groupBy);
  const ownFilterId = ownFilterKeys.join("\n");

  const sortValue = useCallback(
    (row, field) => {
      const isGrid = row.cdm_data_type === "Grid";
      switch (field) {
        case "title":
          return (row.title || "").toLowerCase();
        case "type":
          return (
            isGrid
              ? t("griddapTypeLabel")
              : cdmDataTypeLabel(row.cdm_data_type, t) || ""
          ).toLowerCase();
        case "platform":
          return (
            isGrid ? t("griddapTypeLabel") : row.platform || ""
          ).toLowerCase();
        case "locations":
          return isGrid ? -1 : Number(row.profiles_count) || 0;
        case "days":
          return Number(row.days) || 0;
        case "size":
          return Number(row?.sizeEstimate?.filteredSize) || 0;
        case "downloadable":
          return row.internalDownload ? 1 : 0;
        default:
          return 0;
      }
    },
    [t],
  );

  // Search filtering happens upstream (SelectionProvider's filteredDatasets) —
  // this just sorts whatever it's handed.
  const visibleRows = useMemo(() => {
    const field = sortFields.find((f) => f.id === rowSort.field);
    const factor = rowSort.dir === "asc" ? 1 : -1;
    const sorted = [...(datasets || [])].sort((a, b) => {
      // Datasets under the last map click come first, in the chosen sort order
      // among themselves. This rides on top of the sort rather than replacing
      // it, so the sort control still does what it says — it just orders the two
      // blocks separately.
      const pa = pinnedPks.has(Number(a.pk)) ? 0 : 1;
      const pb = pinnedPks.has(Number(b.pk)) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const va = sortValue(a, rowSort.field);
      const vb = sortValue(b, rowSort.field);
      if (field?.type === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb), i18n.language) * factor;
    });
    return sorted;
  }, [datasets, rowSort, i18n.language, pinnedPks, sortFields, sortValue]);

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

  // The groups seen while the dimension's own filter was not narrowing it.
  // Once it is, the groups it took out of the results — every other one when
  // one is included, the excluded one itself — stay listed from here, empty,
  // so that filter can still be added to or undone from the list. Refreshed
  // only when new results land, not the moment the filter clears: until the
  // refetch, the results still lack the group being brought back.
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

  // Flat render list: without grouping it's just the sorted rows; with grouping
  // it's the rows bucketed under headers. Each entry is either
  // { header, group, count, depth, expandable } or { row, group }, where group
  // is the stable group
  // key (see state/datasetGroups.js — labels are derived at render time). Rows
  // stay in their sorted order within a group; groups are alphabetical by label
  // with Other/Uncategorized last. Array-valued dims place a dataset under each
  // of its values, so the total row entries can exceed the unique dataset count
  // (the toolbar count stays unique — see below). A nested dimension adds a
  // header per parent (depth 0) above its groups' headers (depth 1); a
  // parent's count is its unique datasets, since a dataset can sit in several
  // of its groups. The empty groups (emptyKeys) list after the rest, and only
  // a parent of them opens.
  const renderItems = useMemo(() => {
    if (!isGroupDimension(groupBy)) return visibleRows.map((row) => ({ row }));
    const rowsOf = (key) => byGroup.get(key) ?? [];
    const sortKeys = (keys, sizeOf) => {
      const sorted = sortGroupKeys(keys, groupBy, t, i18n.language);
      if (sort.field === GROUP_SIZE) {
        const factor = sort.dir === "asc" ? 1 : -1;
        sorted.sort((a, b) => (sizeOf(a) - sizeOf(b)) * factor);
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
        if (rows.length > 0 && expandedGroups.has(key)) {
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
      const parentSize = (parent) =>
        new Set(childrenByParent.get(parent).flatMap(rowsOf)).size;
      for (const parent of sortKeys(childrenByParent.keys(), parentSize)) {
        items.push({
          header: true,
          group: parent,
          count: parentSize(parent),
          depth: 0,
          expandable: true,
        });
        if (expandedGroups.has(parent)) {
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
    expandedGroups,
    sort,
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
        if (expandedGroups.has(item.group)) {
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
  }, [renderItems, firstRow, pageSize, currentPage, pageCount, expandedGroups]);

  // The what's here tip points at one of the click's datasets that can be
  // ticked in, while this list rather than the card holds them (see Sidebar).
  const whatsHereTarget = pageItems.find(
    (item) =>
      !item.header &&
      item.row.cdm_data_type !== "Grid" &&
      pinnedPks.has(Number(item.row.pk)),
  );

  const toggleGroupExpanded = (group) => {
    setExpandedGroups((prev) => {
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

  // Back to page one whenever the result set or its ordering changes: page 7 of
  // the previous results is not page 7 of these.
  useEffect(() => {
    // Paired with the scroll reset below, which is a DOM write and so has to
    // happen in an effect either way.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [datasetsKey, sort, isDownloadModal, groupBy, pageSize, pinnedPks]);

  // Every page starts at its top — the reader is at a new place in the list,
  // not where they left the scroll bar on the page before.
  const goToPage = (next) => {
    setPage(Math.min(Math.max(next, 1), pageCount));
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  const sortControl = (
    <SortSelect fields={sortFields} sort={sort} onChange={setSort} />
  );

  const controls = (
    <div className="datasetsCardControls" data-testid="datasets-controls">
      {isDownloadModal ? (
        <>
          {/* The same checkbox the rows below carry, so the control that ticks
              them all reads as one of them rather than as a pill that lights
              up. */}
          <label
            className="selectAllToggle"
            title={t("datasetsTableHeaderSelectAllTitle")}
          >
            <input
              type="checkbox"
              checked={selectAll}
              onChange={handleSelectAllDatasets}
            />
            {t("datasetsTableHeaderSelectAllTitle")}
          </label>
          <div className="datasetsCardArrange">{sortControl}</div>
        </>
      ) : (
        // Search, sort and grouping on one row: every row spent here is a
        // dataset card the sidebar does not show.
        <div className="datasetsCardToolbar">
          <button
            type="button"
            className={classNames("datasetsCardFilters", {
              active: showFiltersModal,
              applied: !showFiltersModal && activeFilterCount > 0,
            })}
            data-testid="datasets-filters-button"
            onClick={openFilters}
            aria-pressed={showFiltersModal}
            title={t("dockFiltersCountTitle", { count: activeFilterCount })}
          >
            <Filter size={13} aria-hidden="true" />
            {t("filtersMenuButton")}
            {activeFilterCount > 0 && (
              <span className="datasetsCardFiltersCount">
                {activeFilterCount}
              </span>
            )}
          </button>
          {sortControl}
          <SelectPill
            label={t("datasetsCardGroupByLabel")}
            value={groupBy}
            options={groupByOptions}
            onChange={setGroupBy}
          />
        </div>
      )}

      {/* What the size pill and the tick/cross on each card below mean. It
          belongs on this row rather than under the list: it is a key to the
          cards, and read before them it saves the reader working out what the
          colours meant after the fact. */}
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
      {/* Explains the accent DatasetCard puts on rows the last map click found
          (see .datasetCard.fromMapClick in styles.css) — otherwise the only
          place that colour is named is a hover tooltip on the row itself,
          which a touch user never sees and a mouse user has no reason to go
          looking for. Only worth saying while there is a click to explain. */}
      {!isDownloadModal && pinnedPks.size > 0 && (
        <div className="datasetsCardMapClickHint">
          <span className="datasetsCardMapClickSwatch" aria-hidden="true" />
          {t("datasetsCardMapClickHint")}
        </div>
      )}
      <div className="datasetsCardList" ref={listRef}>
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
                  downloadLink={downloadLinksByPk?.get(item.row.pk)}
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
            const collapsed = !expandedGroups.has(item.group);
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
                  <span className="datasetsCardGroupTitle" title={label}>
                    {label}
                  </span>
                  <span className="datasetsCardGroupCount">{item.count}</span>
                </button>
                {filter && (
                  <>
                    <button
                      type="button"
                      className="datasetsCardGroupFilter"
                      onClick={() => filter.toggle("include")}
                      aria-pressed={filter.state === "include"}
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
                    </button>
                    <button
                      type="button"
                      className="datasetsCardGroupFilter exclude"
                      onClick={() => filter.toggle("exclude")}
                      aria-pressed={filter.state === "exclude"}
                      aria-label={`${t("filterOptionExcludeAction")}: ${label}`}
                      title={t(
                        filter.state === "exclude"
                          ? "filterOptionUnexcludeTitle"
                          : "filterOptionExcludeTitle",
                      )}
                    >
                      <SlashCircle size={13} aria-hidden="true" />
                    </button>
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
      />
    </div>
  );
}
