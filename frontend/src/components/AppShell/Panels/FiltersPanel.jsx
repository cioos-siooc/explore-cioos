import * as React from "react";
import { useState } from "react";
import {
  ArrowsExpand,
  BoundingBox,
  Building,
  CalendarWeek,
  Cursor,
  Eye,
  FileEarmarkSpreadsheet,
  Pentagon,
  Search,
  Stack,
  Tag,
  Water,
  BroadcastPin,
  Server,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import Spinner from "../../ui/Spinner.jsx";
import FilterSearch from "../FilterSearch/FilterSearch.jsx";
import Filter from "../../Controls/Filter/Filter.jsx";
import FilterSection from "../../Controls/Filter/FilterMenu/FilterSection.jsx";
import DataLayersFilter from "../../Controls/Filter/DataLayersFilter/DataLayersFilter.jsx";
import MultiCheckboxFilter from "../../Controls/Filter/MultiCheckboxFilter/MultiCheckboxFilter.jsx";
import SourceFilter from "../../Controls/Filter/SourceFilter/SourceFilter.jsx";
import Switch from "../../ui/Switch.jsx";
import ScientificNameFilter from "../../Controls/Filter/ScientificNameFilter/ScientificNameFilter.jsx";
import SpatialFilter from "../../Controls/Filter/SpatialFilter/SpatialFilter.jsx";
import TimeSelector from "../../Controls/Filter/TimeSelector/TimeSelector.jsx";
import DepthSelector from "../../Controls/Filter/DepthSelector/DepthSelector.jsx";
import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth,
} from "../../config.js";
import {
  capitalizeFirstLetter,
  generateMultipleSelectBadgeTitle,
  generateRangeSelectBadgeTitle,
  polygonIsRectangle,
  setAllOptionsIsSelectedTo,
} from "../../../utilities.jsx";
import {
  DATA_LAYER_LABEL_KEYS,
  chosenDataLayerKeys,
} from "../../../state/dataLayers.js";
import useDatasetCounts from "../../../state/useDatasetCounts.js";
import useResetAllFilters from "../../../state/useResetAllFilters.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// Included or excluded — either way the option constrains the filter.
const isSet = (option) => option.isSelected || option.isExcluded;

// Matches the raw title and what the user actually reads — the translated
// label and, for EOVs, the category in either language ("physique" finds them
// all).
function createOptionSubset(searchTerms, allOptions, t) {
  if (!searchTerms) return allOptions;
  const search = searchTerms.toString().toLowerCase();
  return allOptions.filter((option) =>
    [
      option.title,
      t(option.title),
      option.categoryTranslated?.en,
      option.categoryTranslated?.fr,
    ].some((text) => text?.toLowerCase().includes(search)),
  );
}

// The Filters panel: filter rows grouped into sections on the left, with the
// open filter's options in the detail pane on the right (see styles.css —
// the .filterOptions flyout is re-anchored inside the sheet), over a footer
// that reports what the filters currently add up to.
export default function FiltersPanel({ searchInputRef }) {
  const { t } = useTranslation();
  const {
    eovsSelected,
    setEovsSelected,
    eovsSearchTerms,
    setEovsSearchTerms,
    eovsMatchAll,
    setEovsMatchAll,
    orgsSelected,
    setOrgsSelected,
    orgsSearchTerms,
    setOrgsSearchTerms,
    orgsMatchAll,
    setOrgsMatchAll,
    datasetsSelected,
    setDatasetsSelected,
    datasetSearchTerms,
    setDatasetSearchTerms,
    platformsSelected,
    setPlatformsSelected,
    platformsSearchTerms,
    setPlatformsSearchTerms,
    erddapServersSelected,
    setErddapServersSelected,
    obisNodesSelected,
    setObisNodesSelected,
    sourcesSearchTerms,
    setSourcesSearchTerms,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    startDepth,
    setStartDepth,
    endDepth,
    setEndDepth,
    scientificNamesSelected,
    setScientificNamesSelected,
    scientificNamesExcluded,
    setScientificNamesExcluded,
    scientificNamesMatchAll,
    setScientificNamesMatchAll,
    realtimeOnly,
    setRealtimeOnly,
    timeFilterActive,
    depthFilterActive,
    allObisNodesSelected,
    allObisNodesExcluded,
    showObis,
    obisDataAvailable,
  } = useFilters();
  const {
    datasetTitleSearchText,
    onlyInView,
    setOnlyInView,
    inViewCount,
    polygon,
  } = useSelection();
  const { openFilter, setOpenFilter, filterSearchText } = useUI();
  // The search page's text, kept here so a visit to a filter's own page and
  // back finds it as it was left.
  const [searchText, setSearchText] = useState(filterSearchText ?? "");
  const [, resetAll] = useResetAllFilters();
  const {
    ready: countsReady,
    updating: countsUpdating,
    filteredCount,
    total,
    allDatasetsShown,
    title: countsTitle,
  } = useDatasetCounts();
  const { dataLayerChoices, resetDataLayers, requestDraw } = useMapState();

  // The one search box whose terms aren't a filter over options already in
  // state — it is a query against WoRMS — so it is kept here rather than in the
  // filter state the URL is built from.
  const [scientificNameSearchTerms, setScientificNameSearchTerms] =
    useState("");

  const realtimeFilterName = t("realtimeFilterName");
  const inViewFilterName = t("datasetsCardOnlyInViewText");

  // Same badge rule as the catalogue filters: the bare filter name while the
  // filter is doing nothing, the chosen value(s) once it is.
  const dataLayersFilterTranslationKey = "layerSelectorLabel";
  const dataLayersChosen = chosenDataLayerKeys(dataLayerChoices);
  const dataLayerLabel = (key) => {
    const title = t(DATA_LAYER_LABEL_KEYS[key]);
    return dataLayerChoices[key] === "exclude"
      ? t("filterExcludedOption", { title })
      : title;
  };
  const dataLayersBadgeTitle =
    dataLayersChosen.length === 0
      ? t(dataLayersFilterTranslationKey)
      : dataLayersChosen.length === 1
        ? dataLayerLabel(dataLayersChosen[0])
        : dataLayersChosen.length + t("dataLayersMulti");

  const eovsFilterTranslationKey = "oceanVariablesFiltername";
  const eovsBadgeTitle = generateMultipleSelectBadgeTitle(
    t,
    eovsFilterTranslationKey,
    eovsSelected,
  );
  const orgsFilterTranslationKey = "organizationFilterName";
  const orgsBadgeTitle = generateMultipleSelectBadgeTitle(
    t,
    orgsFilterTranslationKey,
    orgsSelected,
  );
  const datasetsFilterTranslationKey = "datasetsFilterName";
  const datasetsBadgeTitle = generateMultipleSelectBadgeTitle(
    t,
    datasetsFilterTranslationKey,
    datasetsSelected,
  );
  const platformsFilterTranslationKey = "platformsFilterName";
  const platformsBadgeTitle = generateMultipleSelectBadgeTitle(
    t,
    platformsFilterTranslationKey,
    platformsSelected,
  );
  const sourcesFilterTranslationKey = "sourceFilterName";

  const sourcesBadgeTitle = (() => {
    const notTitle = (title) => t("filterExcludedOption", { title });
    const selectedTitles = [
      ...erddapServersSelected
        .filter(isSet)
        .map((s) => (s.isExcluded ? notTitle(s.title) : s.title)),
      // a fully selected (or fully excluded) OBIS group reads as one source
      ...(allObisNodesSelected
        ? ["OBIS"]
        : allObisNodesExcluded
          ? [notTitle("OBIS")]
          : obisNodesSelected
              .filter(isSet)
              .map((n) => (n.isExcluded ? notTitle(n.title) : n.title))),
    ];
    if (selectedTitles.length === 0) return t(sourcesFilterTranslationKey);
    if (selectedTitles.length === 1) {
      return capitalizeFirstLetter(selectedTitles[0]);
    }
    return selectedTitles.length + t("sourcesMulti");
  })();

  const timeframesFilterName = t("timeframeFilterName");
  const timeframesBadgeTitle = generateRangeSelectBadgeTitle(
    timeframesFilterName,
    [startDate, endDate],
    [defaultStartDate, defaultEndDate],
  );
  // Not one of the catalogue's own facets, so it has no options list to count:
  // the badge names the picked species instead, on the same one/many rule.
  const scientificNamesFilterTranslationKey = "scientificNameFilterName";
  const scientificNamesPicked = [
    ...scientificNamesSelected,
    ...scientificNamesExcluded.map((title) =>
      t("filterExcludedOption", { title }),
    ),
  ];
  const scientificNamesBadgeTitle =
    scientificNamesPicked.length === 0
      ? t(scientificNamesFilterTranslationKey)
      : scientificNamesPicked.length === 1
        ? scientificNamesPicked[0]
        : scientificNamesPicked.length + t("scientificNamesMulti");

  // The Any/All control, on the lists where a dataset can carry several values.
  const matchAllSwitch = (id, checked, setChecked) => (
    <Switch
      id={id}
      data-testid={id}
      label={t("filterMatchAllLabel")}
      checked={checked}
      onChange={(e) => setChecked(e.target.checked)}
    />
  );

  const depthRangeFilterName = t("depthRangeFilterName");
  const depthRangeBadgeTitle = generateRangeSelectBadgeTitle(
    depthRangeFilterName,
    [startDepth, endDepth],
    [defaultStartDepth, defaultEndDepth],
    "(m)",
  );

  // Like the scientific name search above, not a facet with an options list —
  // idle it reads as the bare filter name, drawn it names the shape itself
  // (the same two labels SpatialFilterButton's own menu uses).
  const spatialFilterTranslationKey = "spatialFilterFilterName";
  const hasSpatialFilter = Boolean(polygon);
  const spatialFilterBadgeTitle = hasSpatialFilter
    ? t(
        polygonIsRectangle(polygon)
          ? "drawBoundingBoxOption"
          : "drawPolygonOption",
      )
    : t(spatialFilterTranslationKey);
  const SpatialFilterIcon =
    hasSpatialFilter && !polygonIsRectangle(polygon) ? Pentagon : BoundingBox;

  // A failed /datasets leaves no catalogue total; what came back filtered is
  // then all we know it to be (same fallback as the top bar's counter).
  const totalCount = total ?? filteredCount;

  return (
    <div
      className={classNames("filtersPanel", {
        searching: !openFilter && searchText.trim(),
      })}
      data-testid="filters-panel"
    >
      <div className="filtersPanelBody">
        {!openFilter && (
          <FilterSearch
            text={searchText}
            setText={setSearchText}
            inputRef={searchInputRef}
          />
        )}
        <div className="filtersPanelList" data-testid="filters-panel-list">
          {/* The way back to the search page from a filter's own page; on a
              phone the search sits above the list instead (see styles.css). */}
          <div className="filter filtersPanelSearchRow">
            <button
              type="button"
              data-testid="filters-panel-search"
              className={classNames("filterHeader", {
                open: !openFilter,
                active: Boolean(datasetTitleSearchText),
              })}
              aria-current={!openFilter ? "true" : undefined}
              onClick={() => setOpenFilter(undefined)}
            >
              <Search />
              <div className="badgeTitle">{t("filterSearchLabel")}</div>
            </button>
          </div>
          <FilterSection title={t("filterGroupWhat")}>
            {/* First of the facet rows: this is the coarsest "what" there is —
                it decides which families of data exist for the filters below
                to narrow. */}
            <Filter
              active={dataLayersChosen.length > 0}
              badgeTitle={dataLayersBadgeTitle}
              tooltip={t("dataLayersFilterTooltip")}
              icon={<Stack />}
              controlled
              filterName={dataLayersFilterTranslationKey}
              openFilter={openFilter === dataLayersFilterTranslationKey}
              setOpenFilter={setOpenFilter}
              resetButton={resetDataLayers}
            >
              <DataLayersFilter />
            </Filter>
            <Filter
              active={eovsSelected.some(isSet)}
              badgeTitle={eovsBadgeTitle}
              optionsSelected={eovsSelected}
              setOptionsSelected={setEovsSelected}
              tooltip={t("oceanVariableFilterTooltip")}
              icon={<Water />}
              controlled
              searchable
              searchTerms={eovsSearchTerms}
              setSearchTerms={setEovsSearchTerms}
              searchPlaceholder={t("oceanVariableFilterSeachPlaceholder")}
              filterName={eovsFilterTranslationKey}
              openFilter={openFilter === eovsFilterTranslationKey}
              setOpenFilter={setOpenFilter}
              resetButton={() =>
                setAllOptionsIsSelectedTo(false, eovsSelected, setEovsSelected)
              }
            >
              {matchAllSwitch("eovs-match-all", eovsMatchAll, setEovsMatchAll)}
              <MultiCheckboxFilter
                optionsSelected={createOptionSubset(
                  eovsSearchTerms,
                  eovsSelected,
                  t,
                )}
                setOptionsSelected={setEovsSelected}
                searchable
                translatable
                grouped
                allOptions={eovsSelected}
              />
            </Filter>
            <Filter
              active={platformsSelected.some(isSet)}
              badgeTitle={platformsBadgeTitle}
              setOptionsSelected={setPlatformsSelected}
              tooltip={t("platformFilterTooltip")}
              icon={<Cursor />}
              controlled
              searchable
              searchTerms={platformsSearchTerms}
              setSearchTerms={setPlatformsSearchTerms}
              searchPlaceholder={t("platformsFilterSeachPlaceholder")}
              filterName={platformsFilterTranslationKey}
              openFilter={openFilter === platformsFilterTranslationKey}
              setOpenFilter={setOpenFilter}
              resetButton={() =>
                setAllOptionsIsSelectedTo(
                  false,
                  platformsSelected,
                  setPlatformsSelected,
                )
              }
              infoButton="http://vocab.nerc.ac.uk/collection/L06/current/"
            >
              <MultiCheckboxFilter
                optionsSelected={createOptionSubset(
                  platformsSearchTerms,
                  platformsSelected,
                  t,
                )}
                setOptionsSelected={setPlatformsSelected}
                searchable
                colored
                translatable
                allOptions={platformsSelected}
              />
            </Filter>
          </FilterSection>
          <FilterSection title={t("filterGroupFrom")}>
            <Filter
              active={orgsSelected.some(isSet)}
              badgeTitle={orgsBadgeTitle}
              optionsSelected={orgsSelected}
              setOptionsSelected={setOrgsSelected}
              tooltip={t("organizationFilterTooltip")}
              icon={<Building />}
              controlled
              searchable
              searchTerms={orgsSearchTerms}
              setSearchTerms={setOrgsSearchTerms}
              searchPlaceholder={t("organizationFilterSearchPlaceholder")}
              filterName={orgsFilterTranslationKey}
              openFilter={openFilter === orgsFilterTranslationKey}
              setOpenFilter={setOpenFilter}
              resetButton={() =>
                setAllOptionsIsSelectedTo(false, orgsSelected, setOrgsSelected)
              }
            >
              {matchAllSwitch("orgs-match-all", orgsMatchAll, setOrgsMatchAll)}
              <MultiCheckboxFilter
                optionsSelected={createOptionSubset(
                  orgsSearchTerms,
                  orgsSelected,
                  t,
                )}
                setOptionsSelected={setOrgsSelected}
                searchable
                allOptions={orgsSelected}
              />
            </Filter>
            <Filter
              active={datasetsSelected.some(isSet)}
              badgeTitle={datasetsBadgeTitle}
              optionsSelected={datasetsSelected}
              setOptionsSelected={setDatasetsSelected}
              tooltip={t("datasetFilterTooltip")}
              icon={<FileEarmarkSpreadsheet />}
              controlled
              searchable
              searchTerms={datasetSearchTerms}
              setSearchTerms={setDatasetSearchTerms}
              searchPlaceholder={t("datasetSearchPlaceholder")}
              filterName={datasetsFilterTranslationKey}
              openFilter={openFilter === datasetsFilterTranslationKey}
              setOpenFilter={setOpenFilter}
              resetButton={() =>
                setAllOptionsIsSelectedTo(
                  false,
                  datasetsSelected,
                  setDatasetsSelected,
                )
              }
            >
              <MultiCheckboxFilter
                optionsSelected={createOptionSubset(
                  datasetSearchTerms,
                  datasetsSelected,
                  t,
                )}
                setOptionsSelected={setDatasetsSelected}
                searchable
                allOptions={datasetsSelected}
                translatable
              />
            </Filter>
            <Filter
              active={
                erddapServersSelected.some(isSet) ||
                obisNodesSelected.some(isSet)
              }
              badgeTitle={sourcesBadgeTitle}
              tooltip={t("sourceFilterTooltip")}
              icon={<Server />}
              controlled
              searchable
              searchTerms={sourcesSearchTerms}
              setSearchTerms={setSourcesSearchTerms}
              searchPlaceholder={t("sourceFilterSearchPlaceholder")}
              filterName={sourcesFilterTranslationKey}
              openFilter={openFilter === sourcesFilterTranslationKey}
              setOpenFilter={setOpenFilter}
              resetButton={() => {
                setAllOptionsIsSelectedTo(
                  false,
                  erddapServersSelected,
                  setErddapServersSelected,
                );
                setAllOptionsIsSelectedTo(
                  false,
                  obisNodesSelected,
                  setObisNodesSelected,
                );
              }}
            >
              <SourceFilter
                erddapServersSelected={erddapServersSelected}
                setErddapServersSelected={setErddapServersSelected}
                obisNodesSelected={obisNodesSelected}
                setObisNodesSelected={setObisNodesSelected}
                searchTerms={sourcesSearchTerms}
              />
            </Filter>
          </FilterSection>
          <FilterSection title={t("filterGroupWhenWhere")}>
            {/* First in the section: the drawn shape is the primary "where"
                constraint, ahead of the derived "in view" toggle below it.
                Picking a shape closes the modal (see SpatialFilter) so the
                map — hidden behind the dialog otherwise — is there to draw
                on. */}
            <Filter
              active={hasSpatialFilter}
              badgeTitle={spatialFilterBadgeTitle}
              tooltip={t("spatialFilterMenuTitle")}
              icon={<SpatialFilterIcon />}
              controlled
              filterName={spatialFilterTranslationKey}
              openFilter={openFilter === spatialFilterTranslationKey}
              setOpenFilter={setOpenFilter}
              resetButton={
                hasSpatialFilter ? () => requestDraw("clear") : undefined
              }
            >
              <SpatialFilter />
            </Filter>
            <Filter
              active={timeFilterActive}
              badgeTitle={timeframesBadgeTitle}
              setOptionsSelected={() => {
                setStartDate(defaultStartDate);
                setEndDate(defaultEndDate);
              }}
              tooltip={t("timeframeFilterTooltip")}
              icon={<CalendarWeek />}
              controlled
              filterName={timeframesFilterName}
              openFilter={openFilter === timeframesFilterName}
              setOpenFilter={setOpenFilter}
              resetButton={() => {
                setStartDate(defaultStartDate);
                setEndDate(defaultEndDate);
              }}
            >
              <TimeSelector
                startDate={startDate}
                setStartDate={setStartDate}
                endDate={endDate}
                setEndDate={setEndDate}
              />
            </Filter>
            <Filter
              active={depthFilterActive}
              badgeTitle={depthRangeBadgeTitle}
              setOptionsSelected={() => {
                setStartDepth(defaultStartDepth);
                setEndDepth(defaultEndDepth);
              }}
              tooltip={t("depthrangeFilterTooltip")}
              icon={<ArrowsExpand />}
              controlled
              filterName={depthRangeFilterName}
              openFilter={openFilter === depthRangeFilterName}
              setOpenFilter={setOpenFilter}
              resetButton={() => {
                setStartDepth(defaultStartDepth);
                setEndDepth(defaultEndDepth);
              }}
            >
              <DepthSelector
                startDepth={startDepth}
                setStartDepth={setStartDepth}
                endDepth={endDepth}
                setEndDepth={setEndDepth}
              />
            </Filter>
            <Filter
              active={realtimeOnly}
              badgeTitle={t("realtimeFilterName")}
              tooltip={t("realtimeFilterTooltip")}
              icon={<BroadcastPin />}
              controlled
              filterName={realtimeFilterName}
              openFilter={openFilter === realtimeFilterName}
              setOpenFilter={setOpenFilter}
              resetButton={
                realtimeOnly ? () => setRealtimeOnly(false) : undefined
              }
            >
              <label className="inViewFilterToggle">
                <input
                  type="checkbox"
                  checked={realtimeOnly}
                  onChange={(e) => setRealtimeOnly(e.target.checked)}
                />
                <span>{t("realtimeFilterOptionText")}</span>
              </label>
              <div className="inViewFilterCount">
                {t("realtimeFilterHelpText")}
              </div>
            </Filter>
            <Filter
              active={onlyInView}
              badgeTitle={t("datasetsCardOnlyInViewText")}
              tooltip={t("datasetsCardOnlyInViewTitle")}
              icon={<Eye />}
              controlled
              filterName={inViewFilterName}
              openFilter={openFilter === inViewFilterName}
              setOpenFilter={setOpenFilter}
              resetButton={onlyInView ? () => setOnlyInView(false) : undefined}
            >
              <label className="inViewFilterToggle">
                <input
                  type="checkbox"
                  checked={onlyInView}
                  onChange={(e) => setOnlyInView(e.target.checked)}
                />
                <span>{t("datasetsCardOnlyInViewTitle")}</span>
              </label>
              <div className="inViewFilterCount">
                {t("datasetsCardInViewCountText", { count: inViewCount })}
              </div>
            </Filter>
          </FilterSection>
          {obisDataAvailable && (
            <FilterSection title={t("filterGroupBiodiversity")}>
              <Filter
                active={scientificNamesPicked.length > 0}
                badgeTitle={scientificNamesBadgeTitle}
                tooltip={t("scientificNameFilterTooltip")}
                disabled={!showObis}
                disabledTooltip={t("scientificNameFilterDisabledTooltip")}
                icon={<Tag />}
                controlled
                searchable
                searchTerms={scientificNameSearchTerms}
                setSearchTerms={setScientificNameSearchTerms}
                searchPlaceholder={t("scientificNameFilterSearchPlaceholder")}
                filterName={scientificNamesFilterTranslationKey}
                openFilter={openFilter === scientificNamesFilterTranslationKey}
                setOpenFilter={setOpenFilter}
                resetButton={
                  scientificNamesPicked.length > 0
                    ? () => {
                        setScientificNamesSelected([]);
                        setScientificNamesExcluded([]);
                      }
                    : undefined
                }
              >
                {matchAllSwitch(
                  "scientific-names-match-all",
                  scientificNamesMatchAll,
                  setScientificNamesMatchAll,
                )}
                <ScientificNameFilter
                  scientificNamesSelected={scientificNamesSelected}
                  setScientificNamesSelected={setScientificNamesSelected}
                  scientificNamesExcluded={scientificNamesExcluded}
                  setScientificNamesExcluded={setScientificNamesExcluded}
                  searchTerms={scientificNameSearchTerms}
                />
              </Filter>
            </FilterSection>
          )}
        </div>
      </div>
      {/* Filters apply live, so there is nothing to confirm here — but the
          dialog covers the map at every width and takes the whole screen on a
          phone, so the one thing it owes the user is the number they are
          filtering towards. Reset sits beside it because it is the other thing
          you do to the whole set, rather than at the end of a list that has to
          be scrolled past to reach it. */}
      <div className="filtersPanelFooter">
        <span
          data-testid="filters-panel-count"
          className={classNames("filtersPanelCount", {
            updating: countsUpdating,
          })}
          title={countsTitle}
        >
          {countsReady ? (
            allDatasetsShown ? (
              t("topBarCountsTotal", { count: totalCount })
            ) : (
              t("topBarCountsSummary", {
                filtered: filteredCount,
                total: totalCount,
              })
            )
          ) : (
            <Spinner size="xs" className="countSpinner" />
          )}
        </span>
        <button
          type="button"
          className="filtersPanelReset"
          onClick={resetAll}
          title={t("resetFiltersButtonTooltipText")}
        >
          {t("filtersPanelResetAll")}
        </button>
      </div>
    </div>
  );
}
