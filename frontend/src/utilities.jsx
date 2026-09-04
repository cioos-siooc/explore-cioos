import isEmpty from 'lodash/isEmpty'
import { scaleLinear, scaleLog } from 'd3-scale'
import React, { useState, useEffect } from 'react'
import { defaultQuery } from './components/config.js'
import { useTranslation } from 'react-i18next'

export function setAllOptionsIsSelectedTo(isSelected, options, setOptions) {
  setOptions(
    options.map((option) => {
      return {
        ...option,
        isSelected
      }
    })
  )
}

export function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

export function generateMultipleSelectBadgeTitle (badgeTitle, optionsSelected) {
  const { t } = useTranslation()

  if (optionsSelected) {
    const optionsSelectedFiltered = optionsSelected.filter(
      (option) => option.isSelected
    )
    if (optionsSelectedFiltered.length === 0) {
      return t(badgeTitle)
    } else if (optionsSelectedFiltered.length === 1) {
      return capitalizeFirstLetter(t(optionsSelectedFiltered[0].title))
    } else {
      // More than 0 or 1 options are selected
      const mapping = {
        oceanVariablesFiltername: 'oceanVariablesMulti',
        platformsFilterName: 'platformsMulti',
        organizationFilterName: 'organizationMulti',
        datasetsFilterName: 'datasetsMulti'
      }
      return optionsSelectedFiltered.length + t(mapping[badgeTitle])
    }
  }
}

export function generateRangeSelectBadgeTitle(
  badgeTitle,
  optionsSelected,
  defaults,
  units
) {
  return optionsSelected[0] === defaults[0] &&
    optionsSelected[1] === defaults[1]
    ? badgeTitle
    : `${optionsSelected[0]} - ${optionsSelected[1]}` +
        (!isEmpty(units) ? ' ' + units : '')
}

export function abbreviateString (text, maxLength) {
  if (text) {
    if (text.length > maxLength) {
      return `${text.slice(0, maxLength)}...`
    } else {
      return text
    }
  }
}

// For strings interpolated into popup.setHTML() markup: dataset titles and
// trajectory ids come from harvested (third-party) metadata, so anything
// markup-significant must be neutralized before it reaches the DOM.
export function escapeHtml (text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function validateEmail(email) {
  const re =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
  return re.test(String(email).toLowerCase())
}

// create a URL query string from an object
function objectToURL (obj) {
  return Object.entries(obj)
    .filter(([k, v]) => k && v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

export function createDataFilterQueryString(query) {
  const {
    orgsSelected,
    eovsSelected,
    platformsSelected,
    datasetsSelected,
    scientificNamesSelected,
    obisNodesSelected,
    erddapServersSelected
  } = query

  // pulling together a query object that doesn't contain a ton of values from the defaultQuery object (which is composed of the defaultABCSelected objects)
  const queryWithoutDefaults = Object.keys(defaultQuery).reduce(
    // going through each
    (accumulatorObject, field) => {
      if (query[field] !== defaultQuery[field]) {
        // checking that the value of each property in the query object has been changed in order to include those values in the url
        accumulatorObject[field] = query[field]
      } // otherwise properties are left at their defaults, and excluded from the url.
      return accumulatorObject
    },
    {}
  )
  let platforms, datasetPKs, orgPKs

  const eovs = eovsSelected
    .filter((eov) => eov.isSelected) // pulling the selected eov names out (these don't have pks)
    .map((eov) => eov.title)
    .join() // create the comma delimited list of eovs

  if (platformsSelected.every((e) => e.isSelected)) {
    platforms = ''
  } else {
    platforms = platformsSelected
      .filter((platform) => platform.isSelected)
      .map((platform) => platform.title)
      .join()
  }

  if (datasetsSelected.every((e) => e.isSelected)) {
    datasetPKs = ''
  } else {
    datasetPKs = datasetsSelected
      .filter((dataset) => dataset.isSelected) // getting the selected datasets out
      .map((dataset) => dataset.pk) // getting the pks of the selected datasets using the dataset title to access the pk
      .join() // create the comma delimited list of dataset pks
  }

  if (orgsSelected.every((e) => e.isSelected)) {
    orgPKs = ''
  } else {
    orgPKs = orgsSelected
      .filter((org) => org.isSelected) // getting the selected orgs out
      .map((org) => org.pk) // getting the pks of the selected organizations using the orgs title to access the pk
      .join() // create the comma delimited list of org pks
  }
  const { startDepth, endDepth, startDate, endDate } = queryWithoutDefaults

  const scientificNames = (scientificNamesSelected && scientificNamesSelected.length)
    ? scientificNamesSelected.map(encodeURIComponent).join(',')
    : ''

  // Combined "Data Source" filter (ERDDAP servers + OBIS nodes). No selection
  // — or everything selected — means no source filtering. A server-only
  // selection hides OBIS via includeObis=false; node names are always emitted
  // when any node is picked (even all of them) because their presence is what
  // tells the API to keep OBIS rows while servers are also filtered, and to
  // hide ERDDAP profiles when no servers are selected.
  const selectedServers = (erddapServersSelected || []).filter((s) => s.isSelected)
  const selectedNodes = (obisNodesSelected || []).filter((n) => n.isSelected)
  const allServersSelected =
    erddapServersSelected?.length > 0 &&
    selectedServers.length === erddapServersSelected.length
  const allNodesSelected =
    obisNodesSelected?.length > 0 &&
    selectedNodes.length === obisNodesSelected.length

  let erddapServers = ''
  let obisNodes = ''
  let includeObis = ''
  const sourceFilterActive =
    (selectedServers.length > 0 || selectedNodes.length > 0) &&
    !(allServersSelected && allNodesSelected)
  if (sourceFilterActive) {
    if (selectedNodes.length > 0) {
      obisNodes = selectedNodes.map((n) => encodeURIComponent(n.title)).join(',')
      if (selectedServers.length > 0) {
        erddapServers = selectedServers.map((s) => s.url).join()
      }
    } else {
      includeObis = 'false'
      if (!allServersSelected) {
        erddapServers = selectedServers.map((s) => s.url).join()
      }
    }
  }

  const apiMappedQuery = {
    // These properties are specified by the API's schema
    eovs,
    platforms,
    datasetPKs,
    organizations: orgPKs,
    erddapServers,
    timeMin: startDate,
    timeMax: endDate,
    depthMin: startDepth,
    depthMax: endDepth,
    includeObis,
    scientificNames,
    obisNodes
  }

  return objectToURL(apiMappedQuery)
}

// How many times bigger the max has to be than the min before the ramp goes
// log instead of linear.
const LOG_SCALE_MIN_RATIO = 100

// returns an array of {stop: num, color: string} objects
//
// Two shapes, picked by how wide the range is rather than how big its maximum
// is. There used to be a third — a power curve with exponent 5 — from when the
// ramp counted distinct locations per hex; every current metric is better
// served by one of these two, and the power curve actively hurt them (over a
// [1, 15] dataset-count range it collapsed to stops 1|2|6|15, putting almost
// every hexagon in the lightest shade).
export function generateColorStops(colorScale, range) {
  // Ranges arrive from /legend and can be absent (still in flight), or [null,
  // null] when the filters match nothing. Neither is a scale.
  if (!range || !Number.isFinite(range[1]) || range[1] <= 0) return []
  let colors
  let scale
  // scaleLog cannot have 0 in its domain, so the low end is clamped to 1 —
  // safe because these are counts, and a hex that survives the aggregation
  // holds at least one thing.
  const lo = Math.max(Number.isFinite(range[0]) ? range[0] : 1, 1)
  const hi = range[1]
  if (hi / lo >= LOG_SCALE_MIN_RATIO) {
    // Measurement and day counts span five to eight orders of magnitude. Any
    // linear spacing over that puts all but a handful of hexes in the lightest
    // color, which reads as "there's nothing here" across most of the map. Log
    // spacing is what makes the middle of the distribution visible.
    //
    // The scale is built value -> index and inverted, since the caller wants
    // index -> value and a log domain of [0, n-1] would be the illegal
    // direction.
    colors = colorScale
    const logScale = scaleLog()
      .domain([lo, hi])
      .range([0, colors.length - 1])
    scale = (index) => logScale.invert(index)
  } else {
    // Narrow ranges — dataset counts run about 1..19 — spread evenly. When
    // there are fewer distinct values than colors, thin the ramp so each value
    // gets its own shade instead of two shades sharing a value. Thin by
    // sampling across the whole ramp rather than taking a prefix: a prefix of a
    // 12-stop ramp that starts in pale teal would paint a 1..3 range entirely
    // in the lightest end, and "3 datasets" would look like nothing.
    const span = Math.floor(hi) - Math.floor(lo) + 1
    // A one-value range takes the middle of the ramp, not its first stop: with
    // nothing to compare against, the honest shade is a mid one.
    colors =
      span < colorScale.length
        ? Array.from({ length: span }, (_, i) =>
          colorScale[
            Math.round(
              (span === 1 ? 0.5 : i / (span - 1)) * (colorScale.length - 1)
            )
          ]
        )
        : colorScale
    scale = scaleLinear()
      .domain([0, colors.length - 1])
      .range([lo, hi])
  }
  const colorStops = colors.map((color, index) => {
    return {
      // The top stop is pinned to the range max rather than floored: on the
      // log scale invert() lands a hair under it (499.999... for a max of
      // 500), and a legend whose last tick reads one less than the real
      // maximum looks like a bug.
      stop: index === colors.length - 1 ? hi : Math.floor(scale(index)),
      color
    }
  })
  const result = []
  const map = new Map()
  colorStops.forEach((colorStop) => {
    // ensure there aren't duplicates
    if (!map.has(colorStop.stop)) {
      map.set(colorStop.stop, true)
      result.push(colorStop)
    }
  })
  return result
}

// The dataset count shown on the Datasets entry points: "filtered / total"
// while a filter narrows the catalog, and just the total once nothing is
// filtered out (or before the total is known).
export function formatDatasetCount (filtered, total) {
  if (!total || filtered === total) return String(total || filtered)
  return `${filtered} / ${total}`
}

// The instants either list carries, formatted as the UTC they are: the record
// list spells them out in UTC (see shapeQuery.js) and the platform list sends
// timestamptz, which JSON serializes as UTC too, so a Z is the truth in both
// and no local-time conversion is wanted — an oceanographic record's time is
// the time it was taken at sea, not the reader's wall clock.
//
// Where the two ends share a day, the second one drops it: a cast that ran
// from 18:32 to 19:05 says so in one line rather than repeating the date.
export function formatInstantRange (min, max) {
  const from = splitInstant(min)
  const to = splitInstant(max)
  if (!from) return formatInstant(max)
  if (!to || (from.day === to.day && from.time === to.time)) {
    return formatInstant(min)
  }
  if (from.day === to.day) return `${from.day} ${from.time} → ${to.time}Z`
  return `${from.day} ${from.time}Z → ${to.day} ${to.time}Z`
}

// One instant, under the same UTC rule: a single fix's time on the map's
// hover chip, and the degenerate ends of the range above.
export function formatInstant (value) {
  const at = splitInstant(value)
  return at ? `${at.day} ${at.time}Z` : undefined
}

// Either shape an instant reaches the app in: an ISO string from JSON, or the
// epoch milliseconds a vector tile carries (MVT has no timestamp type, so the
// track tiles encode their times as numbers).
function splitInstant (value) {
  if (value === null || value === undefined || value === '') return undefined
  const iso =
    typeof value === 'number' ? new Date(value).toISOString() : String(value)
  const [day, rest] = iso.split('T')
  return { day, time: (rest || '00:00').slice(0, 5) }
}

// "min – max", or the one bound that exists, or the single value when the two
// are the same.
export function formatRange (min, max, unit = '') {
  const suffix = unit ? ` ${unit}` : ''
  if (min === null || min === undefined) {
    return max === null || max === undefined ? undefined : `${max}${suffix}`
  }
  if (max === null || max === undefined || String(min) === String(max)) {
    return `${min}${suffix}`
  }
  return `${min} – ${max}${suffix}`
}

export function useDebounce (value, delay) {
  // State and setters for debounced value
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(
    () => {
      // Update debounced value after delay
      const handler = setTimeout(() => {
        setDebouncedValue(value)
      }, delay)
      // Cancel the timeout if value changes (also on delay change or unmount)
      // This is how we prevent debounced value from updating if value is changed ...
      // .. within the delay period. Timeout gets cleared and restarted.
      return () => {
        clearTimeout(handler)
      }
    },
    [value, delay] // Only re-call effect if value or delay changes
  )
  return debouncedValue
}

// Which of the three tiers the ramp is drawn from, for a zoom. Every zoom maps
// onto one: an unknown zoom (the map hasn't reported its camera yet) takes the
// widest tier rather than falling out of the switch — a caller that got
// `undefined` back could only read it as "no data", which is a different thing
// entirely.
export function getCurrentRangeLevel (rangeLevels, zoom) {
  if (!rangeLevels) return undefined
  const level = Number(zoom)
  if (!Number.isFinite(level) || level < 5) return rangeLevels.zoom0
  if (level < 7) return rangeLevels.zoom1
  return rangeLevels.zoom2
}

// The rungs a quantized count domain is allowed to land on, within each decade.
// Coarse enough that an ordinary pan lands on the same rung it started from —
// which is the whole point: an unquantized viewport domain would shift by a few
// counts on every drag, repainting the ramp and renumbering the legend for a
// change nobody can see.
const NICE_MANTISSAS = [1, 1.5, 2, 3, 5, 7, 10]

// Snap a positive count out to the nearest rung, away from the middle of the
// domain: 'up' for a maximum, 'down' for a minimum, so quantizing only ever
// widens a range and never clips a hex out of its own ramp.
function snapCount (value, direction) {
  if (!Number.isFinite(value) || value <= 0) return undefined
  const base = 10 ** Math.floor(Math.log10(value))
  const mantissa = value / base
  // The float slack absorbs the log10/pow round trip, which lands a clean 100
  // on 99.99999999999999 often enough to matter — without it, a maximum of 100
  // would snap up to 150.
  const rung =
    direction === 'up'
      ? NICE_MANTISSAS.find((m) => m >= mantissa - 1e-9)
      : [...NICE_MANTISSAS].reverse().find((m) => m <= mantissa + 1e-9)
  return Math.max(1, Math.round(rung * base))
}

// Widen a measured [min, max] onto the rungs above. Counts, so the result is
// integral and never below 1; anything that isn't a usable range (no data on
// screen, a null max from a query that matched nothing) comes back undefined,
// which every caller reads as "use the global domain instead".
export function quantizeCountRange (range) {
  if (!Array.isArray(range)) return undefined
  const hi = snapCount(range[1], 'up')
  if (!hi) return undefined
  const lo = snapCount(Math.max(Number(range[0]) || 1, 1), 'down') || 1
  return [Math.min(lo, hi), hi]
}

// Are two [min, max] ranges the same domain? Used to drop no-op ramp repaints
// and the state updates that would re-render the legend behind them.
export function rangesEqual (a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  return a[0] === b[0] && a[1] === b[1]
}

// Does a [min, max] range describe any data? The API answers a query that
// matched nothing with [null, null] (min/max over no rows), so "empty" isn't
// enough of a test — and a null max would otherwise render as an empty ramp
// with no explanation.
export function rangeLevelHasData (rangeLevel) {
  return Array.isArray(rangeLevel) && Number.isFinite(rangeLevel[1])
}

export function getPointsDataSize (pointsData) {
  let total = 0
  pointsData.forEach((point) => {
    if (point.selected && point.size !== 'NaN' && point.size !== null) {
      total += point.size
    }
  })
  return total
}

// returns true for rectangles, false for rotated rectangles
// [[west, south], [east, north]] for any GeoJSON geometry (the coordinate
// nesting differs per type, so just walk down to the [lng, lat] positions).
// Returns null when the geometry carries no coordinates.
export function boundsFromGeoJson(geometry) {
  const positions = []
  const collect = (coordinates) => {
    if (!Array.isArray(coordinates)) return
    if (typeof coordinates[0] === 'number') {
      positions.push(coordinates)
      return
    }
    coordinates.forEach(collect)
  }
  collect(geometry?.coordinates)
  if (!positions.length) return null

  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [lng, lat] of positions) {
    if (lng < west) west = lng
    if (lng > east) east = lng
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return [
    [west, south],
    [east, north]
  ]
}

// Axis-aligned overlap test for two bounds in [[west,south],[east,north]] form
// — the shape both boundsFromGeoJson and MapLibre's getBounds().toArray()
// produce. Used to flag which datasets fall inside the current map view.
// Antimeridian-crossing extents aren't special-cased (neither is the rest of
// the bbox code); a dataset straddling 180° is treated by its raw min/max.
export function boundsIntersect(a, b) {
  if (!a || !b) return false
  const [[aw, as], [ae, an]] = a
  const [[bw, bs], [be, bn]] = b
  return aw <= be && ae >= bw && as <= bn && an >= bs
}

// Camera the "zoom to dataset" action asks for: the extent centred in the map
// canvas with an even margin on every side. The datasets sidebar floats over
// the canvas's left edge, but the fit deliberately ignores it — the sidebar is
// a transparent column the user can collapse, and steering the camera around
// it threw the extent off to the right of the screen. maxZoom keeps a
// pin-sized extent from slamming the camera to street level.
//
// Shared with ZoomToDataset, which asks the map what camera these bounds would
// produce and compares it to the live one — that comparison is how the button
// knows the view is already right, and it only agrees if the padding matches.
const ZOOM_TO_DATASET_BASE_PADDING = 60

export function zoomToDatasetCamera() {
  return { padding: ZOOM_TO_DATASET_BASE_PADDING, maxZoom: 9 }
}

// True when the map is already showing `bounds` the way zoomToGeometry would
// frame them: same zoom (within a fraction of a level) and the same centre
// (within a few dozen screen pixels, so the tolerance scales with the view).
export function boundsAreFramed(map, bounds) {
  if (!map || !bounds) return false
  const camera = map.cameraForBounds(bounds, zoomToDatasetCamera())
  if (!camera) return false
  if (Math.abs(map.getZoom() - camera.zoom) > 0.2) return false
  const offset = map.project(camera.center).dist(map.project(map.getCenter()))
  return offset < 40
}

export function polygonIsRectangle(polygon) {
  if (polygon.length !== 5) return false
  const p = polygon.slice(0, 4)

  const lons = unique(p.map((e) => e[0]))
  const lats = unique(p.map((e) => e[1]))

  return lons.length === 2 && lats.length === 2
}
const unique = (arr) => [...new Set(arr)]

// translate a rectangular polygon to a bounding box query using lat/long min/max
function polygonToMaxMins(polygon) {
  const p = polygon.slice(0, 4)

  const lons = unique(p.map((e) => e[0]))
  const lats = unique(p.map((e) => e[1]))

  return {
    latMin: Math.min(...lats).toFixed(4),
    lonMin: Math.min(...lons).toFixed(4),
    latMax: Math.max(...lats).toFixed(4),
    lonMax: Math.max(...lons).toFixed(4)
  }
}

// The `polygon` ring is already closed everywhere it's produced (turf's
// bboxPolygon, mapbox-gl-draw's own rings, selectionFromSearchParams below),
// so it needs no extra closing point here.
export function polygonToWkt (polygon) {
  const ring = polygon.map(([lon, lat]) => `${lon} ${lat}`).join(', ')
  return `POLYGON((${ring}))`
}

export function createSelectionQueryString (polygon) {
  if (polygonIsRectangle(polygon)) {
    // res = { latMin, lonMin, latMax, lonMax }
    const res = polygonToMaxMins(polygon)

    return objectToURL(res)
  }
  return 'polygon=' + JSON.stringify(polygon)
}

// Inverse of createSelectionQueryString: rebuild the drawn selection from a
// share link, either from the rectangle bounds or the polygon ring. Returns the
// coordinate ring the app carries as `polygon`, or undefined when the link
// holds no selection.
export function selectionFromSearchParams (searchParams) {
  const polygon = searchParams.get('polygon')
  if (polygon) {
    try {
      const ring = JSON.parse(polygon)
      if (Array.isArray(ring) && ring.length >= 4) return ring
    } catch (error) {
      console.warn('ignoring unparseable polygon in url:', error)
    }
    return undefined
  }

  const bounds = ['latMin', 'lonMin', 'latMax', 'lonMax'].map((key) =>
    Number.parseFloat(searchParams.get(key))
  )
  if (bounds.some((value) => Number.isNaN(value))) return undefined
  const [latMin, lonMin, latMax, lonMax] = bounds
  return [
    [lonMin, latMin],
    [lonMax, latMin],
    [lonMax, latMax],
    [lonMin, latMax],
    [lonMin, latMin]
  ]
}

// No dataset carries pk 0, so this is how the map asks for nothing at all —
// an empty datasetPKs would read as "no dataset filter" and draw everything.
const NO_DATASETS_PK = '0'

// Map-only narrowing of a filter query string (tiles, legend, griddap
// coverage) to the datasets whose group is still shown. The datasets list
// keeps the hidden groups — this is a map visibility toggle, not a filter — so
// the narrowing is applied to the map's queries alone. mapDatasetPKs is
// undefined while nothing is hidden, which leaves the query untouched.
export function applyMapDatasetPKs (queryString, mapDatasetPKs) {
  if (!mapDatasetPKs) return queryString
  const params = new URLSearchParams(queryString)
  params.set(
    'datasetPKs',
    mapDatasetPKs.length > 0 ? mapDatasetPKs.join(',') : NO_DATASETS_PK
  )
  return params.toString()
}

export function filterObjectPropertyByPropertyList(
  objectToFilter,
  allowedProperties
) {
  const result = Object.keys(objectToFilter)
    .filter((key) => allowedProperties.includes(key))
    .reduce((obj, key) => {
      obj[key] = objectToFilter[key]
      return obj
    }, {})
  return result
}

// https://stackoverflow.com/questions/32553158/detect-click-outside-react-component
export function useOutsideAlerter (ref, callback, value) {
  useEffect(() => {
    /**
     * Alert if clicked on outside of element
     */
    function handleClickOutside (event) {
      if (ref.current && !ref.current.contains(event.target)) {
        callback(value)
      }
    }
    // Bind the event listener
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      // Unbind the event listener on clean up
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [ref])
}

export function getCookieValue (cookieName) {
  if (document.cookie.includes(cookieName)) {
    return document.cookie
      .split('; ')
      .find((row) => row.startsWith(cookieName + '='))
      .split('=')[1]
  }
}

export function formatErddapServerName(url, lang = 'en', serversData = null) {
  if (!url) return ''
  
  // If serversData is provided, use it to look up the server name
  if (serversData && Array.isArray(serversData)) {
    const server = serversData.find(s => s.url === url)
    if (server) {
      return lang === 'fr' ? server.label_fr : server.label_en
    }
  }
  
  // Fallback: extract domain from URL
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch (e) {
    // If URL parsing fails, try to extract domain manually
    const match = url.match(/:\/\/([^/]+)/)
    if (match && match[1]) {
      return match[1]
    }
    return url
  }
}
// --- The open dataset page, as URL params -----------------------------------
// A dataset is addressed by `?dataset=<dataset_id>&server=<server-slug>`. Both
// halves come from the source (the server's own id for the dataset, and the
// server's URL), never from our database, so a link survives a full re-harvest —
// unlike the dataset's pk. dataset_id alone is not enough: it is only unique
// within one ERDDAP server, and OBIS ids are a separate namespace.
//
// Both directions go through these helpers, so switching to, say, a hash of the
// pair would be a change to this block alone.

// The server URL as a readable slug, matching the convention the harvest
// dashboard already uses (slugify() in web-api/routes/harvest.js): scheme
// dropped, '.' and '/' replaced with '-'. OBIS datasets carry a sentinel
// erddap_url of https://obis.org, so they slug to 'obis-org' and need no
// special case.
export function erddapServerSlug (url) {
  if (!url) return ''
  return url
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/[./]/g, '-')
}

export function datasetUrlKey (row) {
  if (!row?.dataset_id) return undefined
  return {
    dataset: row.dataset_id,
    server: erddapServerSlug(row.erddap_server_url || row.erddap_url)
  }
}

// Does this dataset row correspond to the dataset the URL points at? Links
// shared before the server slug existed carry `dataset` alone; those still
// resolve, on the dataset_id by itself.
export function datasetMatchesUrlKey (row, searchParams) {
  const dataset = searchParams.get('dataset')
  if (!dataset || row?.dataset_id !== dataset) return false
  const server = searchParams.get('server')
  if (!server) return true
  return datasetUrlKey(row)?.server === server
}

// make table column headers more readable
export function splitLines(s) {
  const split = s.split(' ')
  return (
    <span>
      {split[0]}
      <br />
      {split.slice(1).join(' ')}
    </span>
  )
}

// Split an ordered [lon, lat] coordinate run where consecutive fixes jump
// more than 180 degrees of longitude (antimeridian crossing) so a track
// never draws a line looping around the globe. Returns an array of runs.
export function splitAtAntimeridian(coords) {
  if (!coords || coords.length === 0) return []
  const runs = [[coords[0]]]
  for (let i = 1; i < coords.length; i++) {
    if (Math.abs(coords[i][0] - coords[i - 1][0]) > 180) {
      runs.push([coords[i]])
    } else {
      runs[runs.length - 1].push(coords[i])
    }
  }
  return runs
}

// Split an ordered [lon, lat] track into runs, three break conditions
// (mirrors the segs CTE in web-api /tiles/tracks so the selected-platform
// view and the tile layer segment identically):
//   1. antimeridian crossing (consecutive fixes jump >180 deg of longitude);
//   2. large time gap — over 4x the track's MEDIAN inter-fix gap (its
//      typical reporting cadence, robust to idle periods — a mean would let
//      a vessel idle between short cruises draw between-cruise connector
//      chords), floored at 48h: an Argo float's ~10-day cycles never split,
//      a ship dark for months between expeditions always does;
//   3. outage chord — >50km between fixes closer than 96h in time. The
//      harvester densifies data-backed chords to <=25km, so a long chord on
//      a sub-96h gap is a reporting outage on a fast platform: the true
//      path is unknown, draw nothing rather than a chord through
//      possibly-land. The 96h guard protects slow reporters (Argo drifts
//      30-100km per cycle) from being shredded by this condition.
// `times` is the parallel timestamp array from /trajectories/track; without
// it (or under 2 fixes) this degrades to the antimeridian-only split.
export function splitTrackRuns(coords, times) {
  if (!coords || coords.length === 0) return []
  if (!times || times.length !== coords.length || coords.length < 2) {
    return splitAtAntimeridian(coords)
  }
  const ms = times.map((t) => new Date(t).getTime())
  const sortedGaps = ms
    .slice(1)
    .map((t, i) => t - ms[i])
    .sort((a, b) => a - b)
  const medianGapMs = sortedGaps[Math.floor(sortedGaps.length / 2)]
  const gapMs = Math.max(medianGapMs * 4, 48 * 3600 * 1000)

  const chordKm = (a, b) => {
    const rad = Math.PI / 180
    const p1 = a[1] * rad
    const p2 = b[1] * rad
    const h =
      Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
      Math.cos(p1) * Math.cos(p2) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2
    return 2 * 6371 * Math.asin(Math.sqrt(h))
  }

  const runs = [[coords[0]]]
  for (let i = 1; i < coords.length; i++) {
    const dtMs = ms[i] - ms[i - 1]
    if (
      Math.abs(coords[i][0] - coords[i - 1][0]) > 180 ||
      dtMs > gapMs ||
      (chordKm(coords[i - 1], coords[i]) > 50 && dtMs < 96 * 3600 * 1000)
    ) {
      runs.push([coords[i]])
    } else {
      runs[runs.length - 1].push(coords[i])
    }
  }
  return runs
}

// Initial great-circle bearing from [lon, lat] point a to point b, in
// degrees clockwise from north, [0, 360). Returns null for coincident
// points (direction undefined). The frontend twin of the ST_Azimuth-based
// cog the /tiles/tracks heads layer carries.
export function initialBearing(a, b) {
  if (a[0] === b[0] && a[1] === b[1]) return null
  const rad = Math.PI / 180
  const p1 = a[1] * rad
  const p2 = b[1] * rad
  const dl = (b[0] - a[0]) * rad
  const y = Math.sin(dl) * Math.cos(p2)
  const x =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (Math.atan2(y, x) / rad + 360) % 360
}

// A '#RRGGBB' from the palette, given an alpha channel, in the CSS form
// MapLibre parses. Anything that is not a six-digit hex comes back untouched:
// an unparseable colour throws out of setPaintProperty and takes the rest of
// the paint pass with it, so a palette entry written in some other notation
// should degrade to opaque rather than to 'rgba(NaN, NaN, NaN, 1)'.
export function withAlpha(color, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return color
  const int = parseInt(match[1], 16)
  const a = Math.round(alpha * 1000) / 1000
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${a})`
}
