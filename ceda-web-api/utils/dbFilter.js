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
  organizations = "",
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

  const organizationsString = organizations.split(",").map((e) => `'${e}'`);

  const pointTypeCommaSeparatedString =
    dataType
      .split(",")
      .map((dataType) => cdmDataTypeGrouping[dataType])
      .flat()
      .map((e) => `'${e}'`)
      .join(",") || "return-no-data";

  const filters = [];

  if (timeMin) filters.push(`p.time_min >= '${timeMin}'::timestamp`);
  if (timeMax) filters.push(`p.time_min < '${timeMax}'::timestamp`);

  if (latMin) filters.push(`p.latitude_min >= '${latMin}'`);
  if (latMax) filters.push(`p.latitude_max < '${latMax}'`);
  if (lonMin) filters.push(`p.longitude_min >= '${lonMin}'`);
  if (lonMax) filters.push(`p.longitude_max < '${lonMax}'`);

  if (organizations)
    filters.push(`organization_pks && array[${organizationsString}]`);

  // disabled until we get depth data into the database
  if (depthMin) filters.push(`p.depth_min >= ${depthMin}`);
  if (depthMax) filters.push(`p.depth_max < ${depthMax}`);

  filters.push(`cdm_data_type = any(array[${pointTypeCommaSeparatedString}])`);

  filters.push(`eovs && array[${eovsCommaSeparatedString}]`);
  return filters.join(" AND \n");
}

module.exports = createDBFilter;
