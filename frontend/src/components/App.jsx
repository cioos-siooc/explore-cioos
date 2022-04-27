import React from 'react'
import { useState, useEffect } from 'react'
import * as Sentry from "@sentry/react"
import { Integrations } from "@sentry/tracing"
import { Row, Col, Spinner } from 'react-bootstrap'
import { ChatDots, CheckCircle, XCircle } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import Controls from "./Controls/Controls.jsx"
import Map from "./Map/Map.js"
import SelectionPanel from './Controls/SelectionPanel/SelectionPanel.jsx'
import SelectionDetails from './Controls/SelectionDetails/SelectionDetails.jsx'
import DownloadDetails from './Controls/DownloadDetails/DownloadDetails.jsx'
import DataDownloadModal from './Controls/DataDownloadModal/DataDownloadModal.jsx'
import Loading from './Controls/Loading/Loading.jsx'
import LanguageSelector from './Controls/LanguageSelector/LanguageSelector.jsx'
import { defaultEovsSelected, defaultOrgsSelected, defaultStartDate, defaultEndDate, defaultStartDepth, defaultEndDepth, defaultDatatsetsSelected } from './config.js'

import "bootstrap/dist/css/bootstrap.min.css"

import "./styles.css"
import { createDataFilterQueryString, validateEmail, getCurrentRangeLevel, getPointsDataSize, getCookieValue } from '../utilities.js'
import { server } from '../config.js'
import _ from 'lodash'
import Legend from './Controls/Legend/Legend.jsx'
import IntroModal from './Controls/IntroModal/IntroModal.jsx'

if (process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: "https://ccb1d8806b1c42cb83ef83040dc0d7c0@o56764.ingest.sentry.io/5863595",
    integrations: [new Integrations.BrowserTracing()],

    // Set tracesSampleRate to 1.0 to capture 100%
    // of transactions for performance monitoring.
    // We recommend adjusting this value in production
    tracesSampleRate: 1.0,
  });
}

export default function App() {
  const { t, i18n } = useTranslation()
  const [pointsToDownload, setPointsToDownload] = useState()
  const [pointsToReview, setPointsToReview] = useState()
  const [polygon, setPolygon] = useState()
  const [email, setEmail] = useState()
  const [emailValid, setEmailValid] = useState(false)
  const [submissionState, setSubmissionState] = useState()
  const [submissionFeedback, setSubmissionFeedback] = useState()
  const [loading, setLoading] = useState(true)
  const [organizations, setOrganizations] = useState()
  const [datasets, setDatasets] = useState()
  const [zoom, setZoom] = useState(2)
  const [rangeLevels, setRangeLevels] = useState()
  const [currentRangeLevel, setCurrentRangeLevel] = useState()
  const [query, setQuery] = useState({
    startDate: defaultStartDate,
    endDate: defaultEndDate,
    startDepth: defaultStartDepth,
    endDepth: defaultEndDepth,
    eovsSelected: defaultEovsSelected,
    orgsSelected: defaultOrgsSelected,
    datasetsSelected: defaultDatatsetsSelected
  })


  useEffect(() => {
    if (_.isEmpty(pointsToDownload)) {
      setSubmissionFeedback()
    }
  }, [pointsToDownload])

  useEffect(() => {
    if (_.isEmpty(pointsToReview)) {
      setPointsToDownload()
    }
  }, [pointsToReview])

  useEffect(() => {
    fetch(`${server}/organizations`).then(response => response.json()).then(data => {
      let orgsReturned = {}
      data.forEach(elem => {
        orgsReturned[elem.name] = elem.pk
      })
      fetch(`${server}/datasets`).then(response => response.json()).then(datasetData => {
        let datasetsReturned = {}
        datasetData.forEach(dataset => {
          datasetsReturned[dataset.title] = dataset.pk
        })
        setDatasets(datasetsReturned)
        setOrganizations(orgsReturned)
      })
    }).catch(error => { throw error })
  }, [])

  useEffect(() => {
    switch (submissionState) {
      case 'submitted':
        submitRequest()
        setSubmissionFeedback({
          icon: (
            <Spinner
              className='text-warning'
              as="span"
              animation="border"
              size={30}
              role="status"
              aria-hidden="true"
            />
          ),
          text: t('submissionStateTextSubmitting') //'Submitting...'
        })
        break;

      case 'successful':
        setSubmissionFeedback({
          icon: (
            <CheckCircle
              className='text-success'
              size={30}
            />),
          text: t('submissionStateTextSuccess', { email }) //Request successful. Download link will be sent to: ' + email
        })
        break;

      case 'failed':
        setSubmissionFeedback({
          icon: (
            <XCircle
              className='text-danger'
              size={30}
            />
          ),
          text: t('submissionStateTextFailed') //'Request failed'
        })
        break;

      default:
        setSubmissionFeedback()
        break;
    }
  }, [submissionState])

  useEffect(() => {
    fetch(`${server}/legend?${createDataFilterQueryString(query, organizations, datasets)}`).then(response => response.json()).then(legend => {
      if (legend) {
        setRangeLevels(legend.recordsCount)
      }
    })
  }, [query])

  useEffect(() => {
    if (rangeLevels) {
      setCurrentRangeLevel(getCurrentRangeLevel(rangeLevels, zoom))
    }
  }, [rangeLevels, zoom])

  useEffect(() => {
    setEmailValid(validateEmail(email))
    setSubmissionState()
  }, [email])

  function handleEmailChange(value) {
    setEmail(value)
  }

  function handleSubmission() {
    setSubmissionState('submitted')
  }

  function submitRequest() {
    fetch(`${server}/download?${createDataFilterQueryString(query, organizations, datasets)}&polygon=${JSON.stringify(polygon)}&datasetPKs=${pointsToDownload.map(point => point.pk).join(',')}&email=${email}&lang=${i18n.language}`).then((response) => {
      if (response.ok) {
        setSubmissionState('successful')
      } else {
        setSubmissionState('failed')
      }
    }).catch(err => {
      console.log(err)
      setSubmissionState('failed')
    })
  }

  function DownloadButton() {
    return (
      <DataDownloadModal
        disabled={_.isEmpty(pointsToReview)}
        setEmail={setEmail}
        setSubmissionState={setSubmissionState}
      >
        <DownloadDetails
          width={650}
          pointsToReview={pointsToReview}
          setPointsToDownload={setPointsToDownload}
        >
          <Col>
            <input
              disabled={submissionState === 'submitted'}
              className='emailAddress'
              type='email'
              placeholder='email@email.com'
              onInput={e => handleEmailChange(e.target.value)}
            />
          </Col>
          <Col xs='auto'>
            <button
              className='submitRequestButton'
              disabled={!emailValid || _.isEmpty(pointsToDownload) || getPointsDataSize(pointsToDownload) / 1000000 > 100 || submissionState === 'submitted'}
              onClick={() => handleSubmission()}
            >
              {
                (!_.isEmpty(pointsToDownload) && submissionFeedback && submissionState !== 'submitted' && t('submitRequestButtonResubmitText')) ||
                (_.isEmpty(pointsToDownload) && t('submitRequestButtonSelectDataText')) ||
                t('submitRequestButtonSubmitText') //'Submit Request'
              }
            </button>
          </Col>
          <Col className='submissionFeedback'>
            {submissionFeedback && submissionFeedback.icon}
            {submissionFeedback && submissionFeedback.text}
          </Col>
        </DownloadDetails>
      </DataDownloadModal >
    )
  }

  return (
    <div>
      {loading && <Loading />}
      {rangeLevels &&
        <Map
          setPolygon={setPolygon}
          setPointsToReview={setPointsToReview}
          setLoading={setLoading}
          query={query}
          polygon={polygon}
          organizations={organizations}
          datasets={datasets}
          zoom={zoom}
          setZoom={setZoom}
          rangeLevels={rangeLevels}
        />
      }
      <Controls
        setQuery={setQuery}
        // setLoading={setLoading}
        loading={loading}
      >
        {polygon && (
          <Col xs='auto' className='selectionPanelColumn'>
            <SelectionPanel>
              <SelectionDetails
                pointsToReview={pointsToReview}
                setPointsToReview={setPointsToReview}
                query={query}
                polygon={polygon}
                organizations={organizations}
                datasets={datasets}
              >
                {DownloadButton()}
              </SelectionDetails>
            </SelectionPanel>
          </Col>
        )}
        <div>
          {DownloadButton()}
        </div>
      </Controls>
      {i18n.language === 'en' ?
        <a
          title={t('CIOOSLogoButtonTitle')}
          className='logo english'
          href='https://cioos.ca/'
          target='_blank'
        /> :
        <a
          title={t('CIOOSLogoButtonTitle')}
          className='logo french'
          href='https://cioos.ca/'
          target='_blank'
        />
      }
      {currentRangeLevel && <Legend currentRangeLevel={currentRangeLevel} />}
      <button
        className='boxQueryButton'
        id='boxQueryButton'
        title={t('rectangleToolTitle')}>
        <div className='rectangleIcon' />
      </button>
      <a
        className='feedbackButton'
        title={t('feedbackButtonTitle')}
        href='https://docs.google.com/forms/d/1OAmp6_LDrCyb4KQZ3nANCljXw5YVLD4uzMsWyuh47KI/edit'
        target='_blank'>
        <ChatDots size='30px' />
      </a>
      <IntroModal initialOpenState={true} />
      <LanguageSelector />
    </div >
  );
}
