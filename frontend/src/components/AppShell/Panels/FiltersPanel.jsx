import * as React from "react";
import { useState } from "react";
import {
  ArrowCounterclockwise,
  ArrowsExpand,
  BoundingBox,
  Building,
  CalendarWeek,
  ChevronDown,
  Cursor,
  FileEarmarkSpreadsheet,
  Funnel,
  HandIndex,
  Intersect,
  Map as MapIcon,
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
import Filter from "../../Controls/Filter/Filter.jsx";
import FilterSection from "../../Controls/Filter/FilterMenu/FilterSection.jsx";
import DataLayersFilter from "../../Controls/Filter/DataLayersFilter/DataLayersFilter.jsx";
import MultiCheckboxFilter from "../../Controls/Filter/MultiCheckboxFilter/MultiCheckboxFilter.jsx";
import SourceFilter from "../../Controls/Filter/SourceFilter/SourceFilter.jsx";
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
  selectedDataLayerKeys,
} from "../../../state/dataLayers.js";
import useDatasetCounts from "../../../state/useDatasetCounts.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// The how-to shown in the detail pane before any filter is open (below) —
// one step per glyph, in the order a first-time visitor would do them.
const PLACEHOLDER_STEPS = [
  { key: "select", Icon: HandIndex },
  { key: "combine", Icon: Intersect },
  { key: "live", Icon: MapIcon },
  // The one shortcut that skips this dialog entirely: the same ▾ caret icon
  // QuickFiltersButton itself renders, welded onto the Filters segment on the
  // map (see TopControls.jsx), for the two filters — text search and area
  // draw — that act on the map directly rather than an options list here.
  { key: "quickMenu", Icon: ChevronDown },
  { key: "reset", Icon: ArrowCounterclockwise },
];

function createOptionSubset(searchTerms, allOptions) {
  if (searchTerms) {
    return allOptions.filter((option) =>
      option.title.toLowerCase().includes(searchTerms.toString().toLowerCase()),
    );
  } else {
    return allOptions;
  }
}

// The Filters panel: filter rows grouped into sections on the left, with the
// open filter's options in the detail pane on the right (see styles.css —
// the .filterOptions flyout is re-anchored inside the sheet), over a footer
// that reports what the filters currently add up to.
export default function FiltersPanel() {
  const { t } = useTranslation();
  const {
    eovsSelected,
    setEovsSelected,
    eovsSearchTerms,
    setEovsSearchTerms,
    orgsSelected,
    setOrgsSelected,
    orgsSearchTerms,
    setOrgsSearchTerms,
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
    realtimeOnly,
    setRealtimeOnly,
    timeFilterActive,
    depthFilterActive,
    anyServersSelected,
    anyObisNodesSelected,
    allObisNodesSelected,
    showObis,
    obisDataAvailable,
    resetFilters,
  } = useFilters();
  const {
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView,
    inViewCount,
    polygon,
  } = useSelection();
  const { openFilter, setOpenFilter } = useUI();
  const {
    ready: countsReady,
    updating: countsUpdating,
    filteredCount,
    total,
  } = useDatasetCounts();
  const { dataLayers, resetDataLayers, requestDraw } = useMapState();

  // The one search box whose terms aren't a filter over options already in
  // state — it is a query against WoRMS — so it is kept here rather than in the
  // filter state the URL is built from.
  const [scientificNameSearchTerms, setScientificNameSearchTerms] =
    useState("");

  const inViewFilterName = t("datasetsCardOnlyInViewText");
  const realtimeFilterName = t("realtimeFilterName");

  // Same badge rule as the catalogue filters: the bare filter name while the
  // filter is doing nothing, the chosen value(s) once it is.
  const dataLayersFilterTranslationKey = "layerSelectorLabel";
  const dataLayersChosen = selectedDataLayerKeys(dataLayers);
  const dataLayersBadgeTitle =
    dataLayersChosen.length === 0
      ? t(dataLayersFilterTranslationKey)
      : dataLayersChosen.length === 1
        ? t(DATA_LAYER_LABEL_KEYS[dataLayersChosen[0]])
        : dataLayersChosen.length + t("dataLayersMulti");

  // No options list of its own (it matches free text against dataset titles),
  // so it skips generateMultipleSelectBadgeTitle: idle it reads as a bare
  // filter name, active it shows the typed text itself — same rule as the
  // scientific name search below.
  const textSearchFilterTranslationKey = "textSearchFilterName";
  const textSearchBadgeTitle =
    datasetTitleSearchText || t(textSearchFilterTranslationKey);

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
    const selectedTitles = [
      ...erddapServersSelected.filter((s) => s.isSelected).map((s) => s.title),
      // a fully selected OBIS group reads as one source
      ...(allObisNodesSelected
        ? ["OBIS"]
        : obisNodesSelected.filter((n) => n.isSelected).map((n) => n.title)),
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
  const scientificNamesBadgeTitle =
    scientificNamesSelected.length === 0
      ? t(scientificNamesFilterTranslationKey)
      : scientificNamesSelected.length === 1
        ? scientificNamesSelected[0]
        : scientificNamesSelected.length + t("scientificNamesMulti");

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

  function resetEverything() {
    resetFilters();
    resetDataLayers();
    requestDraw("clear");
    setDatasetTitleSearchText("");
    setOnlyInView(false);
  }

  return (
    <div className="filtersPanel" data-testid="filters-panel">
      <div className="filtersPanelBody">
        <div className="filtersPanelList" data-testid="filters-panel-list">
          <FilterSection title={t("filterGroupWhat")}>
            {/* Ahead of Data Layers: it matches free text against dataset
                titles directly, rather than narrowing by facet, so it is the
                one row here that isn't picking from an options list — the
                same state the brand bar's search icon and the datasets list
                search box read and write (SelectionProvider). */}
            <Filter
              active={Boolean(datasetTitleSearchText)}
              badgeTitle={textSearchBadgeTitle}
              tooltip={t("textSearchFilterTooltip")}
              icon={<Search />}
              controlled
              searchable
              // Unlike the facet rows, this one's value re-queries the map, so
              // it goes on Enter or the magnifier rather than on a pause.
              searchOnSubmit
              searchTerms={datasetTitleSearchText}
              setSearchTerms={setDatasetTitleSearchText}
              searchPlaceholder={t("textSearchFilterPlaceholder")}
              filterName={textSearchFilterTranslationKey}
              openFilter={openFilter === textSearchFilterTranslationKey}
              setOpenFilter={setOpenFilter}
              resetButton={
                datasetTitleSearchText
                  ? () => setDatasetTitleSearchText("")
                  : undefined
              }
            />
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
              active={eovsSelected.filter((eov) => eov.isSelected).length !== 0}
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
              <MultiCheckboxFilter
                optionsSelected={createOptionSubset(
                  eovsSearchTerms,
                  eovsSelected,
                )}
                setOptionsSelected={setEovsSelected}
                searchable
                translatable
                allOptions={eovsSelected}
              />
            </Filter>
            <Filter
              active={
                platformsSelected.filter((eov) => eov.isSelected).length !== 0
              }
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
              active={orgsSelected.filter((eov) => eov.isSelected).length !== 0}
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
              <MultiCheckboxFilter
                optionsSelected={createOptionSubset(
                  orgsSearchTerms,
                  orgsSelected,
                )}
                setOptionsSelected={setOrgsSelected}
                searchable
                allOptions={orgsSelected}
              />
            </Filter>
            <Filter
              active={
                datasetsSelected.filter((eov) => eov.isSelected).length !== 0
              }
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
                )}
                setOptionsSelected={setDatasetsSelected}
                searchable
                allOptions={datasetsSelected}
                translatable
              />
            </Filter>
            <Filter
              active={anyServersSelected || anyObisNodesSelected}
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
              icon={<BoundingBox />}
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
                active={scientificNamesSelected.length > 0}
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
                  scientificNamesSelected.length > 0
                    ? () => setScientificNamesSelected([])
                    : undefined
                }
              >
                <ScientificNameFilter
                  scientificNamesSelected={scientificNamesSelected}
                  setScientificNamesSelected={setScientificNamesSelected}
                  searchTerms={scientificNameSearchTerms}
                />
              </Filter>
            </FilterSection>
          )}
        </div>
        {!openFilter && (
          <div className="filtersPanelPlaceholder">
            <span className="filtersPanelPlaceholderIcon" aria-hidden="true">
              <Funnel size={22} />
            </span>
            <p className="filtersPanelPlaceholderTitle">
              {t("filtersPanelHintTitle")}
            </p>
            <p className="filtersPanelPlaceholderText">
              {t("filtersPanelHint")}
            </p>
            <ul className="filtersPanelPlaceholderSteps">
              {PLACEHOLDER_STEPS.map(({ key, Icon }) => (
                <li key={key}>
                  <Icon size={16} aria-hidden="true" />
                  <span>{t(`filtersPanelHintStep_${key}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {/* Filters apply live, so there is nothing to confirm here — but the
          dialog covers the map at every width and takes the whole screen on a
          phone, so the one thing it owes the user is the number they are
          filtering towards. Reset sits beside it because it is the other thing
          you do to the whole set, rather than at the end of a list that has to
          be scrolled past to reach it. */}
      <div className="filtersPanelFooter">
        <span
          className={classNames("filtersPanelCount", {
            updating: countsUpdating,
          })}
          title={
            countsReady
              ? t("dockDatasetsCountTitle", {
                  filtered: filteredCount,
                  total: totalCount,
                })
              : t("datasetsCountLoadingTitle")
          }
        >
          {countsReady ? (
            t("topBarCountsSummary", {
              filtered: filteredCount,
              total: totalCount,
            })
          ) : (
            <Spinner size="xs" className="countSpinner" />
          )}
        </span>
        <button
          type="button"
          className="filtersPanelReset"
          onClick={resetEverything}
          title={t("resetFiltersButtonTooltipText")}
        >
          {t("filtersPanelResetAll")}
        </button>
      </div>
    </div>
  );
}
