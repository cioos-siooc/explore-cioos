import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  createDataFilterQueryString,
  createSelectionQueryString
} from '../utilities.jsx'
import { wmsSliceParams } from '../wmsUtilities.js'
import {
  anyTrajectoryLayerOn,
  dataLayersAreDefault
} from './dataLayers.js'
import { GROUP_NONE } from './datasetGroups.js'
import { defaultTrailingDays } from '../components/config.js'
import { useFilters } from './filters/FilterProvider.jsx'
import { useMapState } from './map/MapStateProvider.jsx'
import { useSelection } from './selection/SelectionProvider.jsx'

// Sole owner of the URL format: serializes everything that shapes what the
// user is looking at — the debounced filter query, the drawn selection, the
// list's own narrowing (title search, in-view, grouping), the map view, and
// what the open dataset page or the "what's here" card is pointing at — into
// the search params, so the link reproduces the view. It also keeps i18n in
// sync with the lang param.
//
// Reading URL state back on load happens where the state lives (FilterProvider
// seeds the filters, MapStateProvider the camera, SelectionProvider the
// selection / search / grouping), each from the address the app was opened at.
//
// The open dataset page is the exception: SelectionProvider owns the
// dataset/server params and derives its state from them, so this sync must
// carry them through rather than drop them (it rebuilds the whole search
// string from scratch on every map pan).
export default function UrlSync () {
  const [searchParams] = useSearchParams()
  const { i18n } = useTranslation()
  // No ?lang= in the link means "whatever the user last chose" — i18n has
  // already resolved that from localStorage — not a reset to English, which
  // would undo the stored preference on the first sync.
  const lang = searchParams.get('lang') || i18n.resolvedLanguage
  const dataset = searchParams.get('dataset')
  const server = searchParams.get('server')
  const navigate = useNavigate()

  const { query } = useFilters()
  const {
    mapView,
    tracksMode,
    scrubTime,
    debouncedScrubTime,
    trailingDays,
    dataLayers,
    dataLayersVisible,
    bathymetryVisible,
    griddapCoverageVisible,
    projection,
    activeWmsOverlay,
    featureQuery
  } = useMapState()
  const {
    polygon,
    datasetTitleSearchText,
    onlyInView,
    groupBy,
    hiddenGroups,
    highlightedRecord,
    selectedTrajectory
  } = useSelection()
  const [isPageLoad, setIsPageLoad] = useState(true)

  // Set of hidden group keys — a stable string so a Set rebuilt with the same
  // members doesn't re-navigate.
  const hiddenGroupsParam = [...hiddenGroups]
    .map((key) => encodeURIComponent(key))
    .sort()
    .join(',')

  useEffect(() => {
    setIsPageLoad(false)
    if (isPageLoad) return
    const filterParams = new URLSearchParams(createDataFilterQueryString(query))
    // Rectangles serialize as latMin/lonMin/latMax/lonMax, free-form polygons
    // as a coordinate ring — createSelectionQueryString picks; the API takes
    // either (see /pointQuery).
    const selectionParams = new URLSearchParams(
      polygon ? createSelectionQueryString(polygon) : ''
    )
    const obj = {
      ...mapView,
      ...Object.fromEntries(filterParams),
      ...Object.fromEntries(selectionParams),
      lang,
      ...(datasetTitleSearchText ? { search: datasetTitleSearchText } : {}),
      ...(onlyInView ? { onlyInView: 'true' } : {}),
      ...(groupBy && groupBy !== GROUP_NONE ? { groupBy } : {}),
      ...(hiddenGroupsParam ? { hiddenGroups: hiddenGroupsParam } : {}),
      ...(dataset ? { dataset } : {}),
      ...(dataset && server ? { server } : {}),
      // What the open dataset page is pointing at, all of it keyed to the
      // ?dataset= above and gone with it: which slice of a griddap overlay is
      // drawn, and which subset of the dataset is highlighted — the record a
      // marker click pinned, or the platform whose track is on the map.
      ...(activeWmsOverlay ? wmsSliceParams(activeWmsOverlay) : {}),
      ...(highlightedRecord ? { record: highlightedRecord.profileId } : {}),
      ...(selectedTrajectory
        ? { track: selectedTrajectory.trajectoryId }
        : {}),
      // Where the "what's here" card was opened. The card's contents are
      // whatever is drawn under that point, so the point is the whole of it —
      // Map asks the question again on load. Six decimals is ~0.1 m, well
      // past the size of anything the hit-test can distinguish.
      ...(featureQuery
        ? { at: featureQuery.lngLat.map((n) => Number(n.toFixed(6))).join(',') }
        : {})
    }
    // The track-lines switch only means anything while a trajectory geometry is
    // on, and the param records its non-default state: it defaults on, so
    // 'tracks=false' is what needs saying.
    if (anyTrajectoryLayerOn(dataLayers) && !tracksMode) {
      obj.tracks = 'false'
    }
    // The scrub window only drives the track tiles, so it rides along with them.
    if (tracksMode && anyTrajectoryLayerOn(dataLayers)) {
      obj.scrubTime = scrubTime
      if (trailingDays !== defaultTrailingDays) obj.trail = trailingDays
    }
    // Data-layer selection persists only when not the default selection.
    if (!dataLayersAreDefault(dataLayers)) {
      obj.layers = Object.entries(dataLayers)
        .filter(([, on]) => on)
        .map(([key]) => key)
        .join(',')
    }
    // The legend's layer switches, each recording only its non-default state so
    // an untouched map keeps the short link it had before they were shareable.
    // They are preferences as well (localStorage), and a param in the link wins
    // over the stored value — see useUrlSeededPersistentState.
    if (!dataLayersVisible) obj.obs = 'false'
    if (!bathymetryVisible) obj.bathy = 'false'
    if (griddapCoverageVisible) obj.griddap = 'true'
    if (projection === 'globe') obj.globe = 'true'
    const combined = new URLSearchParams(obj)
    // Replace, never push: this mirrors state the app never reads back out of
    // the URL, so an entry per map pan would only bury the history entries
    // that do mean something (opening a dataset page).
    navigate('?' + combined.toString(), { replace: true })
  }, [
    query,
    mapView,
    polygon,
    datasetTitleSearchText,
    onlyInView,
    groupBy,
    hiddenGroupsParam,
    tracksMode,
    debouncedScrubTime,
    trailingDays,
    dataLayers,
    dataLayersVisible,
    bathymetryVisible,
    griddapCoverageVisible,
    projection,
    activeWmsOverlay,
    featureQuery,
    highlightedRecord,
    selectedTrajectory
  ])

  useEffect(() => {
    if (lang !== i18n.language) {
      i18n.changeLanguage(lang)
    }
  }, [lang])

  return null
}
