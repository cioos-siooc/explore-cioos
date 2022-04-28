const { polygonJSONToWKT } = require("./polygon");
const unique = (arr) => [...new Set(arr)];

function createDBFilter(request) {
  let {
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
    datasetPKs,
    pointPKs,
  } = request;

  const filters = [];

  if (eovs) {
    const eovsCommaSeparatedString = unique(
      eovs
        .split(","))
        .map((eov) => `'${eov}'`).join();

    filters.push(`ceda_eovs && array[${eovsCommaSeparatedString}]`);
  }

  if (timeMin) filters.push(`time_max >= '${timeMin}'::timestamptz`);
  if (timeMax) filters.push(`time_min <= '${timeMax}'::timestamptz`);

  // This would be used if there was a rectangle selection for download
  if (latMin) filters.push(`latitude_min >= '${latMin}'::double precision`);
  if (latMax) filters.push(`latitude_min <= '${latMax}'::double precision`);

  if (lonMin) filters.push(`longitude_min >= '${lonMin}'::double precision`);
  if (lonMax) filters.push(`longitude_min <= '${lonMax}'::double precision`);

  // disabled until we get depth data into the database
  if (depthMin) filters.push(`depth_max >= '${depthMin}'::integer`);
  if (depthMax) filters.push(`depth_min <= '${depthMax}'::integer`);

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
    const wktPolygon = polygonJSONToWKT(polygon);

    filters.push(
      `ST_Contains(ST_GeomFromText('${wktPolygon}',4326),ST_Transform(geom,4326)) is true`
    );
  }

  return filters.join(" AND \n");
}

module.exports = createDBFilter;
