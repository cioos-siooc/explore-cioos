import React, { useState, useEffect } from 'react'
import { Modal, Dropdown, DropdownButton, Table } from 'react-bootstrap'
import { ChevronCompactLeft } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import Loading from '../Loading/Loading.jsx'
import DatasetPreviewPlot from '../DatasetPreviewPlot/DatasetPreviewPlot.jsx'
import DatasetPreviewTable from '../DatasetPreviewTable/DatasetPreviewTable.jsx'
import './styles.css'

export default function DatasetPreview ({ datasetPreview, inspectDataset, setInspectDataset, inspectRecordID, setInspectRecordID, showModal, setShowModal, setDatasetPreview, recordLoading }) {
  const { t, i18n } = useTranslation()
  const [plotXAxis, setPlotXAxis] = useState([])
  const [plotYAxis, setPlotYAxis] = useState([])
  const [selectedVis, setSelectedVis] = useState('table')
  const [clear, setClear] = useState(false)

  useEffect(() => {
    setClear(false)
  }, [inspectRecordID])
  return <Modal
    className='dataPreviewModal'
    show={showModal}
    // fullscreen
    size='xl'
    onHide={() => {
      setInspectRecordID()
      setShowModal(false)
      setPlotXAxis([])
      setPlotYAxis([])
      setSelectedVis('table')
      setInspectRecordID()
      setClear(true)
    }}
    onExit={() => {
      setInspectRecordID()
      setShowModal(false)
      setPlotXAxis([])
      setPlotYAxis([])
      setSelectedVis('table')
      setInspectRecordID()
      setClear(true)
    }}
    centered
    scrollable
  >
    {inspectDataset && inspectRecordID &&
      <>
        <Modal.Header closeButton>
          <div
            className='backButton'
            onClick={() => {
              // setInspectDataset()
              setInspectRecordID()
              setShowModal(false)
              setPlotXAxis([])
              setPlotYAxis([])
              setSelectedVis('table')
              setInspectRecordID()
              setClear(true)
            }}
            title={t('datasetInspectorBackButtonTitle')} // 'Return to dataset list'
          >
            <ChevronCompactLeft />
            <>
              {t('datasetInspectorBackButtonText')}
            </>
            {/* Back */}
          </div>
          <h4 className='datasetTitle'>
            {inspectDataset.title}
            {/* {t('datasetInspectorModalTitle')} */}
            {/* Dataset Preview */}
          </h4>
        </Modal.Header>
        <Modal.Body>
          <div className='previewFlexContainer'>
            <div className='previewFlexItem dataTableAndDataPlot'>
              <div className='tableAndPlotGridContainer'>
                <div className='tableAndPlotGridItem'>
                  <strong>Selected record ID:</strong> {` ${inspectRecordID} `}
                  <button
                    className={`toggleButton ${selectedVis === 'table' && 'selected'}`}
                    onClick={() => {
                      setSelectedVis('table')
                      // setRecordLoading(true)
                    }}>
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
                </div>
                <div className='tableAndPlotGridItem tableAndPlot'>
                  {recordLoading && <Loading />}
                  {!clear && selectedVis === 'table'
                    ? <DatasetPreviewTable
                      datasetPreview={datasetPreview}
                    // setRecordLoading={setRecordLoading}
                    />
                    : <>
                      <hr />
                      <DropdownButton
                        title={(plotXAxis && 'X axis: ' + plotXAxis.columnName) || 'Select X axis variable'}
                      >
                        {datasetPreview && datasetPreview?.table?.columnNames.map((columnName, index) => {
                          return <Dropdown.Item key={index} onClick={() => setPlotXAxis({ index, columnName })}>{columnName}</Dropdown.Item>
                        })}
                      </DropdownButton>
                      <DropdownButton
                        title={(plotYAxis && 'Y Axis: ' + plotYAxis.columnName) || 'Select Y axis variable'}
                      >
                        {datasetPreview && datasetPreview?.table?.columnNames.map((columnName, index) => {
                          return <Dropdown.Item key={index} onClick={() => setPlotYAxis({ index, columnName })}>{columnName}</Dropdown.Item>
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
                        plotXAxis={plotXAxis}
                        plotYAxis={plotYAxis}
                        title={inspectDataset.title}
                      // setRecordLoading={setRecordLoading}
                      />
                    </>
                  }
                </div>
              </div>
            </div>
          </div>
        </Modal.Body>
      </>
    }
  </Modal>
}
