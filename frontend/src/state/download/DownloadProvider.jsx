import * as React from 'react'
import { createContext, useContext, useState, useEffect } from 'react'
import { Check2Circle, XCircle } from 'react-bootstrap-icons'
import Spinner from '../../components/ui/Spinner.jsx'
import { useTranslation } from 'react-i18next'
import isEmpty from 'lodash/isEmpty'

import { server } from '../../config.js'
import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth
} from '../../components/config.js'
import {
  createDataFilterQueryString,
  validateEmail,
  getCookieValue
} from '../../utilities.jsx'
import { useFilters } from '../filters/FilterProvider.jsx'
import { useSelection } from '../selection/SelectionProvider.jsx'

const DownloadContext = createContext()

export function useDownload () {
  return useContext(DownloadContext)
}

export default function DownloadProvider ({ children }) {
  const { t, i18n } = useTranslation()
  const { query, startDate, endDate, startDepth, endDepth } = useFilters()
  const { polygon, pointsToDownload } = useSelection()

  const [email, setEmail] = useState(getCookieValue('email'))
  const [emailValid, setEmailValid] = useState(false)
  const [submissionState, setSubmissionState] = useState()
  const [submissionFeedback, setSubmissionFeedback] = useState()

  const [filterDownloadByTime, setFilterDownloadByTime] = useState(false)
  const [filterDownloadByDepth, setFilterDownloadByDepth] = useState(false)
  const [filterDownloadByPolygon, setFilterDownloadByPolygon] = useState(false)
  const [polygonFilterActive, setPolygonFilterActive] = useState(false)

  useEffect(() => {
    setFilterDownloadByTime(
      startDate !== defaultStartDate || endDate !== defaultEndDate
    )
    setFilterDownloadByDepth(
      startDepth !== defaultStartDepth || endDepth !== defaultEndDepth
    )
  }, [query])

  useEffect(() => {
    setPolygonFilterActive(!isEmpty(polygon))
    setFilterDownloadByPolygon(!isEmpty(polygon))
  }, [polygon])

  useEffect(() => {
    if (isEmpty(pointsToDownload)) {
      setSubmissionFeedback()
    }
  }, [pointsToDownload])

  useEffect(() => {
    setEmailValid(validateEmail(email))
    setSubmissionState()
  }, [email])

  useEffect(() => {
    switch (submissionState) {
    case 'submitted':
      submitRequest()
      setSubmissionFeedback({
        icon: <Spinner className='submissionSpinner' />,
        text: t('submissionStateTextSubmitting') // 'Submitting...'
      })
      break

    case 'successful':
      setSubmissionFeedback({
        icon: <Check2Circle size={30} className='success' />,
        text: t('submissionStateTextSuccess') // Request successful. Download link will be sent to: ' + email
      })
      break

    case 'failed':
      setSubmissionFeedback({
        icon: <XCircle size={30} className='error' />,
        text: t('submissionStateTextFailed') // 'Request failed'
      })
      break

    default:
      setSubmissionFeedback()
      break
    }
  }, [submissionState])

  function handleEmailChange (value) {
    setEmail(value)
  }

  function handleSubmission () {
    setSubmissionState('submitted')
    if (validateEmail(email)) {
      document.cookie = `email=${email}; Secure; max-age=${60 * 60 * 24 * 31}`
    }
  }

  function submitRequest () {
    const downloadQuery = { ...query }
    if (
      (startDate !== defaultStartDate || endDate !== defaultEndDate) &&
      !filterDownloadByTime
    ) {
      downloadQuery.startDate = defaultStartDate
      downloadQuery.endDate = defaultEndDate
    }
    if (
      (startDepth !== defaultStartDepth || endDepth !== defaultEndDepth) &&
      !filterDownloadByDepth
    ) {
      downloadQuery.startDepth = defaultStartDepth
      downloadQuery.endDepth = defaultEndDepth
    }
    let url = `${server}/download?${createDataFilterQueryString(
      downloadQuery
    )}&datasetPKs=${pointsToDownload
      .map((point) => point.pk)
      .join(',')}&email=${email}&lang=${i18n.language}`
    if (polygon && filterDownloadByPolygon) {
      url += `&polygon=${JSON.stringify(polygon)}`
    }
    fetch(url)
      .then((response) => {
        if (response.ok) {
          setSubmissionState('successful')
        } else {
          setSubmissionState('failed')
        }
      })
      .catch((error) => {
        setSubmissionState('failed')
        throw error
      })
  }

  const value = {
    email,
    setEmail,
    emailValid,
    submissionState,
    setSubmissionState,
    submissionFeedback,
    filterDownloadByTime,
    setFilterDownloadByTime,
    filterDownloadByDepth,
    setFilterDownloadByDepth,
    filterDownloadByPolygon,
    setFilterDownloadByPolygon,
    polygonFilterActive,
    handleEmailChange,
    handleSubmission
  }

  return (
    <DownloadContext.Provider value={value}>
      {children}
    </DownloadContext.Provider>
  )
}
