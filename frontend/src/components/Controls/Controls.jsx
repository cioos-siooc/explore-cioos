import * as React from 'react'
import {useState} from 'react'
import {Container, Row, Col, Accordion, Card, Button, InputGroup, Label} from 'react-bootstrap'
import TimeSelector from './TimeSelector/TimeSelector.jsx'
import classnames from 'classnames'
import './styles.css'


export default function Controls() {
  const [controlsClosed, setControlsClosed] = useState(false)
  const controlClassName = classnames('controlAccordion', 'mb-3', 'animate__animated', {'animate__slideOutRight': controlsClosed}, {'animate__slideInRight': !controlsClosed})
  return (
    <div className='controls'>
      <Container>
        <Row>
          <Col xs={{ span: 1, offset: 10 }}>
            <Button className='toggleControlsOpenAndClosed' onClick={() => setControlsClosed(!controlsClosed)}>{controlsClosed ? '<' : '>'}</Button>
          </Col>
        </Row>
        <Row>
          <Accordion defaultActiveKey="0" className={controlClassName}>
            <Card>
              <Card.Header>
                <Accordion.Toggle as={Button} variant="link" eventKey="0">
                  Variables
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
                Spatio-temporal Filters
                </Accordion.Toggle>
              </Card.Header>
              <Accordion.Collapse eventKey="2">
                <Card.Body>
                  <InputGroup className="mb-3">
                    <TimeSelector/>
                  </InputGroup>
                  <InputGroup className="mb-3">
                    <label> Depth </label>
                  </InputGroup>
                </Card.Body>
              </Accordion.Collapse>
            </Card>
          </Accordion>
        </Row>
    </Container>
  </div>
  )
} 