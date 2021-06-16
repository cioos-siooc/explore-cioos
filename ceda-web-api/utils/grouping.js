const eovGrouping = {
  carbon: ["inorganicCarbon", "surfaceCurrents"],
  currents: ["subSurfaceCurrents", "surfaceCurrents"],
  nutrients: ["nitrate", "phosphate", "sulphate", "silicate"],
  salinity: ["seaSurfaceSalinity", "subSurfaceSalinity"],
  temperature: ["seaSurfaceTemperature", "subSurfaceTemperature"],
};
const cdmDataTypeGrouping = {
  casts: ["Profile", "TimeSeriesProfile"],
  fixedStations: ["TimeSeries", "Point"],
};

module.exports = { eovGrouping, cdmDataTypeGrouping };
