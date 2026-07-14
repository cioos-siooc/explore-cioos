import isEmpty from 'lodash/isEmpty'
import { scaleLinear, scalePow } from 'd3-scale'
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

// returns an array of {stop: num, color: string} objects
export function generateColorStops(colorScale, range) {
  // check if fewer points than colors
  const exponent = 5
  let colors
  let scale
  if (range[1] <= colorScale.length * 2) {
    colors = colorScale.slice(0, range[1])
    scale = scaleLinear()
      .domain([0, colors.length - 1])
      .range(range)
  } else {
    colors = colorScale
    scale = scalePow()
      .exponent(exponent)
      .domain([0, colors.length - 1])
      .range(range)
  }
  const colorStops = colors.map((color, index) => {
    return {
      stop: Math.floor(scale(index)),
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

export function getCurrentRangeLevel (rangeLevels, zoom) {
  switch (true) {
  case zoom < 5:
    return rangeLevels.zoom0
  case zoom >= 5 && zoom < 7:
    return rangeLevels.zoom1
  case zoom >= 7:
    return rangeLevels.zoom2
  }
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

// Camera the "zoom to dataset" action asks for. The map canvas is full-bleed
// and the datasets sidebar floats on top of its left edge, so a plain centred
// fit would push half the extent underneath the sidebar: pad the fit by the
// space the sidebar actually occupies, measured from the live DOM (it varies
// with the viewport, and shrinks away entirely on a narrow screen). maxZoom
// keeps a pin-sized extent from slamming the camera to street level.
//
// Shared with ZoomToDataset, which asks the map what camera these bounds would
// produce and compares it to the live one — that comparison is how the button
// knows the view is already right, and it only agrees if the padding matches.
const ZOOM_TO_DATASET_MARGIN = 24
const ZOOM_TO_DATASET_BASE_PADDING = 60

export function zoomToDatasetCamera(map) {
  const padding = {
    top: ZOOM_TO_DATASET_BASE_PADDING,
    bottom: ZOOM_TO_DATASET_BASE_PADDING,
    left: ZOOM_TO_DATASET_BASE_PADDING,
    right: ZOOM_TO_DATASET_BASE_PADDING
  }
  const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
  const canvasWidth = map?.getCanvas()?.clientWidth
  if (sidebar?.width && canvasWidth) {
    const left = sidebar.right + ZOOM_TO_DATASET_MARGIN
    // On a narrow viewport the sidebar covers nearly the whole map. Padding
    // wider than the canvas leaves MapLibre no room to fit anything into, so
    // only clear the sidebar while a usable strip of map remains beside it.
    if (left < canvasWidth * 0.6) padding.left = left
  }
  return { padding, maxZoom: 9 }
}

// True when the map is already showing `bounds` the way zoomToGeometry would
// frame them: same zoom (within a fraction of a level) and the same centre
// (within a few dozen screen pixels, so the tolerance scales with the view).
export function boundsAreFramed(map, bounds) {
  if (!map || !bounds) return false
  const camera = map.cameraForBounds(bounds, zoomToDatasetCamera(map))
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

export function createSelectionQueryString (polygon) {
  if (polygonIsRectangle(polygon)) {
    // res = { latMin, lonMin, latMax, lonMax }
    const res = polygonToMaxMins(polygon)

    return objectToURL(res)
  }
  return 'polygon=' + JSON.stringify(polygon)
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

export function updateMapToolTitleLanguage(t) {
  // const { t } = useTranslation()
  const polygonToolDiv = document.getElementsByClassName(
    'mapbox-gl-draw_polygon'
  )
  polygonToolDiv[0].title = t('mapPolygonToolTitle')

  const deleteToolDiv = document.getElementsByClassName('mapbox-gl-draw_trash')
  deleteToolDiv[0].title = t('mapDeleteToolTitle')

  const zoomInToolDiv = document.getElementsByClassName(
    'maplibregl-ctrl-zoom-in'
  )
  zoomInToolDiv[0].title = t('mapZoomInToolTitle')

  const zoomOutToolDiv = document.getElementsByClassName(
    'maplibregl-ctrl-zoom-out'
  )
  zoomOutToolDiv[0].title = t('mapZoomOutToolTitle')
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
