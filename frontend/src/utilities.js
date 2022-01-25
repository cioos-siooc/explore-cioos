import * as _ from 'lodash'

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

export function createDataFilterQueryString(query) {
  let eovsArray = [], orgsArray = []
  Object.keys(query.eovsSelected).forEach((eov) => {
    if(query.eovsSelected[eov]) {
      eovsArray.push(eov)
    }
  })
  Object.keys(query.orgsSelected).forEach((org) => {
    if(query.orgsSelected[org]) {
      orgsArray.push(organizations[org])
    }
  })
  let apiMappedQuery = {
    timeMin: query.startDate,
    timeMax: query.endDate,
    depthMin: query.startDepth,
    depthMax: query.endDepth,
  }
  if(eovsArray.length === 0) {
    apiMappedQuery.eovs = "carbon,currents,nutrients,salinity,temperature"
  } else {
    apiMappedQuery.eovs = eovsArray
  }
  if(orgsArray.length !== 0) {
    apiMappedQuery.organizations = orgsArray
  }
  // apiMappedQuery.dataType = 'casts,fixedStations'
  return Object.entries(apiMappedQuery).map(([k, v]) => `${k}=${v}`).join("&")
}