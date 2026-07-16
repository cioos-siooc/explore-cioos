import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  createDataFilterQueryString,
  createSelectionQueryString
} from '../utilities.jsx'
import { GROUP_NONE } from './datasetGroups.js'
import { defaultTrailingDays } from '../components/config.js'
import { useFilters } from './filters/FilterProvider.jsx'
import { useMapState } from './map/MapStateProvider.jsx'
import { useSelection } from './selection/SelectionProvider.jsx'

// Sole owner of the URL format: serializes everything that shapes what the
// user is looking at — the debounced filter query, the drawn selection, the
// list's own narrowing (title search, in-view, grouping) and the map view —
// into the search params, so the link reproduces the view. It also keeps i18n
// in sync with the lang param.
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
    dataLayers
  } = useMapState()
  const {
    polygon,
    datasetTitleSearchText,
    onlyInView,
    groupBy,
    hiddenGroups
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
      ...(dataset && server ? { server } : {})
    }
    // Tracks-mode state persists in the URL only when active/non-default
    if (tracksMode) {
      obj.tracks = 'true'
      obj.scrubTime = scrubTime
      if (trailingDays !== defaultTrailingDays) obj.trail = trailingDays
    }
    // Data-layer selection persists only when not the all-on default.
    if (!Object.values(dataLayers).every(Boolean)) {
      obj.layers = Object.entries(dataLayers)
        .filter(([, on]) => on)
        .map(([key]) => key)
        .join(',')
    }
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
    dataLayers
  ])

  useEffect(() => {
    if (lang !== i18n.language) {
      i18n.changeLanguage(lang)
    }
  }, [lang])

  return null
}
