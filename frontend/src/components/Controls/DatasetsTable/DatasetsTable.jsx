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
import {
  CATALOGUE_KEY,
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
import { isCatalogueRecord } from "../../../state/dataLayers.js";
import { useChanged } from "../../../utilities.jsx";
import DatasetCard from "./DatasetCard.jsx";
import Pager, { PAGE_SIZES } from "../../ui/Pager.jsx";
import SelectPill from "../../ui/SelectPill.jsx";
import SortSelect from "../../ui/SortSelect.jsx";
import "./styles.css";
import "../../Map/ClearMapSelection/styles.css";

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
  downloadLinkByPk,
  // The format OBIS rows fall back to when the chosen one has no OBIS version.
  // Beside the pager's range: the download modal's selection totals.
  pagerExtra,
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
    listSort,
    setListSort,
  } = useSelection();
  const { openFilters, showFiltersModal, compactList, setListDensity } =
    useUI();
  const activeFilterCount = useActiveFilters().length;
  // The "what's here" card's datasets sort to the top, tying the card to the
  // list; the download modal ignores them.
  const { featureQuery, setFeatureQuery, griddapCoverageVisible } =
    useMapState();
  const pinnedPks = useMemo(
    () => pinnedPksOf(isDownloadModal ? null : featureQuery),
    [featureQuery, isDownloadModal],
  );
  // With the gridded coverage layer on, the reader is looking for grids.
  const gridFirst = griddapCoverageVisible && !isDownloadModal;
  const { tipHighlight } = useTips();

  const groupBy = isDownloadModal ? GROUP_NONE : selectedGroupBy;
  const compact = !isDownloadModal && compactList;
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const listRef = useRef(null);
  // A display:none list loses its scroll offset, so it is remembered here and
  // put back when the list shows again.
  const scrollTopRef = useRef(0);
  const scrollListToTop = () => {
    scrollTopRef.current = 0;
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  useLayoutEffect(() => {
    if (!hidden && listRef.current) {
      listRef.current.scrollTop = scrollTopRef.current;
    }
  }, [hidden]);

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
        gridFirst,
        t,
        language: i18n.language,
      }),
    [datasets, sort, pinnedPks, gridFirst, t, i18n.language],
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
  const isExpanded = useCallback(
    (key) =>
      (fitsOnePage || parentGroupKeys(groupBy).includes(key)) !==
      toggledGroups.has(key),
    [fitsOnePage, groupBy, toggledGroups],
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
      // Catalogue records sort last; ungrouped, they still get a section of
      // their own, as they hold no data.
      const firstCatalogue = visibleRows.findIndex(isCatalogueRecord);
      if (firstCatalogue === -1) return visibleRows.map((row) => ({ row }));
      const catalogue = visibleRows.slice(firstCatalogue);
      return [
        ...visibleRows.slice(0, firstCatalogue).map((row) => ({ row })),
        {
          header: true,
          group: CATALOGUE_KEY,
          count: catalogue.length,
          depth: 0,
          expandable: true,
        },
        ...(isExpanded(CATALOGUE_KEY)
          ? catalogue.map((row) => ({ row, group: CATALOGUE_KEY }))
          : []),
      ];
    }
    const rowsOf = (key) => byGroup.get(key) ?? [];
    const sortKeys = (keys, sizeOf) => {
      const sorted = sortGroupKeys(keys, groupBy, t, i18n.language);
      if (sort.field === GROUP_SIZE) {
        const factor = sort.dir === "asc" ? 1 : -1;
        sorted.sort((a, b) => (sizeOf(a) - sizeOf(b)) * factor);
      }
      if (gridFirst && sorted.includes(GRID_KEY)) {
        sorted.splice(sorted.indexOf(GRID_KEY), 1);
        sorted.unshift(GRID_KEY);
      }
      if (sorted.includes(CATALOGUE_KEY)) {
        sorted.splice(sorted.indexOf(CATALOGUE_KEY), 1);
        sorted.push(CATALOGUE_KEY);
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
    gridFirst,
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
  }, [
    datasetsKey,
    sort,
    isDownloadModal,
    groupBy,
    pageSize,
    pinnedPks,
    gridFirst,
  ]);

  const goToPage = (next) => {
    setPage(Math.min(Math.max(next, 1), pageCount));
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
              onChange={handleSelectAllDatasets}
            />
            {t("datasetsTableHeaderSelectAllTitle")}
          </label>
          <div className="datasetsCardArrange">{sortControl}</div>
        </>
      ) : (
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
          <button
            type="button"
            className="datasetsCardDensity"
            data-testid="datasets-density-toggle"
            onClick={() => setListDensity(compact ? "full" : "compact")}
            aria-pressed={compact}
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
          </button>
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
      <div
        className={classNames("datasetsCardList", { compact })}
        ref={listRef}
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
      >
        {pagerExtra}
      </Pager>
    </div>
  );
}
