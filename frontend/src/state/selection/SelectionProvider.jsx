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
  selectionFromSearchParams,
  useDebounce
} from '../../utilities.jsx'
import erddapServersJSONfile from '../../erddapServers.json'
import { useFilters } from '../filters/FilterProvider.jsx'
import { useMapState } from '../map/MapStateProvider.jsx'
import { GROUP_NONE, hiddenDatasetPksFor } from '../datasetGroups.js'
import { allDataLayersOn, datasetInDataLayers } from '../dataLayers.js'

const SelectionContext = createContext()

// cdm_data_types that never render as platform-coloured point markers: grids
// draw as a coverage footprint / WMS overlay, trajectories as coverage hexes.
// See platformsAvailable below.
const PLATFORMLESS_DATASET_TYPES = new Set([
  'Grid',
  'Trajectory',
  'TrajectoryProfile'
])

// OBIS datasets draw as coverage hexes too, but they carry cdm_data_type
// 'Point' — which an ERDDAP dataset can legitimately be as well — so they're
// matched on source rather than type.
const isPlatformlessDataset = (row) =>
  PLATFORMLESS_DATASET_TYPES.has(row.cdm_data_type) || row.source_type === 'obis'

export function useSelection () {
  return useContext(SelectionContext)
}

// Note: datasets and points are exchangable terminology
export default function SelectionProvider ({ children }) {
  const { i18n } = useTranslation()
  const { query, catalogLoaded, setDatasetsSelected } = useFilters()
  const {
    setActiveWmsOverlay,
    zoomToGeometry,
    pendingDatasetZoom,
    setPendingDatasetZoom,
    mapView,
    setMapDatasetPKs,
    dataLayers
  } = useMapState()
  const [searchParams, setSearchParams] = useSearchParams()

  // Everything below that is seeded from the URL is read once, from the
  // address the app was opened at — UrlSync owns the URL from then on and
  // rewrites it from this state, so re-reading it here would be circular.
  const initialParams = useState(
    () => new URL(window.location.href).searchParams
  )[0]

  // The drawn selection (rectangle or free-form polygon) is part of a share
  // link: Map re-draws it into the draw control on load, this seeds the state
  // the /pointQuery is built from.
  const [polygon, setPolygon] = useState(() =>
    selectionFromSearchParams(initialParams)
  )
  const [pointsToReview, setPointsToReview] = useState()
  const [pointsToDownload, setPointsToDownload] = useState()
  // Hovering the dataset list drives a map highlight (see Map.jsx). Sweeping
  // the cursor across the list would otherwise repaint the highlight once per
  // card crossed — and flash the "all datasets" state in the gaps between
  // cards — so the map follows a settled hover rather than every transit.
  const [hoveredDatasetTarget, setHoveredDataset] = useState()
  const hoveredDataset = useDebounce(hoveredDatasetTarget, 120)

  // One platform (trajectory id) picked in the dataset inspector to draw its
  // full track on the map: {datasetPk, datasetTitle, trajectoryId} | undefined.
  const [selectedTrajectory, setSelectedTrajectory] = useState()

  const [selectAll, setSelectAll] = useState(false)
  const [pointsData, setPointsData] = useState([])
  const [selectionLoading, setSelectionLoading] = useState(true)
  const [initialPointsQueryComplete, setInitialPointsQueryComplete] =
    useState(false)
  const [inspectRecordID, setInspectRecordID] = useState()
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [recordLoading, setRecordLoading] = useState(false)
  const [datasetPreview, setDatasetPreview] = useState()
  // Free-text title search for the datasets list (DatasetsTable's search
  // box). Lifted out of that component so it can also surface as a
  // removable chip in ActiveFilterChips.
  const [datasetTitleSearchText, setDatasetTitleSearchText] = useState(
    () => initialParams.get('search') || ''
  )
  const [datasetsSelectedCount, setDatasetsSelectedCount] = useState()
  const [combinedQueries, setCombinedQueries] = useState([])
  // "Only in view": restrict the list to datasets whose extent overlaps the
  // current map viewport. Lifted here (like the title search) so it also drives
  // the shared counters and surfaces as a removable chip in ActiveFilterChips.
  const [onlyInView, setOnlyInView] = useState(
    () => initialParams.get('onlyInView') === 'true'
  )

  // Grouping of the datasets list, and the groups the user has hidden from the
  // map. Both live here rather than in DatasetsTable: the hidden groups decide
  // what the map draws (see mapDatasetPKs below), and both are shareable — the
  // list can unmount (the inspector takes over the panel) without losing them.
  const [groupBy, setGroupByState] = useState(
    () => initialParams.get('groupBy') || GROUP_NONE
  )
  const [hiddenGroups, setHiddenGroups] = useState(
    () =>
      new Set(
        (initialParams.get('hiddenGroups') || '')
          .split(',')
          .map((key) => decodeURIComponent(key))
          .filter(Boolean)
      )
  )

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
            .filter((row) => !isPlatformlessDataset(row))
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
  //
  // The data-layer switches narrow it as well: turning a data type off stops
  // the map drawing it, so the list would otherwise keep offering datasets
  // that have no presence on the map (see state/dataLayers.js for which
  // switch owns which dataset — Grid datasets belong to none and always stay).
  const filteredDatasets = useMemo(() => {
    const query = datasetTitleSearchText.toLowerCase()
    const hasSearch = !isEmpty(datasetTitleSearchText)
    const layersNarrowed = !allDataLayersOn(dataLayers)
    if (!hasSearch && !onlyInView && !layersNarrowed) return pointsData
    return pointsData.filter((row) => {
      if (layersNarrowed && !datasetInDataLayers(row, dataLayers)) return false
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
  }, [
    pointsData,
    datasetTitleSearchText,
    onlyInView,
    datasetsInViewPks,
    dataLayers,
    i18n.language
  ])

  // Group keys are only meaningful within one dimension, so switching
  // dimensions drops whatever was hidden under the old one.
  const setGroupBy = useCallback((dimension) => {
    setGroupByState(dimension)
    setHiddenGroups(new Set())
  }, [])

  const toggleGroupHidden = useCallback((group) => {
    setHiddenGroups((previous) => {
      const next = new Set(previous)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const showAllGroups = useCallback(() => setHiddenGroups(new Set()), [])

  // Datasets hidden from the map by their group. The list still shows them —
  // this is a visibility toggle, not a filter.
  const hiddenDatasetPks = useMemo(
    () =>
      hiddenDatasetPksFor(
        pointsData,
        groupBy,
        hiddenGroups,
        datasetsInViewPks
      ),
    [pointsData, groupBy, hiddenGroups, datasetsInViewPks]
  )

  // Hand the map the datasets it may draw. The tile/legend/coverage queries
  // take an include list (datasetPKs), so the exclusion is expressed as its
  // complement over the current results; undefined while nothing is hidden
  // leaves those queries as the filters wrote them.
  useEffect(() => {
    setMapDatasetPKs(
      hiddenDatasetPks.size === 0
        ? undefined
        : pointsData
          .filter((row) => !hiddenDatasetPks.has(row.pk))
          .map((row) => row.pk)
    )
  }, [hiddenDatasetPks, pointsData])

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

  // Leaving the dataset page, from wherever it is asked for — the page's own
  // close/swipe/Backspace, or the sidebar header's back control.
  //
  // This used to clear the datasets filter on the way out, because opening the
  // page was itself what had set that filter: clicking a hex or a griddap
  // footprint overwrote it with the cell's datasets, and a single survivor then
  // auto-opened its page, so leaving had to undo a narrowing the user never
  // asked for. Nothing does that any more — a map click reports what it found
  // and the filter only changes when the user presses a button — so leaving the
  // page is now just leaving the page. Clearing here would instead discard a
  // selection they deliberately built up.
  const returnToDatasetList = useCallback(() => {
    setInspectDataset()
    setSelectedTrajectory()
  }, [setInspectDataset])

  // A track clicked on the map does what clicking a platform row in the dataset
  // inspector does (DatasetInspector's onRowClicked): open that dataset's page
  // AND draw the platform's full history. Both writes happen in this one call so
  // React batches them into a single render — which is what stops the
  // [inspectDataset] effect below from clearing the selection it just made (it
  // sees the new inspectDataset and the matching selectedTrajectory together).
  const selectTrajectoryFromMap = useCallback(
    (datasetPk, trajectoryId, datasetTitle) => {
      // Re-clicking the selected track is a no-op, not a toggle: track-lines
      // stays hit-testable (just dimmed) under the selected track drawn over it,
      // so a toggle would clear the selection on any click along it — including
      // a click meant to read a fix tooltip. Clearing stays the platform row.
      if (
        selectedTrajectory?.datasetPk === datasetPk &&
        selectedTrajectory?.trajectoryId === trajectoryId
      ) {
        return
      }

      // The page can only open for a dataset the current results contain —
      // inspectDataset resolves out of pointsData. The tracks tiles apply only
      // the dataset-level filters, so they can carry a dataset that pointQuery's
      // depth/bbox/polygon predicates dropped; draw its track anyway and leave
      // the URL alone. Never setInspectDataset(undefined) here — that would
      // close whatever page was open and take the new selection down with it.
      const dataset = pointsData.find((row) => row.pk === datasetPk)
      // Skipped when this dataset's page is already open, so repeat clicks don't
      // each push a history entry Back has to walk through.
      if (dataset && inspectDataset?.pk !== datasetPk && datasetUrlKey(dataset)) {
        setInspectDataset(dataset)
      }

      setSelectedTrajectory({
        datasetPk,
        datasetTitle: dataset?.title || datasetTitle,
        trajectoryId
      })
    },
    [pointsData, inspectDataset, selectedTrajectory, setInspectDataset]
  )

  // Put datasets aside into the selection, from the "what's here" card — the
  // same thing the "+" on a dataset card does, for a set at a time. The
  // selection is a shortlist the user is building; downloading it is one thing
  // they can do with it afterwards, not what it is for.
  //
  // This deliberately does NOT touch the datasets *filter*. The card's "+" used
  // to add to that filter, which narrowed the results to whatever had been
  // added — and a narrowed list is a list you cannot pick anything else out of,
  // so the second click on the map had less to offer than the first and the
  // basket could never grow. Adding to the download selection composes instead:
  // click around the map, keep adding, the list stays whole.
  //
  // Griddap datasets are metadata-only and never enter pointsToReview (see
  // handleSelectDataset), so they are skipped here too rather than silently
  // added and dropped later.
  const addDatasetsToSelection = useCallback((pks) => {
    const wanted = new Set(pks.map(Number))
    if (wanted.size === 0) return
    setPointsData((previous) =>
      previous.map((point) =>
        wanted.has(Number(point.pk)) &&
        !point.selected &&
        point.cdm_data_type !== 'Grid'
          ? { ...point, selected: true }
          : point
      )
    )
  }, [])

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
    // A single remaining result used to open its own dataset page. That made
    // the outcome of a map click depend on how dense the data happened to be —
    // clicking a griddap footprint or a hex narrowed the filter, and you landed
    // on a dataset page or on a one-row list depending on whether the narrowing
    // bottomed out at exactly one. Opening a dataset page is now always an
    // explicit act: a row in the "what's here" card, a card in the list, or a
    // ?dataset= link.
    if (
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
    // The selected track follows the inspected dataset: leaving the inspector
    // (or moving to another dataset) clears it from the map.
    setSelectedTrajectory((current) =>
      current && current.datasetPk !== inspectDataset?.pk ? undefined : current
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
    selectedTrajectory,
    setSelectedTrajectory,
    selectTrajectoryFromMap,
    selectAll,
    pointsData,
    setPointsData,
    inspectDataset,
    setInspectDataset,
    returnToDatasetList,
    addDatasetsToSelection,
    selectionLoading,
    initialPointsQueryComplete,
    inspectRecordID,
    setInspectRecordID,
    showPreviewModal,
    setShowPreviewModal,
    recordLoading,
    setRecordLoading,
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
    groupBy,
    setGroupBy,
    hiddenGroups,
    toggleGroupHidden,
    showAllGroups,
    hiddenDatasetPks,
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
