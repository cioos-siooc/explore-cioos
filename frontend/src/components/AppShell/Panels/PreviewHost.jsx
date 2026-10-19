import * as React from "react";

import { useSelection } from "../../../state/selection/SelectionProvider.jsx";

const DatasetPreview = React.lazy(
  () => import("../../Controls/DatasetPreview/DatasetPreview.jsx"),
);

// Mounted at the shell level so it survives panel swaps; loads on first open,
// then stays mounted so later opens and closes animate.
export default function PreviewHost() {
  const {
    datasetPreview,
    setDatasetPreview,
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
