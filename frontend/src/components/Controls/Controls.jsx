import * as React from 'react'
import { useState } from 'react'
import PropTypes from 'prop-types'
import { Container, Row, Col } from 'react-bootstrap'

import Filter from './Filter/Filter.jsx'
import MultiCheckboxFilter from './Filter/MultiCheckboxFilter.jsx'
import { server } from '../../config'

import './styles.css'
import { useEffect } from 'react'

export default function Controls(props) {

  // Making changes to context within context consumers
  //https://stackoverflow.com/questions/41030361/how-to-update-react-context-from-inside-a-child-component

  // EOV filter initial values and state
  const eovsFilterInit = {
    carbon: false,
    currents: false,
    nutrients: false,
    salinity: false,
    temperature: false,
  }
  const [eovsSelected, setEovsSelected] = useState(eovsFilterInit)

  // Organization filter initial values from API and state
  const orgsFilterInit = {}
  const [orgsSelected, setOrgsSelected] = useState(orgsFilterInit)
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

  return (
    <div className='controls'>
      <Container fluid>
        <Row>
          <Col sm='auto'>
            <Filter badgeTitle='Ocean Variables' optionsSelected={eovsSelected} setOptionsSelected={setEovsSelected}>
              <MultiCheckboxFilter optionsSelected={eovsSelected} setOptionsSelected={setEovsSelected} />
            </Filter>
          </Col>
          <Col sm='auto'>
            <Filter badgeTitle='Organizations' optionsSelected={orgsSelected} setOptionsSelected={setOrgsSelected}>
              <MultiCheckboxFilter optionsSelected={orgsSelected} setOptionsSelected={setOrgsSelected} />
            </Filter>
          </Col>
          {/* <Col sm='auto'>
              <Filter badgeTitle='Timeframe' type='range' />
            </Col>
            <Col sm='auto'>
              <Filter badgeTitle='Depth Range' type='range' />
            </Col> */}
        </Row>
      </Container>
    </div >
  )
}

Controls.propTypes = {
  map: PropTypes.object.isRequired
}
