import * as React from 'react'
import { useState } from 'react'
import { Modal } from 'react-bootstrap'

import './styles.css'

export default function DataDownloadModal({ disabled, children }) {
  const [showModal, setShowModal] = useState(false)
  return (
    <div>
      <Modal
        contentClassName='dataDownloadModal'
        show={showModal}
        size='xl'
        centered
        aria-labelledby='contained-modal-title-vcenter'
        onHide={() => setShowModal(false)}
      >
        <Modal.Header closeButton>
          <Modal.Title id='contained-modal-title-vcenter'>
            Download Data from CIOOS Data Explorer
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