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

export function generateMultipleSelectBadgeTitle(badgeTitle, optionsSelected) {
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

export function abbreviateString(text, maxLength) {
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
function objectToURL(obj) {
  return Object.entries(obj)
    .filter(([k, v]) => k && v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

export function createDataFilterQueryString(query, filterLengths) {
  const { orgsSelected, eovsSelected, platformsSelected, datasetsSelected } =
    query

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

  const apiMappedQuery = {
    // These properties are specified by the API's schema
    eovs,
    platforms,
    datasetPKs,
    organizations: orgPKs,
    timeMin: startDate,
    timeMax: endDate,
    depthMin: startDepth,
    depthMax: endDepth
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

export function useDebounce(value, delay) {
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

export function getCurrentRangeLevel(rangeLevels, zoom) {
  switch (true) {
  case zoom < 5:
    return rangeLevels.zoom0
  case zoom >= 5 && zoom < 7:
    return rangeLevels.zoom1
  case zoom >= 7:
    return rangeLevels.zoom2
  }
}

export function getPointsDataSize(pointsData) {
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

export function createSelectionQueryString(polygon) {
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
export function useOutsideAlerter(ref, callback, value) {
  useEffect(() => {
    /**
     * Alert if clicked on outside of element
     */
    function handleClickOutside(event) {
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

export function getCookieValue(cookieName) {
  if (document.cookie.includes(cookieName)) {
    return document.cookie
      .split('; ')
      .find((row) => row.startsWith(cookieName + '='))
      .split('=')[1]
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
