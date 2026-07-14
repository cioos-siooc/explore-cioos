import * as React from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  useMemo
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import isEmpty from 'lodash/isEmpty'

import { server } from '../../config.js'
import {
  boundsFromGeoJson,
  boundsIntersect,
  createDataFilterQueryString,
  createSelectionQueryString,
  datasetMatchesUrlKey,
  datasetUrlKey,
  formatErddapServerName,
  polygonIsRectangle,
  useDebounce
} from '../../utilities.jsx'
import erddapServersJSONfile from '../../erddapServers.json'
import { useFilters } from '../filters/FilterProvider.jsx'
import { useMapState } from '../map/MapStateProvider.jsx'

const SelectionContext = createContext()

// cdm_data_types that never render as platform-coloured point markers: grids
// draw as a coverage footprint / WMS overlay, trajectories as their own hex
// layer. See platformsAvailable below.
const PLATFORMLESS_DATASET_TYPES = new Set([
  'Grid',
  'Trajectory',
  'TrajectoryProfile'
])

export function useSelection () {
  return useContext(SelectionContext)
}

// Note: datasets and points are exchangable terminology
export default function SelectionProvider ({ children }) {
  const { i18n } = useTranslation()
  const { query, catalogLoaded } = useFilters()
  const {
    setActiveWmsOverlay,
    zoomToGeometry,
    pendingDatasetZoom,
    setPendingDatasetZoom,
    mapView
  } = useMapState()
  const [searchParams, setSearchParams] = useSearchParams()

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
  const [selectionLoading, setSelectionLoading] = useState(true)
  const [initialPointsQueryComplete, setInitialPointsQueryComplete] =
    useState(false)
  const [inspectRecordID, setInspectRecordID] = useState()
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [recordLoading, setRecordLoading] = useState(false)
  const [backClicked, setBackClicked] = useState(false)
  const [datasetPreview, setDatasetPreview] = useState()
  // Free-text title search for the datasets list (DatasetsTable's search
  // box). Lifted out of that component so it can also surface as a
  // removable chip in ActiveFilterChips.
  const [datasetTitleSearchText, setDatasetTitleSearchText] = useState('')
  const [datasetsSelectedCount, setDatasetsSelectedCount] = useState()
  const [combinedQueries, setCombinedQueries] = useState([])
  // "Only in view": restrict the list to datasets whose extent overlaps the
  // current map viewport. Lifted here (like the title search) so it also drives
  // the shared counters and surfaces as a removable chip in ActiveFilterChips.
  const [onlyInView, setOnlyInView] = useState(false)

  // Per-dataset bbox, computed once per result set from the filtered extent
  // (falls back to the coverage bbox, the only one grids carry).
  const datasetBounds = useMemo(
    () =>
      pointsData.map((row) => ({
        pk: row.pk,
        bounds: boundsFromGeoJson(
          row.filtered_bbox_geojson || row.coverage_bbox_geojson
        )
      })),
    [pointsData]
  )

  // Platform types present in the current result set — i.e. every platform the
  // map can draw a platform-coloured marker for under the active filters, at
  // any zoom or camera. The legend's platform swatches key off this rather than
  // the full catalog of platform types, so it never advertises a colour that
  // isn't on the map.
  //
  // Grids and trajectories are excluded because neither renders as a point:
  // grids show as a coverage footprint / WMS overlay, trajectories as the
  // dedicated hex layer. Their platforms are otherwise smuggled into the
  // legend — 'spacecraft' belongs only to grid datasets, and was showing a
  // swatch for a marker that is never drawn.
  const platformsAvailable = useMemo(
    () =>
      [
        ...new Set(
          pointsData
            .filter((row) => !PLATFORMLESS_DATASET_TYPES.has(row.cdm_data_type))
            .map((row) => row.platform)
            .filter(Boolean)
        )
      ].sort(),
    [pointsData]
  )

  // The live viewport changes on every pan; debounce it so a continuous drag
  // recomputes the in-view set once it settles rather than every frame.
  const viewportBounds = useDebounce(mapView?.bounds, 150)

  // pks whose extent overlaps the current viewport. Recomputed only when the
  // result set or the settled viewport changes.
  const datasetsInViewPks = useMemo(() => {
    const inView = new Set()
    if (!viewportBounds) return inView
    for (const { pk, bounds } of datasetBounds) {
      if (boundsIntersect(bounds, viewportBounds)) inView.add(pk)
    }
    return inView
  }, [datasetBounds, viewportBounds])

  // pointsData narrowed by the title search, matched the same way
  // DatasetsTable's search box used to match locally: title, dataset type,
  // and data-portal name. Derived here (rather than inside DatasetsTable) so
  // the datasets counters (Sidebar, TopControls) reflect it too.
  const filteredDatasets = useMemo(() => {
    const query = datasetTitleSearchText.toLowerCase()
    const hasSearch = !isEmpty(datasetTitleSearchText)
    if (!hasSearch && !onlyInView) return pointsData
    return pointsData.filter((row) => {
      if (onlyInView && !datasetsInViewPks.has(row.pk)) return false
      if (!hasSearch) return true
      return [
        row.title,
        row.cdm_data_type,
        formatErddapServerName(
          row.erddap_server_url || row.erddap_url,
          i18n.language,
          erddapServersJSONfile
        )
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [pointsData, datasetTitleSearchText, onlyInView, datasetsInViewPks, i18n.language])

  // The open dataset page lives in the URL (?dataset=…&server=…) rather than in
  // component state, so Back/Forward move through it natively and the page can
  // be linked to. useSearchParams re-renders on popstate, which is what makes
  // the browser's Back button close the page for free.
  const inspectDataset = useMemo(
    () => pointsData.find((point) => datasetMatchesUrlKey(point, searchParams)),
    [pointsData, searchParams]
  )

  // A share link that named a dataset but no camera: frame its footprint as
  // soon as it resolves out of pointsData, same as the "Zoom to dataset"
  // button would. Consumed once — later re-inspections don't re-trigger it.
  useEffect(() => {
    if (!pendingDatasetZoom || !inspectDataset) return
    const footprint =
      inspectDataset.filtered_bbox_geojson || inspectDataset.coverage_bbox_geojson
    if (footprint) zoomToGeometry(footprint)
    setPendingDatasetZoom(false)
  }, [pendingDatasetZoom, inspectDataset])

  // Opening or closing a dataset page is a navigation the user made, so it
  // pushes an entry that Back reverses. Automatic opens/closes (auto-inspecting
  // a lone result, dropping a dataset the filters just excluded) pass
  // replace: true — Back should skip a step the user never took.
  const setInspectDataset = useCallback(
    (dataset, { replace = false } = {}) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          const key = datasetUrlKey(dataset)
          if (key) {
            next.set('dataset', key.dataset)
            if (key.server) next.set('server', key.server)
            else next.delete('server')
          } else {
            next.delete('dataset')
            next.delete('server')
          }
          return next
        },
        { replace }
      )
    },
    [setSearchParams]
  )

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
      setInspectDataset(pointsData[0], { replace: true })
    } else if (
      !isEmpty(pointsData) &&
      searchParams.get('dataset') &&
      !pointsData.some((point) => datasetMatchesUrlKey(point, searchParams))
    ) {
      // The results just changed under an open dataset page and the dataset is
      // no longer among them (a filter excluded it, say): the page has already
      // closed itself — inspectDataset stopped resolving — so clear the params
      // it left behind rather than carry a dead key in the URL.
      setInspectDataset(undefined, { replace: true })
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
      // An open dataset page is deliberately NOT closed here: it survives a
      // filter change as long as the dataset is still in the results. If it
      // isn't, it closes when the new results land (see the pointsData effect).
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
    filteredDatasets,
    platformsAvailable,
    datasetsInViewPks,
    inViewCount: datasetsInViewPks.size,
    onlyInView,
    setOnlyInView,
    datasetsSelectedCount,
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
