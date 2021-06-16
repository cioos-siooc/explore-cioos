const { eovGrouping, cdmDataTypeGrouping } = require("./grouping");
// this is used by the tiler and the downloader routes
const removeDuplicates = (arr) => [...new Set(arr)];

function createDBFilter({
  eovs,
  timeMin,
  timeMax,
  depthMin,
  depthMax,
  latMin,
  latMax,
  lonMin,
  lonMax,
  dataType = "return-no-data",
}) {
  const eovsCommaSeparatedString =
    removeDuplicates(
      eovs
        .split(",")
        .map((eov) => eovGrouping[eov])
        .flat()
        .map((eov) => `'${eov}'`)
    ).join() || "return-no-data";

  // All cdm_data_type's:

  // Other
  // Point
  // Profile
  // Trajectory
  // TimeSeriesProfile
  // TimeSeries

  const pointTypeCommaSeparatedString =
    dataType
      .split(",")
      .map((dataType) => cdmDataTypeGrouping[dataType])
      .flat()
      .join("|") || "return-no-data";

  const filters = [];

  if (timeMin) filters.push(`p.time_min >= '${timeMin}'::timestamp`);
  if (timeMax) filters.push(`p.time_min < '${timeMax}'::timestamp`);

  if (latMin) filters.push(`p.latitude_min >= '${latMin}'`);
  if (latMax) filters.push(`p.latitude_max < '${latMax}'`);
  if (lonMin) filters.push(`p.longitude_min >= '${lonMin}'`);
  if (lonMax) filters.push(`p.longitude_max < '${lonMax}'`);

  // disabled until we get depth data into the database
  // if (depthMin) filters.push(`p.depth_min >= ${depthMin}`);
  // if (depthMax) filters.push(`p.depth_max < ${depthMax}`);

  filters.push(`cdm_data_type ~ ('${pointTypeCommaSeparatedString}')`);

  filters.push(
    `(d.ckan_record -> 'eov') \\?| array[${eovsCommaSeparatedString}]`
  );
  return filters.join(" AND \n");
}

module.exports = createDBFilter;
