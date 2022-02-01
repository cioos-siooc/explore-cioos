import * as React from 'react'
import { useState } from 'react'
import { Modal } from 'react-bootstrap'

import './styles.css'

export default function DataDownloadModal({ disabled, children }) {
  const [showModal, setShowModal] = useState(false)
  return (
    <div className='dataDownloadModal'>
      <Modal
        show={showModal}
        size='lg'
        centered
        aria-labelledby='contained-modal-title-vcenter'
        onHide={() => setShowModal(false)}
      >
        <Modal.Header closeButton>
          <Modal.Title id='contained-modal-title-vcenter'>
            Request data
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {children}
        </Modal.Body>
      </Modal>
      <button
        className='downloadButton'
        onClick={() => setShowModal(true)}
        disabled={disabled}
        title='Download selected data'
      >
        Download
      </button>
    </div>
  )
}