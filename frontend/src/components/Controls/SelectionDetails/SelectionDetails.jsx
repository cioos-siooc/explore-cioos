import * as React from 'react'
import { useState, useEffect } from 'react'
import { Modal, ProgressBar, Table } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import DatasetInspector from '../DatasetInspector/DatasetInspector.jsx'
import QuestionIconTooltip from '../QuestionIconTooltip/QuestionIconTooltip.jsx'
import Loading from '../Loading/Loading.jsx'
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
  const [datasetPreview, setDatasetPreview] = useState()

  useEffect(() => {
    setDataTotal(0)
    if (!_.isEmpty(pointsData)) {
      const total = getPointsDataSize(pointsData)
      setDataTotal(total / 1000000)
      setPointsToReview(pointsData.filter(point => point.selected))
    }
    setLoading(false)
    if (pointsData.length === 1) {
      setInspectDataset(pointsData[0])
    }
  }, [pointsData])

  useEffect(() => {
    setDataTotal(0)
    if (polygon !== undefined && !loading) {
      const filtersQuery = createDataFilterQueryString(query)
      const shapeQuery = createSelectionQueryString(polygon)
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
      fetch(`${server}/preview?dataset=${inspectDataset.dataset_id}&profile=${inspectDataset.profiles[0].profile_id}`).then(response => response.json()).then(preview => {
        setDatasetPreview(JSON.parse(preview))
      }).catch(error => { throw error })
    }
  }, [inspectDataset])

  return (
    <div className='pointDetails'>
      <div className='pointDetailsInfoRow'>
        {loading
          ? (
            <Loading />
          )
          : (inspectDataset
            ? <Modal
              show={inspectDataset} fullscreen onHide={() => setInspectDataset(false)}
            >
              <Modal.Header closeButton>
                <Modal.Title>Dataset Preview</Modal.Title>
              </Modal.Header>
              {/* <Modal.Body>
                {JSON.stringify(inspectDataset)}
                {JSON.stringify(datasetPreview)}
                <Table striped bordered hover>
                  <thead>
                    <tr>
                      {datasetPreview.table.columnNames.map((columnName, columnIndex) => {
                        return <th key={columnIndex}>A{columnName}</th>
                      })}
                    </tr>
                    <tr>
                      {datasetPreview?.table?.columnTypes.map((columnType, columnIndex) => {
                        <th key={columnIndex}>{columnType}</th>
                      })}
                    </tr>
                    <tr>
                      {datasetPreview?.table?.columnUnits.map((columnUnits, columnIndex) => {
                        <th key={columnIndex}>{columnUnits}</th>
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {datasetPreview.table.rows.map((row, rowIndex) => {
                      return <tr key={rowIndex}>
                        {row.map((elem, elemKey) => {
                          return <td key={elemKey}>B{elem}</td>
                        })}
                      </tr>
                    })}
                  </tbody>
                </Table>
              </Modal.Body> */}
            </Modal>
            //   <DatasetInspector
            //   dataset={inspectDataset}
            //   setInspectDataset={setInspectDataset}
            //   setHoveredDataset={setHoveredDataset}
            // />
            : (
              pointsData && pointsData.length > 0 &&
              <DatasetsTable
                handleSelectAllDatasets={handleSelectAllDatasets}
                handleSelectDataset={handleSelectDataset}
                setInspectDataset={setInspectDataset}
                selectAll={selectAll}
                setDatasets={setPointsData}
                datasets={pointsData}
                setHoveredDataset={setHoveredDataset}
              />
            ) || (
              pointsData && pointsData.length === 0 &&
              <div className="noDataNotice">
                {t('selectionDetailsNoDataWarning')}
                {/* No Data. Modify filters or change selection on map. */}
              </div>
            )
          )
        }
      </div>
      <div className='pointDetailsControls'>
        <div className='pointDetailsControlRow'>
          <div>
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
              {bytesToMemorySizeString(dataTotal * 1000000)} {t('selectionDetailsMaxRatio')}
              {/* of 100MB Max */}
              <QuestionIconTooltip
                tooltipText={t('selectionDetailsQuestionTooltipText')} // 'Downloads are limited to 100MB.'}
                size={20}
                tooltipPlacement={'top'}
              />
            </div>
          </div>
          {children}
        </div>
      </div>
    </div >
  )
}
