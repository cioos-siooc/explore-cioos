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
    console.log(hoveredStep)
    switch (hoveredStep) {
      case 'filter':
        return (
          <div className='stepInfo'>
            Filtering
            <div className='stepInfoContent'>
              Filters are at the top of the screen.
              When no filters are selected all datasets are visible.
              Only valid filter values change the available data.
            </div>
          </div>
        )
      case 'select':
        return (
          <div className='stepInfo'>
            Selecting
            <div className='stepInfoContent'>
              There are four ways to select data:
              <ul>
                <li>
                  Creating a rectangle at any zoom level,
                </li>
                <li>
                  Creating a polygon at any zoom level,
                </li>
                <li>
                  Click + shift and drag at any zoom level,
                </li>
                <li>
                  Selecting points at the points zoom level
                </li>
              </ul>
            </div>
          </div>
        )
      case 'inspect':
        return (
          <div className='stepInfo'>
            Inspecting
            <div className='stepInfoContent'>
              Inspect datasets and their records by making a selection.
              Datasets that satisfy filter parameters and your selection show in a panel to the left.
              View a dataset in more detail by clicking on its detail button.
              Sort datasets by clicking on the table header in the datasets panel.
              Note: only selected datasets are available in the download view to choose from.
            </div>
          </div>
        )
      case 'download':
        return (
          <div className='stepInfo'>
            Downloading
            <div className='stepInfoContent'>
              Datasets that have been selected can be downloaded.
              Please provide an email address for the data download link to be sent to.
              Your selected filter parameters are applied to the downloaded data.
              Note: A 100MB limit applies to download sizes.
              Note: Dataset sizes are estimates only. Downloads that are inadvertantly more than 100MB will be cut off at 100MB.
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
            Canadian Integrated Ocean Observing System (CIOOS) Data Explorer
            <a title='Return to CIOOS pacific homepage' className='introLogo' href='https://cioospacific.ca/' />
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Container fluid>
            <div className='tagLine'>
              "Your access point for research-quality ocean data from Canada, around the world."
            </div>
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