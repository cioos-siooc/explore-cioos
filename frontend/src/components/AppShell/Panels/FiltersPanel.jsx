import * as React from 'react'
import {
  ArrowsExpand,
  BoundingBox,
  Building,
  CalendarWeek,
  FileEarmarkSpreadsheet,
  Water,
  BroadcastPin,
  Server
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import Filter from '../../Controls/Filter/Filter.jsx'
import FilterSection from '../../Controls/Filter/FilterMenu/FilterSection.jsx'
import MultiCheckboxFilter from '../../Controls/Filter/MultiCheckboxFilter/MultiCheckboxFilter.jsx'
import SourceFilter from '../../Controls/Filter/SourceFilter/SourceFilter.jsx'
import ScientificNameFilter from '../../Controls/Filter/ScientificNameFilter/ScientificNameFilter.jsx'
import TimeSelector from '../../Controls/Filter/TimeSelector/TimeSelector.jsx'
import DepthSelector from '../../Controls/Filter/DepthSelector/DepthSelector.jsx'
import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth
} from '../../config.js'
import {
  capitalizeFirstLetter,
  generateMultipleSelectBadgeTitle,
  generateRangeSelectBadgeTitle,
  setAllOptionsIsSelectedTo
} from '../../../utilities.jsx'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

function createOptionSubset (searchTerms, allOptions) {
  if (searchTerms) {
    return allOptions.filter((option) =>
      option.title.toLowerCase().includes(searchTerms.toString().toLowerCase())
    )
  } else {
    return allOptions
  }
}

// The Filters panel: filter rows grouped into sections on the left, with the
// open filter's options in the detail pane on the right (see styles.css —
// the .filterOptions flyout is re-anchored inside the sheet).
export default function FiltersPanel () {
  const { t } = useTranslation()
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
    timeFilterActive,
    depthFilterActive,
    anyServersSelected,
    anyObisNodesSelected,
    allObisNodesSelected,
    showObis,
    obisDataAvailable,
    resetFilters
  } = useFilters()
  const {
    setPolygon,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView,
    inViewCount
  } = useSelection()
  const { openFilter, setOpenFilter } = useUI()

  const inViewFilterName = t('datasetsCardOnlyInViewText')

  const eovsFilterTranslationKey = 'oceanVariablesFiltername'
  const eovsBadgeTitle = generateMultipleSelectBadgeTitle(
    eovsFilterTranslationKey,
    eovsSelected
  )
  const orgsFilterTranslationKey = 'organizationFilterName'
  const orgsBadgeTitle = generateMultipleSelectBadgeTitle(
    orgsFilterTranslationKey,
    orgsSelected
  )
  const datasetsFilterTranslationKey = 'datasetsFilterName'
  const datasetsBadgeTitle = generateMultipleSelectBadgeTitle(
    datasetsFilterTranslationKey,
    datasetsSelected
  )
  const platformsFilterTranslationKey = 'platformsFilterName'
  const platformsBadgeTitle = generateMultipleSelectBadgeTitle(
    platformsFilterTranslationKey,
    platformsSelected
  )
  const sourcesFilterTranslationKey = 'sourceFilterName'

  const sourcesBadgeTitle = (() => {
    const selectedTitles = [
      ...erddapServersSelected.filter((s) => s.isSelected).map((s) => s.title),
      // a fully selected OBIS group reads as one source
      ...(allObisNodesSelected
        ? ['OBIS']
        : obisNodesSelected.filter((n) => n.isSelected).map((n) => n.title))
    ]
    if (selectedTitles.length === 0) return t(sourcesFilterTranslationKey)
    if (selectedTitles.length === 1) {
      return capitalizeFirstLetter(selectedTitles[0])
    }
    return selectedTitles.length + t('sourcesMulti')
  })()

  const timeframesFilterName = t('timeframeFilterName')
  const timeframesBadgeTitle = generateRangeSelectBadgeTitle(
    timeframesFilterName,
    [startDate, endDate],
    [defaultStartDate, defaultEndDate]
  )
  const depthRangeFilterName = t('depthRangeFilterName')
  const depthRangeBadgeTitle = generateRangeSelectBadgeTitle(
    depthRangeFilterName,
    [startDepth, endDepth],
    [defaultStartDepth, defaultEndDepth],
    '(m)'
  )

  return (
    <div className='filtersPanel'>
      <div className='filtersPanelList'>
        <FilterSection title={t('filterGroupWhat')}>
          <Filter
            active={eovsSelected.filter((eov) => eov.isSelected).length !== 0}
            badgeTitle={eovsBadgeTitle}
            optionsSelected={eovsSelected}
            setOptionsSelected={setEovsSelected}
            tooltip={t('oceanVariableFilterTooltip')}
            icon={<Water />}
            controlled
            searchable
            searchTerms={eovsSearchTerms}
            setSearchTerms={setEovsSearchTerms}
            searchPlaceholder={t('oceanVariableFilterSeachPlaceholder')}
            filterName={eovsFilterTranslationKey}
            openFilter={openFilter === eovsFilterTranslationKey}
            setOpenFilter={setOpenFilter}
            selectAllButton={() =>
              setAllOptionsIsSelectedTo(true, eovsSelected, setEovsSelected)
            }
            resetButton={() =>
              setAllOptionsIsSelectedTo(false, eovsSelected, setEovsSelected)
            }
            numberOfOptions={eovsSelected.length}
          >
            <MultiCheckboxFilter
              optionsSelected={createOptionSubset(eovsSearchTerms, eovsSelected)}
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
            tooltip={t('platformFilterTooltip')}
            icon={<BroadcastPin />}
            controlled
            searchable
            searchTerms={platformsSearchTerms}
            setSearchTerms={setPlatformsSearchTerms}
            searchPlaceholder={t('platformsFilterSeachPlaceholder')}
            filterName={platformsFilterTranslationKey}
            openFilter={openFilter === platformsFilterTranslationKey}
            setOpenFilter={setOpenFilter}
            selectAllButton={() =>
              setAllOptionsIsSelectedTo(
                true,
                platformsSelected,
                setPlatformsSelected
              )
            }
            resetButton={() =>
              setAllOptionsIsSelectedTo(
                false,
                platformsSelected,
                setPlatformsSelected
              )
            }
            numberOfOptions={platformsSelected.length}
            infoButton='http://vocab.nerc.ac.uk/collection/L06/current/'
          >
            <MultiCheckboxFilter
              optionsSelected={createOptionSubset(
                platformsSearchTerms,
                platformsSelected
              )}
              setOptionsSelected={setPlatformsSelected}
              searchable
              colored
              translatable
              allOptions={platformsSelected}
            />
          </Filter>
        </FilterSection>
        <FilterSection title={t('filterGroupFrom')}>
          <Filter
            active={orgsSelected.filter((eov) => eov.isSelected).length !== 0}
            badgeTitle={orgsBadgeTitle}
            optionsSelected={orgsSelected}
            setOptionsSelected={setOrgsSelected}
            tooltip={t('organizationFilterTooltip')}
            icon={<Building />}
            controlled
            searchable
            searchTerms={orgsSearchTerms}
            setSearchTerms={setOrgsSearchTerms}
            searchPlaceholder={t('organizationFilterSearchPlaceholder')}
            filterName={orgsFilterTranslationKey}
            openFilter={openFilter === orgsFilterTranslationKey}
            setOpenFilter={setOpenFilter}
            selectAllButton={() =>
              setAllOptionsIsSelectedTo(true, orgsSelected, setOrgsSelected)
            }
            resetButton={() =>
              setAllOptionsIsSelectedTo(false, orgsSelected, setOrgsSelected)
            }
            numberOfOptions={orgsSelected.length}
          >
            <MultiCheckboxFilter
              optionsSelected={createOptionSubset(orgsSearchTerms, orgsSelected)}
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
            tooltip={t('datasetFilterTooltip')}
            icon={<FileEarmarkSpreadsheet />}
            controlled
            searchable
            searchTerms={datasetSearchTerms}
            setSearchTerms={setDatasetSearchTerms}
            searchPlaceholder={t('datasetSearchPlaceholder')}
            filterName={datasetsFilterTranslationKey}
            openFilter={openFilter === datasetsFilterTranslationKey}
            setOpenFilter={setOpenFilter}
            selectAllButton={() =>
              setAllOptionsIsSelectedTo(
                true,
                datasetsSelected,
                setDatasetsSelected
              )
            }
            resetButton={() =>
              setAllOptionsIsSelectedTo(
                false,
                datasetsSelected,
                setDatasetsSelected
              )
            }
            numberOfOptions={datasetsSelected.length}
          >
            <MultiCheckboxFilter
              optionsSelected={createOptionSubset(
                datasetSearchTerms,
                datasetsSelected
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
            tooltip={t('sourceFilterTooltip')}
            icon={<Server />}
            controlled
            searchable
            searchTerms={sourcesSearchTerms}
            setSearchTerms={setSourcesSearchTerms}
            searchPlaceholder={t('sourceFilterSearchPlaceholder')}
            filterName={sourcesFilterTranslationKey}
            openFilter={openFilter === sourcesFilterTranslationKey}
            setOpenFilter={setOpenFilter}
            selectAllButton={() => {
              setAllOptionsIsSelectedTo(
                true,
                erddapServersSelected,
                setErddapServersSelected
              )
              setAllOptionsIsSelectedTo(
                true,
                obisNodesSelected,
                setObisNodesSelected
              )
            }}
            resetButton={() => {
              setAllOptionsIsSelectedTo(
                false,
                erddapServersSelected,
                setErddapServersSelected
              )
              setAllOptionsIsSelectedTo(
                false,
                obisNodesSelected,
                setObisNodesSelected
              )
            }}
            numberOfOptions={
              erddapServersSelected.length + obisNodesSelected.length
            }
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
        <FilterSection title={t('filterGroupWhenWhere')}>
          <Filter
            active={timeFilterActive}
            badgeTitle={timeframesBadgeTitle}
            setOptionsSelected={() => {
              setStartDate(defaultStartDate)
              setEndDate(defaultEndDate)
            }}
            tooltip={t('timeframeFilterTooltip')}
            icon={<CalendarWeek />}
            controlled
            filterName={timeframesFilterName}
            openFilter={openFilter === timeframesFilterName}
            setOpenFilter={setOpenFilter}
            resetButton={() => {
              setStartDate(defaultStartDate)
              setEndDate(defaultEndDate)
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
              setStartDepth(defaultStartDepth)
              setEndDepth(defaultEndDepth)
            }}
            tooltip={t('depthrangeFilterTooltip')}
            icon={<ArrowsExpand />}
            controlled
            filterName={depthRangeFilterName}
            openFilter={openFilter === depthRangeFilterName}
            setOpenFilter={setOpenFilter}
            resetButton={() => {
              setStartDepth(defaultStartDepth)
              setEndDepth(defaultEndDepth)
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
            active={onlyInView}
            badgeTitle={t('datasetsCardOnlyInViewText')}
            tooltip={t('datasetsCardOnlyInViewTitle')}
            icon={<BoundingBox />}
            controlled
            filterName={inViewFilterName}
            openFilter={openFilter === inViewFilterName}
            setOpenFilter={setOpenFilter}
            resetButton={onlyInView ? () => setOnlyInView(false) : undefined}
          >
            <label className='inViewFilterToggle'>
              <input
                type='checkbox'
                checked={onlyInView}
                onChange={(e) => setOnlyInView(e.target.checked)}
              />
              <span>{t('datasetsCardOnlyInViewTitle')}</span>
            </label>
            <div className='inViewFilterCount'>
              {t('datasetsCardInViewCountText', { count: inViewCount })}
            </div>
          </Filter>
        </FilterSection>
        {obisDataAvailable && (
          <FilterSection title={t('filterGroupBiodiversity')}>
            <ScientificNameFilter
              scientificNamesSelected={scientificNamesSelected}
              setScientificNamesSelected={setScientificNamesSelected}
              disabled={!showObis}
              disabledTooltip={t('scientificNameFilterDisabledTooltip')}
              tooltip={t('scientificNameFilterTooltip')}
              controlled
              openFilter={openFilter === 'scientificNameFilterName'}
              setOpenFilter={setOpenFilter}
              filterName='scientificNameFilterName'
              badgeTitle={t('scientificNameFilterName')}
              searchPlaceholder={t('scientificNameFilterSearchPlaceholder')}
            />
          </FilterSection>
        )}
        <button
          type='button'
          className='filtersPanelReset filterMenuReset'
          onClick={() => {
            resetFilters()
            setPolygon()
            setDatasetTitleSearchText('')
            setOnlyInView(false)
          }}
          title={t('resetFiltersButtonTooltipText')}
        >
          {t('resetButtonText')}
        </button>
      </div>
      {!openFilter && (
        <div className='filtersPanelPlaceholder'>
          {t('filtersPanelHint')}
        </div>
      )}
    </div>
  )
}
