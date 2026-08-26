import React, { useState, useEffect, Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { Check2, Clipboard } from 'react-bootstrap-icons'

import Modal from '../../ui/Modal.jsx'

import Loading from '../Loading/Loading.jsx'
import DatasetPreviewTable from '../DatasetPreviewTable/DatasetPreviewTable.jsx'
import usePreviewPlotParams from './usePreviewPlotParams.js'
import './styles.css'

// Lazy so the ~1 MB Plotly chunk only downloads when a plot is actually shown.
// It now downloads on the first record opened rather than on the first Plot
// click, since the plot is the default view — but it stays a separate chunk
// behind the Loading fallback below, and the /preview fetch runs alongside it.
const DatasetPreviewPlot = lazy(() =>
  import('../DatasetPreviewPlot/DatasetPreviewPlot.jsx')
)

const NO_CUSTOM_LABELS = { x: '', y: '', secondary: '', color: '' }

export default function DatasetPreview({
  datasetPreview,
  inspectDataset,
  inspectRecordID,
  setInspectRecordID,
  showModal,
  recordLoading,
  setRecordLoading
}) {
  const { t } = useTranslation()

  // What is being looked at and how it is drawn — all of it in the query string,
  // so a link reproduces the plot and Back closes it. Each param is written only
  // when it differs from what this dataset type opens on, so an untouched plot
  // adds nothing to the URL. See usePreviewPlotParams.
  const {
    selectedVis,
    setSelectedVis,
    plotAxes,
    setPlotAxes,
    plotType,
    setPlotType,
    colorscales,
    setColorscales,
    dualColorscale,
    setDualColorscale
  } = usePreviewPlotParams(inspectDataset, datasetPreview?.table)

  // Per-role display names. Lifted out of the plot so they survive the
  // Table/Plot flip (which unmounts it) like everything else now does, but
  // deliberately NOT in the URL: free text is what makes a query string
  // unreadable, and a rename is a private annotation rather than a view.
  const [customLabels, setCustomLabels] = useState(NO_CUSTOM_LABELS)
  const [linkCopied, setLinkCopied] = useState(false)

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

  // A different record is a different plot: drop the previous one's names, and
  // let the copy button offer itself again.
  useEffect(() => {
    setCustomLabels(NO_CUSTOM_LABELS)
    setLinkCopied(false)
  }, [inspectRecordID])

  const onModalClose = () => {
    // One call, one history entry: setInspectRecordID clears ?record= and every
    // plot param together, because react-router would drop one of two writes
    // made in the same tick (see previewParams.js).
    setInspectRecordID()
    setCustomLabels(NO_CUSTOM_LABELS)
    setData()
    setRecordLoading(false)
  }
  const dataIsReady = !recordLoading && datasetPreview?.table?.rows

  return (
    <Modal
      className='dataPreviewModal'
      show={showModal}
      size='xl'
      onHide={onModalClose}
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
                  onClick={() => setSelectedVis('table')}
                >
                  {t('datasetPreviewTableText')}
                </button>
                <button
                  className={`toggleButton ${selectedVis === 'plot' && 'selected'
                  }`}
                  onClick={() => setSelectedVis('plot')}
                >
                  {t('datasetPreviewPlotText')}
                </button>
              </>
            )}

            <h4 className='datasetTitle'>
              {inspectDataset.title}: <i>{inspectRecordID}</i>
            </h4>

            {dataIsReady && (
              // The address bar is already the live mirror of the whole app
              // state — record, plot settings, map and filters — so sharing what
              // is on screen is the current URL and nothing more.
              <button
                type='button'
                className='copyLinkButton'
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href)
                  setLinkCopied(true)
                }}
              >
                {linkCopied
                  ? <Check2 size={16} aria-hidden='true' />
                  : <Clipboard size={16} aria-hidden='true' />}
                {t(linkCopied ? 'copiedPreviewLinkTitle' : 'copyPreviewLinkTitle')}
              </button>
            )}
          </Modal.Header>
          <Modal.Body>
            <div className='tableAndPlotGridItem tableAndPlot'>
              {recordLoading ? (
                <Loading variant='inline' />
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
                        <Suspense fallback={<Loading variant='inline' />}>
                          <DatasetPreviewPlot
                            inspectDataset={inspectDataset}
                            plotAxes={plotAxes}
                            datasetPreview={datasetPreview}
                            setPlotAxes={setPlotAxes}
                            inspectRecordID={inspectRecordID}
                            data={data}
                            plotType={plotType}
                            setPlotType={setPlotType}
                            colorscales={colorscales}
                            setColorscales={setColorscales}
                            dualColorscale={dualColorscale}
                            setDualColorscale={setDualColorscale}
                            customLabels={customLabels}
                            setCustomLabels={setCustomLabels}
                          />
                        </Suspense>
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
