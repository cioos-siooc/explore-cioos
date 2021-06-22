import * as React from 'react'
import {useState, useRef, useEffect} from 'react'
import PropTypes from 'prop-types'
import {Container, Row, Col, Accordion, Card, Button, InputGroup, OverlayTrigger, Tooltip, useAccordionToggle} from 'react-bootstrap'
import classnames from 'classnames'
import { ChevronCompactLeft, ChevronCompactRight, QuestionCircle, ChevronCompactDown, ChevronCompactUp } from 'react-bootstrap-icons'

import TimeSelector from './TimeSelector/TimeSelector.jsx'
import DepthSelector from './DepthSelector/DepthSelector.jsx'
import SubmitRequest from './SubmitRequest/SubmitRequest.jsx'
import {server} from '../../config'
import './styles.css'
export default function Controls(props) {
  // Initialization properties
  const isMounted = useRef(false)
  const orgsLoaded = useRef(false)

  // Filters
  const eovsToggleStart = {
    carbon: true,
    currents: true,
    nutrients: true,
    salinity: true,
    temperature: true,
  };
  const [eovsSelected, setEovsSelected] = useState(eovsToggleStart)
  const [organizationsToggleStart, setOrganizationsToggleStart] = useState()
  const [organizationsSelected, setOrganizationsSelected] = useState()
  const [prevOrganizationsSelected, setPreviousOrganizationsSelected] = useState(organizationsSelected)
  const [fixedStations, setFixedStations] = useState(true)
  const [casts, setCasts] = useState(true)

  const [startDate, setStartDate] = useState('2000-01-01');
  
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  const [startDepth, setStartDepth] = useState(0)
  const [endDepth, setEndDepth] = useState(100)

  const eovsSelectedArray = Object.entries(eovsSelected).filter(([eov,isSelected]) => isSelected).map(([eov,isSelected])=>eov).filter(e=>e)
  let organizationsSelectedArray
  if(organizationsSelected) organizationsSelectedArray =  Object.entries(organizationsSelected).filter(([org, isSelectedAndPK]) => isSelectedAndPK[0]).map(([org, isSelectedAndPK]) => isSelectedAndPK[1]).filter(pk=>pk)

  const query = {
    timeMin: startDate,
    timeMax: endDate,
    depthMin: startDepth,
    depthMax: endDepth,
    eovs: eovsSelectedArray,
    organizations: organizationsSelected && organizationsSelectedArray,
    dataType: [casts && 'casts', fixedStations &&'fixedStations'].filter(e=>e),
  }

  // UI state
  const [controlsClosed, setControlsClosed] = useState(false)
  const [filtersChanged, setFiltersChanged] = useState(false)
  const [previousQueryString, setPreviousQueryString] = useState(createDataFilterQueryString())
  const [accordionSectionsOpen, setAccordionSectionsOpen] = useState([true,false,false,false])

  function createDataFilterQueryString () {
    return Object.entries(query)
    .filter(([k, v])=> v )
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
    if(isMounted.current && orgsLoaded.current) {
      console.log('triggered')
      if(previousQueryString !== createDataFilterQueryString()) {
        setFiltersChanged(true)
      } else {
        setFiltersChanged(false)
      }
    } else {
      isMounted.current = true
    }
  }, [eovsSelected, organizationsSelected, fixedStations, casts, startDate, endDate, startDepth, endDepth])

  useEffect(() => {
    console.log(organizationsSelected)
    if(prevOrganizationsSelected === undefined && organizationsSelected) {
      setPreviousOrganizationsSelected(organizationsSelected)
    } else {
      if(!orgsLoaded.current) {
        orgsLoaded.current = true
      }
    }
  }, [organizationsSelected])

  // Load the institution dropdown with all institutions in the dataset
  useEffect(() => {
    fetch(`${server}/organizations`).then(response => response.json()).then(data => { 
      let orgsReturned = {}
      console.log(data)
      data.forEach(elem => {
        orgsReturned[elem.name] = [true, elem.pk]
      })
      setOrganizationsToggleStart(orgsReturned)
      setOrganizationsSelected(orgsReturned)
    }).catch(error => {throw error})
  }, [])

  function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  const controlClassName = classnames('filterRow', 'mb-3', 'animate__animated', {'animate__slideOutRight': controlsClosed}, {'animate__slideInRight': !controlsClosed})
  return (
    <div className='controls float-right'>
      <Container fluid>
        <Row>
          <Col style={{pointerEvents: 'none', width:  '450px'}}>
            <Row style={{pointerEvents: 'auto'}} className='controlRow'>
              {/* <Col> */}
                <SubmitRequest 
                  map={props.map} 
                  query={createDataFilterQueryString(query)}
                  filtersChanged={filtersChanged}
                />
                <OverlayTrigger
                  key='left'
                  placement='bottom'
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
                    {controlsClosed ? <ChevronCompactLeft size={20}/> : <ChevronCompactRight size={20}/>}
                  </Button>
                </OverlayTrigger>
              {/* </Col> */}
            </Row>
            <Row style={{pointerEvents: 'auto'}} className={controlClassName}>
              <Accordion defaultActiveKey="0" className='controlAccordion'>
                <Card>
                  <Card.Header>
                    <Accordion.Toggle as={Button} variant="light" eventKey="0" onClick={() => setAccordionSectionsOpen(accordionSectionsOpen.map((elem, index) => index === 0 ? !elem : false))}>
                      Ocean Variables 
                    </Accordion.Toggle>
                    <OverlayTrigger
                      key='oceanVariablesHelp'
                      placement='bottom'
                      overlay={
                        <Tooltip id={`tooltip-left`}>
                          Select the Ocean Variables you want to download. Checkboxes work as logical OR operators -- i.e.: if you select ‘Oxygen’ and ‘Temperature’, locations that have at least one of those variables can be selected for download.
                        </Tooltip>
                      }
                      >
                        <QuestionCircle className='helpIcon' color='#007bff' size={20}/>
                      </OverlayTrigger>
                      <Accordion.Toggle className='chevronAccordionToggle' as={Button} variant='light' eventKey='0' onClick={() => setAccordionSectionsOpen(accordionSectionsOpen.map((elem, index) => index === 0 ? !elem : false))}>
                        {accordionSectionsOpen[0] ? <ChevronCompactUp  size={20}/> : <ChevronCompactDown className='chevronIcon' size={20}/>}
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
                                  setEovsSelected({...eovsSelected,
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
                    <Accordion.Toggle as={Button} variant="light" eventKey="1" onClick={() => setAccordionSectionsOpen(accordionSectionsOpen.map((elem, index) => index === 1 ? !elem : false))}>
                      Data Source Types 
                    </Accordion.Toggle>
                    <OverlayTrigger
                      key='dataSourcesHelp'
                      placement='bottom'
                      overlay={
                        <Tooltip id={`tooltip-left`}>
                          Select the Data Sources from which you want to download data. Checkboxes work as logical OR operations -- i.e.: if you select ‘Buoys/Moorings’ and ‘Casts/Profiles’, locations that have data from at least one of those two types of data sources can be selected for download.
                          <ul>
                            <li>
                              Buoys/Moorings: Tooltip: “Examples include mooring, buoys, cabled observatories.
                            </li>
                            <li>
                              Casts/Profiles: Tooltip: “Examples include vertical CTD and Rosette (bottle) profiles.
                            </li>
                          </ul>
                        </Tooltip>
                      }
                    >
                      <QuestionCircle className='helpIcon' color='#007bff' size={20}/>
                    </OverlayTrigger>
                    <Accordion.Toggle className='chevronAccordionToggle' as={Button} variant='light' eventKey='1' onClick={() => setAccordionSectionsOpen(accordionSectionsOpen.map((elem, index) => index === 1 ? !elem : false))}>
                        {accordionSectionsOpen[1] ? <ChevronCompactUp  size={20}/> : <ChevronCompactDown className='chevronIcon' size={20}/>}
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
                        <label className='ml-2'> Buoys/Moorings </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox 
                          checked={casts}
                          onChange={() => setCasts(!casts)}
                          aria-label="Checkbox for following text input" 
                        />
                        <label className='ml-2'> Casts/Profiles </label>
                      </InputGroup>
                    </Card.Body>
                  </Accordion.Collapse>
                </Card>
                <Card>
                  <Card.Header>
                    <Accordion.Toggle as={Button} variant="light" eventKey="2" onClick={() => setAccordionSectionsOpen(accordionSectionsOpen.map((elem, index) => index === 2 ? !elem : false))}>
                      Organizations 
                    </Accordion.Toggle>
                    <OverlayTrigger
                      key='organizationsHelp'
                      placement='bottom'
                      overlay={
                        <Tooltip id={`tooltip-left`}>
                          Filter data by Responsible Organisation name. Selection works as logical OR operation -- i.e.: if you select ‘Institute of Ocean Science’ and ‘Hakai Institute’, data from both organisations will be selected for download.
                        </Tooltip>
                      }
                    >
                      <QuestionCircle className='helpIcon' color='#007bff' size={20}/>
                    </OverlayTrigger>
                    <Accordion.Toggle className='chevronAccordionToggle' as={Button} variant='light' eventKey='2' onClick={() => setAccordionSectionsOpen(accordionSectionsOpen.map((elem, index) => index === 2 ? !elem : false))}>
                        {accordionSectionsOpen[2] ? <ChevronCompactUp  size={20}/> : <ChevronCompactDown className='chevronIcon' size={20}/>}
                      </Accordion.Toggle>
                  </Card.Header>
                  <Accordion.Collapse eventKey="2">
                  <Card.Body style={{maxHeight:"300px",overflowY:"scroll"}}>
                      {(organizationsToggleStart && organizationsSelected) && Object.keys(organizationsToggleStart).map(org =>  (
                      <InputGroup key={org} className="mb-3">
                        <InputGroup.Checkbox
                            checked={organizationsSelected[org][0]}
                            onChange={(e) => {
                                  console.log(e.target.value);
                                  setOrganizationsSelected({...organizationsSelected,
                                    [org]:[!organizationsSelected[org][0], organizationsSelected[org][1]]
                                  })
                            }}
                            aria-label="Checkbox for following text input"
                          />
                        <label className='ml-2'>{capitalizeFirstLetter(org)}</label>
                      </InputGroup>))
                      }
                    </Card.Body>
                  </Accordion.Collapse>
                </Card>
                <Card></Card>
                <Card>
                  <Card.Header>
                    <Accordion.Toggle as={Button} variant="light" eventKey="3" onClick={() => setAccordionSectionsOpen(accordionSectionsOpen.map((elem, index) => index === 3 ? !elem : false))}>
                      Timeframe and Depth Range 
                    </Accordion.Toggle>
                    <OverlayTrigger
                      key='timeframeDepthHelp'
                      placement='bottom'
                      overlay={
                        <Tooltip id={`tooltip-left`}>
                          Select depth and time range for which you want to download data. Selection works as logical AND operation -- i.e.: only locations that have data in the selected time and depth range will be selected for download.
                        </Tooltip>
                      }
                    >
                      <QuestionCircle className='helpIcon' color='#007bff' size={20}/>
                    </OverlayTrigger>
                    <Accordion.Toggle className='chevronAccordionToggle' as={Button} variant='light' eventKey='3' onClick={() => setAccordionSectionsOpen(accordionSectionsOpen.map((elem, index) => index === 3 ? !elem : false))}>
                        {accordionSectionsOpen[3] ? <ChevronCompactUp  size={20}/> : <ChevronCompactDown className='chevronIcon' size={20}/>}
                      </Accordion.Toggle>
                  </Card.Header>
                  <Accordion.Collapse eventKey="3">
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