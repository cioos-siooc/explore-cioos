import * as React from "react";

import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { RECORD_PARAM } from "../../../state/selection/previewParams.js";

const loadPreview = () =>
  import("../../Controls/DatasetPreview/DatasetPreview.jsx");
const DatasetPreview = React.lazy(loadPreview);

// A link that opens on a record is there for its plot: fetch the plot's code
// with the page instead of after the catalogue the modal waits on. The lazy
// imports in this chain then resolve from the module cache.
if (new URLSearchParams(window.location.search).has(RECORD_PARAM)) {
  loadPreview();
  import("../../Controls/DatasetPreviewPlot/DatasetPreviewPlot.jsx");
}

// Mounted at the shell level so it survives panel swaps; loads on first open,
// then stays mounted so later opens and closes animate.
export default function PreviewHost() {
  const {
    datasetPreview,
    setDatasetPreview,
    previewError,
    previewQuery,
    retryPreview,
    inspectDataset,
    setInspectDataset,
    showPreviewModal,
    inspectRecordID,
    inspectRecordPeriod,
    setInspectRecordID,
    recordLoading,
    setRecordLoading,
  } = useSelection();
  const [opened, setOpened] = React.useState(showPreviewModal);
  if (showPreviewModal && !opened) setOpened(true);
  if (!opened) return null;

  return (
    <React.Suspense fallback={null}>
      <DatasetPreview
        datasetPreview={datasetPreview}
        setDatasetPreview={setDatasetPreview}
        previewError={previewError}
        previewQuery={previewQuery}
        retryPreview={retryPreview}
        inspectDataset={inspectDataset}
        setInspectDataset={setInspectDataset}
        showModal={showPreviewModal}
        inspectRecordID={inspectRecordID}
        inspectRecordPeriod={inspectRecordPeriod}
        setInspectRecordID={setInspectRecordID}
        recordLoading={recordLoading}
        setRecordLoading={setRecordLoading}
      />
    </React.Suspense>
  );
}
