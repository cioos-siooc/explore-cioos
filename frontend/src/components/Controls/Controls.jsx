import * as React from 'react'
import { useState, useEffect } from 'react'
import { Container, Row, Col } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import Filter from './Filter/Filter.jsx'
import MultiCheckboxFilter from './Filter/MultiCheckboxFilter/MultiCheckboxFilter.jsx'
import TimeSelector from './Filter/TimeSelector/TimeSelector.jsx'
import DepthSelector from './Filter/DepthSelector/DepthSelector.jsx'
import { generateMultipleSelectBadgeTitle, generateRangeSelectBadgeTitle, useDebounce } from '../../utilities.js'

import { ArrowsExpand, Building, CalendarWeek, FileEarmarkSpreadsheet, Water } from 'react-bootstrap-icons'

import './styles.css'
import { defaultStartDate, defaultEndDate, defaultStartDepth, defaultEndDepth } from '../config.js'

export default function Controls({ eovs, orgs, datasets, setQuery, loading, children }) {
  const { t } = useTranslation()

  // Making changes to context within context consumers (ie. passing mutable state down to children to manipulate)
  //https://stackoverflow.com/questions/41030361/how-to-update-react-context-from-inside-a-child-component

  // EOV filter initial values and state
  const [eovsSelected, setEovsSelected] = useState(eovs)
  const debouncedEovsSelected = useDebounce(eovsSelected, 500)
  const eovsFilterTranslationKey = 'oceanVariablesFiltername' //'Ocean Variables'
  const eovsBadgeTitle = generateMultipleSelectBadgeTitle(eovsFilterTranslationKey, eovsSelected)
  const [eovsSearchTerms, setEovsSearchTerms] = useState('')

  // Organization filter initial values from API and state
  const [orgsSelected, setOrgsSelected] = useState(orgs)
  const debouncedOrgsSelected = useDebounce(orgsSelected, 500)
  const orgsFilterTranslationKey = "organizationFilterName" //'Organizations'
  const orgsBadgeTitle = generateMultipleSelectBadgeTitle(orgsFilterTranslationKey, orgsSelected)
  const [orgsSearchTerms, setOrgsSearchTerms] = useState('')

  // Dataset filter initial values and state
  const [datasetsSelected, setDatasetsSelected] = useState(datasets)
  const debouncedDatasetsSelected = useDebounce(datasetsSelected, 500)
  const datasetsFilterTranslationKey = 'datasetsFilterName' //'Datasets'
  const datasetsBadgeTitle = generateMultipleSelectBadgeTitle(datasetsFilterTranslationKey, datasetsSelected)
  const [datasetSearchTerms, setDatasetSearchTerms] = useState('')

  // Timeframe filter initial values and state
  const [startDate, setStartDate] = useState(defaultStartDate)
  const debouncedStartDate = useDebounce(startDate, 500)
  const [endDate, setEndDate] = useState(defaultEndDate)
  const debouncedEndDate = useDebounce(endDate, 500)
  const timeframesFilterName = t('timeframeFilterName') //'Timeframe'
  const timeframesBadgeTitle = generateRangeSelectBadgeTitle(timeframesFilterName, [startDate, endDate], [defaultStartDate, defaultEndDate])

  // Depth filter initial values and state
  const [startDepth, setStartDepth] = useState(defaultStartDepth)
  const debouncedStartDepth = useDebounce(startDepth, 500)
  const [endDepth, setEndDepth] = useState(defaultEndDepth)
  const debouncedEndDepth = useDebounce(endDepth, 500)
  const depthRangeFilterName = t('depthRangeFilterName') //'Depth Range (m)'
  const depthRangeBadgeTitle = generateRangeSelectBadgeTitle(depthRangeFilterName, [startDepth, endDepth], [defaultStartDepth, defaultEndDepth], '(m)')

  // Filter open state
  const [openFilter, setOpenFilter] = useState()

  // TODO: consider adding a 'searched' property to the options to indicate whether they satisfy the search terms, 
  // and removing the extra concept of 'allOptions' vs 'selectedOptions'

  useEffect(() => {
    setEovsSelected(eovs)
    setDatasetsSelected(datasets)
    setOrgsSelected(orgs)
  }, [eovs, datasets, orgs])

  // Update query 
  useEffect(() => {
    setQuery({
      startDate: startDate,
      endDate: endDate,
      startDepth: startDepth,
      endDepth: endDepth,
      eovsSelected: eovsSelected,
      orgsSelected: orgsSelected,
      datasetsSelected: datasetsSelected
    })
  }, [debouncedStartDate, debouncedEndDate, debouncedStartDepth, debouncedEndDepth, debouncedEovsSelected, debouncedOrgsSelected, debouncedDatasetsSelected])

  const childrenArray = React.Children.toArray(children)

  function createOptionSubset(searchTerms, allOptions) {
    if (searchTerms) {
      return allOptions.filter(option => option.title.toLowerCase().includes(searchTerms.toString().toLowerCase()))
    } else {
      return allOptions
    }
  }

  return (
    <div className={`controls ${loading === true && 'disabled'}`}>
      <Container fluid>
        <Row>
          {childrenArray.length === 2 && childrenArray[0]}
          <Col className='controlColumn' >
            <Filter
              badgeTitle={eovsBadgeTitle}
              optionsSelected={eovsSelected}
              setOptionsSelected={setEovsSelected}
              tooltip={t('oceanVariableFilterTooltip')} //'Filter data by ocean variable name. Selection works as logical OR operation.'
              icon={<Water />}
              controlled
              searchable
              searchTerms={eovsSearchTerms}
              setSearchTerms={setEovsSearchTerms}
              searchPlaceholder={t('oceanVariableFilterSeachPlaceholder')} //'Search for ocean variable name...'
              searchResults={createOptionSubset(eovsSearchTerms, eovsSelected)}
              filterName={eovsFilterTranslationKey}
              openFilter={openFilter === eovsFilterTranslationKey}
              setOpenFilter={setOpenFilter}
            >
              <MultiCheckboxFilter
                optionsSelected={createOptionSubset(eovsSearchTerms, eovsSelected)}
                setOptionsSelected={setEovsSelected}
                searchable
                allOptions={eovsSelected}
              />
            </Filter>
            <Filter
              badgeTitle={orgsBadgeTitle}
              optionsSelected={orgsSelected}
              setOptionsSelected={setOrgsSelected}
              tooltip={t('organizationFilterTooltip')} //'Filter data by responsible organisation name. Selection works as logical OR operation.'
              icon={<Building />}
              controlled
              searchable
              searchTerms={orgsSearchTerms}
              setSearchTerms={setOrgsSearchTerms}
              searchPlaceholder={t('organizationFilterSearchPlaceholder')} //'Search for organization name...'
              searchResults={createOptionSubset(orgsSearchTerms, orgsSelected)}
              filterName={orgsFilterTranslationKey}
              openFilter={openFilter === orgsFilterTranslationKey}
              setOpenFilter={setOpenFilter}
            >
              <MultiCheckboxFilter
                optionsSelected={createOptionSubset(orgsSearchTerms, orgsSelected)}
                setOptionsSelected={setOrgsSelected}
                searchable
                allOptions={orgsSelected}
              />
            </Filter>
            <Filter
              badgeTitle={datasetsBadgeTitle}
              optionsSelected={datasetsSelected}
              setOptionsSelected={setDatasetsSelected}
              tooltip={t('datasetFilterTooltip')} //'Filter data by dataset name. Selection works as logical OR operation.'
              icon={<FileEarmarkSpreadsheet />}
              controlled
              searchable
              searchTerms={datasetSearchTerms}
              setSearchTerms={setDatasetSearchTerms}
              searchPlaceholder={t('datasetSearchPlaceholder')} // 'Search for dataset name...'
              searchResults={createOptionSubset(datasetSearchTerms, datasetsSelected)}
              filterName={datasetsFilterTranslationKey}
              openFilter={openFilter === datasetsFilterTranslationKey}
              setOpenFilter={setOpenFilter}
            >
              <MultiCheckboxFilter
                optionsSelected={createOptionSubset(datasetSearchTerms, datasetsSelected)}
                setOptionsSelected={setDatasetsSelected}
                searchable
                allOptions={datasetsSelected}
              />
            </Filter>
            <Filter
              badgeTitle={timeframesBadgeTitle}
              optionsSelected={startDate, endDate}
              setOptionsSelected={() => { setStartDate('1900-01-01'); setEndDate(new Date().toISOString().split('T')[0]) }}
              tooltip={t('timeframeFilterTooltip')} // 'Filter data by timeframe. Selection works as inclusive range.'
              icon={<CalendarWeek />}
              controlled
              filterName={timeframesFilterName}
              openFilter={openFilter === timeframesFilterName}
              setOpenFilter={setOpenFilter}
            >
              <TimeSelector
                startDate={startDate}
                setStartDate={setStartDate}
                endDate={endDate}
                setEndDate={setEndDate}
              />
            </Filter>
            <Filter
              badgeTitle={depthRangeBadgeTitle}
              optionsSelected={startDepth, endDepth}
              setOptionsSelected={() => { setStartDepth(0); setEndDepth(12000) }}
              tooltip={t('depthrangeFilterTooltip')} // 'Filter data by depth. Selection works as inclusive range.'
              icon={<ArrowsExpand />}
              controlled
              filterName={depthRangeFilterName}
              openFilter={openFilter === depthRangeFilterName}
              setOpenFilter={setOpenFilter}
            >
              < DepthSelector
                startDepth={startDepth}
                setStartDepth={setStartDepth}
                endDepth={endDepth}
                setEndDepth={setEndDepth}
              />
            </Filter>
            {childrenArray.length === 2 ? childrenArray[1] : childrenArray[0]}
          </Col>
        </Row>
      </Container>
    </div >
  )
}
