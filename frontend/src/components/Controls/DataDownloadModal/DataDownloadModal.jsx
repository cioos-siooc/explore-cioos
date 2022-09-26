import * as React from 'react'
import { useState } from 'react'
import { Modal } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import './styles.css'

export default function DataDownloadModal({
  disabled,
  children,
  setEmail,
  setSubmissionState
}) {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  return (
    <div>
      <Modal
        dialogClassName='dataDownloadModal'
        show={showModal}
        size='xl'
        centered
        aria-labelledby='contained-modal-title-vcenter'
        onHide={() => {
          setEmail()
          setSubmissionState()
          setShowModal(false)
        }}
      >
        <Modal.Header closeButton>
          <Modal.Title id='contained-modal-title-vcenter'>
            {t('downloadModalTitleText')}
            {/* Download Data from CIOOS Data Explorer */}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>{children}</Modal.Body>
      </Modal>
      <button
        className='downloadButton'
        onClick={() => setShowModal(true)}
        disabled={disabled}
        title={t('downloadModalButtonTitle')} // 'Download selected data'
      >
        {t('downloadModalButtonText')}
        {/* Download */}
      </button>
    </div>
  )
}
