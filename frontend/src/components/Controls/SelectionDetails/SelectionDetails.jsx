import * as React from 'react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { InfoSquare, ChatDots, Filter, FileEarmarkSpreadsheet, Download } from 'react-bootstrap-icons'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import DatasetPreview from '../DatasetPreview/DatasetPreview.jsx'
import DatasetInspector from '../DatasetInspector/DatasetInspector.jsx'
import LanguageSelector from '../LanguageSelector/LanguageSelector.jsx'
import Loading from '../Loading/Loading.jsx'
import CIOOSLogoEN from '../../Images/CIOOSNationalLogoBlackEnglish.svg'
import CIOOSLogoFR from '../../Images/CIOOSNationalLogoBlackFrench.svg'
import CDELogoEN from '../../Images/CDELogoEN.png'
import CDELogoFR from '../../Images/CDELogoFR.png'
import { server } from '../../../config'
import './styles.css'
import {
  createDataFilterQueryString,
  getPointsDataSize,
  createSelectionQueryString,
  useDebounce
} from '../../../utilities.js'

import isEmpty from 'lodash/isEmpty'

// Note: datasets and points are exchangable terminology
export default function SelectionDetails({
  setPointsToReview,
  query,
  polygon,
  setPolygon,
  setHoveredDataset,
  filterSet,
  setShowIntroModal,
  totalNumberOfDatasets,
  resetFilters,
  children
}) {
  const { t, i18n } = useTranslation()
  const [selectAll, setSelectAll] = useState(false)
  const [pointsData, setPointsData] = useState([])
  const [inspectDataset, setInspectDataset] = useState()
  const [, setDataTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [initialPointsQueryComplete, setInitialPointsQueryComplete] =
    useState(false)
  const [inspectRecordID, setInspectRecordID] = useState()
  const [showModal, setShowModal] = useState(false)
  const [recordLoading, setRecordLoading] = useState(false)
  const [backClicked, setBackClicked] = useState(false)
  const [datasetPreview, setDatasetPreview] = useState()
  const [datasetTitleSearchText] = useState('')
  const debouncedDatasetTitleSearchText = useDebounce(
    datasetTitleSearchText,
    300
  )
  const [datasetsSelected, setDatasetsSelected] = useState()
  const [filteredDatasets, setFilteredDatasets] = useState([])
  const [combinedQueries, setCombinedQueries] = useState([])

  useEffect(() => {
    if (!isEmpty(debouncedDatasetTitleSearchText)) {
      setFilteredDatasets(
        pointsData.filter((dataset) => {
          return `${dataset.title}`
            .toLowerCase()
            .includes(`${debouncedDatasetTitleSearchText}`.toLowerCase())
        })
      )
    } else {
      setFilteredDatasets(pointsData)
    }
  }, [debouncedDatasetTitleSearchText])

  useEffect(() => {
    if (!isEmpty(pointsData)) {
      let count = 0
      pointsData.forEach((point) => {
        if (point.selected) count++
      })
      setDatasetsSelected(count)
      setDataTotal(0)
      const total = getPointsDataSize(pointsData)
      setDataTotal(total / 1000000)
      setPointsToReview(pointsData.filter((point) => point.selected))
    }
    setLoading(false)
    if (pointsData.length === 1 && !backClicked) {
      // Auto load single selected dataset
      setInspectDataset(pointsData[0])
      // setLoading(true)
    }
  }, [pointsData])

  function datasetsInLanguage(point) {
    return {
      ...point,
      title: point.title_translated[i18n.language] || point.title,
      selected: false
    }
  }
  useEffect(() => {
    setDataTotal(0)
    if (!loading && query.eovsSelected.length) {
      const filtersQuery = createDataFilterQueryString(query)
      let shapeQuery = []
      if (polygon) {
        shapeQuery = createSelectionQueryString(polygon)
      }
      const combinedQueries = [filtersQuery, shapeQuery]
        .filter((e) => e)
        .join('&')
      setInspectDataset()
      setLoading(true)
      setCombinedQueries(combinedQueries)
      const urlString = `${server}/pointQuery${
        combinedQueries ? '?' + combinedQueries : ''
      }`
      fetch(urlString).then((response) => {
        if (response.ok) {
          response.json().then((data) => {
            setPointsData(data.map(datasetsInLanguage))
          })
        } else {
          setPointsData([])
        }
        setInitialPointsQueryComplete(true)
      })
    }
    setBackClicked(false)
  }, [query, polygon])

  useEffect(() => {
    if (!loading) {
      setPointsData(pointsData.map(datasetsInLanguage))
    }
  }, [i18n.language])

  function handleSelectDataset(point) {
    const dataset = pointsData.filter((p) => p.pk === point.pk)[0]
    dataset.selected = !point.selected
    const result = pointsData.map((p) => {
      if (p.pk === point.pk) {
        return dataset
      } else {
        return p
      }
    })
    setPointsData(result)
  }

  function handleSelectAllDatasets() {
    setPointsData(
      pointsData.map((p) => {
        return {
          ...p,
          selected: !selectAll
        }
      })
    )
    setSelectAll(!selectAll)
  }

  useEffect(() => {
    if (inspectDataset) {
      if (inspectRecordID) {
        setShowModal(true)
        setRecordLoading(true)
        fetch(
          `${server}/preview?dataset=${inspectDataset.dataset_id}&profile=${inspectRecordID}`
        )
          .then((response) => response.json())
          .then((preview) => {
            setDatasetPreview(preview)
            setRecordLoading(false)
          })
          .catch((error) => {
            throw error
          })
      }
    } else {
      setInspectRecordID()
    }
  }, [inspectRecordID])

  return (
    <div
      className='pointDetails'
      onMouseEnter={() => setHoveredDataset(inspectDataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      <div className='pointDetailsHeader'>
        <img
          className='pointDetailsHeaderLogo CIOOS'
          src={i18n.language === 'en' ? CIOOSLogoEN : CIOOSLogoFR}
          onClick={() =>
            i18n.language === 'en'
              ? window.open('https://www.cioos.ca')
              : window.open('https://www.siooc.ca/fr/accueil/')
          }
          title={t('PointDetailsCIOOSLogoTitleText')}
        />
        <img
          className='pointDetailsHeaderLogo CDE'
          src={i18n.language === 'en' ? CDELogoEN : CDELogoFR}
          title={t('PointDetailsCDELogoTitleText')}
          onClick={() => {
            resetFilters()
            setPolygon()
          }}
        />
        <button
          className='pointDetailsHeaderIntroButton'
          onClick={() => setShowIntroModal(true)}
          title={t('introReopenTitle')} // 'Re-open introduction'
        >
          <InfoSquare color='#007bff' size={'25px'} />
        </button>
        <a
          className='feedbackButton'
          title={t('feedbackButtonTitle')}
          href='https://docs.google.com/forms/d/1OAmp6_LDrCyb4KQZ3nANCljXw5YVLD4uzMsWyuh47KI/edit'
          target='_blank'
          rel='noreferrer'
        >
          <ChatDots size='28px' color='#007bff' />
        </a>
        <LanguageSelector className='noPosition' />
      </div>
      <div
        className={`pointDetailsInfoRow ${inspectDataset ? 'fullHeight' : ''}`}
      >
        {loading || !initialPointsQueryComplete ? (
          <Loading />
        ) : inspectDataset ? (
          <DatasetInspector
            dataset={inspectDataset}
            setHoveredDataset={setHoveredDataset}
            setBackClicked={setBackClicked}
            setInspectDataset={setInspectDataset}
            setInspectRecordID={setInspectRecordID}
            filterSet={filterSet}
            query={combinedQueries}
          />
        ) : (
          <>
            <DatasetsTable
              handleSelectAllDatasets={handleSelectAllDatasets}
              handleSelectDataset={handleSelectDataset}
              setInspectDataset={setInspectDataset}
              setInspectRecordID={setInspectRecordID}
              filterSet={filterSet}
              selectAll={selectAll}
              setDatasets={setPointsData}
              datasets={
                isEmpty(debouncedDatasetTitleSearchText)
                  ? pointsData
                  : filteredDatasets
              }
              setHoveredDataset={setHoveredDataset}
            />
            {/* {(!pointsData || pointsData.length === 0) &&
                <div className="noDataNotice">
                  {t('selectionDetailsNoDataWarning')} */}
            {/* No Data. Modify filters or change selection on map. */}
            {/* </div>
              } */}
            <div className='pointDetailsControls'>
              <div className='pointDetailsControlRow'>
                <div className='pointDetailsControlRowGridContainer' >
                  <div className='numberOfDatasets'
                    title={t('pointDetailsControlRowDatasetsSelected')}
                  >
                    <strong>{totalNumberOfDatasets}</strong>
                    {' '}
                    <FileEarmarkSpreadsheet size={18} />
                  </div>
                  <div className='filteredDatasets'
                    title={t('pointDetailsControlRowFilteredDatasets')}
                  >
                    <strong>{pointsData.length}</strong>
                    {' '}
                    <Filter size={18} />
                  </div>
                  <div className='selectedDatasets'
                    title={t('pointDetailsControlRowToDownload')}
                  >
                    <strong>{datasetsSelected}</strong>
                    {' '}
                    <Download size={18} />
                  </div>
                </div>
                {/* {t('pointDetailsControlRowDatasetsSelected')}{' '}
                <strong>{totalNumberOfDatasets}</strong>
                Filtered
                <strong>{pointsData.length}</strong>
                {t('pointDetailsControlRowToDownload')}{' '}
                <strong>{datasetsSelected}</strong> */}
                {children}
              </div>
            </div>
          </>
        )}
      </div>
      <DatasetPreview
        datasetPreview={datasetPreview}
        setDatasetPreview={setDatasetPreview}
        inspectDataset={inspectDataset}
        setInspectDataset={setInspectDataset}
        showModal={showModal || recordLoading}
        setShowModal={setShowModal}
        inspectRecordID={inspectRecordID}
        setInspectRecordID={setInspectRecordID}
        recordLoading={recordLoading}
        setRecordLoading={setRecordLoading}
      />
    </div >
  )
}
