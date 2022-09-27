import React, { useState, useEffect } from 'react'
import { Modal, Dropdown, DropdownButton, Table } from 'react-bootstrap'
import { ChevronCompactLeft } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import Loading from '../Loading/Loading.jsx'
import DatasetPreviewPlot from '../DatasetPreviewPlot/DatasetPreviewPlot.jsx'
import DatasetPreviewTable from '../DatasetPreviewTable/DatasetPreviewTable.jsx'
import './styles.css'

export default function DatasetPreview({
  datasetPreview,
  inspectDataset,
  setInspectDataset,
  inspectRecordID,
  setInspectRecordID,
  showModal,
  setShowModal,
  setDatasetPreview,
  recordLoading
}) {
  if (!datasetPreview) return <></>

  const columnNames = datasetPreview?.table?.columnNames || []
  const columnUnits = datasetPreview?.table?.columnUnits || []
  const rows = datasetPreview?.table?.rows || []

  const { t, i18n } = useTranslation()
  const clearAxes = { x: null, y: null }
  const [plotAxes, setAxes] = useState(clearAxes)
  const [selectedVis, setSelectedVis] = useState('table')
  const [clear, setClear] = useState(false)

  // reformat datasetPreview into array of objects
  const data = rows.map((row) => {
    const keys = columnNames
    const values = row
    const merged = keys.reduce(
      (obj, key, index) => ({ ...obj, [key]: values[index] }),
      {}
    )
    return merged
  })

  useEffect(() => {
    setClear(false)

    switch (inspectDataset.cdm_data_type) {
    case 'Profile':
    case 'TimeSeriesProfile':
      setAxes({ x: inspectDataset.first_eov_column, y: 'depth' })
      break
    case 'TimeSeries':
      setAxes({ x: 'time', y: inspectDataset.first_eov_column })
      break

    default:
      break
    }
  }, [inspectRecordID])

  return (
    <Modal
      className='dataPreviewModal'
      show={showModal}
      // fullscreen
      size='xl'
      onHide={() => {
        setInspectRecordID()
        setShowModal(false)
        setAxes(clearAxes)
        setSelectedVis('table')
        setInspectRecordID()
        setClear(true)
      }}
      onExit={() => {
        setInspectRecordID()
        setShowModal(false)
        setAxes(clearAxes)
        setSelectedVis('table')
        setInspectRecordID()
        setClear(true)
      }}
      centered
      scrollable
    >
      {inspectDataset && inspectRecordID && (
        <>
          <Modal.Header closeButton className='tableAndPlotGridContainer'>
            <button
              className={`toggleButton ${
                selectedVis === 'table' && 'selected'
              }`}
              onClick={() => {
                setSelectedVis('table')
                // setRecordLoading(true)
              }}
            >
              Table
            </button>
            <button
              className={`toggleButton ${selectedVis === 'plot' && 'selected'}`}
              onClick={() => {
                setSelectedVis('plot')
                // setRecordLoading(true)
              }}
            >
              Plot
            </button>

            <h4 className='datasetTitle'>
              {inspectDataset.title}: <i>{inspectRecordID}</i>
              {/* {t('datasetInspectorModalTitle')} */}
              {/* Dataset Preview */}
            </h4>
          </Modal.Header>
          <Modal.Body
            style={selectedVis === 'table' ? { padding: 0 } : undefined}
          >
            <div className='tableAndPlotGridItem tableAndPlot'>
              {recordLoading && <Loading />}
              {!clear && selectedVis === 'table' ? (
                <DatasetPreviewTable
                  datasetPreview={datasetPreview}
                  data={data}
                  // setRecordLoading={setRecordLoading}
                />
              ) : (
                <>
                  <DropdownButton
                    title={
                      plotAxes.x
                        ? 'X axis: ' + plotAxes.x
                        : 'Select X axis variable'
                    }
                  >
                    {datasetPreview &&
                      datasetPreview?.table?.columnNames.map((columnName) => {
                        return (
                          <Dropdown.Item
                            key={columnName}
                            onClick={() =>
                              setAxes({ x: columnName, y: plotAxes.y })
                            }
                          >
                            {columnName}
                          </Dropdown.Item>
                        )
                      })}
                  </DropdownButton>
                  <DropdownButton
                    title={
                      plotAxes.y
                        ? 'Y Axis: ' + plotAxes.y
                        : 'Select Y axis variable'
                    }
                  >
                    {datasetPreview &&
                      datasetPreview?.table?.columnNames.map((columnName) => {
                        return (
                          <Dropdown.Item
                            key={columnName}
                            onClick={() =>
                              setAxes({ x: plotAxes.x, y: columnName })
                            }
                          >
                            {columnName}
                          </Dropdown.Item>
                        )
                      })}
                  </DropdownButton>
                  {/* <DropdownButton title={(plotType && `PlotType: ` + plotYAxis.columnName) || 'Select plot type'}>
                        Add plot types that will work with the kind of data we are working with
                        {plotlyPlotTypes.map((plotType, index) => {
                          return <Dropdown.Item key={index} onClick={() => setPlotType({ index, plotType })}>{plotType}</Dropdown.Item>
                        })}
                      </DropdownButton> */}
                  <DatasetPreviewPlot
                    datasetPreview={datasetPreview}
                    data={data}
                    plotAxes={plotAxes}
                    title={inspectDataset.title}
                    isProfile={inspectDataset.cdm_data_type
                      .toLowerCase()
                      .includes('profile')}
                    // setRecordLoading={setRecordLoading}
                  />
                </>
              )}
            </div>
          </Modal.Body>
        </>
      )}
    </Modal>
  )
}
