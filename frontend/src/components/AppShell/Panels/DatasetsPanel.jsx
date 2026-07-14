import * as React from 'react'

import DatasetsTable from '../../Controls/DatasetsTable/DatasetsTable.jsx'
import DatasetInspector from '../../Controls/DatasetInspector/DatasetInspector.jsx'
import Loading from '../../Controls/Loading/Loading.jsx'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import './styles.css'

// The Datasets panel: results list ⇄ single-dataset inspector drill-in.
// All state lives in the providers, so the panel can unmount freely.
export default function DatasetsPanel () {
  const {
    eovsSelected,
    setEovsSelected,
    platformsSelected,
    setPlatformsSelected,
    orgsSelected,
    setOrgsSelected,
    datasetsSelected,
    setDatasetsSelected
  } = useFilters()
  const { activeWmsOverlay, setActiveWmsOverlay } = useMapState()
  const {
    setPointsData,
    filteredDatasets,
    inspectDataset,
    setInspectDataset,
    selectionLoading,
    initialPointsQueryComplete,
    setInspectRecordID,
    setBackClicked,
    selectAll,
    handleSelectDataset,
    handleSelectAllDatasets,
    setHoveredDataset,
    combinedQueries,
    datasetsInViewPks
  } = useSelection()

  const filterSet = {
    eovFilter: { eovsSelected, setEovsSelected },
    platformFilter: { platformsSelected, setPlatformsSelected },
    orgFilter: { orgsSelected, setOrgsSelected },
    datasetFilter: { datasetsSelected, setDatasetsSelected }
  }

  if (selectionLoading || !initialPointsQueryComplete) {
    return (
      <div className='datasetsPanel'>
        <Loading />
      </div>
    )
  }

  return (
    <div
      className='datasetsPanel'
      onMouseEnter={() => setHoveredDataset(inspectDataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      {inspectDataset ? (
        <DatasetInspector
          dataset={inspectDataset}
          setHoveredDataset={setHoveredDataset}
          setBackClicked={setBackClicked}
          setInspectDataset={setInspectDataset}
          setInspectRecordID={setInspectRecordID}
          filterSet={filterSet}
          query={combinedQueries}
          activeWmsOverlay={activeWmsOverlay}
          setActiveWmsOverlay={setActiveWmsOverlay}
        />
      ) : (
        <DatasetsTable
          handleSelectAllDatasets={handleSelectAllDatasets}
          handleSelectDataset={handleSelectDataset}
          setInspectDataset={setInspectDataset}
          setInspectRecordID={setInspectRecordID}
          filterSet={filterSet}
          selectAll={selectAll}
          setDatasets={setPointsData}
          datasets={filteredDatasets}
          setHoveredDataset={setHoveredDataset}
          datasetsInViewPks={datasetsInViewPks}
        />
      )}
    </div>
  )
}
