import * as React from "react";

import DatasetPreview from "../../Controls/DatasetPreview/DatasetPreview.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";

// Keeps the record-preview modal mounted at the shell level so it survives
// panel swaps (its open/close state lives in the selection provider).
export default function PreviewHost() {
  const {
    datasetPreview,
    setDatasetPreview,
    previewError,
    inspectDataset,
    setInspectDataset,
    showPreviewModal,
    inspectRecordID,
    setInspectRecordID,
    recordLoading,
    setRecordLoading,
  } = useSelection();

  return (
    <DatasetPreview
      datasetPreview={datasetPreview}
      setDatasetPreview={setDatasetPreview}
      previewError={previewError}
      inspectDataset={inspectDataset}
      setInspectDataset={setInspectDataset}
      showModal={showPreviewModal}
      inspectRecordID={inspectRecordID}
      setInspectRecordID={setInspectRecordID}
      recordLoading={recordLoading}
      setRecordLoading={setRecordLoading}
    />
  );
}
