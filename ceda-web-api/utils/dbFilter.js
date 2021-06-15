const eovGrouping = require("../utils/eovGrouping.json");
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
  dataType,
}) {
  const eovsCommaSeparatedString =
    removeDuplicates(
      eovs
        .split(",")
        .map((eov) => eovGrouping[eov])
        .flat()
        .map((eov) => `'${eov}'`)
    ).join() || "return-no-data";

  console.log(eovsCommaSeparatedString);
  const filters = [];

  if (timeMin) filters.push(`p.time_min >= '${timeMin}'::timestamp`);
  if (timeMax) filters.push(`p.time_min < '${timeMax}'::timestamp`);

  if (latMin) filters.push(`p.latitude_min >= '${latMin}'`);
  if (latMax) filters.push(`p.latitude_max < '${latMax}'`);
  if (lonMin) filters.push(`p.longitude_min >= '${lonMin}'`);
  if (lonMax) filters.push(`p.longitude_max < '${lonMax}'`);

  if (depthMin) filters.push(`p.depth_min >= '${depthMin}'`);
  if (depthMax) filters.push(`p.depth_max < '${depthMax}'`);

  if (dataType) filters.push(`p.cdm_data_type = '${dataType}'`);
  filters.push(
    `(d.ckan_record -> 'eov') \\?| array[${eovsCommaSeparatedString}]`
  );
  return filters.join(" AND ");
}

module.exports = createDBFilter;
