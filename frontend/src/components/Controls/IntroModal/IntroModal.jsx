import * as React from 'react'
import { useState } from 'react'
import { Modal } from 'react-bootstrap'
import { InfoSquare } from 'react-bootstrap-icons'

import './styles.css'

export default function IntroModal({ intialOpenState }) {
  const [showModal, setShowModal] = useState(intialOpenState)
  return (
    <div className='IntroModal'>
      <Modal
        show={showModal}
        size='lg'
        centered
        aria-labelledby='contained-modal-title-vcenter'
        onHide={() => setShowModal(false)}
      >
        <Modal.Header closeButton>
          <Modal.Title id='contained-modal-title-vcenter'>
            CIOOS Data Explorer
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Welcome to the CIOOS Data Explorer. Access and download data from across Canada.
          <ol>
            <hr />
            <li>
              Filter Map Data (Filters along top left of screen)
            </li>
            Filters can be found across the top of the screen. The datasets shown on the map are based on the parameters that you select.
            Unmodified filters do not filter data, and the entire range of values for that property are included.
            <hr />
            <li>
              Select Data of Interest (Tools along bottom right of screen)
            </li>
            There are four ways to select datasets you wish to view in more detail.
            <ul>
              <li>
                Use the rectangle selection tool at any zoom level
              </li>
              <li>
                Use the polygon selection tool at any zoom level
              </li>
              <li>
                Shift-click and drag to select at any zoom level
              </li>
              <li>
                Click on hexagons to zoom to points, and click on points to select them individually
              </li>
            </ul>
            <hr />
            <li>
              Download Data (Button at top of screen enabeled after selection)
            </li>
            Select datasets of interest to download them. Provide the email you wish to receive download notifications at.
            Note: Data downloads are limited to 100MB total size. Use the data size estimation to keep downloads inside the 100MB limit.
            <hr />
          </ol>
          Pro-tip: Provide your user feedback by opening the survey link at top right.
          Pro-tip: Re-open this dialogue anytime by pressing the information button at right.
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