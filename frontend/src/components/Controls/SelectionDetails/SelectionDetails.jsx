import * as React from 'react'
import { useState, useEffect } from 'react'
import { ProgressBar } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import { InfoSquare, X } from 'react-bootstrap-icons'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import DatasetPreview from '../DatasetPreview/DatasetPreview.jsx'
import DatasetInspector from '../DatasetInspector/DatasetInspector.jsx'
import QuestionIconTooltip from '../QuestionIconTooltip/QuestionIconTooltip.jsx'
import LanguageSelector from '../LanguageSelector/LanguageSelector.jsx'
import Loading from '../Loading/Loading.jsx'
import Logo from '../../Images/logo_FINAL.png'
import { server } from '../../../config'
import './styles.css'
import {
  bytesToMemorySizeString,
  createDataFilterQueryString,
  getPointsDataSize,
  createSelectionQueryString,
  useDebounce
} from '../../../utilities.js'
import _ from 'lodash'

// Note: datasets and points are exchangable terminology
export default function SelectionDetails({
  setPointsToReview,
  query,
  polygon,
  setHoveredDataset,
  filterSet,
  children
}) {
  const { t, i18n } = useTranslation()
  const [selectAll, setSelectAll] = useState(false)
  const [pointsData, setPointsData] = useState([])
  const [inspectDataset, setInspectDataset] = useState()
  const [dataTotal, setDataTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [inspectRecordID, setInspectRecordID] = useState()
  const [showModal, setShowModal] = useState(false)
  const [recordLoading, setRecordLoading] = useState(false)
  const [datasetPreview, setDatasetPreview] = useState()
  const [datasetTitleSearchText, setDatasetTitleSearchText] = useState('')
  const debouncedDatasetTitleSearchText = useDebounce(
    datasetTitleSearchText,
    300
  )
  const [datasetsSelected, setDatasetsSelected] = useState()
  const [filteredDatasets, setFilteredDatasets] = useState([])

  useEffect(() => {
    if (!_.isEmpty(debouncedDatasetTitleSearchText)) {
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
    if (!_.isEmpty(pointsData)) {
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
    if (pointsData.length === 1) {
      // Auto load single selected dataset
      setInspectDataset(pointsData[0])
      // setLoading(true)
    }
  }, [pointsData])

  useEffect(() => {
    setDataTotal(0)
    if (!loading) {
      const filtersQuery = createDataFilterQueryString(query)
      let shapeQuery = []
      if (polygon) {
        shapeQuery = createSelectionQueryString(polygon)
      }
      const combinedQueries =
        '?' + [filtersQuery, shapeQuery].filter((e) => e).join('&')
      setInspectDataset()
      setLoading(true)
      const urlString = `${server}/pointQuery${combinedQueries}`
      fetch(urlString).then((response) => {
        if (response.ok) {
          response.json().then((data) => {
            setPointsData(
              data.map((point) => {
                return {
                  ...point,
                  title: point.title_translated[i18n.language] || point.title,
                  selected: false
                }
              })
            )
          })
        } else {
          setPointsData([])
        }
      })
    }
  }, [query, polygon, i18n.language])

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
        <button
          className='pointDetailsHeaderIntroButton'
          onClick={() => alert('open intro modal')}
          title={t('introReopenTitle')} // 'Re-open introduction'
        >
          <InfoSquare color='#007bff' size={'25px'} />
        </button>
        <img
          className='pointDetailsHeaderLogo'
          src={Logo}
          onClick={() => alert('reset application')}
        />
        <LanguageSelector className='noPosition' />
      </div>
      <div className='pointDetailsInfoRow'>
        {loading ? (
          <Loading />
        ) : inspectDataset ? (
          <DatasetInspector
            dataset={inspectDataset}
            setHoveredDataset={setHoveredDataset}
            setInspectDataset={setInspectDataset}
            setInspectRecordID={setInspectRecordID}
            filterSet={filterSet}
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
                _.isEmpty(debouncedDatasetTitleSearchText)
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
                <strong>{t('pointDetailsControlRowDatasetsSelected')}:</strong>{' '}
                {pointsData.length}
                <strong>{t('pointDetailsControlRowToDownload')}:</strong>{' '}
                {datasetsSelected}
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
        showModal={showModal}
        setShowModal={setShowModal}
        inspectRecordID={inspectRecordID}
        setInspectRecordID={setInspectRecordID}
        recordLoading={recordLoading}
      />
    </div>
  )
}
