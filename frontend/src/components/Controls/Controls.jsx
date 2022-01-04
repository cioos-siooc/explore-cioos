import * as React from 'react'
import { useState } from 'react'
import PropTypes from 'prop-types'
import { Container, Row, Col } from 'react-bootstrap'

import Filter from './Filter/Filter.jsx'
import ControlsContext from './ControlsContext.js'
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

  // Context populated with all of the initalized state, and setters, for the controls
  const controlsContextValue = {
    // EOVs filter context
    eovsSelected,
    setEovsSelected,
    // Orgs filter context
    orgsSelected,
    setOrgsSelected
  }

  return (
    <div className='controls'>
      <ControlsContext.Provider value={controlsContextValue}>
        <Container fluid>
          <Row>
            <Col sm='auto'>
              <Filter badgeTitle='Ocean Variables' />
            </Col>
            <Col sm='auto'>
              <Filter badgeTitle='Organizations' />
            </Col>
          </Row>
        </Container>
      </ControlsContext.Provider>
    </div>
  )
}

Controls.propTypes = {
  map: PropTypes.object.isRequired
}
