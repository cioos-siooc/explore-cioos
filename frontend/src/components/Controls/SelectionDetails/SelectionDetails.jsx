import * as React from 'react'
import { useState, useEffect } from 'react'
import { Dropdown, DropdownButton, Modal, ProgressBar, Table } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import Plot from 'react-plotly.js'

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
import { toInteger } from 'lodash'

// Note: datasets and points are exchangable terminology
export default function SelectionDetails({ setPointsToReview, query, polygon, setHoveredDataset, children }) {
  const { t, i18n } = useTranslation()
  const [selectAll, setSelectAll] = useState(true)
  const [pointsData, setPointsData] = useState([])
  const [inspectDataset, setInspectDataset] = useState()
  const [dataTotal, setDataTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [inspectRecordID, setInspectRecordID] = useState()
  const [datasetPreview, setDatasetPreview] = useState()
  const [plotXAxis, setPlotXAxis] = useState()
  const [plotYAxis, setPlotYAxis] = useState()
  const [showPlot, setShowPlot] = useState(false)

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
      if (inspectRecordID) {
        fetch(`${server}/preview?dataset=${inspectDataset.dataset_id}&profile=${inspectRecordID}`).then(response => response.json()).then(preview => {
          setDatasetPreview(preview)
          setLoading(false)
        }).catch(error => { throw error })
      }
    } else {
      setInspectRecordID()
    }
  }, [inspectRecordID])

  function convertToType(element, type) {
    switch (String(type).toLowerCase()) {
      case 'string':
        return element

      case 'boolean':
        return !!element

      case 'float':
        return 1.0 * element

      case 'integer':
        return toInteger(element)

      default:
        return element
    }
  }

  return (
    <div className='pointDetails'>
      <div className='pointDetailsInfoRow'>
        {loading
          ? (
            <Loading />
          )
          : (inspectDataset
            ?
            <Modal
              show={inspectDataset} fullscreen onHide={() => setInspectDataset()}
            >
              <Modal.Header closeButton>
                <Modal.Title>Dataset Preview</Modal.Title>
              </Modal.Header>
              <Modal.Body>
                <DatasetInspector
                  dataset={inspectDataset}
                  setInspectDataset={setInspectDataset}
                  setHoveredDataset={setHoveredDataset}
                  setInspectRecordID={setInspectRecordID}
                />
                {datasetPreview &&
                  <>
                    <button onClick={() => setShowPlot(!showPlot)} >{showPlot ? 'Show Table' : 'Show Plot'}</button>
                    <>
                      {showPlot ?
                        <>
                          <DropdownButton title={'X-Axis'}>
                            {datasetPreview.table.columnNames.map((columnName, index) => {
                              return <Dropdown.Item key={index} onClick={() => setPlotXAxis(index)}>{columnName}</Dropdown.Item>
                            })}
                          </DropdownButton>
                          <DropdownButton title={'Y-Axis'}>
                            {datasetPreview.table.columnNames.map((columnName, index) => {
                              return <Dropdown.Item key={index} onClick={() => setPlotYAxis(index)}>{columnName}</Dropdown.Item>
                            })}
                          </DropdownButton>
                          {plotXAxis !== undefined && plotYAxis !== undefined &&
                            <Plot
                              data={[
                                {
                                  x: [...datasetPreview.table.rows.map((row, index) => {
                                    return row[plotXAxis]//convertToType(row[plotXAxis], datasetPreview.table.columnTypes[plotXAxis])
                                  })] || [],
                                  y: [...datasetPreview.table.rows.map((row, index) => {
                                    return row[plotYAxis]//convertToType(row[plotYAxis], datasetPreview.table.columnTypes[plotYAxis])
                                  })] || [],
                                  type: 'scatter',
                                  mode: 'markers'
                                }
                              ]}
                              layout={{ width: 500, height: 300 }}
                            />
                          }
                        </>
                        :
                        <Table striped bordered hover>
                          <thead>
                            <tr>
                              {datasetPreview.table.columnNames.map((columnName, columnIndex) => {
                                return <th key={columnIndex}>{columnName}</th>
                              })}
                            </tr>
                            <tr>
                              {datasetPreview.table.columnTypes.map((columnType, columnIndex) => {
                                return <th key={columnIndex}>{columnType}</th>
                              })}
                            </tr>
                            <tr>
                              {datasetPreview.table.columnUnits.map((columnUnits, columnIndex) => {
                                return <th key={columnIndex}>{columnUnits}</th>
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {datasetPreview.table.rows.map((row, rowIndex) => {
                              return <tr key={rowIndex}>
                                {row.map((elem, elemKey) => {
                                  return <td key={elemKey}>{elem}</td>
                                })}
                              </tr>
                            })}
                          </tbody>
                        </Table>
                      }
                    </>
                  </>
                }
              </Modal.Body>
            </Modal>
            : (
              pointsData && pointsData.length > 0 &&
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
