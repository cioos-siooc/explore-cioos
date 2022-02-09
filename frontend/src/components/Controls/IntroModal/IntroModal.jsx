import * as React from 'react'
import { useState } from 'react'
import { Modal } from 'react-bootstrap'
import { InfoSquare } from 'react-bootstrap-icons'

import './styles.css'

export default function IntroModal() {
  const [showModal, setShowModal] = useState(false)
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
          Welcome to the CIOOS Data Explorer
          Easily download data from across Canada.
          Filter data on the map, select datasets of interest, and download them.
          1. Filter Map Data
          2. Select Data of Interest
          3. Download Data
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