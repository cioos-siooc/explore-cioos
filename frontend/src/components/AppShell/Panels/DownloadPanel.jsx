import * as React from 'react'
import { useTranslation } from 'react-i18next'
import isEmpty from 'lodash/isEmpty'

import DownloadDetails from '../../Controls/DownloadDetails/DownloadDetails.jsx'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { useDownload } from '../../../state/download/DownloadProvider.jsx'
import { useUI, PANELS } from '../../../state/ui/UIProvider.jsx'

// The Download panel: order review (DownloadDetails) + email submit.
export default function DownloadPanel () {
  const { t } = useTranslation()
  const { query, timeFilterActive, depthFilterActive } = useFilters()
  const {
    polygon,
    pointsToReview,
    pointsToDownload,
    setPointsToDownload,
    setHoveredDataset
  } = useSelection()
  const {
    email,
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
  } = useDownload()
  const { setActivePanel } = useUI()

  if (isEmpty(pointsToReview)) {
    return (
      <div className='downloadPanel downloadPanelEmpty'>
        {t('dockDownloadEmptyMessage')}
      </div>
    )
  }

  return (
    <div className='downloadPanel'>
      <DownloadDetails
        width={650}
        pointsToReview={pointsToReview}
        setPointsToDownload={setPointsToDownload}
        setHoveredDataset={setHoveredDataset}
        polygon={polygon}
        query={query}
        timeFilterActive={timeFilterActive}
        filterDownloadByTime={filterDownloadByTime}
        setFilterDownloadByTime={setFilterDownloadByTime}
        depthFilterActive={depthFilterActive}
        filterDownloadByDepth={filterDownloadByDepth}
        setFilterDownloadByDepth={setFilterDownloadByDepth}
        polygonFilterActive={polygonFilterActive}
        filterDownloadByPolygon={filterDownloadByPolygon}
        setFilterDownloadByPolygon={setFilterDownloadByPolygon}
        setSubmissionState={setSubmissionState}
        setShowModal={() => setActivePanel(PANELS.datasets)}
      >
        <div className='col'>
          <input
            disabled={submissionState === 'submitted'}
            className='emailAddress'
            type='email'
            value={email}
            placeholder='email@email.com'
            onInput={(e) => handleEmailChange(e.target.value)}
          />
          <button
            className={`submitRequestButton ${
              (!emailValid ||
                isEmpty(pointsToDownload) ||
                submissionState === 'submitted') &&
              'disabled'
            }`}
            disabled={
              !emailValid ||
              isEmpty(pointsToDownload) ||
              submissionState === 'submitted'
            }
            onClick={() => handleSubmission()}
          >
            {(!isEmpty(pointsToDownload) &&
              submissionFeedback &&
              submissionState !== 'submitted' &&
              t('submitRequestButtonResubmitText')) ||
              (isEmpty(pointsToDownload) &&
                t('submitRequestButtonSelectDataText')) ||
              t('submitRequestButtonSubmitText')}
          </button>
        </div>
        <div className='col submissionFeedback'>
          {submissionFeedback && submissionFeedback.icon}
          {submissionFeedback && submissionFeedback.text}
        </div>
      </DownloadDetails>
    </div>
  )
}
