import * as React from 'react'
import { useState } from 'react'
import PropTypes from 'prop-types'
import { Container, Row, Col } from 'react-bootstrap'
import _ from 'lodash'

import Filter from './Filter/Filter.jsx'
import MultiCheckboxFilter from './Filter/MultiCheckboxFilter.jsx'
import TimeSelector from './Filter/TimeSelector/TimeSelector.jsx'
import DepthSelector from './Filter/DepthSelector/DepthSelector.jsx'
import { generateMultipleSelectBadgeTitle, generateRangeSelectBadgeTitle } from '../../utilities.js'
import { server } from '../../config'

import './styles.css'
import { useEffect } from 'react'

export default function Controls(props) {

  // Making changes to context within context consumers (ie. passing mutable state down to children to manipulate)
  //https://stackoverflow.com/questions/41030361/how-to-update-react-context-from-inside-a-child-component

  // EOV filter initial values and state
  const [eovsSelected, setEovsSelected] = useState(
    {
      carbon: false,
      currents: false,
      nutrients: false,
      salinity: false,
      temperature: false,
    })

  // Organization filter initial values from API and state
  const [orgsSelected, setOrgsSelected] = useState({})
  useEffect(() => {
    fetch(`${server}/organizations`).then(response => response.json()).then(data => {
      let orgsReturned = {}
      data.forEach(elem => {
        orgsReturned[elem.name] = false
      })
      setOrgsSelected(orgsReturned)
      // setOrgs(orgsReturned)
    }).catch(error => { throw error })
  }, [])

  // Timeframe filter initial values and state
  const defaultStartDate = '1900-01-01'
  const defaultEndDate = new Date().toISOString().split('T')[0]
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);

  // Depth filter initial values and state
  const defaultStartDepth = 0
  const defaultEndDepth = 12000
  const [startDepth, setStartDepth] = useState(defaultStartDepth)
  const [endDepth, setEndDepth] = useState(defaultEndDepth)

  return (
    <div className='controls'>
      <Container fluid>
        <Row>
          <Col xs='auto'>
            <Filter
              badgeTitle={generateMultipleSelectBadgeTitle('Ocean Variables', eovsSelected)}
              optionsSelected={eovsSelected}
              setOptionsSelected={setEovsSelected}
              tooltip='Filter data by ocean variable name. Selection works as logical OR operation.'
            >
              <MultiCheckboxFilter optionsSelected={eovsSelected} setOptionsSelected={setEovsSelected} />
            </Filter>
          </Col>
          <Col xs='auto'>
            <Filter
              badgeTitle={generateMultipleSelectBadgeTitle('Organizations', orgsSelected)}
              optionsSelected={orgsSelected}
              setOptionsSelected={setOrgsSelected}
              tooltip='Filter data by responsible organisation name. Selection works as logical OR operation.'
            >
              <MultiCheckboxFilter optionsSelected={orgsSelected} setOptionsSelected={setOrgsSelected} />
            </Filter>
          </Col>
          <Col xs='auto'>
            <Filter
              badgeTitle={generateRangeSelectBadgeTitle('Timeframe', [startDate, endDate], [defaultStartDate, defaultEndDate])}
              optionsSelected={startDate, endDate}
              setOptionsSelected={() => { setStartDate('1900-01-01'); setEndDate(new Date().toISOString().split('T')[0]) }}
              tooltip='Filter data by timeframe. Selection works as inclusive range.'
            >
              <TimeSelector
                startDate={startDate}
                setStartDate={setStartDate}
                endDate={endDate}
                setEndDate={setEndDate}
              />
            </Filter>
          </Col>
          <Col xs='auto'>
            <Filter
              badgeTitle={generateRangeSelectBadgeTitle('Depth Range (m)', [startDepth, endDepth], [defaultStartDepth, defaultEndDepth])}
              optionsSelected={startDepth, endDepth}
              setOptionsSelected={() => { setStartDepth(0); setEndDepth(12000) }}
              tooltip='Filter data by depth. Selection works as inclusive range, and negative values are meters above ocean surface.'
            >
              <DepthSelector
                startDepth={startDepth}
                setStartDepth={setStartDepth}
                endDepth={endDepth}
                setEndDepth={setEndDepth}
              />
            </Filter>
          </Col>
        </Row>
      </Container>
    </div >
  )
}

Controls.propTypes = {
  map: PropTypes.object.isRequired
}
