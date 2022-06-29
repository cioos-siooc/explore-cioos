import * as React from 'react'
import { useState, useEffect } from 'react'
import { Container, Row, Col } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import './styles.css'

export default function Controls({ selectionPanel, loading, children }) {
  const childrenArray = React.Children.toArray(children)
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
