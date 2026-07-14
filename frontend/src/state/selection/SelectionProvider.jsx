import * as React from 'react'
import { createContext, useContext, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import isEmpty from 'lodash/isEmpty'

import { server } from '../../config.js'
import {
  createDataFilterQueryString,
  createSelectionQueryString,
  polygonIsRectangle,
  useDebounce
} from '../../utilities.jsx'
import { useFilters } from '../filters/FilterProvider.jsx'
import { useMapState } from '../map/MapStateProvider.jsx'

const SelectionContext = createContext()

export function useSelection () {
  return useContext(SelectionContext)
}

// Note: datasets and points are exchangable terminology
export default function SelectionProvider ({ children }) {
  const { i18n } = useTranslation()
  const { query, catalogLoaded } = useFilters()
  const { setActiveWmsOverlay } = useMapState()

  const [polygon, setPolygon] = useState()
  const [pointsToReview, setPointsToReview] = useState()
  const [pointsToDownload, setPointsToDownload] = useState()
  // Hovering the dataset list drives a map highlight (see Map.jsx). Sweeping
  // the cursor across the list would otherwise repaint the highlight once per
  // card crossed — and flash the "all datasets" state in the gaps between
  // cards — so the map follows a settled hover rather than every transit.
  const [hoveredDatasetTarget, setHoveredDataset] = useState()
  const hoveredDataset = useDebounce(hoveredDatasetTarget, 120)

  const [selectAll, setSelectAll] = useState(false)
  const [pointsData, setPointsData] = useState([])
  const [inspectDataset, setInspectDataset] = useState()
  const [selectionLoading, setSelectionLoading] = useState(true)
  const [initialPointsQueryComplete, setInitialPointsQueryComplete] =
    useState(false)
  const [inspectRecordID, setInspectRecordID] = useState()
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [recordLoading, setRecordLoading] = useState(false)
  const [backClicked, setBackClicked] = useState(false)
  const [datasetPreview, setDatasetPreview] = useState()
  const [datasetTitleSearchText, setDatasetTitleSearchText] = useState('')
  const debouncedDatasetTitleSearchText = useDebounce(
    datasetTitleSearchText,
    300
  )
  const [datasetsSelectedCount, setDatasetsSelectedCount] = useState()
  const [filteredDatasets, setFilteredDatasets] = useState([])
  const [combinedQueries, setCombinedQueries] = useState([])

  // Mark the polygon-draw control active for free-form polygons (rectangles
  // have their own #boxQueryButton active state).
  useEffect(() => {
    const elem = document.querySelector(
      '.mapbox-gl-draw_ctrl-draw-btn.mapbox-gl-draw_polygon'
    )
    if (polygon && !polygonIsRectangle(polygon)) {
      if (elem) {
        elem.style.backgroundColor = 'var(--cioos-teal-light)'
      }
    } else {
      // remove colour from button
      if (elem) {
        elem.style.backgroundColor = 'var(--cioos-white)'
      }
    }
  }, [polygon])

  useEffect(() => {
    if (isEmpty(pointsToReview)) {
      setPointsToDownload()
    }
  }, [pointsToReview])

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
      setDatasetsSelectedCount(count)
      setPointsToReview(pointsData.filter((point) => point.selected))
    }
    setSelectionLoading(false)
    if (pointsData.length === 1 && !backClicked) {
      // Auto load single selected dataset
      setInspectDataset(pointsData[0])
    }
  }, [pointsData])

  function datasetsInLanguage (point) {
    return {
      ...point,
      title: point.title_translated?.[i18n.language] || point.title,
      selected: false
    }
  }

  // The pointQuery waits for the catalog so the filters it sends are hydrated
  // from the URL first. It must not wait for a non-empty EOV list: OBIS
  // datasets carry no EOVs, so a database holding only OBIS data produces an
  // empty /oceanVariables and would never query at all. catalogLoaded resolves
  // even when the fetches fail, so a dead API lands on an empty list rather
  // than an endless spinner.
  useEffect(() => {
    if (!selectionLoading && catalogLoaded) {
      const filtersQuery = createDataFilterQueryString(query)
      let shapeQuery = []
      if (polygon) {
        shapeQuery = createSelectionQueryString(polygon)
      }
      const combinedQueries = [filtersQuery, shapeQuery]
        .filter((e) => e)
        .join('&')
      setInspectDataset()
      setSelectionLoading(true)
      setCombinedQueries(combinedQueries)
      const urlString = `${server}/pointQuery${
        combinedQueries ? '?' + combinedQueries : ''
      }`
      fetch(urlString)
        .then((response) => {
          if (response.ok) {
            response.json().then((data) => {
              setPointsData(data.map(datasetsInLanguage))
            })
          } else {
            setPointsData([])
          }
          setInitialPointsQueryComplete(true)
        })
        .catch((error) => {
          // network failure / gateway timeout: land on an empty list rather
          // than an endless spinner
          console.error('pointQuery failed:', error)
          setPointsData([])
          setInitialPointsQueryComplete(true)
        })
    }
    setBackClicked(false)
  }, [query, polygon, catalogLoaded])

  useEffect(() => {
    if (!selectionLoading) {
      setPointsData(pointsData.map(datasetsInLanguage))
    }
  }, [i18n.language])

  function handleSelectDataset (point) {
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

  function handleSelectAllDatasets () {
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

  // The WMS overlay lives only while its dataset is inspected: navigating
  // back or to another dataset clears it (the WmsLegend close button is the
  // other exit). Functional update on purpose — GriddapDetails auto-shows the
  // overlay for a newly inspected dataset from a child effect, which runs
  // before this one, so reading activeWmsOverlay from this render's closure
  // would see the stale value and clear the overlay that was just set.
  useEffect(() => {
    setActiveWmsOverlay((current) =>
      current && current.pk !== inspectDataset?.pk ? undefined : current
    )
  }, [inspectDataset])

  useEffect(() => {
    if (inspectDataset) {
      if (inspectRecordID) {
        setShowPreviewModal(true)
        setRecordLoading(true)
        fetch(
          `${server}/preview?dataset=${inspectDataset.dataset_id}&profile=${inspectRecordID}`
        )
          .then((response) => (response.ok ? response.json() : undefined))
          .then((preview) => {
            setDatasetPreview(preview)
            setRecordLoading(false)
          })
          .catch((error) => {
            console.error('preview fetch failed:', error)
            setRecordLoading(false)
          })
      }
    } else {
      setInspectRecordID()
    }
  }, [inspectRecordID])

  const value = {
    polygon,
    setPolygon,
    pointsToReview,
    setPointsToReview,
    pointsToDownload,
    setPointsToDownload,
    hoveredDataset,
    setHoveredDataset,
    selectAll,
    pointsData,
    setPointsData,
    inspectDataset,
    setInspectDataset,
    selectionLoading,
    initialPointsQueryComplete,
    inspectRecordID,
    setInspectRecordID,
    showPreviewModal,
    setShowPreviewModal,
    recordLoading,
    setRecordLoading,
    setBackClicked,
    datasetPreview,
    setDatasetPreview,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    debouncedDatasetTitleSearchText,
    datasetsSelectedCount,
    filteredDatasets,
    combinedQueries,
    handleSelectDataset,
    handleSelectAllDatasets
  }

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  )
}
