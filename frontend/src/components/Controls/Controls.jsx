import * as React from 'react'
import { useState } from 'react'
import PropTypes from 'prop-types'
import { Container, Row, Col } from 'react-bootstrap'
import _ from 'lodash'

import Filter from './Filter/Filter.jsx'
import MultiCheckboxFilter from './Filter/MultiCheckboxFilter.jsx'
import TimeSelector from '../OldControls/TimeSelector/TimeSelector.jsx'
import DepthSelector from '../OldControls/DepthSelector/DepthSelector.jsx'
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
  const [startDate, setStartDate] = useState('1900-01-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Depth filter initial values and state
  const [startDepth, setStartDepth] = useState(0)
  const [endDepth, setEndDepth] = useState(12000)

  return (
    <div className='controls'>
      <Container fluid>
        <Row>
          <Col xs='auto'>
            <Filter
              badgeTitle={generateMultipleSelectBadgeTitle('Ocean Variables', eovsSelected)}
              optionsSelected={eovsSelected}
              setOptionsSelected={setEovsSelected}
            >
              <MultiCheckboxFilter optionsSelected={eovsSelected} setOptionsSelected={setEovsSelected} />
            </Filter>
          </Col>
          <Col xs='auto'>
            <Filter
              badgeTitle={generateMultipleSelectBadgeTitle('Organizations', orgsSelected)}
              optionsSelected={orgsSelected}
              setOptionsSelected={setOrgsSelected}
            >
              <MultiCheckboxFilter optionsSelected={orgsSelected} setOptionsSelected={setOrgsSelected} />
            </Filter>
          </Col>
          <Col xs='auto'>
            <Filter
              badgeTitle={generateRangeSelectBadgeTitle('Timeframe', [startDate, endDate])}
              optionsSelected={startDate, endDate}
              setOptionsSelected={() => { setStartDate('1900-01-01'); setEndDate(new Date().toISOString().split('T')[0]) }}
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
              badgeTitle={generateRangeSelectBadgeTitle('Depth Range', [startDepth, endDepth])}
              optionsSelected={startDepth, endDepth}
              setOptionsSelected={() => { setStartDepth(0); setEndDepth(12000) }}
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
