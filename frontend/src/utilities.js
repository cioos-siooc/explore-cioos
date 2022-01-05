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
    return capitalizeFirstLetter(badgeTitle)
  } else if (count === 1) {
    Object.keys(optionsSelected).forEach(key => {
      if (optionsSelected[key]) {
        newBadge = capitalizeFirstLetter(key)
      }
    })
    return newBadge
  } else if (count > 1) {
    return (badgeTitle === 'Ocean Variables' ? count + ' variables' : count + ' organizations')
  }
}

export function generateRangeSelectBadgeTitle(badgeTitle, optionsSelected) {
  return `${badgeTitle}:${optionsSelected[0]} - ${optionsSelected[1]}`
}