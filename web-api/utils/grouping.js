const unique = (arr) => [...new Set(arr)];

const eovGrouping = {
  carbon: ["inorganicCarbon", "dissolvedOrganicCarbon"],
  currents: ["subSurfaceCurrents", "surfaceCurrents"],
  nutrients: ["nutrients"],
  salinity: ["seaSurfaceSalinity", "subSurfaceSalinity"],
  temperature: ["seaSurfaceTemperature", "subSurfaceTemperature"],
};

// Takes ocean variables such as 'temperature,salinity' and transforms into, eg 'subSurfaceTemperature,surfaceTemperature...'
function oceanVariablesToGOOS(oceanVariables) {
  return unique(
    oceanVariables
      .split(",")
      .map((eov) => eovGrouping[eov])
      .flat()
      .map((eov) => `'${eov}'`)
  ).join();
}

module.exports = { eovGrouping, oceanVariablesToGOOS, unique };
