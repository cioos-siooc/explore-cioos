const { eovGrouping } = require("./grouping");
// this is used by the tiler and the downloader routes
const unique = (arr) => [...new Set(arr)];
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
  polygon,

  // These are comma separated lists
  eovs,
  organizations,
  dataType,
  datasetPKs,
  pointPKs,
}) {
  if ((!dataType || !eovs) && !pointPKs && !polygon) return IMPOSSIBLE_FILTER;

  const filters = [];

  if (eovs) {
    const eovsCommaSeparatedString = unique(
      eovs
        .split(",")
        .map((eov) => eovGrouping[eov])
        .flat()
        .map((eov) => `'${eov}'`)
    ).join();

    filters.push(`eovs && array[${eovsCommaSeparatedString}]`);
  }

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

  if (datasetPKs) {
    filters.push(`d.pk = ANY ('{${datasetPKs}}')`);
  }

  if (pointPKs) {
    filters.push(`point_pk = ANY ('{${pointPKs}}')`);
  }

  if (organizations) {
    const organizationsString = organizations.split(",").map((e) => `${e}`);
    filters.push(`organization_pks && array[${organizationsString}]`);
  }

  if (polygon) {
    const wktPolygon =
      "POLYGON((" +
      JSON.parse(polygon)
        .map(([lat, lon]) => `${lat} ${lon}`)
        .join() +
      "))";

    filters.push(
      `ST_Contains(ST_GeomFromText('${wktPolygon}',4326),ST_Transform(geom,4326)) is true`
    );
  }

  return filters.join(" AND \n");
}

module.exports = createDBFilter;
