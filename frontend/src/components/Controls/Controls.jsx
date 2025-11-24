import * as React from 'react'
import { Container, Row, Col } from 'react-bootstrap'
import { ChevronCompactLeft, ChevronCompactRight } from 'react-bootstrap-icons'
import { SmallHeader } from './SmallScreenHeader/SmallScreenHeader'

import './styles.css'

export default function Controls({ selectionPanel, loading, isSelectionPanelOpen, setSelectionPanelOpen, setShowIntroModal, children }) {
  return (
    <div className={`controls ${loading === true && 'disabled'}`}>
      <Container fluid>
        {/* Desktop: show both columns */}
        <Row className='hidden lg:flex'>
          {selectionPanel}
          <Col className='controlColumn'>{children}</Col>
        </Row>

        {/* Mobile: show only one, based on open/close */}
       
          {isSelectionPanelOpen ? (

            <Row className='flex lg:hidden'>
              {selectionPanel}
            </Row>
            
          ) : (

            <> 
            <SmallHeader setShowIntroModal= {setShowIntroModal}/>

            <Row className='flex lg:hidden relative top-[10px]'>
            <Col className='panelHandleCol'>
              <div className='panelHandleClosed' 
                onClick={() => setSelectionPanelOpen(true)}>  
                <ChevronCompactRight /> 
              </div> 
            </Col>
          
            <Col className='controlColumn'>{children}</Col>
          </Row>
            </>


           
          
            
          )}
        
      </Container>
    </div>
  )
}
