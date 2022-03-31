import * as React from 'react'
import { useEffect } from 'react'
import { useState } from 'react'
import { Container, Modal, Col, Row } from 'react-bootstrap'
import { InfoSquare } from 'react-bootstrap-icons'

import './styles.css'

export default function IntroModal({ intialOpenState }) {
  const [showModal, setShowModal] = useState(intialOpenState)
  const [hoveredStep, setHoveredStep] = useState()
  // Potential idea for cut through transparency to highligh controls: https://ishadeed.com/article/thinking-about-the-cut-out-effect/

  function generateInfo() {
    switch (hoveredStep) {
      case 'filter':
        return (
          <div className='stepInfo'>
            Filter
            <div className='stepInfoContent'>
              By default, the Data Explorer displays all available datasets.
              Use the filters at the top of the screen to narrow down your selections
            </div>
          </div>
        )
      case 'select':
        return (
          <div className='stepInfo'>
            Select
            <div className='stepInfoContent'>
              There are four ways to select data:
              <ul>
                <li>
                  Creating a rectangle at any zoom level:
                  Click and hold shift while dragging the cursor at any zoom level or use the rectangle tool (insert icon).
                  With the tool selected, click on the map to start drawing the rectangle.
                  Drag to the opposing corner and click again.
                  Note that you can only have one rectangle selection active at a time.
                </li>
                <li>
                  Creating a polygon at any zoom level:
                  For an irregular shape use the polygon tool (insert icon).
                  With the tool selected, click on the map to start drawing the polygon.
                  When you\'ve finished drawing the search area, finish your search area by clicking on the first point again.
                </li>
                <li>
                  Selecting points at the points zoom level:
                  At the points zoom level, click to directly select.
                </li>
              </ul>
            </div>
          </div>
        )
      case 'inspect':
        return (
          <div className='stepInfo'>
            Inspect
            <div className='stepInfoContent'>
              After making a selection, a summary of the selected dataset(s) will appear in a panel to the left.
              Click the table headers to sort results alphabetically by title, type of dataset, or numerically by number of records and estimated size.
              You can view each dataset in more detail by clicking the arrow button next to the estimated dataset size.
              <i> Note: Only selected datasets will be available to download.</i>
            </div>
          </div>
        )
      case 'download':
        return (
          <div className='stepInfo'>
            Download
            <div className='stepInfoContent'>
              To download the data, click the Download link at the bottom of the panel or top of the page.
              This page allows the user to confirm their data order by verifying dataset titles, records, the size of the download, and inspect dataset details.
              Enter your email address and submit to confirm your order.
              An email providing the direct download link will be sent shortly.
              <i> Note: Filters that have been applied in the search will also be applied to the data download. A 100MB size limit applies to all orders; downloads that are more than 100MB will be cut off at 100MB. Check the bar at the bottom of the panel to verify the order does not exceed the maximum. If the size is over 100MB, please submit multiple orders of smaller sizes.</i>
            </div>
          </div>
        )
      default:
        return (
          <div className='tipInfo'>
            <p>
              <img className='feedbackButtonImage' />
              Please fill out our user feedback survey! It helps improve this interface and find bugs.
            </p>
            <p>
              <img className='infoButtonImage' />
              Click the info button to reopen this information panel.
            </p>
          </div>
        )
    }
  }

  return (
    <div>
      <Modal
        show={showModal}
        size='xl'
        centered
        aria-labelledby='contained-modal-title-vcenter'
        onHide={() => setShowModal(false)}
        className='introModal'
        dialogClassName="modal-90w"
      >
        <Modal.Header closeButton>
          <Modal.Title className='modalHeader' id='contained-modal-title-vcenter'>
            <span>
              CIOOS Data Explorer
            </span>
            <span className='tagLine'> "Ocean Data For Our Ocean Future" </span>
            <a title='Return to CIOOS pacific homepage' className='introLogo' href='https://cioospacific.ca/' />
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Container fluid>
            <Row>
              <div
                className='steps'
                onMouseOut={() => setHoveredStep()}
              >
                <div
                  className='stepImage filterStep'
                  onMouseOver={() => setHoveredStep('filter')}
                >
                  Filter
                </div>
                <div
                  className='stepImage selectStep'
                  onMouseOver={() => setHoveredStep('select')}
                >
                  Select
                </div>
                <div
                  className='stepImage inspectStep'
                  onMouseOver={() => setHoveredStep('inspect')}
                >
                  Inspect
                </div>
                <div
                  className='stepImage downloadStep'
                  onMouseOver={() => setHoveredStep('download')}
                >
                  Download
                </div>
              </div>
            </Row>
            <Row>
              {generateInfo()}
            </Row>
          </Container>
        </Modal.Body>
      </Modal>
      <button
        className='introButton'
        onClick={() => setShowModal(true)}
        title='Re-open introduction'
      >
        <InfoSquare color='#007bff' size={'25px'} />
      </button>
    </div>
  )
}