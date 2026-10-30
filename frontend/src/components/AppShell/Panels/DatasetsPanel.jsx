import * as React from "react";

import DatasetsTable from "../../Controls/DatasetsTable/DatasetsTable.jsx";
import DatasetInspector from "../../Controls/DatasetInspector/DatasetInspector.jsx";
import Loading from "../../Controls/Loading/Loading.jsx";
import { SkeletonGroup } from "../../ui/Skeleton.jsx";
import Spinner from "../../ui/Spinner.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import useMediaQuery, { RAIL_QUERY } from "../../../state/ui/useMediaQuery.js";
import "./styles.css";

function DatasetListLoading() {
  return (
    <SkeletonGroup className="datasetsPanelLoading">
      <Spinner size="lg" role="presentation" />
    </SkeletonGroup>
  );
}

// The open dataset's page: in this panel in place of the list, or in its own
// window beside it where there's room (Sidebar).
export function DatasetPage() {
  const { activeWmsOverlay, setActiveWmsOverlay } = useMapState();
  const {
    inspectDataset,
    returnToDatasetList,
    setInspectRecordID,
    setHoveredDataset,
    combinedQueries,
    selectedTrajectory,
    setSelectedTrajectory,
    highlightedRecord,
    setHighlightedRecord,
  } = useSelection();

  return (
    <div className="datasetsPanelView datasetsPanelDetail">
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
  );
}

// All state lives in the providers, so the panel can unmount freely.
export default function DatasetsPanel() {
  const roomForRail = useMediaQuery(RAIL_QUERY);
  const { filtersPending } = useFilters();
  const {
    filteredDatasets,
    inspectDataset,
    setInspectDataset,
    selectionLoading,
    initialPointsQueryComplete,
    handleSelectDataset,
    setHoveredDataset,
  } = useSelection();
  const railed = Boolean(inspectDataset) && roomForRail;

  if (!initialPointsQueryComplete) {
    return (
      <div className="datasetsPanel" data-testid="datasets-panel">
        <DatasetListLoading />
      </div>
    );
  }

  // Cards that no longer answer the filters would read as the new results.
  const listStale = selectionLoading || filtersPending;
  const listShown = !inspectDataset || railed;

  return (
    <div
      data-testid="datasets-panel"
      className="datasetsPanel"
      onMouseEnter={() => setHoveredDataset(inspectDataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      {/* The open page doesn't depend on the results, so it stays readable
          under the scrim. */}
      {inspectDataset && !railed && selectionLoading && (
        <Loading variant="inline" />
      )}
      {listShown && listStale && <DatasetListLoading />}
      {/* The list stays mounted under a dataset page, so going back lands on
          the same page of it, scrolled to the same place. Where there's room
          it stays in sight beside the page, as it was, to move between
          datasets. */}
      <div
        className="datasetsPanelView datasetsPanelList"
        key="list"
        hidden={!listShown || listStale}
      >
        <DatasetsTable
          handleSelectDataset={handleSelectDataset}
          setInspectDataset={setInspectDataset}
          datasets={filteredDatasets}
          setHoveredDataset={setHoveredDataset}
          hidden={!listShown || listStale}
          activePk={railed ? inspectDataset.pk : undefined}
        />
      </div>
      {inspectDataset && !railed && <DatasetPage />}
    </div>
  );
}
