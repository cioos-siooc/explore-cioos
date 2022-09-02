import * as React from 'react'
import { useState, useEffect } from 'react'
import { Modal, ProgressBar, Row, Col, DropdownButton, Dropdown, Table } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import { ChevronCompactLeft } from 'react-bootstrap-icons'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
// import DatasetInspector from '../DatasetInspector/DatasetInspector.jsx'
import QuestionIconTooltip from '../QuestionIconTooltip/QuestionIconTooltip.jsx'
import Loading from '../Loading/Loading.jsx'
import DatasetPreviewPlot from '../DatasetPreviewPlot/DatasetPreviewPlot.jsx'
import DatasetPreviewTable from '../DatasetPreviewTable/DatasetPreviewTable.jsx'
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
  const [datasetPreview, setDatasetPreview] = useState()
  // const [showPlot, setShowPlot] = useState(false)
  const [plotType, setPlotType] = useState([])
  const [plotXAxis, setPlotXAxis] = useState([])
  const [plotYAxis, setPlotYAxis] = useState([])

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

  return (
    <div className='pointDetails'>
      <div className='pointDetailsInfoRow'>
        {loading
          ? (
            <Loading />
          )
          : (inspectDataset
            ?
            <Modal className='dataPreviewModal'
              show={inspectDataset} fullscreen onHide={() => setInspectDataset()}
            >
              <Modal.Header closeButton>
                <div
                  className='backButton'
                  onClick={() => setInspectDataset()}
                  title={t('datasetInspectorBackButtonTitle')} // 'Return to dataset list'
                >
                  <ChevronCompactLeft />
                  <>
                    {t('datasetInspectorBackButtonText')}
                  </>
                  {/* Back */}
                </div>
                <h4>
                  {inspectDataset.title}
                  {/* {t('datasetInspectorModalTitle')} */}
                  {/* Dataset Preview */}
                </h4>
              </Modal.Header>
              <Modal.Body>
                <div className='previewRow'>
                  <div className='previewColumn'>
                    <div>
                      {t('datasetInspectorURLText')}
                      {/* Dataset URLs */}
                    </div>
                    <a
                      href={inspectDataset.ckan_url}
                      target='_blank'
                      title={inspectDataset.ckan_url ? inspectDataset.ckan_url : 'unavailable'} rel="noreferrer">
                      {t('datasetInspectorCKANURL')} (CKAN)
                    </a>
                    <a
                      href={inspectDataset.erddap_url}
                      target='_blank'
                      title={inspectDataset.erddap_url ? inspectDataset.erddap_url : 'unavailable'} rel="noreferrer">
                      {t('datasetInspectorERDDAPURL')} (ERDDAP)
                    </a>
                    <div>
                      {t('datasetInspectorOrganizationText')}
                      {/* Organizations */}
                    </div>
                    <div>
                      {inspectDataset.organizations.join(', ')}
                    </div>
                    <div>
                      {t('datasetInspectorOceanVariablesText')}
                      {/* Ocean Variables */}
                    </div>
                    <div>
                      {inspectDataset.eovs.map((eov, index) => ' ' + t(eov)).join(',')}
                    </div>
                    <div>
                      {t('datasetInspectorPlatformText')}
                      {/* Platform */}
                    </div>
                    <div>
                      {t(inspectDataset.platform)}
                    </div>
                    <div>
                      {/* Records ... records total, 1000 shown */}
                      {t('datasetInspectorRecordsText')} ({inspectDataset && inspectDataset.profiles_count > 1000 ? `${inspectDataset.profiles_count} ${t('datasetInspectorRecordsOverflowText')}` : inspectDataset.profiles_count})
                    </div>
                  </div>
                  <div className='previewColumn'>
                    <Table striped bordered size="sm">
                      <thead>
                        <tr>
                          <th>{t('datasetInspectorRecordIDText')}</th>
                          <th>{t('datasetInspectorTimeframeText')}</th>
                          <th>{t('datasetInspectorDepthRangeText')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspectDataset.profiles.map((profile, index) => {
                          return (
                            <tr key={index} onClick={() => setInspectRecordID(profile.profile_id)}>
                              <td>{profile.profile_id}</td>
                              <td>{`${new Date(profile.time_min).toLocaleDateString()} - ${new Date(profile.time_max).toLocaleDateString()}`}</td>
                              <td>{`${profile.depth_min < Number.EPSILON ? 0 : profile.depth_min > 15000 ? t('datasetInspectorDepthTooLargeWarningText') : profile.depth_min.toFixed(1)} - ${profile.depth_max < Number.EPSILON ? 0 : profile.depth_max > 15000 ? t('datasetInspectorDepthTooLargeWarningText') : profile.depth_max.toFixed(1)}`}</td>
                            </tr>
                          )
                        })}
                        {inspectDataset.profiles_count > 1000 && (
                          <tr key={1001}>
                            <td>{`1000/${inspectDataset.profiles_count} ${t('datasetInspectorRecordsShownText')}`}</td>
                            <td />
                            <td />
                          </tr>
                        )}
                      </tbody>
                    </Table>
                  </div>
                </div>
                <div className='previewRow'>
                  <div className='previewColumn'>
                    <DatasetPreviewPlot datasetPreview={datasetPreview} plotXAxis={plotXAxis} setPlotXAxis={setPlotXAxis} plotYAxis={plotYAxis} setPlotYAxis={setPlotYAxis} />
                  </div>
                  <div className='previewColumn'>
                    <DatasetPreviewTable datasetPreview={datasetPreview} />
                  </div>
                </div>
                {/* <DatasetInspector
                  dataset={inspectDataset}
                  setInspectDataset={setInspectDataset}
                  setHoveredDataset={setHoveredDataset}
                  setInspectRecordID={setInspectRecordID}
                />
                {datasetPreview &&
                  <div className='datasetData'>
                    <DatasetPreviewPlot datasetPreview={datasetPreview} plotXAxis={plotXAxis} setPlotXAxis={setPlotXAxis} plotYAxis={plotYAxis} setPlotYAxis={setPlotYAxis} />
                    <DatasetPreviewTable datasetPreview={datasetPreview} />
                  </div>
                } */}
                {/* <button onClick={() => setShowPlot(!showPlot)} >{showPlot ? 'Show Table' : 'Show Plot'}</button> */}
                {/* <DropdownButton title={(plotType && `PlotType: ` + plotYAxis.columnName) || 'Select plot type'}>
                  // Add plot types that will work with the kind of data we are working with
                        {plotlyPlotTypes.map((plotType, index) => {
                          return <Dropdown.Item key={index} onClick={() => setPlotType({ index, plotType })}>{plotType}</Dropdown.Item>
                        })}
                        </DropdownButton> */}

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
