import * as React from 'react'
import { useState, useEffect } from 'react'
import { ProgressBar } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import { InfoSquare } from 'react-bootstrap-icons'

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
  createSelectionQueryString
} from '../../../utilities.js'

// Note: datasets and points are exchangable terminology
export default function SelectionDetails({ setPointsToReview, query, polygon, setHoveredDataset, children }) {
  const { t, i18n } = useTranslation()
  const [selectAll, setSelectAll] = useState(true)
  const [pointsData, setPointsData] = useState([])
  const [inspectDataset, setInspectDataset] = useState()
  const [dataTotal, setDataTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [inspectRecordID, setInspectRecordID] = useState()
  const [showModal, setShowModal] = useState(false)
  const [recordLoading, setRecordLoading] = useState(false)
  const [datasetPreview, setDatasetPreview] = useState()

  useEffect(() => {
    // if (inspectDataset) {
    //   setInspectRecordID(inspectDataset.profiles[0].profile_id)
    // }
  }, [inspectDataset])

  useEffect(() => {
    setDataTotal(0)
    if (!_.isEmpty(pointsData)) {
      const total = getPointsDataSize(pointsData)
      setDataTotal(total / 1000000)
      setPointsToReview(pointsData.filter(point => point.selected))
    }
    setLoading(false)
    // if (pointsData.length === 1) { // Auto load single selected dataset
    //   setInspectDataset(pointsData[0])
    //   // setLoading(true)
    // }
  }, [pointsData])

  useEffect(() => {
    setDataTotal(0)
    if (!loading) {
      const filtersQuery = createDataFilterQueryString(query)
      let shapeQuery = []
      if (polygon) {
        shapeQuery = createSelectionQueryString(polygon)
      }
      const combinedQueries = [filtersQuery, shapeQuery].filter(e => e).join('&')
      setInspectDataset()
      setLoading(true)
      const urlString = `${server}/pointQuery?${combinedQueries}`
      fetch(urlString).then(response => {
        if (response.ok) {
          response.json().then(data => {
            setPointsData(data.map(point => {
              return {
                ...point,
                title: point.title_translated[i18n.language] || point.title,
                selected: true
              }
            }))
          })
        } else {
          setPointsData([])
        }
      })
    }
  }, [polygon, i18n.language])

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
    setPointsData(pointsData.map(p => {
      return {
        ...p,
        selected: !selectAll
      }
    }))
    setSelectAll(!selectAll)
  }

  useEffect(() => {
    if (inspectDataset) {
      if (inspectRecordID) {
        setShowModal(true)
        setRecordLoading(true)
        fetch(`${server}/preview?dataset=${inspectDataset.dataset_id}&profile=${inspectRecordID}`).then(response => response.json()).then(preview => {
          setDatasetPreview(preview)
          setRecordLoading(false)
        }).catch(error => { throw error })
      }
    } else {
      setInspectRecordID()
    }
  }, [inspectRecordID])

  return (
    <div className='pointDetails'>
      <div className='pointDetailsHeader'>
        <img className='pointDetailsHeaderLogo' src={Logo} />
        <button
          className='pointDetailsHeaderIntroButton'
          onClick={() => alert('open intro modal')}
          title={t('introReopenTitle')} // 'Re-open introduction'
        >
          <InfoSquare color='#007bff' size={'25px'} />
        </button>
        <LanguageSelector className='noPosition' />
      </div>
      <div className='pointDetailsInfoRow'>
        {loading
          ? <Loading />
          : inspectDataset
            ? <DatasetInspector
              dataset={inspectDataset}
              setHoveredDataset={setHoveredDataset}
              setInspectDataset={setInspectDataset}
              setInspectRecordID={setInspectRecordID}
            />
            :
            // (pointsData && pointsData.length > 0 &&
            <>
              <div className="pointDetailsSearchBar">
                <input value='Search for dataset title here' onChange={() => alert('searching for dataset title')} />
              </div>
              <DatasetsTable
                handleSelectAllDatasets={handleSelectAllDatasets}
                handleSelectDataset={handleSelectDataset}
                setInspectDataset={setInspectDataset}
                setInspectRecordID={setInspectRecordID}
                selectAll={selectAll}
                setDatasets={setPointsData}
                datasets={pointsData}
                setHoveredDataset={setHoveredDataset}
              />
              <div className='pointDetailsControls'>
                <div className='pointDetailsControlRow'>
                  {children}
                </div>
              </div>
            </>
          // )
          // ||
          // (pointsData && pointsData.length === 0 &&
          //   (
          //     <div className="noDataNotice">
          //       {t('selectionDetailsNoDataWarning')}
          //       {/* No Data. Modify filters or change selection on map. */}
          //     </div>
          //   )
          // )
        }
      </div>
      <DatasetPreview
        datasetPreview={datasetPreview}
        setDatasetPreview={setDatasetPreview}
        inspectDataset={inspectDataset}
        setInspectDataset={setInspectDataset}
        showModal={setShowModal}
        setShowModal={setShowModal}
        inspectRecordID={inspectRecordID}
        setInspectRecordID={setInspectRecordID}
        recordLoading={recordLoading}
      />
      {/* <div>
            <ProgressBar
              className='dataTotalBar'
              title={t('selectionDetailsProgressBarTitle')}
            >
              <ProgressBar
                striped
                className='upTo100'
                variant='success'
                now={dataTotal < 100 ? dataTotal : 100}
                label={dataTotal < 100 ? bytesToMemorySizeString(dataTotal * 1000000) : '100 MB'}
                key={1}
              />
              {dataTotal > 100 &&
                <ProgressBar
                  striped
                  className='past100'
                  variant='warning'
                  now={dataTotal > 100 ? (dataTotal - 100).toFixed(2) : 0}
                  label={dataTotal > 100 ? bytesToMemorySizeString((dataTotal - 100).toFixed(2) * 1000000) : 0}
                  key={2}
                />
              }
            </ProgressBar>
            <div className='dataTotalRatio'>
              {bytesToMemorySizeString(dataTotal * 1000000)} {t('selectionDetailsMaxRatio')} */}
      {/* of 100MB Max */}
      {/* <QuestionIconTooltip
                tooltipText={t('selectionDetailsQuestionTooltipText')} // 'Downloads are limited to 100MB.'}
                size={20}
                tooltipPlacement={'top'}
              />
            </div>
          </div> */}
    </div >
  )
}
