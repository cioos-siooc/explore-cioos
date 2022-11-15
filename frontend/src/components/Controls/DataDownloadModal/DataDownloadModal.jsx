import * as React from 'react'
import { Modal } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import './styles.css'

export default function DataDownloadModal({
  disabled,
  setSubmissionState,
  showModal,
  setShowModal,
  children
}) {
  const { t } = useTranslation()
  return (
    <div>
      <Modal
        dialogClassName='dataDownloadModal'
        show={showModal}
        size='xl'
        centered
        aria-labelledby='contained-modal-title-vcenter'
        onHide={() => {
          setSubmissionState()
          setShowModal(false)
        }}
        fullscreen='lg-down'
      >
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
