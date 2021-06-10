import * as React from 'react'
import {useState, useRef, useEffect} from 'react'
import PropTypes from 'prop-types'
import {Container, Row, Col, Accordion, Card, Button, InputGroup, OverlayTrigger, Tooltip} from 'react-bootstrap'
import classnames from 'classnames'
import { Check } from 'react-bootstrap-icons';

import TimeSelector from './TimeSelector/TimeSelector.jsx'
import DepthSelector from './DepthSelector/DepthSelector.jsx'
import CIOOSMap from '../Map/Map.js'
import './styles.css'

export default function Controls(props) {
  const [temperature, setTemperature] = useState(true)
  const [salinity, setSalinity] = useState(true)
  const [pressure, setPressure] = useState(true)
  const [oxygen, setOxygen] = useState(true)

  const [fixedStations, setFixedStations] = useState(true)
  const [casts, setCasts] = useState(true)
  const [trajectories, setTrajectories] = useState(true)

  var startDateInit = new Date()
  startDateInit.setHours(0, 0, 0, 0)
  startDateInit.setDate(startDateInit.getDate() - 365*20)
  const [startDate, setStartDate] = useState(startDateInit);
  const [endDate, setEndDate] = useState(new Date());

  const [startDepth, setStartDepth] = useState(0)
  const [endDepth, setEndDepth] = useState(100)

  const [controlsClosed, setControlsClosed] = useState(false)
  const [requestSubmitted, setRequestSubmitted] = useState(false)
  // const mapRefContainer = useRef(new CIOOSMap());
  
  useEffect(() => {
    console.log('isLoaded', props.map.getLoaded())
    if(props.map.getLoaded()){
      // if(props.map.getLayer('data-layer')) props.map.removeLayer('data-layer')
      const query = {
        timeMin: startDate.getFullYear() + '-' + startDate.getMonth() + '-' + startDate.getDate(),
        timeMax: endDate.getFullYear() + '-' + endDate.getMonth() + '-' + endDate.getDate(),
        eovs: [salinity && 'seaSurfaceSalinity', pressure && 'pressure', temperature && 'seaSurfaceTemeperature', oxygen && 'oxygen'].filter(elem => elem),
        // dataType: ''
      }
      console.log(query)
      props.map.addDataLayer(query)
    }
  }, [temperature, salinity, pressure, oxygen, fixedStations, casts, trajectories, startDate, endDate, startDepth, endDepth])

  const controlClassName = classnames('controlAccordion', 'mb-3', 'animate__animated', {'animate__slideOutRight': controlsClosed}, {'animate__slideInRight': !controlsClosed})
  return (
    <div className='controls'>
      <Container fluid>
        <Row>
          <Col style={{pointerEvents: 'none'}} xs={{span: 3, offset:9}}>
            <Row style={{pointerEvents: 'auto'}}>
              <Col xs={{ span: 6, offset: 5 }}>
                <OverlayTrigger
                  key='left'
                  placement='top'
                  overlay={
                    <Tooltip id={`tooltip-left`}>
                      Submit Request
                    </Tooltip>
                  }
                >
                  <Button 
                    className='toggleControlsOpenAndClosed' 
                    onClick={() => setRequestSubmitted(true)}
                    variant={requestSubmitted ? 'success' : 'secondary'}
                  >
                    {requestSubmitted ? 'Request Submitted' : 'Submit Request'}
                    {requestSubmitted && <Check/>}
                  </Button>
                </OverlayTrigger>
              </Col>
              <Col xs={{ span: 1, offset: 0 }} className='mr-0 pr-0'>
                <OverlayTrigger
                  key='left'
                  placement='top'
                  overlay={
                    <Tooltip id={`tooltip-left`}>
                      {controlsClosed ? 'Open' : 'Close'} Controls
                    </Tooltip>
                  }
                >
                  <Button 
                    className='toggleControlsOpenAndClosed' 
                    onClick={() => setControlsClosed(!controlsClosed)}
                  >
                    {controlsClosed ? '<' : '>'}
                  </Button>
                </OverlayTrigger>
              </Col>
            </Row>
            <Row style={{pointerEvents: 'auto'}}>
              <Accordion defaultActiveKey="0" className={controlClassName}>
                <Card>
                  <Card.Header>
                    <Accordion.Toggle as={Button} variant="link" eventKey="0">
                      Ocean Variables
                    </Accordion.Toggle>
                  </Card.Header>
                  <Accordion.Collapse eventKey="0">
                    <Card.Body>
                    <InputGroup className="mb-3">
                          <InputGroup.Checkbox 
                            checked={temperature}
                            onChange={() => setTemperature(!temperature)}
                            aria-label="Checkbox for following text input"
                          />
                        <label> Temperature </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox 
                          checked={salinity}
                          onChange={() => setSalinity(!salinity)}
                          aria-label="Checkbox for following text input" 
                        />
                        <label> Salinity </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox 
                          checked={pressure}
                          onChange={() => setPressure(!pressure)}
                          aria-label="Checkbox for following text input" 
                        />
                        <label> Pressure </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox 
                          checked={oxygen}
                          onChange={() => setOxygen(!oxygen)}
                          aria-label="Checkbox for following text input" 
                        />
                        <label> Oxygen </label>
                      </InputGroup>
                    </Card.Body>
                  </Accordion.Collapse>
                </Card>
                <Card>
                  <Card.Header>
                    <Accordion.Toggle as={Button} variant="link" eventKey="1">
                      Data Source Types
                    </Accordion.Toggle>
                  </Card.Header>
                  <Accordion.Collapse eventKey="1">
                    <Card.Body>
                    <InputGroup className="mb-3">
                          <InputGroup.Checkbox 
                            checked={fixedStations}
                            onChange={() => setFixedStations(!fixedStations)}
                            aria-label="Checkbox for following text input"
                          />
                        <label> Fixed Stations </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox 
                          checked={casts}
                          onChange={() => setCasts(!casts)}
                          aria-label="Checkbox for following text input" 
                        />
                        <label> Casts </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox 
                          checked={trajectories}
                          onChange={() => setTrajectories(!trajectories)}
                          aria-label="Checkbox for following text input" 
                        />
                        <label> Trajectories </label>
                      </InputGroup>
                    </Card.Body>
                  </Accordion.Collapse>
                </Card>
                <Card>
                  <Card.Header>
                    <Accordion.Toggle as={Button} variant="link" eventKey="2">
                    Timeframe and Depth Range
                    </Accordion.Toggle>
                  </Card.Header>
                  <Accordion.Collapse eventKey="2">
                    <Card.Body>
                      <InputGroup className="mb-3">
                        <TimeSelector
                          startDate={startDate}
                          setStartDate={setStartDate}
                          endDate={endDate}
                          setEndDate={setEndDate}
                        />
                      </InputGroup>
                      <hr></hr>
                      <InputGroup className="mb-3">
                        <DepthSelector
                          startDepth={startDepth}
                          setStartDepth={setStartDepth}
                          endDepth={endDepth}
                          setEndDepth={setEndDepth}
                        />
                      </InputGroup>
                    </Card.Body>
                  </Accordion.Collapse>
                </Card>
              </Accordion>
            </Row>
          </Col>
        </Row>
      </Container>
    </div>
  )
} 

Controls.propTypes = {
  map: PropTypes.object.isRequired
}