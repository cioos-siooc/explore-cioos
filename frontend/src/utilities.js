import * as _ from 'lodash'
import * as d3 from 'd3'
import {useState, useEffect} from 'react'
import { defaultQuery } from './components/config.js'

export function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export function generateMultipleSelectBadgeTitle(badgeTitle, optionsSelected) {
  let count = 0
  let newBadge
  if (!_.isEmpty(optionsSelected)) {
    Object.keys(optionsSelected).forEach(key => {
      if (optionsSelected[key] === true) {
        count++
      }
    })
  }
  if (count === 0) {
    newBadge = badgeTitle
  } else if (count === 1) {
    Object.keys(optionsSelected).forEach(key => {
      if (optionsSelected[key]) {
        newBadge = capitalizeFirstLetter(key)
      }
    })
  } else if (count > 1) {
    newBadge = badgeTitle === 'Ocean Variables' ? count + ' variables' : count + ' organizations'
  }
  return newBadge
}

export function generateRangeSelectBadgeTitle(badgeTitle, optionsSelected, defaults, units) {
  return optionsSelected[0] === defaults[0] && optionsSelected[1] === defaults[1] 
  ? badgeTitle
  : `${optionsSelected[0]} - ${optionsSelected[1]}` + (!_.isEmpty(units) ? ' ' + units : '')
}

export function abbreviateString(text, maxLength) {
  if(text) {
    if(text.length > maxLength) {
      return `${text.slice(0, maxLength)}...`
    } else {
      return text
    }
  }
}

export function validateEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

export function createDataFilterQueryString(query, organizations) {
  const { orgsSelected, eovsSelected } = query;

  const queryWithoutDefaults = Object.keys(defaultQuery).reduce(
    (acc, field) => {
      if (query[field] !== defaultQuery[field]) {
        acc[field] = query[field];
      }
      return acc;
    },
    {}
  );

  const eovs = Object.keys(eovsSelected)
    .filter((eov) => eovsSelected[eov])
    .join();

  const orgPKsSelected = Object.keys(orgsSelected)
    .filter((org) => orgsSelected[org])
    .map((org) => organizations[org])
    .join();
  
  const {startDepth,endDepth,startDate,endDate} = queryWithoutDefaults
  
  const apiMappedQuery = {
    eovs,
    organizations: orgPKsSelected,
    timeMin: startDate,
    timeMax: endDate,
    depthMin: startDepth,
    depthMax: endDepth,
  };


  return Object.entries(apiMappedQuery)
    .filter(([k, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export function bytesToMemorySizeString(bytes) {
  let num = parseFloat(bytes)
  // if(_.isEmpty(bytes)) return '---'
  if(num === NaN || num === 'NaN' || bytes === null) {
    return 'NaN'
  } else if(num < 1000000) {
    return `${(num/1000).toFixed(2)}KB`
  } else if(num < 1000000000) {
    return `${(num/1000000).toFixed(2)}MB`
  } else if(num < 1000000000000) {
    return `${(num/1000000000).toFixed(2)}GB`
  } else if(num < 1000000000000000) {
    return `${(num/1000000000000).toFixed(2)}TB`
  } else if(num < 1000000000000000000) {
    return `${(num/1000000000000000).toFixed(2)}PB`
  } else {
    return '>1PB'
  }
}

// returns an array of {stop: num, color: string} objects
export function generateColorStops(colorScale, range) {
  //check if fewer points than colors
  const exponent = 5
  let colors
  let scale
  if(range[1] <= colorScale.length * 2) {
    colors = colorScale.slice(0, range[1])
    scale = d3.scaleLinear().domain([0, colors.length - 1]).range(range)
  } else {
    colors = colorScale
    scale = d3.scalePow().exponent(exponent).domain([0, colors.length - 1]).range(range)
  }
  let colorStops = colors.map((color, index) => {
    return {
      stop: Math.floor(scale(index)),
      color: color
    }
  })
  const result = []
  const map = new Map()
  colorStops.map(colorStop => { // ensure there aren't duplicates
    if(!map.has(colorStop.stop)) {
      map.set(colorStop.stop, true)
      result.push(colorStop)
    } 
  })
  return result 
}

export function useDebounce(value, delay) {
  // State and setters for debounced value
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(
    () => {
      // Update debounced value after delay
      const handler = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);
      // Cancel the timeout if value changes (also on delay change or unmount)
      // This is how we prevent debounced value from updating if value is changed ...
      // .. within the delay period. Timeout gets cleared and restarted.
      return () => {
        clearTimeout(handler);
      };
    },
    [value, delay] // Only re-call effect if value or delay changes
  );
  return debouncedValue;
}

export function getCurrentRangeLevel(rangeLevels, zoom) {
  switch (true) {
    case zoom < 5:
      return(rangeLevels['zoom0'])
    case zoom >= 5 && zoom < 7:
      return(rangeLevels['zoom1'])
    case zoom >= 7:
      return(rangeLevels['zoom2'])
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