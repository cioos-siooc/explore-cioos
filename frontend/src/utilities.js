import * as _ from 'lodash'
import * as d3 from 'd3'
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
        (!_.isEmpty(units) ? ' ' + units : '')
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
    scale = d3
      .scaleLinear()
      .domain([0, colors.length - 1])
      .range(range)
  } else {
    colors = colorScale
    scale = d3
      .scalePow()
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
export function updateMapToolTitleLanguage(t) {
  // const { t } = useTranslation()
  const polygonToolDiv = document.getElementsByClassName(
    'mapbox-gl-draw_polygon'
  )
  polygonToolDiv[0].title = t('mapPolygonToolTitle')

  const deleteToolDiv = document.getElementsByClassName('mapbox-gl-draw_trash')
  deleteToolDiv[0].title = t('mapDeleteToolTitle')

  const zoomInToolDiv = document.getElementsByClassName('mapboxgl-ctrl-zoom-in')
  zoomInToolDiv[0].title = t('mapZoomInToolTitle')

  const zoomOutToolDiv = document.getElementsByClassName(
    'mapboxgl-ctrl-zoom-out'
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

// Centripetal Catmull-Rom spline through an ordered [lon, lat] coordinate
// array. PURELY COSMETIC, render-time only: the stored/fetched track data is
// never modified, endpoints are preserved, and the curve passes through every
// original fix. Returns a new densified coordinate array.
export function catmullRomSpline(coords, segmentsPerSpan = 8) {
  if (!coords || coords.length < 3) return coords
  const alpha = 0.5 // centripetal — no cusps/self-intersections between fixes
  const out = [coords[0]]

  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])

  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] || coords[i]
    const p1 = coords[i]
    const p2 = coords[i + 1]
    const p3 = coords[i + 2] || coords[i + 1]

    // Coincident fixes would collapse a knot interval to zero (division by
    // zero below), so every increment gets an epsilon floor.
    const t0 = 0
    const t1 = t0 + Math.max(Math.pow(dist(p0, p1), alpha), 1e-9)
    const t2 = t1 + Math.max(Math.pow(dist(p1, p2), alpha), 1e-9)
    const t3 = t2 + Math.max(Math.pow(dist(p2, p3), alpha), 1e-9)

    for (let s = 1; s <= segmentsPerSpan; s++) {
      const t = t1 + ((t2 - t1) * s) / segmentsPerSpan
      const point = [0, 1].map((axis) => {
        const a1 =
          ((t1 - t) / (t1 - t0)) * p0[axis] + ((t - t0) / (t1 - t0)) * p1[axis]
        const a2 =
          ((t2 - t) / (t2 - t1)) * p1[axis] + ((t - t1) / (t2 - t1)) * p2[axis]
        const a3 =
          ((t3 - t) / (t3 - t2)) * p2[axis] + ((t - t2) / (t3 - t2)) * p3[axis]
        const b1 =
          ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2
        const b2 =
          ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3
        return ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2
      })
      out.push(point)
    }
  }
  return out
}
