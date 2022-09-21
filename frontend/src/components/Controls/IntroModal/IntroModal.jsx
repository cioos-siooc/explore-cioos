import * as React from 'react'
import { useState, useEffect } from 'react'
import { Container, Modal, Row } from 'react-bootstrap'
import { InfoSquare, ChatDots } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import { getCookieValue } from '../../../utilities'
import './styles.css'

export default function IntroModal({ initialOpenState }) {
  const { t, i18n } = useTranslation()
  const introOpenCookie = !getCookieValue('introModalOpen')
  const [showModal, setShowModal] = useState(
    introOpenCookie !== undefined ? introOpenCookie : initialOpenState
  )

  const [hoveredStep, setHoveredStep] = useState()
  // Potential idea for cut through transparency to highligh controls: https://ishadeed.com/article/thinking-about-the-cut-out-effect/

  useEffect(() => {
    if (showModal === false) {
      document.cookie = `introModalOpen=${showModal}; Secure; max-age=${
        60 * 60 * 24 * 31
      }`
    }
  }, [showModal])

  function generateInfo() {
    switch (hoveredStep) {
    case 'filter':
      return (
        <div className='stepInfo'>
          {t('stepInfoFilter')}
          <div className='stepInfoContent'>{t('stepInfoFilterText')}</div>
        </div>
      )
    case 'select':
      return (
        <div className='stepInfo'>
          {t('stepInfoSelect')}
          <div className='stepInfoContent'>
            {t('stepInfoSelectTextA')}
            {/* There are four ways to select data: */}
            <ul>
              <li>
                {t('stepInfoSelectTextB')}
                {/* Creating a rectangle at any zoom level:
                  Click and hold shift while dragging the cursor at any zoom level or use the rectangle tool (insert icon).
                  With the tool selected, click on the map to start drawing the rectangle.
                  Drag to the opposing corner and click again.
                  Note that you can only have one rectangle selection active at a time. */}
              </li>
              <li>
                {t('stepInfoSelectTextC')}
                {/* Creating a polygon at any zoom level:
                  For an irregular shape use the polygon tool (insert icon).
                  With the tool selected, click on the map to start drawing the polygon.
                  When you\'ve finished drawing the search area, finish your search area by clicking on the first point again. */}
              </li>
              <li>
                {t('stepInfoSelectTextD')}
                {/* Selecting points at the points zoom level:
                  At the points zoom level, click to directly select. */}
              </li>
            </ul>
          </div>
        </div>
      )
    case 'inspect':
      return (
        <div className='stepInfo'>
          {t('stepInfoInspect')}
          <div className='stepInfoContent'>
            {t('stepInfoInspectText')}

            {/* <Trans i18nKey="stepInfoInspectText" >
                After making a selection, a summary of the selected dataset(s) will appear in a panel to the left.
                Click the table headers to sort results alphabetically by title, type of dataset, or numerically by number of records and estimated size.
                You can view each dataset in more detail by clicking the arrow button next to the estimated dataset size.
                <i> Note: Only selected datasets will be available to download.</i>
              </Trans> */}
          </div>
        </div>
      )
    case 'download':
      return (
        <div className='stepInfo'>
          {t('stepInfoDownload')}
          <div className='stepInfoContent'>
            {t('stepInfoDownloadText')}
            {/* To download the data, click the Download link at the bottom of the panel or top of the page.
              This page allows the user to confirm their data order by verifying dataset titles, records, the size of the download, and inspect dataset details.
              Enter your email address and submit to confirm your order.
              An email providing the direct download link will be sent shortly.
              <i> Note: Filters that have been applied in the search will also be applied to the data download. A 100MB size limit applies to all orders; downloads that are more than 100MB will be cut off at 100MB. Check the bar at the bottom of the panel to verify the order does not exceed the maximum. If the size is over 100MB, please submit multiple orders of smaller sizes.</i> */}
          </div>
        </div>
      )
    default:
      return (
        <div className='tipInfo'>
          <p>
            <a
              className='feedbackButton'
              title={t('feedbackButtonTitle')}
              href='https://docs.google.com/forms/d/1OAmp6_LDrCyb4KQZ3nANCljXw5YVLD4uzMsWyuh47KI/edit'
              target='_blank'
              rel='noreferrer'
            >
              <ChatDots size='30px' />
            </a>
            {t('tipInfoFeedback')}
            {/* Please fill out our user feedback survey! It helps improve this interface and find bugs. */}
          </p>
          <p>
            <img className='infoButtonImage' />
            {t('tipInfoReopen')}
            {/* Click the info button to reopen this information panel. */}
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
        scrollable
        className='introModal'
      >
        <Modal.Header closeButton>
          <Modal.Title
            className='modalHeader'
            id='contained-modal-title-vcenter'
          >
            <span>
              {t('CIOOSDataExplorer') + ' '}
              {/* CIOOS Data Explorer */}
            </span>
            <span className='tagLine'>
              {t('CIOOSQuote')}
              {/* "Ocean Data For Our Ocean Future" */}
            </span>
            {i18n.language === 'en' ? (
              <a
                title={t('CIOOSLogoButtonTitle')}
                className='introLogo english'
                href='https://cioos.ca/'
                target='_blank'
                rel='noreferrer'
              />
            ) : (
              <a
                title={t('CIOOSLogoButtonTitle')}
                className='introLogo french'
                href='https://cioos.ca/'
                target='_blank'
                rel='noreferrer'
              />
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Container fluid>
            {/* {t('test', { test })} */}
            <Row>
              <div className='steps' onMouseOut={() => setHoveredStep()}>
                <div
                  className={`stepImage filterStep ${i18n.language}`}
                  onMouseOver={() => setHoveredStep('filter')}
                >
                  {t('stepInfoFilter')}
                </div>
                <div
                  className={`stepImage selectStep ${i18n.language}`}
                  onMouseOver={() => setHoveredStep('select')}
                >
                  {t('stepInfoSelect')}
                </div>
                <div
                  className={`stepImage inspectStep ${i18n.language}`}
                  onMouseOver={() => setHoveredStep('inspect')}
                >
                  {t('stepInfoInspect')}
                </div>
                <div
                  className={`stepImage downloadStep ${i18n.language}`}
                  onMouseOver={() => setHoveredStep('download')}
                >
                  {t('stepInfoDownload')}
                </div>
              </div>
            </Row>
            <Row className='infoBox'>{generateInfo()}</Row>
          </Container>
        </Modal.Body>
      </Modal>
      {/* <button
        className='introButton'
        onClick={() => setShowModal(true)}
        title={t('introReopenTitle')} // 'Re-open introduction'
      >
        <InfoSquare color='#007bff' size={'25px'} />
      </button> */}
    </div>
  )
}
