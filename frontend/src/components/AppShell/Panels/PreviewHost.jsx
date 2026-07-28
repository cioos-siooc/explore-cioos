import * as React from 'react'

import DatasetPreview from '../../Controls/DatasetPreview/DatasetPreview.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'

// Keeps the record-preview modal mounted at the shell level so it survives
// panel swaps (its open/close state lives in the selection provider).
export default function PreviewHost () {
  const {
    datasetPreview,
    setDatasetPreview,
    inspectDataset,
    setInspectDataset,
    showPreviewModal,
    setShowPreviewModal,
    inspectRecordID,
    setInspectRecordID,
    recordLoading,
    setRecordLoading
  } = useSelection()

  return (
    <DatasetPreview
      datasetPreview={datasetPreview}
      setDatasetPreview={setDatasetPreview}
      inspectDataset={inspectDataset}
      setInspectDataset={setInspectDataset}
      showModal={showPreviewModal || recordLoading}
      setShowModal={setShowPreviewModal}
      inspectRecordID={inspectRecordID}
      setInspectRecordID={setInspectRecordID}
      recordLoading={recordLoading}
      setRecordLoading={setRecordLoading}
    />
  )
}
