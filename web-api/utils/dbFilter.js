const { eovGrouping } = require("./grouping");
// this is used by the tiler and the downloader routes
const removeDuplicates = (arr) => [...new Set(arr)];
const IMPOSSIBLE_FILTER = "1=0";
function createDBFilter({
  timeMin,
  timeMax,
  depthMin,
  depthMax,
  latMin,
  latMax,
  lonMin,
  lonMax,
  // These are comma separated lists
  eovs,
  organizations,
  dataType,
}) {
  if (!dataType || !eovs) return IMPOSSIBLE_FILTER;

  const eovsCommaSeparatedString = removeDuplicates(
    eovs
      .split(",")
      .map((eov) => eovGrouping[eov])
      .flat()
      .map((eov) => `'${eov}'`)
  ).join();

  const filters = [];

  if (timeMin) filters.push(`p.time_max >= '${timeMin}'::timestamp`);
  if (timeMax) filters.push(`p.time_min <= '${timeMax}'::timestamp`);

  // This would be used if there was a rectangle selection for download
  if (latMin) filters.push(`p.latitude_max >= '${latMin}'`);
  if (latMax) filters.push(`p.latitude_min <= '${latMax}'`);

  if (lonMin) filters.push(`p.longitude_max >= '${lonMin}'`);
  if (lonMax) filters.push(`p.longitude_min <= '${lonMax}'`);

  // disabled until we get depth data into the database
  if (depthMin) filters.push(`p.depth_max >= ${depthMin}`);
  if (depthMax) filters.push(`p.depth_min <= ${depthMax}`);

  if (organizations) {
    const organizationsString = organizations.split(",").map((e) => `${e}`);
    filters.push(`organization_pks && array[${organizationsString}]`);
  }
  filters.push(`eovs && array[${eovsCommaSeparatedString}]`);

  return filters.join(" AND \n");
}

module.exports = createDBFilter;
