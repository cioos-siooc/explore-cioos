import * as React from 'react'
import {useState, useRef, useEffect} from 'react'
import PropTypes from 'prop-types'
import {Container, Row, Col, Accordion, Card, Button, InputGroup, OverlayTrigger, Tooltip} from 'react-bootstrap'
import classnames from 'classnames'
import { ChevronCompactLeft, ChevronCompactRight } from 'react-bootstrap-icons'

import TimeSelector from './TimeSelector/TimeSelector.jsx'
import DepthSelector from './DepthSelector/DepthSelector.jsx'
import './styles.css'

export default function Controls(props) {
  const isMounted = useRef(false)

  // Filters
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

  const eovsSelectedArray = Object.entries(eovsSelected).filter(([eov,isSelected]) => isSelected).map(([eov,isSelected])=>eov).filter(e=>e);
  
  const query = {
    timeMin: startDate.getFullYear() + '-' + startDate.getMonth() + '-' + startDate.getDate(),
    timeMax: endDate.getFullYear() + '-' + endDate.getMonth() + '-' + endDate.getDate(),
    depthMin: startDepth,
    depthMax: endDepth,
    eovs: eovsSelectedArray,
    dataType: [casts && 'casts', fixedStations &&'fixedStations'].filter(e=>e),
  }

  // UI state
  const [controlsClosed, setControlsClosed] = useState(false)
  const [filtersChanged, setFiltersChanged] = useState(false)
  const [previousQueryString, setPreviousQueryString] = useState(createDataFilterQueryString())

  function createDataFilterQueryString () {
    return Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  } 

  function applyFilters() {
    setFiltersChanged(false)
    setPreviousQueryString(createDataFilterQueryString())
    if(props.map.getLoaded()){
      props.map.updateSource(createDataFilterQueryString())
    }
  }

  useEffect(() => {
    if(isMounted.current) {
      if(previousQueryString !== createDataFilterQueryString()) {
        setFiltersChanged(true)
      } else {
        setFiltersChanged(false)
      }
    } else {
      isMounted.current = true
    }
  }, [eovsSelected, fixedStations, casts, trajectories, startDate, endDate, startDepth, endDepth])

  function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  const controlClassName = classnames('filterRow', 'mb-3', 'animate__animated', {'animate__slideOutRight': controlsClosed}, {'animate__slideInRight': !controlsClosed})
  return (
    <div className='controls'>
      <Container fluid>
        <Row>
          <Col style={{pointerEvents: 'none'}} xs={{span: 3, offset:9}}>
            <Row style={{pointerEvents: 'auto'}} className='controlRow'>
              <Col xs={{ span: 1, offset: 11 }} className='mr-0 pr-0 pl-0'>
                <OverlayTrigger
                  key='left'
                  placement='left'
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
                    {controlsClosed ? <ChevronCompactLeft/> : <ChevronCompactRight/>}
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
                        <label className='ml-2'>{capitalizeFirstLetter(eov)}</label>
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
                        <label className='ml-2'> Fixed Stations </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox 
                          checked={casts}
                          onChange={() => setCasts(!casts)}
                          aria-label="Checkbox for following text input" 
                        />
                        <label className='ml-2'> Casts </label>
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
                  <Col xs={{span: 7, offset: 0}} >
                    Status: <span className='filterStatus'>{filtersChanged ? 'New filters to apply' : 'No new filters' }</span> 
                    {/* {previousQueryString} */}
                  </Col>
                  <Col xs={{span: 5, offset: 0}}>
                    <OverlayTrigger
                      key='left'
                      placement='top'
                      overlay={
                        <Tooltip id={`tooltip-left`}>
                          {filtersChanged ? 'Filter map data with current selection' : 'Select new filters to apply them'}
                        </Tooltip>
                      }
                      >
                      <Button 
                        className='applyFiltersButton' 
                        onClick={() => filtersChanged && applyFilters()}
                        variant={filtersChanged ? 'primary' : 'secondary'}
                        // disabled={!filtersChanged}
                        >
                          Apply New Filters
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