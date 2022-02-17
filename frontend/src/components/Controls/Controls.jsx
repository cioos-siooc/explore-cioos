import * as React from 'react'
import { useState, useEffect } from 'react'
import { Container, Row, Col } from 'react-bootstrap'
import _ from 'lodash'

import Filter from './Filter/Filter.jsx'
import MultiCheckboxFilter from './Filter/MultiCheckboxFilter/MultiCheckboxFilter.jsx'
import TimeSelector from './Filter/TimeSelector/TimeSelector.jsx'
import DepthSelector from './Filter/DepthSelector/DepthSelector.jsx'
import { filterObjectPropertyByPropertyList, generateMultipleSelectBadgeTitle, generateRangeSelectBadgeTitle, useDebounce } from '../../utilities.js'
import { server } from '../../config'

import { ArrowsExpand, Building, CalendarWeek, FileEarmarkSpreadsheet, Water } from 'react-bootstrap-icons'

import './styles.css'
import { defaultEovsSelected, defaultOrgsSelected, defaultStartDate, defaultEndDate, defaultStartDepth, defaultEndDepth, defaultDatatsetsSelected } from '../config.js'
import { useLayoutEffect } from 'react'

export default function Controls({ setQuery, organizations, children }) {

  // Making changes to context within context consumers (ie. passing mutable state down to children to manipulate)
  //https://stackoverflow.com/questions/41030361/how-to-update-react-context-from-inside-a-child-component

  // EOV filter initial values and state
  const [eovsSelected, setEovsSelected] = useState(defaultEovsSelected)
  const eovsFilterName = 'Ocean Variables'
  const eovsBadgeTitle = generateMultipleSelectBadgeTitle(eovsFilterName, eovsSelected)

  // Organization filter initial values from API and state
  const [orgsSelected, setOrgsSelected] = useState(defaultOrgsSelected)
  useEffect(() => {
    fetch(`${server}/organizations`).then(response => response.json()).then(data => {
      let orgsReturned = {}
      data.forEach(elem => {
        orgsReturned[elem.name] = false
      })
      setOrgsSelected(orgsReturned)
    }).catch(error => { throw error })
  }, [])
  const orgsFilterName = 'Organizations'
  const orgsBadgeTitle = generateMultipleSelectBadgeTitle(orgsFilterName, orgsSelected)

  // Dataset filter initial values and state
  const [datasetsSelected, setDatasetsSelected] = useState(defaultDatatsetsSelected)
  const datasetsFilterName = 'Datasets'
  const datasetsBadgeTitle = generateMultipleSelectBadgeTitle(datasetsFilterName, datasetsSelected)
  const [datasetSearchTerms, setDatasetSearchTerms] = useState()
  const [datasetSubset, setDatasetSubset] = useState(datasetsSelected)

  // Bugs: updates are one step behind, applying search terms may need a apply or more likely a debounce

  // Create a subset of the datasetsSelected object to generate the subset that match the search
  useEffect(() => {
    // If there are search terms
    if (datasetSearchTerms) {
      // Get a list of the allowed datasets
      const allowedDatasets = Object.keys(datasetsSelected).filter(datasetName => datasetName.includes(datasetSearchTerms.toString().toLowerCase()))
      // Generate the subset of datasets
      const filteredDatasets = filterObjectPropertyByPropertyList(datasetsSelected, allowedDatasets)
      // Set the subset of datasets
      setDatasetSubset({ ...filteredDatasets })
    } else { // Else if there aren't search terms, set the subset to the whole set
      setDatasetSubset({ ...datasetsSelected })
    }
  }, [datasetSearchTerms])

  // Apply selections made within the subset to the full set
  useEffect(() => {
    // Make a copy of datasetsSelected
    let tempData = { ...datasetsSelected }
    // Go through each of the elements in the subset
    Object.keys(datasetSubset).forEach(dataset => {
      // Find the corresponding element in the total set and set its selection status
      tempData[dataset] = datasetSubset[dataset]
    })
    // Set the total set 
    setDatasetsSelected(tempData)
  }, [datasetSubset])

  // Timeframe filter initial values and state
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const timeframesFilterName = 'Timeframe'
  const timeframesBadgeTitle = generateRangeSelectBadgeTitle(timeframesFilterName, [startDate, endDate], [defaultStartDate, defaultEndDate])

  // Depth filter initial values and state
  const [startDepth, setStartDepth] = useState(defaultStartDepth)
  const debouncedStartDepth = useDebounce(startDepth, 500)
  const [endDepth, setEndDepth] = useState(defaultEndDepth)
  const debouncedEndDepth = useDebounce(endDepth, 500)
  const depthRangeFilterName = 'Depth Range (m)'
  const depthRangeBadgeTitle = generateRangeSelectBadgeTitle(depthRangeFilterName, [startDepth, endDepth], [defaultStartDepth, defaultEndDepth], '(m)')

  // Filter open state
  const [openFilter, setOpenFilter] = useState()

  // Update query 
  useEffect(() => {
    setQuery({
      startDate: startDate,
      endDate: endDate,
      startDepth: startDepth,
      endDepth: endDepth,
      eovsSelected: eovsSelected,
      orgsSelected: orgsSelected
    })
  }, [startDate, endDate, debouncedStartDepth, debouncedEndDepth, eovsSelected, orgsSelected])

  const childrenArray = React.Children.toArray(children)
  return (
    <div>
      <div className='controls'>
        <Container fluid>
          <Row>
            {childrenArray.length === 2 && childrenArray[0]}
            <Col className='controlColumn' >
              <Filter
                badgeTitle={eovsBadgeTitle}
                optionsSelected={eovsSelected}
                setOptionsSelected={setEovsSelected}
                tooltip='Filter data by ocean variable name. Selection works as logical OR operation.'
                icon={<Water />}
                controlled
                filterName={eovsFilterName}
                openFilter={openFilter === eovsFilterName}
                setOpenFilter={setOpenFilter}
              >
                <MultiCheckboxFilter optionsSelected={eovsSelected} setOptionsSelected={setEovsSelected} />
              </Filter>
              <Filter
                badgeTitle={orgsBadgeTitle}
                optionsSelected={orgsSelected}
                setOptionsSelected={setOrgsSelected}
                tooltip='Filter data by responsible organisation name. Selection works as logical OR operation.'
                icon={<Building />}
                controlled
                filterName={orgsFilterName}
                openFilter={openFilter === orgsFilterName}
                setOpenFilter={setOpenFilter}
              >
                <MultiCheckboxFilter optionsSelected={orgsSelected} setOptionsSelected={setOrgsSelected} />
              </Filter>
              <Filter
                badgeTitle={datasetsBadgeTitle}
                optionsSelected={datasetsSelected}
                setOptionsSelected={setDatasetsSelected}
                tooltip='Filter data by dataset name. Selection works as logical OR operation.'
                icon={<FileEarmarkSpreadsheet />}
                controlled
                searchable
                setSearchTerms={setDatasetSearchTerms}
                searchPlaceholder='Search for dataset name...'
                filterName={datasetsFilterName}
                openFilter={openFilter === datasetsFilterName}
                setOpenFilter={setOpenFilter}
              >
                <MultiCheckboxFilter optionsSelected={datasetSubset} setOptionsSelected={setDatasetSubset} />
              </Filter>
              <Filter
                badgeTitle={timeframesBadgeTitle}
                optionsSelected={startDate, endDate}
                setOptionsSelected={() => { setStartDate('1900-01-01'); setEndDate(new Date().toISOString().split('T')[0]) }}
                tooltip='Filter data by timeframe. Selection works as inclusive range.'
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
                tooltip='Filter data by depth. Selection works as inclusive range, and negative values are meters above ocean surface.'
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
    </div >
  )
}
