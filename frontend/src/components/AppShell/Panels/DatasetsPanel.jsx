import * as React from "react";

import DatasetsTable from "../../Controls/DatasetsTable/DatasetsTable.jsx";
import DatasetInspector from "../../Controls/DatasetInspector/DatasetInspector.jsx";
import Loading from "../../Controls/Loading/Loading.jsx";
import { SkeletonGroup } from "../../ui/Skeleton.jsx";
import Spinner from "../../ui/Spinner.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import "./styles.css";

function DatasetListLoading() {
  return (
    <SkeletonGroup className="datasetsPanelLoading">
      <Spinner size="lg" role="presentation" />
    </SkeletonGroup>
  );
}

// All state lives in the providers, so the panel can unmount freely.
export default function DatasetsPanel() {
  const { activeWmsOverlay, setActiveWmsOverlay } = useMapState();
  const { filtersPending } = useFilters();
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
        <DatasetListLoading />
      </div>
    );
  }

  // Cards that no longer answer the filters would read as the new results.
  const listStale = selectionLoading || filtersPending;

  return (
    <div
      data-testid="datasets-panel"
      className="datasetsPanel"
      onMouseEnter={() => setHoveredDataset(inspectDataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      {/* The open page doesn't depend on the results, so it stays readable
          under the scrim. */}
      {inspectDataset && selectionLoading && <Loading variant="inline" />}
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
      {!inspectDataset && listStale && <DatasetListLoading />}
      <div
        className="datasetsPanelView datasetsPanelList"
        key="list"
        hidden={Boolean(inspectDataset) || listStale}
      >
        <DatasetsTable
          handleSelectDataset={handleSelectDataset}
          setInspectDataset={setInspectDataset}
          datasets={filteredDatasets}
          setHoveredDataset={setHoveredDataset}
          hidden={Boolean(inspectDataset) || listStale}
        />
      </div>
    </div>
  );
}
