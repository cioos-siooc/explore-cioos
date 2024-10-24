import React, { useState, useEffect } from 'react'
import { Modal } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import Loading from '../Loading/Loading.jsx'
import DatasetPreviewPlot from '../DatasetPreviewPlot/DatasetPreviewPlot.jsx'
import DatasetPreviewTable from '../DatasetPreviewTable/DatasetPreviewTable.jsx'
import './styles.css'

export default function DatasetPreview({
  datasetPreview,
  inspectDataset,
  inspectRecordID,
  setInspectRecordID,
  showModal,
  setShowModal,
  recordLoading,
  setRecordLoading
}) {
  const { t } = useTranslation()
  const clearAxes = { x: { columnName: null, unit: null }, y: { columnName: null, unit: null } }
  const [plotAxes, setPlotAxes] = useState(clearAxes)
  const [selectedVis, setSelectedVis] = useState('table')

  const [data, setData] = useState()

  useEffect(() => {
    const columnNames = datasetPreview?.table?.columnNames || []

    const rows = datasetPreview?.table?.rows || []

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
    setData(data)
  }, [datasetPreview])

  const onModalClose = () => {
    setInspectRecordID()
    setShowModal(false)
    setPlotAxes(clearAxes)
    setSelectedVis('table')
    setInspectRecordID()
    setData()
    setRecordLoading(false)
  }
  const dataIsReady = !recordLoading && datasetPreview?.table?.rows

  return (
    <Modal
      className='dataPreviewModal'
      show={showModal}
      // fullscreen
      size='xl'
      onHide={onModalClose}
      onExit={onModalClose}
      centered
      scrollable
    >
      {inspectDataset && inspectRecordID && (
        <>
          <Modal.Header closeButton className='tableAndPlotGridContainer'>
            {dataIsReady && (
              <>
                <button
                  className={`toggleButton ${selectedVis === 'table' && 'selected'
                    }`}
                  onClick={() => {
                    setSelectedVis('table')
                    // setRecordLoading(true)
                  }}
                >
                  {t('datasetPreviewTableText')}
                </button>
                <button
                  className={`toggleButton ${selectedVis === 'plot' && 'selected'
                    }`}
                  onClick={() => {
                    setSelectedVis('plot')
                    // setRecordLoading(true)
                  }}
                >
                  {t('datasetPreviewPlotText')}
                </button>
              </>
            )}

            <h4 className='datasetTitle'>
              {inspectDataset.title}: <i>{inspectRecordID}</i>
              {/* {t('datasetInspectorModalTitle')} */}
              {/* Dataset Preview */}
            </h4>
          </Modal.Header>
          <Modal.Body>
            <div className='tableAndPlotGridItem tableAndPlot'>
              {recordLoading ? (
                <Loading />
              ) : (
                <>
                  {datasetPreview?.table?.rows ? (
                    <>
                      {selectedVis === 'table' ? (
                        <DatasetPreviewTable
                          datasetPreview={datasetPreview}
                          data={data}
                        />
                      ) : (
                        <DatasetPreviewPlot
                          inspectDataset={inspectDataset}
                          plotAxes={plotAxes}
                          datasetPreview={datasetPreview}
                          setPlotAxes={setPlotAxes}
                          inspectRecordID={inspectRecordID}
                          data={data}
                        />
                      )}
                    </>
                  ) : (
                    <>
                      <p>{t('datasetPreviewNoData')}</p>
                    </>
                  )}
                </>
              )}
            </div>
          </Modal.Body>
        </>
      )}
    </Modal>
  )
}
