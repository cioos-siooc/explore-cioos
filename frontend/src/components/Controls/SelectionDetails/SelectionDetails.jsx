import * as React from 'react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import SelectionPanelHeader from '../SelectionPanelHeader/SelectionPanelHeader.jsx'
import SearchBar from '../SearchBar/SearchBar.jsx'
import FilterChips from '../FilterChips/FilterChips.jsx'
import FunnelVisualization from '../FunnelVisualization/FunnelVisualization.jsx'
import DownloadCTA from '../DownloadCTA/DownloadCTA.jsx'
import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import DatasetPreview from '../DatasetPreview/DatasetPreview.jsx'
import DatasetInspector from '../DatasetInspector/DatasetInspector.jsx'
import Loading from '../Loading/Loading.jsx'
import CIOOSLogoEN from '../../Images/NationalLogoEnglish.png'
import CIOOSLogoFR from '../../Images/NationalLogoFrench.png'
import { server } from '../../../config'
import './styles.css'
import {
  createDataFilterQueryString,
  getPointsDataSize,
  createSelectionQueryString,
  useDebounce
} from '../../../utilities.js'

import isEmpty from 'lodash/isEmpty'

// Note: datasets and points are exchangable terminology
export default function SelectionDetails({
  setPointsToReview,
  query,
  polygon,
  setPolygon,
  setHoveredDataset,
  filterSet,
  setShowIntroModal,
  totalNumberOfDatasets,
  resetFilters,
  activeWmsOverlay,
  setActiveWmsOverlay,
  children
}) {
  const { t, i18n } = useTranslation()
  const [selectAll, setSelectAll] = useState(false)
  const [pointsData, setPointsData] = useState([])
  const [inspectDataset, setInspectDataset] = useState()
  const [, setDataTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [initialPointsQueryComplete, setInitialPointsQueryComplete] =
    useState(false)
  const [inspectRecordID, setInspectRecordID] = useState()
  const [showModal, setShowModal] = useState(false)
  const [recordLoading, setRecordLoading] = useState(false)
  const [backClicked, setBackClicked] = useState(false)
  const [datasetPreview, setDatasetPreview] = useState()
  const [datasetTitleSearchText, setDatasetTitleSearchText] = useState('')
  const debouncedDatasetTitleSearchText = useDebounce(
    datasetTitleSearchText,
    300
  )
  const [datasetsSelected, setDatasetsSelected] = useState()
  const [filteredDatasets, setFilteredDatasets] = useState([])
  const [combinedQueries, setCombinedQueries] = useState([])

  useEffect(() => {
    if (!isEmpty(debouncedDatasetTitleSearchText)) {
      setFilteredDatasets(
        pointsData.filter((dataset) => {
          return `${dataset.title}`
            .toLowerCase()
            .includes(`${debouncedDatasetTitleSearchText}`.toLowerCase())
        })
      )
    } else {
      setFilteredDatasets(pointsData)
    }
  }, [debouncedDatasetTitleSearchText])

  useEffect(() => {
    if (!isEmpty(pointsData)) {
      let count = 0
      pointsData.forEach((point) => {
        if (point.selected) count++
      })
      setDatasetsSelected(count)
      setDataTotal(0)
      const total = getPointsDataSize(pointsData)
      setDataTotal(total / 1000000)
      setPointsToReview(pointsData.filter((point) => point.selected))
    }
    setLoading(false)
    if (pointsData.length === 1 && !backClicked) {
      // Auto load single selected dataset
      setInspectDataset(pointsData[0])
      // setLoading(true)
    }
  }, [pointsData])

  function datasetsInLanguage(point) {
    return {
      ...point,
      title: point.title_translated?.[i18n.language] || point.title,
      selected: false
    }
  }
  useEffect(() => {
    setDataTotal(0)
    if (!loading && query.eovsSelected.length) {
      const filtersQuery = createDataFilterQueryString(query)
      let shapeQuery = []
      if (polygon) {
        shapeQuery = createSelectionQueryString(polygon)
      }
      const combinedQueries = [filtersQuery, shapeQuery]
        .filter((e) => e)
        .join('&')
      setInspectDataset()
      setLoading(true)
      setCombinedQueries(combinedQueries)
      const urlString = `${server}/pointQuery${combinedQueries ? '?' + combinedQueries : ''}`
      fetch(urlString).then((response) => {
        if (response.ok) {
          response.json().then((data) => {
            setPointsData(data.map(datasetsInLanguage))
          })
        } else {
          setPointsData([])
        }
        setInitialPointsQueryComplete(true)
      })
    }
    setBackClicked(false)
  }, [query, polygon])

  useEffect(() => {
    if (!loading) {
      setPointsData(pointsData.map(datasetsInLanguage))
    }
  }, [i18n.language])

  function handleSelectDataset(point) {
    // Griddap datasets are metadata-only: they never enter the download
    // selection (pointsToReview) — data access is on ERDDAP directly.
    if (point.cdm_data_type === 'Grid') return
    const dataset = pointsData.filter((p) => p.pk === point.pk)[0]
    dataset.selected = !point.selected
    const result = pointsData.map((p) => {
      if (p.pk === point.pk) {
        return dataset
      } else {
        return p
      }
    })
    setPointsData(result)
  }

  function handleSelectAllDatasets() {
    setPointsData(
      pointsData.map((p) => {
        return {
          ...p,
          selected: p.cdm_data_type === 'Grid' ? false : !selectAll
        }
      })
    )
    setSelectAll(!selectAll)
  }

  function getActiveFilterCount() {
    let count = 0
    if (filterSet?.eovFilter?.eovsSelected?.some((e) => e.isSelected)) count++
    if (filterSet?.platformFilter?.platformsSelected?.some((e) => e.isSelected)) count++
    if (filterSet?.orgFilter?.orgsSelected?.some((e) => e.isSelected)) count++
    return count
  }

  // The WMS overlay lives only while its dataset is inspected: navigating
  // back or to another dataset clears it (the WmsLegend close button is the
  // other exit).
  useEffect(() => {
    if (activeWmsOverlay && activeWmsOverlay.pk !== inspectDataset?.pk) {
      setActiveWmsOverlay()
    }
  }, [inspectDataset])

  useEffect(() => {
    if (inspectDataset) {
      if (inspectRecordID) {
        setShowModal(true)
        setRecordLoading(true)
        fetch(
          `${server}/preview?dataset=${inspectDataset.dataset_id}&profile=${inspectRecordID}`
        )
          .then((response) => response.json())
          .then((preview) => {
            setDatasetPreview(preview)
            setRecordLoading(false)
          })
          .catch((error) => {
            throw error
          })
      }
    } else {
      setInspectRecordID()
    }
  }, [inspectRecordID])

  return (
    <div
      className='pointDetails'
      onMouseEnter={() => setHoveredDataset(inspectDataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      <SelectionPanelHeader
        logoSource={i18n.language === 'en' ? CIOOSLogoEN : CIOOSLogoFR}
        onInfoClick={() => setShowIntroModal(true)}
      />
      {!inspectDataset && !loading && initialPointsQueryComplete && (
        <>
          <SearchBar
            value={datasetTitleSearchText}
            onChange={setDatasetTitleSearchText}
            onClear={() => setDatasetTitleSearchText('')}
            activeFilterCount={getActiveFilterCount()}
          />
          <FilterChips
            activeFilters={[]}
            onRemoveFilter={() => {}}
            onClearAll={() => {}}
          />
        </>
      )}
      <div
        className={`pointDetailsInfoRow ${inspectDataset ? 'fullHeight' : ''}`}
      >
        {loading || !initialPointsQueryComplete ? (
          <Loading />
        ) : inspectDataset ? (
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
          <>
            <DatasetsTable
              handleSelectAllDatasets={handleSelectAllDatasets}
              handleSelectDataset={handleSelectDataset}
              setInspectDataset={setInspectDataset}
              setInspectRecordID={setInspectRecordID}
              filterSet={filterSet}
              selectAll={selectAll}
              setDatasets={setPointsData}
              datasets={
                isEmpty(debouncedDatasetTitleSearchText)
                  ? pointsData
                  : filteredDatasets
              }
              setHoveredDataset={setHoveredDataset}
            />
            {/* {(!pointsData || pointsData.length === 0) &&
                <div className="noDataNotice">
                  {t('selectionDetailsNoDataWarning')} */}
            {/* No Data. Modify filters or change selection on map. */}
            {/* </div>
              } */}
            <div className='pointDetailsControls'>
              <div className='pointDetailsControlRow'>
                <FunnelVisualization
                  all={totalNumberOfDatasets}
                  filtered={pointsData.length}
                  selected={datasetsSelected}
                />
                {children}
              </div>
            </div>
          </>
        )}
      </div>
      <DatasetPreview
        datasetPreview={datasetPreview}
        setDatasetPreview={setDatasetPreview}
        inspectDataset={inspectDataset}
        setInspectDataset={setInspectDataset}
        showModal={showModal || recordLoading}
        setShowModal={setShowModal}
        inspectRecordID={inspectRecordID}
        setInspectRecordID={setInspectRecordID}
        recordLoading={recordLoading}
        setRecordLoading={setRecordLoading}
      />
    </div >
  )
}
