import React from 'react'
import { useState, useEffect } from 'react'
import ReactDOM from 'react-dom'
import * as Sentry from "@sentry/react"
import { Integrations } from "@sentry/tracing"
import { Row, Col, Spinner } from 'react-bootstrap'
import { ChatDots, CheckCircle, XCircle } from 'react-bootstrap-icons'

import Controls from "./Controls/Controls.jsx"
import Map from "./Map/Map.js"
import SelectionPanel from './Controls/SelectionPanel/SelectionPanel.jsx'
import SelectionDetails from './Controls/SelectionDetails/SelectionDetails.jsx'
import DownloadDetails from './Controls/DownloadDetails/DownloadDetails.jsx'
import DataDownloadModal from './Controls/DataDownloadModal/DataDownloadModal.jsx'
import Loading from './Controls/Loading/Loading.jsx'
import { defaultEovsSelected, defaultOrgsSelected, defaultStartDate, defaultEndDate, defaultStartDepth, defaultEndDepth, defaultDatatsetsSelected } from './config.js'

import "bootstrap/dist/css/bootstrap.min.css"

import "./styles.css"
import { createDataFilterQueryString, validateEmail, getCurrentRangeLevel, getPointsDataSize } from '../utilities.js'
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
  const [pointsToDownload, setPointsToDownload] = useState()
  const [pointsToReview, setPointsToReview] = useState()
  const [polygon, setPolygon] = useState()
  const [email, setEmail] = useState()
  const [emailValid, setEmailValid] = useState()
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
          text: 'Submitting...'
        })
        break;

      case 'successful':
        setSubmissionFeedback({
          icon: (
            <CheckCircle
              className='text-success'
              size={30}
            />),
          text: 'Request successful. Download link will be sent to email.'
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
          text: 'Request failed'
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

  function handleEmailChange(value) {
    setEmailValid(validateEmail(value))
    setEmail(value)
    setSubmissionState()
  }

  function handleSubmission() {
    setSubmissionState('submitted')
  }

  function submitRequest() {
    fetch(`${server}/download?${createDataFilterQueryString(query, organizations, datasets)}&polygon=${JSON.stringify(polygon)}&datasetPKs=${pointsToDownload.map(point => point.pk).join(',')}&email=${email}`).then((response) => {
      if (response.ok) {
        setSubmissionState('successful')
      } else {
        setSubmissionState('failed')
      }
    })
  }

  function DownloadButton() {
    return (
      <DataDownloadModal
        disabled={_.isEmpty(pointsToReview)}
      >
        <DownloadDetails
          width={770}
          pointsToReview={pointsToReview}
          setPointsToDownload={setPointsToDownload}
        >
          <Col>
            <input className='emailAddress' type='email' placeholder='email@email.com' onChange={e => handleEmailChange(e.target.value)} />
          </Col>
          <Col style={{ maxWidth: '170px' }}>
            <button
              className='submitRequestButton'
              disabled={!emailValid || _.isEmpty(pointsToDownload) || getPointsDataSize(pointsToDownload) / 1000000 > 100 || submissionState === 'submitted'}
              onClick={() => handleSubmission()}
            >
              {
                (!_.isEmpty(pointsToDownload) && submissionFeedback && submissionFeedback.text !== 'submitted' && 'Resubmit Request') ||
                (_.isEmpty(pointsToDownload) && 'Select Data') ||
                'Submit Request'
              }
            </button>
          </Col>
          <Col>
            <Row>
              <Col xs='auto' className='submissionFeedback'>
                {submissionFeedback && submissionFeedback.icon}
                {submissionFeedback && submissionFeedback.text}
              </Col>
              <Col xs='auto'>
              </Col>
            </Row>
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
        setLoading={setLoading}
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
                width={550}
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
      <a title='Return to CIOOS pacific homepage' className='logo' href='https://cioospacific.ca/' />
      {currentRangeLevel && <Legend currentRangeLevel={currentRangeLevel} />}
      <button className='boxQueryButton' id='boxQueryButton' title='Rectangle tool'><div className='rectangleIcon' /></button>
      <a className='feedbackButton' title='Please provide feedback on your experience using CIOOS Data Explorer!' href='https://docs.google.com/forms/d/1OAmp6_LDrCyb4KQZ3nANCljXw5YVLD4uzMsWyuh47KI/edit' target='_blank'>
        <ChatDots size='30px' />
      </a>
      <IntroModal intialOpenState={true} />
    </div>
  );
}


// This is where react reaches into the DOM, finds the <div id="chart"> element, and replaces it with the content of ReactD3Viz's render function JSX.
const domContainer = document.querySelector('#app')
ReactDOM.render(<App />, domContainer)
