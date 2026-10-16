import * as React from "react";

import DatasetsTable from "../../Controls/DatasetsTable/DatasetsTable.jsx";
import { DatasetCardSkeleton } from "../../Controls/DatasetsTable/DatasetCard.jsx";
import DatasetInspector from "../../Controls/DatasetInspector/DatasetInspector.jsx";
import Loading from "../../Controls/Loading/Loading.jsx";
import { SkeletonGroup } from "../../ui/Skeleton.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import "./styles.css";

// All state lives in the providers, so the panel can unmount freely.
export default function DatasetsPanel() {
  const { activeWmsOverlay, setActiveWmsOverlay } = useMapState();
  const {
    filteredDatasets,
    inspectDataset,
    setInspectDataset,
    returnToDatasetList,
    selectionLoading,
    initialPointsQueryComplete,
    setInspectRecordID,
    handleSelectDataset,
    setHoveredDataset,
    combinedQueries,
    selectedTrajectory,
    setSelectedTrajectory,
    highlightedRecord,
    setHighlightedRecord,
  } = useSelection();

  if (!initialPointsQueryComplete) {
    return (
      <div className="datasetsPanel" data-testid="datasets-panel">
        <SkeletonGroup className="datasetsCardList">
          {Array.from({ length: 6 }, (_, i) => (
            <DatasetCardSkeleton key={i} />
          ))}
        </SkeletonGroup>
      </div>
    );
  }

  return (
    <div
      data-testid="datasets-panel"
      className="datasetsPanel"
      onMouseEnter={() => setHoveredDataset(inspectDataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      {/* A refetch keeps the current results readable under the scrim. */}
      {selectionLoading && <Loading variant="inline" />}
      {/* The list stays mounted, hidden, under a dataset page, so going back
          lands on the same page of it, scrolled to the same place. */}
      {inspectDataset && (
        <div className="datasetsPanelView datasetsPanelDetail" key="detail">
          <DatasetInspector
            dataset={inspectDataset}
            setHoveredDataset={setHoveredDataset}
            returnToList={returnToDatasetList}
            setInspectRecordID={setInspectRecordID}
            query={combinedQueries}
            selectedTrajectory={selectedTrajectory}
            setSelectedTrajectory={setSelectedTrajectory}
            highlightedRecord={highlightedRecord}
            setHighlightedRecord={setHighlightedRecord}
            activeWmsOverlay={activeWmsOverlay}
            setActiveWmsOverlay={setActiveWmsOverlay}
          />
        </div>
      )}
      <div
        className="datasetsPanelView datasetsPanelList"
        key="list"
        hidden={Boolean(inspectDataset)}
      >
        <DatasetsTable
          handleSelectDataset={handleSelectDataset}
          setInspectDataset={setInspectDataset}
          datasets={filteredDatasets}
          setHoveredDataset={setHoveredDataset}
          hidden={Boolean(inspectDataset)}
        />
      </div>
    </div>
  );
}
