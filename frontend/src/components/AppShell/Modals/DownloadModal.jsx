import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CloudArrowDownFill } from 'react-bootstrap-icons'

import Modal from '../../ui/Modal.jsx'
import DownloadPanel from '../Panels/DownloadPanel.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// The download-order modal, launched from the sidebar footer's Download
// button: order review (DownloadDetails) + email submit.
export default function DownloadModal () {
  const { t } = useTranslation()
  const { showDownloadModal, setShowDownloadModal } = useUI()

  return (
    <Modal
      show={showDownloadModal}
      onHide={() => setShowDownloadModal(false)}
      className='downloadModal'
      dialogClassName='downloadModalDialog'
      aria-labelledby='downloadModalTitle'
    >
      <Modal.Header closeButton>
        <Modal.Title id='downloadModalTitle'>
          <span className='downloadModalTitleIcon' aria-hidden='true'>
            <CloudArrowDownFill size={20} />
          </span>
          <span className='downloadModalTitleText'>
            <span className='downloadModalTitleHeading'>
              {t('downloadModalTitleText')}
            </span>
            <span className='downloadModalTitleSubtitle'>
              {t('downloadModalSubtitleText')}
            </span>
          </span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <DownloadPanel />
      </Modal.Body>
    </Modal>
  )
}
