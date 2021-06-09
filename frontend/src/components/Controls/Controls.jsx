import * as React from 'react'
import {useState} from 'react'
import {Container, Row, Col, Accordion, Card, Button, InputGroup, OverlayTrigger, Tooltip} from 'react-bootstrap'
import classnames from 'classnames'

import TimeSelector from './TimeSelector/TimeSelector.jsx'
import DepthSelector from './DepthSelector/DepthSelector.jsx'
import './styles.css'

export default function Controls() {
  const [controlsClosed, setControlsClosed] = useState(false)
  const controlClassName = classnames('controlAccordion', 'mb-3', 'animate__animated', {'animate__slideOutRight': controlsClosed}, {'animate__slideInRight': !controlsClosed})
  return (
    <div className='controls'>
      <Container fluid>
        <Row>
          <Col xs={{span: 3, offset:9}}>
            <Row>
              <Col xs={{ span: 1, offset: 11 }} className='mr-0 pr-0'>
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
                    {controlsClosed ? '<' : '>'}
                  </Button>
                </OverlayTrigger>
              </Col>
            </Row>
            <Row>
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
                          <InputGroup.Checkbox aria-label="Checkbox for following text input" />
                        <label> Temperature </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox aria-label="Checkbox for following text input" />
                        <label> Salinity </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox aria-label="Checkbox for following text input" />
                        <label> Pressure </label>
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
                          <InputGroup.Checkbox aria-label="Checkbox for following text input" />
                        <label> Fixed Stations </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox aria-label="Checkbox for following text input" />
                        <label> Casts </label>
                      </InputGroup>
                      <InputGroup className="mb-3">
                        <InputGroup.Checkbox aria-label="Checkbox for following text input" />
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
                        <TimeSelector/>
                      </InputGroup>
                      <hr></hr>
                      <InputGroup className="mb-3">
                        <DepthSelector/>
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