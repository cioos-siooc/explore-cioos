import * as React from 'react'
import { Container, Row, Col } from 'react-bootstrap'

import './styles.css'

export default function Controls ({ selectionPanel, loading, children }) {
  return (
    <div className={`controls ${loading === true && 'disabled'}`}>
      <Container fluid>
        <Row>
          {selectionPanel}
          <Col className='controlColumn' >
            {children}
          </Col>
        </Row>
      </Container>
    </div >
  )
}
