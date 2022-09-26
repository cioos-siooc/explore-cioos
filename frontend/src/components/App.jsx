import React, { useState, useEffect } from 'react'
import * as Sentry from '@sentry/react'
import { Integrations } from '@sentry/tracing'
import { Col, Spinner } from 'react-bootstrap'
import {
  CheckCircle,
  XCircle,
  ArrowsExpand,
  Building,
  CalendarWeek,
  FileEarmarkSpreadsheet,
  Water,
  BroadcastPin
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import _ from 'lodash'
import platformsJSONfile from '../platforms.json'
import eovsJSONfile from '../eovs.json'
import { server } from '../config.js'
import Controls from './Controls/Controls.jsx'
import Map from './Map/Map.js'
import SelectionPanel from './Controls/SelectionPanel/SelectionPanel.jsx'
import SelectionDetails from './Controls/SelectionDetails/SelectionDetails.jsx'
import DownloadDetails from './Controls/DownloadDetails/DownloadDetails.jsx'
import DataDownloadModal from './Controls/DataDownloadModal/DataDownloadModal.jsx'
import Loading from './Controls/Loading/Loading.jsx'
import Legend from './Controls/Legend/Legend.jsx'
import IntroModal from './Controls/IntroModal/IntroModal.jsx'
import Filter from './Controls/Filter/Filter.jsx'
import MultiCheckboxFilter from './Controls/Filter/MultiCheckboxFilter/MultiCheckboxFilter.jsx'
import TimeSelector from './Controls/Filter/TimeSelector/TimeSelector.jsx'
import DepthSelector from './Controls/Filter/DepthSelector/DepthSelector.jsx'
import ErrorBoundary from './ErrorBoundary/ErrorBoundary.jsx'
import EnglishLogo from './Images/CIOOSNationalLogoBlackEnglish.svg'
import FrenchLogo from './Images/CIOOSNationalLogoBlackFrench.svg'
import {
  defaultEovsSelected,
  defaultOrgsSelected,
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth,
  defaultDatatsetsSelected,
  defaultPlatformsSelected
} from './config.js'
import {
  createDataFilterQueryString,
  validateEmail,
  getCurrentRangeLevel,
  getPointsDataSize,
  generateMultipleSelectBadgeTitle,
  generateRangeSelectBadgeTitle,
  useDebounce,
  setAllOptionsIsSelectedTo
} from '../utilities.js'

import 'bootstrap/dist/css/bootstrap.min.css'
import './styles.css'

if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: 'https://ccb1d8806b1c42cb83ef83040dc0d7c0@o56764.ingest.sentry.io/5863595',
    integrations: [new Integrations.BrowserTracing()],

    // Set tracesSampleRate to 1.0 to capture 100%
    // of transactions for performance monitoring.
    // We recommend adjusting this value in production
    tracesSampleRate: 1.0
  })
}

export default function App() {
  const { t, i18n } = useTranslation()
  const [selectionPanelOpen, setSelectionPanelOpen] = useState(true)
  const [pointsToDownload, setPointsToDownload] = useState()
  const [pointsToReview, setPointsToReview] = useState()
  const [polygon, setPolygon] = useState()
  const [email, setEmail] = useState()
  const [emailValid, setEmailValid] = useState(false)
  const [submissionState, setSubmissionState] = useState()
  const [submissionFeedback, setSubmissionFeedback] = useState()
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(2)
  const [rangeLevels, setRangeLevels] = useState()
  const [currentRangeLevel, setCurrentRangeLevel] = useState()
  const [hoveredDataset, setHoveredDataset] = useState()
  const [query, setQuery] = useState({
    startDate: defaultStartDate,
    endDate: defaultEndDate,
    startDepth: defaultStartDepth,
    endDepth: defaultEndDepth,
    eovsSelected: defaultEovsSelected,
    orgsSelected: defaultOrgsSelected,
    datasetsSelected: defaultDatatsetsSelected,
    platformsSelected: defaultPlatformsSelected
  })

  // EOV filter initial values and state
  const [eovsSelected, setEovsSelected] = useState(defaultEovsSelected)
  const debouncedEovsSelected = useDebounce(eovsSelected, 500)
  const eovsFilterTranslationKey = 'oceanVariablesFiltername' // 'Ocean Variables'
  const eovsBadgeTitle = generateMultipleSelectBadgeTitle(
    eovsFilterTranslationKey,
    eovsSelected
  )
  const [eovsSearchTerms, setEovsSearchTerms] = useState('')

  // Organization filter initial values from API and state
  const [orgsSelected, setOrgsSelected] = useState(defaultOrgsSelected)
  const debouncedOrgsSelected = useDebounce(orgsSelected, 500)
  const orgsFilterTranslationKey = 'organizationFilterName' // 'Organizations'
  const orgsBadgeTitle = generateMultipleSelectBadgeTitle(
    orgsFilterTranslationKey,
    orgsSelected
  )
  const [orgsSearchTerms, setOrgsSearchTerms] = useState('')

  // Dataset filter initial values and state
  const [datasetsSelected, setDatasetsSelected] = useState(
    defaultDatatsetsSelected
  )
  const debouncedDatasetsSelected = useDebounce(datasetsSelected, 500)
  const datasetsFilterTranslationKey = 'datasetsFilterName' // 'Datasets'
  const datasetsBadgeTitle = generateMultipleSelectBadgeTitle(
    datasetsFilterTranslationKey,
    datasetsSelected
  )
  const [datasetSearchTerms, setDatasetSearchTerms] = useState('')

  // Dataset filter initial values and state
  const [platformsSelected, setPlatformsSelected] = useState(
    defaultPlatformsSelected
  )
  const debouncedPlatformsSelected = useDebounce(platformsSelected, 500)
  const platformsFilterTranslationKey = 'platformsFilterName' // 'Datasets'
  const platformsBadgeTitle = generateMultipleSelectBadgeTitle(
    platformsFilterTranslationKey,
    platformsSelected
  )
  const [platformsSearchTerms, setPlatformsSearchTerms] = useState('')

  // Timeframe filter initial values and state
  const [startDate, setStartDate] = useState(defaultStartDate)
  const debouncedStartDate = useDebounce(startDate, 500)
  const [endDate, setEndDate] = useState(defaultEndDate)
  const debouncedEndDate = useDebounce(endDate, 500)
  const timeframesFilterName = t('timeframeFilterName') // 'Timeframe'
  const timeframesBadgeTitle = generateRangeSelectBadgeTitle(
    timeframesFilterName,
    [startDate, endDate],
    [defaultStartDate, defaultEndDate]
  )

  // Depth filter initial values and state
  const [startDepth, setStartDepth] = useState(defaultStartDepth)
  const debouncedStartDepth = useDebounce(startDepth, 500)
  const [endDepth, setEndDepth] = useState(defaultEndDepth)
  const debouncedEndDepth = useDebounce(endDepth, 500)
  const depthRangeFilterName = t('depthRangeFilterName') // 'Depth Range (m)'
  const depthRangeBadgeTitle = generateRangeSelectBadgeTitle(
    depthRangeFilterName,
    [startDepth, endDepth],
    [defaultStartDepth, defaultEndDepth],
    '(m)'
  )

  // Filter open state
  const [openFilter, setOpenFilter] = useState()

  // TODO: consider adding a 'searched' property to the options to indicate whether they satisfy the search terms,
  // and removing the extra concept of 'allOptions' vs 'selectedOptions'

  // Update query
  useEffect(() => {
    setQuery({
      startDate,
      endDate,
      startDepth,
      endDepth,
      eovsSelected,
      orgsSelected,
      datasetsSelected,
      platformsSelected
    })
  }, [
    debouncedStartDate,
    debouncedEndDate,
    debouncedStartDepth,
    debouncedEndDepth,
    debouncedEovsSelected,
    debouncedOrgsSelected,
    debouncedDatasetsSelected,
    debouncedPlatformsSelected
  ])

  function createOptionSubset(searchTerms, allOptions) {
    if (searchTerms) {
      return allOptions.filter((option) =>
        option.title
          .toLowerCase()
          .includes(searchTerms.toString().toLowerCase())
      )
    } else {
      return allOptions
    }
  }

  useEffect(() => {
    if (_.isEmpty(pointsToDownload)) {
      setSubmissionFeedback()
    }
  }, [pointsToDownload])

  useEffect(() => {
    if (_.isEmpty(pointsToReview)) {
      setPointsToDownload()
    }
    setSelectionPanelOpen(true)
  }, [pointsToReview])

  // Filter option data structure:
  /*
  [{
    title: 'abc',
    isSelected: boolean,
    titleTranslated: {
      en: 'abc',
      fr: 'def'
    },
    pk: 123
  }]
  */
  useEffect(() => {
    /* /platforms returns array of platform names:
      ['abc', 'def', ...]
    */
    fetch(`${server}/platforms`)
      .then((response) => response.json())
      .then((platforms) => {
        setPlatformsSelected(
          platforms.map((platform, index) => {
            const platformMetadata = platformsJSONfile.find(
              (p) => p.label_en === platform
            )

            return {
              title: platform,
              pk: platform,
              isSelected: false,
              hover_en: platformMetadata.definition_en,
              hover_fr: platformMetadata.definition_fr
            }
          })
        )
      })
      .catch((error) => {
        throw error
      })

    /* /oceanVariables returns array of variable names:
      ['abc', 'def', ...]
    */
    fetch(`${server}/oceanVariables`)
      .then((response) => response.json())
      .then((eovs) => {
        setEovsSelected(
          eovs.map((eov, index) => {
            const eovMetadata = eovsJSONfile.eovs.find((e) => e.value === eov)

            return {
              title: eov,
              isSelected: false,
              pk: index,
              hover_en: eovMetadata['definition EN'],
              hover_fr: eovMetadata['definition FR']
            }
          })
        )
      })
      .catch((error) => {
        throw error
      })

    /* /organizations returns array of org objects:
      [
        {
          color:null,
          name:'abc',
          pk_text:null
          pk:87,
        },
        ...
      ]
    */
    fetch(`${server}/organizations`)
      .then((response) => response.json())
      .then((orgsR) => {
        setOrgsSelected(
          orgsR.map((org) => {
            return {
              title: org.name,
              isSelected: false,
              pk: org.pk
            }
          })
        )
      })
      .catch((error) => {
        throw error
      })

    /* /datasets returns array of dataset objects
      [
        {
          title:'abc',
          title_translated:
            {
              en: 'abc',
              fr: 'def'
            }
          organization_pks: [54, ...],
          pk: 86923,
        }
      ]
    */
    fetch(`${server}/datasets`)
      .then((response) => response.json())
      .then((datasetsR) => {
        setDatasetsSelected(
          datasetsR.map((dataset) => {
            return {
              title: dataset.title,
              titleTranslated: dataset.title_translated,
              platform: dataset.platform,
              isSelected: false,
              pk: dataset.pk
            }
          })
        )
      })
      .catch((error) => {
        throw error
      })

    /** Get initial legend values */
    fetch(`${server}/legend?${createDataFilterQueryString(query)}`)
      .then((response) => response.json())
      .then((legend) => {
        if (legend) {
          setRangeLevels(legend.recordsCount)
        }
      })
      .catch((error) => {
        throw error
      })
  }, [])

  useEffect(() => {
    switch (submissionState) {
      case 'submitted':
        submitRequest()
        setSubmissionFeedback({
          icon: (
            <Spinner
              className='text-warning'
              as='span'
              animation='border'
              size={30}
              role='status'
              aria-hidden='true'
            />
          ),
          text: t('submissionStateTextSubmitting') // 'Submitting...'
        })
        break

      case 'successful':
        setSubmissionFeedback({
          icon: <CheckCircle className='text-success' size={30} />,
          text: t('submissionStateTextSuccess', { email }) // Request successful. Download link will be sent to: ' + email
        })
        break

      case 'failed':
        setSubmissionFeedback({
          icon: <XCircle className='text-danger' size={30} />,
          text: t('submissionStateTextFailed') // 'Request failed'
        })
        break

      default:
        setSubmissionFeedback()
        break
    }
  }, [submissionState])

  useEffect(() => {
    if (!loading && !_.isEmpty(rangeLevels)) {
      fetch(`${server}/legend?${createDataFilterQueryString(query)}`)
        .then((response) => response.json())
        .then((legend) => {
          if (legend) {
            setRangeLevels(legend.recordsCount)
          }
        })
    }
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
    fetch(
      `${server}/download?${createDataFilterQueryString(
        query
      )}&polygon=${JSON.stringify(polygon)}&datasetPKs=${pointsToDownload
        .map((point) => point.pk)
        .join(',')}&email=${email}&lang=${i18n.language}`
    )
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
              onInput={(e) => handleEmailChange(e.target.value)}
            />
          </Col>
          <Col xs='auto'>
            <button
              className='submitRequestButton'
              disabled={
                !emailValid ||
                _.isEmpty(pointsToDownload) ||
                getPointsDataSize(pointsToDownload) / 1000000 > 100 ||
                submissionState === 'submitted'
              }
              onClick={() => handleSubmission()}
            >
              {
                (!_.isEmpty(pointsToDownload) &&
                  submissionFeedback &&
                  submissionState !== 'submitted' &&
                  t('submitRequestButtonResubmitText')) ||
                (_.isEmpty(pointsToDownload) &&
                  t('submitRequestButtonSelectDataText')) ||
                t('submitRequestButtonSubmitText') // 'Submit Request'
              }
            </button>
          </Col>
          <Col className='submissionFeedback'>
            {submissionFeedback && submissionFeedback.icon}
            {submissionFeedback && submissionFeedback.text}
          </Col>
        </DownloadDetails>
      </DataDownloadModal>
    )
  }

  return (
    <ErrorBoundary
      errorBoundaryMessage={t('errorBoundaryMessage')}
      logoSource={i18n.language === 'en' ? EnglishLogo : FrenchLogo}
    >
      {loading && <Loading />}
      {rangeLevels && (
        <Map
          setPolygon={setPolygon}
          setPointsToReview={setPointsToReview}
          setLoading={setLoading}
          query={query}
          polygon={polygon}
          zoom={zoom}
          setZoom={setZoom}
          rangeLevels={rangeLevels}
          offsetFlyTo={selectionPanelOpen}
          hoveredDataset={hoveredDataset}
        />
      )}
      <Controls
        loading={loading}
        selectionPanel={
          <Col xs='auto' className='selectionPanelColumn'>
            <SelectionPanel
              open={selectionPanelOpen}
              setOpen={setSelectionPanelOpen}
            >
              <SelectionDetails
                pointsToReview={pointsToReview}
                setPointsToReview={setPointsToReview}
                query={query}
                polygon={polygon}
                setHoveredDataset={setHoveredDataset}
                filterSet={{
                  eovFilter: { eovsSelected, setEovsSelected },
                  platformFilter: { platformsSelected, setPlatformsSelected },
                  orgFilter: { orgsSelected, setOrgsSelected },
                  datasetFilter: { datasetsSelected, setDatasetsSelected }
                }}
              >
                {DownloadButton()}
              </SelectionDetails>
            </SelectionPanel>
          </Col>
        }
      >
        <Filter
          active={eovsSelected.filter((eov) => eov.isSelected).length !== 0}
          badgeTitle={eovsBadgeTitle}
          optionsSelected={eovsSelected}
          setOptionsSelected={setEovsSelected}
          tooltip={t('oceanVariableFilterTooltip')} // 'Filter data by ocean variable name. Selection works as logical OR operation.'
          icon={<Water />}
          controlled
          searchable
          searchTerms={eovsSearchTerms}
          setSearchTerms={setEovsSearchTerms}
          searchPlaceholder={t('oceanVariableFilterSeachPlaceholder')} // 'Search for ocean variable name...'
          filterName={eovsFilterTranslationKey}
          openFilter={openFilter === eovsFilterTranslationKey}
          setOpenFilter={setOpenFilter}
          selectAllButton={() =>
            setAllOptionsIsSelectedTo(true, eovsSelected, setEovsSelected)
          }
          resetButton={() =>
            setAllOptionsIsSelectedTo(false, eovsSelected, setEovsSelected)
          }
          numberOfOptions={eovsSelected.length}
        >
          <MultiCheckboxFilter
            optionsSelected={createOptionSubset(eovsSearchTerms, eovsSelected)}
            setOptionsSelected={setEovsSelected}
            searchable
            translatable
            allOptions={eovsSelected}
          />
        </Filter>
        <Filter
          active={
            platformsSelected.filter((eov) => eov.isSelected).length !== 0
          }
          badgeTitle={platformsBadgeTitle}
          setOptionsSelected={setPlatformsSelected}
          tooltip={t('platformFilterTooltip')} // 'Filter data by ocean variable name. Selection works as logical OR operation.'
          icon={<BroadcastPin />}
          controlled
          searchable
          searchTerms={platformsSearchTerms}
          setSearchTerms={setPlatformsSearchTerms}
          searchPlaceholder={t('platformsFilterSeachPlaceholder')} // 'Search for ocean variable name...'
          filterName={platformsFilterTranslationKey}
          openFilter={openFilter === platformsFilterTranslationKey}
          setOpenFilter={setOpenFilter}
          selectAllButton={() =>
            setAllOptionsIsSelectedTo(
              true,
              platformsSelected,
              setPlatformsSelected
            )
          }
          resetButton={() =>
            setAllOptionsIsSelectedTo(
              false,
              platformsSelected,
              setPlatformsSelected
            )
          }
          numberOfOptions={platformsSelected.length}
          infoButton='http://vocab.nerc.ac.uk/collection/L06/current/'
        >
          <MultiCheckboxFilter
            optionsSelected={createOptionSubset(
              platformsSearchTerms,
              platformsSelected
            )}
            setOptionsSelected={setPlatformsSelected}
            searchable
            colored
            translatable
            allOptions={platformsSelected}
          />
        </Filter>
        <Filter
          active={orgsSelected.filter((eov) => eov.isSelected).length !== 0}
          badgeTitle={orgsBadgeTitle}
          optionsSelected={orgsSelected}
          setOptionsSelected={setOrgsSelected}
          tooltip={t('organizationFilterTooltip')} // 'Filter data by responsible organisation name. Selection works as logical OR operation.'
          icon={<Building />}
          controlled
          searchable
          searchTerms={orgsSearchTerms}
          setSearchTerms={setOrgsSearchTerms}
          searchPlaceholder={t('organizationFilterSearchPlaceholder')} // 'Search for organization name...'
          filterName={orgsFilterTranslationKey}
          openFilter={openFilter === orgsFilterTranslationKey}
          setOpenFilter={setOpenFilter}
          selectAllButton={() =>
            setAllOptionsIsSelectedTo(true, orgsSelected, setOrgsSelected)
          }
          resetButton={() =>
            setAllOptionsIsSelectedTo(false, orgsSelected, setOrgsSelected)
          }
          numberOfOptions={orgsSelected.length}
        >
          <MultiCheckboxFilter
            optionsSelected={createOptionSubset(orgsSearchTerms, orgsSelected)}
            setOptionsSelected={setOrgsSelected}
            searchable
            allOptions={orgsSelected}
          />
        </Filter>
        <Filter
          active={datasetsSelected.filter((eov) => eov.isSelected).length !== 0}
          badgeTitle={datasetsBadgeTitle}
          optionsSelected={datasetsSelected}
          setOptionsSelected={setDatasetsSelected}
          tooltip={t('datasetFilterTooltip')} // 'Filter data by dataset name. Selection works as logical OR operation.'
          icon={<FileEarmarkSpreadsheet />}
          controlled
          searchable
          searchTerms={datasetSearchTerms}
          setSearchTerms={setDatasetSearchTerms}
          searchPlaceholder={t('datasetSearchPlaceholder')} // 'Search for dataset name...'
          filterName={datasetsFilterTranslationKey}
          openFilter={openFilter === datasetsFilterTranslationKey}
          setOpenFilter={setOpenFilter}
          selectAllButton={() =>
            setAllOptionsIsSelectedTo(
              true,
              datasetsSelected,
              setDatasetsSelected
            )
          }
          resetButton={() =>
            setAllOptionsIsSelectedTo(
              false,
              datasetsSelected,
              setDatasetsSelected
            )
          }
          numberOfOptions={datasetsSelected.length}
        >
          <MultiCheckboxFilter
            optionsSelected={createOptionSubset(
              datasetSearchTerms,
              datasetsSelected
            )}
            setOptionsSelected={setDatasetsSelected}
            searchable
            allOptions={datasetsSelected}
            translatable
          />
        </Filter>
        <Filter
          active={startDate !== defaultStartDate || endDate !== defaultEndDate}
          badgeTitle={timeframesBadgeTitle}
          optionsSelected={(startDate, endDate)}
          setOptionsSelected={() => {
            setStartDate('1900-01-01')
            setEndDate(new Date().toISOString().split('T')[0])
          }}
          tooltip={t('timeframeFilterTooltip')} // 'Filter data by timeframe. Selection works as inclusive range.'
          icon={<CalendarWeek />}
          controlled
          filterName={timeframesFilterName}
          openFilter={openFilter === timeframesFilterName}
          setOpenFilter={setOpenFilter}
          resetButton={() => {
            setStartDate('1900-01-01')
            setEndDate(new Date().toISOString().split('T')[0])
          }}
        >
          <TimeSelector
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
          />
        </Filter>
        <Filter
          active={
            startDepth !== defaultStartDepth || endDepth !== defaultEndDepth
          }
          badgeTitle={depthRangeBadgeTitle}
          optionsSelected={(startDepth, endDepth)}
          setOptionsSelected={() => {
            setStartDepth(0)
            setEndDepth(12000)
          }}
          tooltip={t('depthrangeFilterTooltip')} // 'Filter data by depth. Selection works as inclusive range.'
          icon={<ArrowsExpand />}
          controlled
          filterName={depthRangeFilterName}
          openFilter={openFilter === depthRangeFilterName}
          setOpenFilter={setOpenFilter}
          resetButton={() => {
            setStartDepth(0)
            setEndDepth(12000)
          }}
        >
          <DepthSelector
            startDepth={startDepth}
            setStartDepth={setStartDepth}
            endDepth={endDepth}
            setEndDepth={setEndDepth}
          />
        </Filter>
      </Controls>
      {currentRangeLevel && (
        <Legend
          currentRangeLevel={currentRangeLevel}
          zoom={zoom}
          selectionPanelOpen={selectionPanelOpen}
          platformsInView={platformsSelected.map((e) => e.title)}
        />
      )}
      <button
        className='boxQueryButton'
        id='boxQueryButton'
        title={t('rectangleToolTitle')}
      >
        <div className='rectangleIcon' />
      </button>
      <IntroModal initialOpenState={true} />
    </ErrorBoundary>
  )
}
