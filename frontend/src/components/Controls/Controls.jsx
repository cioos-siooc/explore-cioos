import * as React from 'react'
import {useState, useRef, useEffect} from 'react'
import PropTypes from 'prop-types'
import {Container, Row, Col, Accordion, Card, Button, InputGroup, OverlayTrigger, Tooltip, useAccordionToggle, Table} from 'react-bootstrap'
import classnames from 'classnames'
import { ChevronCompactLeft, ChevronCompactRight, QuestionCircle, ChevronCompactDown, ChevronCompactUp } from 'react-bootstrap-icons'

import TimeSelector from './TimeSelector/TimeSelector.jsx'
import DepthSelector from './DepthSelector/DepthSelector.jsx'
import SubmitRequest from './SubmitRequest/SubmitRequest.jsx'
import PageControls from './PageControls/PageControls.jsx'
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
  const [tempPointsData, setTempPointsData] = useState([])

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
  const [currentPage, setCurrentPage] = useState()
  const [data, setData] = useState()

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


  // Selection details
  useEffect(() => {
    if(!tempPointsData) { // there are no points selected
      setPointsClicked(false)
      // setPointsData()
      setCurrentPage()
      setPointDetailsOpen(false)
      setData()
    } else if(JSON.stringify(pointsData) !== JSON.stringify(tempPointsData)) { // there are new points selected
      setPointsClicked(true)
      setPointsData(tempPointsData)
      setActivePage(1)
    } // there are the same points selected so do nothing
  }, [tempPointsData])

  useEffect(() => {
    setInterval(() => setTempPointsData(props.map.getPointClicked()), 500);
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
    // console.log(pointsData)
    if(pointsData && pointsData.length !== 0 && activePage <= pointsData.length) {
      fetch(`${server}/pointQuery/${pointsData.map(point => JSON.stringify(point.properties.pk)).join(',')}`).then(response => {
        if(response.ok) {
          response.json().then(data => {
            setData(data)
          })
        }
      })
    }
    setActivePage(1)
  }, [pointsData])

  useEffect(() => {
    if(data) {
      setCurrentPage(data[activePage - 1])
      setPointDetailsOpen(true)
    } else {
      setCurrentPage()
      setPointDetailsOpen(false)
    }
  },[data, activePage])

  let pointsDetailsTooltip
  if(pointsClicked) {
    pointsDetailsTooltip = pointDetailsOpen ? 'Close selection details' : 'Open selection details'
  } else {
    pointsDetailsTooltip = 'Please make a point selection to view selection details'
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
                  <Col>
                    <h6 style={{marginTop: '5px'}}>
                      Datasets
                    </h6>
                  </Col>
                  <Col>
                    {data && <PageControls numPages={data.length} activePage={activePage} setActivePage={setActivePage}/>}
                  </Col>
                </Row>
                <Row>
                  { currentPage && 
                    <Col>
                      <Container style={{pointerEvents: 'auto', margin:'10px 0px 10px 0px'}}>
                        <hr/>
                        <h6>
                          Title
                        </h6>
                        <div>
                          {currentPage.title}
                        </div>
                        <hr/>
                        <h6>
                          Organizations
                        </h6>
                        <div>
                          {currentPage.parties}
                        </div>
                        <hr/>
                        <h6>
                          Ocean Variables 
                        </h6>
                        <div>
                          {currentPage.eovs.map((eov, index) => ' ' + eov ).join(',')}
                        </div>
                        <hr/>
                        <h6>
                          Profiles ({currentPage && currentPage.profiles && currentPage.profiles.length} profiles)
                        </h6>
                      </Container>
                      <Table className='profileTable' striped bordered size="sm">
                          <thead>
                            <tr>
                              <th>Profile ID</th>
                              <th>Start Date</th>
                              <th>End Date</th>
                              <th>Start Depth</th>
                              <th>End Depth</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentPage.profiles.map((profile, index) => {
                              return (
                                <tr key={index}>
                                  <td>{profile.profile_id}</td>
                                  <td>{new Date(profile.time_min).toLocaleDateString()}</td>
                                  <td>{new Date(profile.time_max).toLocaleDateString()}</td>
                                  <td>{profile.depth_min < Number.EPSILON ? 0 : profile.depth_min > 15000 ? 'too big' : profile.depth_min.toFixed(1)}</td>
                                  <td>{profile.depth_max < Number.EPSILON ? 0 : profile.depth_max > 15000 ? 'too big' : profile.depth_max.toFixed(1)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </Table>
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

