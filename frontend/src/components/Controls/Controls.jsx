import * as React from 'react'
import {useState, useRef, useEffect} from 'react'
import PropTypes from 'prop-types'
import {Container, Row, Col, Accordion, Card, Button, InputGroup, OverlayTrigger, Tooltip} from 'react-bootstrap'
import classnames from 'classnames'
import { Check } from 'react-bootstrap-icons';

import TimeSelector from './TimeSelector/TimeSelector.jsx'
import DepthSelector from './DepthSelector/DepthSelector.jsx'
// import CIOOSMap from '../Map/Map.js'
import './styles.css'

export default function Controls(props) {
  const eovsToggleStart = {
    carbon: true,
    currents: true,
    nutrients: true,
    salinity: true,
    temperature: true,
  };

  const [eovsSelected, setEOVs] = useState(eovsToggleStart)

  const [fixedStations, setFixedStations] = useState(true)
  const [casts, setCasts] = useState(true)
  const [trajectories, setTrajectories] = useState(true)

  var startDateInit = new Date()
  startDateInit.setHours(0, 0, 0, 0)
  startDateInit.setDate(startDateInit.getDate() - 365*50)
  const [startDate, setStartDate] = useState(startDateInit);
  const [endDate, setEndDate] = useState(new Date());

  const [startDepth, setStartDepth] = useState(0)
  const [endDepth, setEndDepth] = useState(100)

  // UI state
  const [controlsClosed, setControlsClosed] = useState(false)
  const [email, setEmail] = useState('')
  const [querySubmitted, setQuerySubmitted] = useState(false)
  const [filterReady, setFilterReady] = useState(false)
  const [filterStatus, setFilterStatus] = useState('No new filters')
  const [numberOfPoints, setNumberOfPoints] = useState(999999)

  // Map
  const [polygonPresent, setPolygonPresent] = useState(false)
  // const [map, setMap] = useState(new CIOOSMap((value) => setPolygonPresent(value)))

  const [requestSubmitted, setRequestSubmitted] = useState(false)
  // const mapRefContainer = useRef(new CIOOSMap());
  
  const eovsSelectedArray = Object.entries(eovsSelected).filter(([eov,isSelected]) => isSelected).map(([eov,isSelected])=>eov).filter(e=>e);
  
  const query = {
    timeMin: startDate.getFullYear() + '-' + startDate.getMonth() + '-' + startDate.getDate(),
    timeMax: endDate.getFullYear() + '-' + endDate.getMonth() + '-' + endDate.getDate(),
    depthMin: startDepth,
    depthMax: endDepth,
    eovs: eovsSelectedArray,
    dataType: [casts && 'casts', fixedStations &&'fixedStations'].filter(e=>e),
  }
  
  function createPolygonQueryString () {
    console.log(props.map.getPolygon());
    query.polygon=JSON.stringify(props.map.getPolygon());

    return Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  }

  function createDataFilterQueryString () {
    return Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  } 

  function applyFilters() {
    console.log('filters applied')
  }

  useEffect(() => {
    setFilterStatus('Filters updated')
    if(props.map.getLoaded()){
      props.map.updateSource(createDataFilterQueryString())
    }
  }, [eovsSelected, fixedStations, casts, trajectories, startDate, endDate, startDepth, endDepth])

  useEffect(() => {
    if(props.map.getPolygon()) {
      console.log(`https://pac-dev2.cioos.org/ceda/download?${createPolygonQueryString()}`)
      fetch(`https://pac-dev2.cioos.org/ceda/download?${createPolygonQueryString()}`).then((value) => {
        console.log(value.ok)
      })
    }
    
  }, [querySubmitted])

  // useEffect(() => {
  //   console.log('polygonPresent:', polygonPresent)
  // }, [polygonPresent])

  const controlClassName = classnames('filterRow', 'mb-3', 'animate__animated', {'animate__slideOutRight': controlsClosed}, {'animate__slideInRight': !controlsClosed})
  return (
    <div className='controls'>
      <Container fluid>
        <Row>
          <Col style={{pointerEvents: 'none'}} xs={{span: 3, offset:9}}>
            <Row style={{pointerEvents: 'auto'}} className='controlRow'>
              <Col xs={{span: 5, offset: 0}}>
                <OverlayTrigger
                  key='left'
                  placement='top'
                  overlay={
                    <Tooltip id={`tooltip-left`}>
                      Email address
                    </Tooltip>
                  }
                >
                  <input value={email} onChange={(e) => props.setEmail(e.target.value)} placeholder='abc@gmail.com' className='emailInput'/>
                </OverlayTrigger>
              </Col>
              <Col  xs={{span: 6, offset: 0}}>
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
                    className='submitQueryButton' 
                    onClick={() => setQuerySubmitted(true)}
                    variant={querySubmitted ? 'success' : 'secondary'}
                    >
                    {querySubmitted ? 'Request Submitted' : 'Submit Request'}
                    {querySubmitted && <Check/>}
                  </Button>
                </OverlayTrigger>
              </Col>
              <Col xs={{ span: 1, offset: 0 }} className='mr-0 pr-0 pl-0'>
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
            <Row style={{pointerEvents: 'auto'}} className={controlClassName}>
              <Accordion defaultActiveKey="0" className='controlAccordion'>
                <Card>
                  <Card.Header>
                    <Accordion.Toggle as={Button} variant="link" eventKey="0">
                      Ocean Variables
                    </Accordion.Toggle>
                  </Card.Header>
                  <Accordion.Collapse eventKey="0">
                  <Card.Body style={{maxHeight:"300px",overflowY:"scroll"}}>
                      {Object.keys(eovsToggleStart).map(eov=>  (
                      <InputGroup key={eov} className="mb-3">
                        <InputGroup.Checkbox
                            checked={eovsSelected[eov]}
                            onChange={(e) => {
                                  console.log(e.target.value);
                                  setEOVs({...eovsSelected,
                                    [eov]:!eovsSelected[eov]
                                  })
                            }}
                            aria-label="Checkbox for following text input"
                          />
                        <label>{eov}</label>
                      </InputGroup>))
                      }
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
                      {/* <InputGroup className="mb-3">
                        <InputGroup.Checkbox 
                          checked={trajectories}
                          onChange={() => setTrajectories(!trajectories)}
                          aria-label="Checkbox for following text input" 
                        />
                        <label> Trajectories </label>
                      </InputGroup> */}
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
              <Col>
                <Row className='mb-3 mt-3'>
                  <Col xs={{span: 6, offset: 0}} >
                    Filter Status: <span className='filterStatus'>{filterStatus}</span>
                  </Col>
                  <Col xs={{span: 4, offset: 2}}>
                    <OverlayTrigger
                      key='left'
                      placement='top'
                      overlay={
                        <Tooltip id={`tooltip-left`}>
                          Apply Filters
                        </Tooltip>
                      }
                      >
                      <Button 
                        className='applyFiltersButton' 
                        onClick={() => applyFilters()}
                        variant={filterReady ? 'disabled' : 'primary'}
                        >
                          Apply Filters
                      </Button>
                    </OverlayTrigger>
                  </Col>
                </Row>
              </Col>
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