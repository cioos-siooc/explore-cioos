import * as React from 'react'
import {useState, useRef, useEffect} from 'react'
import PropTypes from 'prop-types'
import {Container, Row, Col, Accordion, Card, Button, InputGroup, OverlayTrigger, Tooltip, useAccordionToggle, Pagination} from 'react-bootstrap'
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
  const [pointsClicked, setPointsClicked] = useState(false)
  const [pointsData, setPointsData] = useState()
  const [pointCount, setPointCount] = useState(0)
  const [projectedPointCount, setProjectedPointCount] = useState(0)

  const [startDate, setStartDate] = useState('1900-01-01');
  
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  const [startDepth, setStartDepth] = useState(0)
  const [endDepth, setEndDepth] = useState(12000)

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
  const [pointDetailsOpen, setPointDetailsOpen] = useState(false)
  const [filtersChanged, setFiltersChanged] = useState(false)
  const [previousQueryString, setPreviousQueryString] = useState(createDataFilterQueryString())
  const [accordionSectionsOpen, setAccordionSectionsOpen] = useState([true,false,false,false])
  const [activePage, setActivePage] = useState(1)
  const [paginationItems, setPaginationItems] = useState()
  const [currentPage, setCurrentPage] = useState()

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
    if(isMounted.current && orgsLoaded.current >= 1) {
      if(previousQueryString !== createDataFilterQueryString() && prevOrganizationsSelected !== organizationsSelected) {
        setFiltersChanged(true)
        fetch(`${server}/profilesCount?${createDataFilterQueryString()}`).then(response => {
          if(response.ok) {
            return response.text()
          }
        }).then(data => {
          setProjectedPointCount(data)
        }).catch(error => {throw error})
      } else {
        setFiltersChanged(false)
      }
    } else {
      isMounted.current = true
    }
  }, [eovsSelected, organizationsSelected, fixedStations, casts, startDate, endDate, startDepth, endDepth])

  useEffect(() => {
    if(prevOrganizationsSelected === undefined && organizationsSelected !== undefined && !orgsLoaded.current) { // this is the first load
      orgsLoaded.current = true
      applyFilters()
    }
  }, [organizationsSelected])

  // Load the institution dropdown with all institutions in the dataset
  useEffect(() => {
    fetch(`${server}/organizations`).then(response => response.json()).then(data => { 
      let orgsReturned = {}
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

  useEffect(() => {
    setInterval(() => {
      if(pointsData !== props.map.getPointClicked()) {
        setPointsClicked(true)
        setPointsData(props.map.getPointClicked())
      } else {
        setPointsClicked(false)
        setPointsData()
        setCurrentPage()
        setPaginationItems()
        setPointDetailsOpen(false)
      }
    }, 500);
  }, [])

  useEffect(() => {
    fetch(`${server}/profilesCount?${previousQueryString}`).then(response => {
      if(response.ok) {
        return response.text()
      }
    }).then(data => {
      setPointCount(data)
    }).catch(error => {throw error})
  }, [previousQueryString])

  useEffect(() => {
    let tempPageItems = []
    if(pointsData) {
      if(pointsData.length > 7) {
        tempPageItems.push(
          <Pagination.Item key={1} active={activePage === 1}onClick={() => setActivePage(1)}>
            {1}
          </Pagination.Item>
        )
        if(activePage > 3 && activePage < pointsData.length - 3) { // middle pages
          tempPageItems.push(
            <Pagination.Ellipsis key='startElipsis'/>
          )
          tempPageItems.push(
            <Pagination.Item key={activePage - 1} onClick={() => setActivePage(activePage - 1)}>
              {activePage - 1}
            </Pagination.Item>
          )
          tempPageItems.push(
            <Pagination.Item key={activePage} active={true} onClick={() => setActivePage(activePage)}>
              {activePage}
            </Pagination.Item>
          )
          tempPageItems.push(
            <Pagination.Item key={activePage + 1} onClick={() => setActivePage(activePage + 1)}>
              {activePage + 1}
            </Pagination.Item>
          )
          tempPageItems.push(
            <Pagination.Ellipsis key='endEllipsis'/>
          )
        } else if (activePage > pointsData.length - 4) { // last couple pages
          tempPageItems.push(
            <Pagination.Ellipsis key='startEllipsis'/>
          )
          tempPageItems.push(
            <Pagination.Item key={pointsData.length - 4} active={activePage === pointsData.length - 4} onClick={() => setActivePage(pointsData.length - 4)}>
              {pointsData.length - 4}
            </Pagination.Item>
          )
          tempPageItems.push(
            <Pagination.Item key={pointsData.length - 3} active={activePage === pointsData.length - 3} onClick={() => setActivePage(pointsData.length - 3)}>
              {pointsData.length - 3}
            </Pagination.Item>
          )
          tempPageItems.push(
            <Pagination.Item key={pointsData.length - 2} active={activePage === pointsData.length - 2} onClick={() => setActivePage(pointsData.length - 2)}>
              {pointsData.length - 2}
            </Pagination.Item>
          )
          tempPageItems.push(
            <Pagination.Item key={pointsData.length - 1} active={activePage === pointsData.length - 1} onClick={() => setActivePage(pointsData.length - 1)}>
              {pointsData.length - 1}
            </Pagination.Item>
          )
        } else if (activePage < 4) { // first couple pages
          tempPageItems.push(
            <Pagination.Item key={2} active={activePage === 2} onClick={() => setActivePage(2)}>
              {2}
            </Pagination.Item>
          )
          tempPageItems.push(
            <Pagination.Item key={3} active={activePage === 3} onClick={() => setActivePage(3)}>
              {3}
            </Pagination.Item>
          )
          tempPageItems.push(
            <Pagination.Item key={4} active={activePage === 4} onClick={() => setActivePage(4)}>
              {4}
            </Pagination.Item>
          )
          tempPageItems.push(
            <Pagination.Item key={5} active={activePage === 5} onClick={() => setActivePage(5)}>
              {5}
            </Pagination.Item>
          )
          tempPageItems.push(
            <Pagination.Ellipsis key='endEllipsis'/>
          )
        }
        tempPageItems.push(
          <Pagination.Item key={pointsData.length} active={activePage === pointsData.length}onClick={() => setActivePage(pointsData.length)}>
            {pointsData.length}
          </Pagination.Item>
        )
      } else {
        for (let number = 1; number <= pointsData.length; number++) {
          tempPageItems.push(
            <Pagination.Item key={number} active={number === activePage} onClick={() => setActivePage(number)}>
              {number}
            </Pagination.Item>,
          );
        }
      }
      setPaginationItems(tempPageItems)
    }
    if(pointsData && pointsData.length !== 0) {
      createCurrentPage()
    }
  }, [pointsData, activePage])
  
  function createCurrentPage() {
    if(pointsData && pointsData.length !== 0 && activePage <= pointsData.length) {
      fetch(`${server}/pointQuery/${pointsData[activePage - 1].properties.pk}`).then(response => {
        if(response.ok) {
          response.json().then(data => {
            setCurrentPage(data[0])
          })
        }
      })
    }
  }

  useEffect(() => {
    setActivePage(1)
  }, [pointsData])

  let pointsDetailsTooltip
  if(pointsClicked) {
    pointsDetailsTooltip = pointDetailsOpen ? 'Close point details' : 'Open point details'
  } else {
    pointsDetailsTooltip = 'Please select points to view point details'
  }

  const controlClassName = classnames('filterRow', 'mb-3', 'animate__animated', {'animate__slideOutRight': controlsClosed}, {'animate__slideInRight': !controlsClosed})
  const pointDetailsClassName = classnames('pointDetailsCard', 'mt-3', 'animate__animated', {'animate__slideInLeft': pointDetailsOpen}, {'animate__slideOutLeft': !pointDetailsOpen})

  return (
    <div>
      <div className='controls'>
        <div className='filters float-right'>
          <Container fluid>
            <Row className='accordionColumn'>
              <Col >
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
                          <InputGroup className="">
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
                        <div>
                          Points: {pointCount}
                        </div>
                        <div>
                          Remaining: {filtersChanged ? projectedPointCount : 'n/a'}
                        </div>
                        <div>
                          Difference: {filtersChanged ? projectedPointCount - pointCount : 'n/a'}
                        </div>
                      </Col>
                      <Col xs={{span: 6, offset: 0}}>
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
        <div className='topControls float-right'>
          <Container fluid>
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
                        {controlsClosed ? 'Open' : 'Close'} filters
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
          </Container>
        </div>
      </div>
      <div>
        <div>
          <div className='pointDetails float-left'>
            <Container fluid>
              <Row style={{pointerEvents: 'auto'}}>
                <OverlayTrigger
                    key='pointDetails'
                    placement='right'
                    overlay={
                      <Tooltip id={`tooltip-left`}>
                        {pointsDetailsTooltip}
                      </Tooltip>
                    }
                  >
                  <Button className='pointDetailsTabToggleButton' onClick={() => pointsClicked && setPointDetailsOpen(!pointDetailsOpen)} variant={pointsClicked ? 'primary' : 'secondary'}>
                    {pointDetailsOpen ? <ChevronCompactLeft size={20}/> : <ChevronCompactRight size={20} />}
                  </Button>
                </OverlayTrigger>
              </Row>
              <Row className={pointDetailsClassName} style={{pointerEvents: 'auto'}}>
                <Row className='paginationRow'>
                  <Col></Col>
                  <Col>
                    <Pagination size='sm' >
                      <Pagination.First onClick={() => setActivePage(1)}/>
                      <Pagination.Prev onClick={() => {activePage !== 1 && setActivePage(activePage - 1)}}/>
                      {paginationItems}
                      <Pagination.Next onClick={() => {pointsData && activePage !== pointsData.length  && setActivePage(activePage + 1)}}/>
                      <Pagination.Last onClick={() => {pointsData && setActivePage(pointsData.length)}}/>
                    </Pagination>
                  </Col>
                  <Col></Col>
                </Row>
                <Row>
                  { currentPage && 
                    <Col>
                      <Container fluid style={{pointerEvents: 'auto', margin:'10px 0px 10px 0px'}}>
                        <h5>
                          Title:
                        </h5>
                        <div>
                          {currentPage.title}
                        </div>
                        <hr/>
                        <h5>
                          Organizations: 
                        </h5>
                        <div>
                          {currentPage.parties}
                        </div>
                        <hr/>
                        <h5>
                          Ocean Variables: 
                        </h5>
                        <div>
                          {currentPage.eovs.map((eov, index) => <div key={index}>{eov}</div>)}
                        </div>
                        <hr/>
                        <h5>
                          Timeframe: 
                        </h5>
                        <div>
                          {new Date(currentPage.profiles[0].time_min).toLocaleDateString()} - {new Date(currentPage.profiles[0].time_max).toLocaleDateString()}
                        </div>
                        <hr/>
                        <h5>
                          Depth Range: 
                        </h5>
                        <div>
                          {currentPage.profiles[0].depth_min.toFixed(3)} - {currentPage.profiles[0].depth_max.toFixed(3)} (m)
                        </div>
                      </Container>
                    </Col>
                  }
                </Row>
              </Row>
            </Container>
          </div>
        </div>
      </div>
    </div>
  )
} 

