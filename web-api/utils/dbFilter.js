const { polygonJSONToWKT } = require("./polygon");
const unique = (arr) => [...new Set(arr)];
const db = require("../db");

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
  const parameters = {};

  if (eovs) {
    parameters["eovsCommaSeparatedString"] = unique(eovs.split(","));
    filters.push(`eovs && :eovsCommaSeparatedString`);
  }

  if (timeMin) {
    parameters["timeMin"] = timeMin;
    filters.push(`time_max >= :timeMin::timestamptz`);
  }
  if (timeMax) {
    parameters["timeMax"] = timeMax;
    filters.push(`time_min <= :timeMax::timestamptz`);
  }

  // This would be used if there was a rectangle selection for download
  if (latMin) {
    parameters["latMin"] = latMin;
    filters.push(`latitude >= (:latMin)::double precision`);
  }
  if (latMax) {
    parameters["latMax"] = latMax;
    filters.push(`latitude <= (:latMax)::double precision`);
  }

  if (lonMin) {
    parameters["lonMin"] = lonMin;
    filters.push(`longitude >= (:lonMin)::double precision`);
  }
  if (lonMax) {
    parameters["lonMax"] = lonMax;
    filters.push(`longitude <= (:lonMax)::double precision`);
  }

  // disabled until we get depth data into the database
  if (depthMin) {
    parameters["depthMin"] = depthMin;
    filters.push("depth_max >= (:depthMin)::integer");
  }
  if (depthMax) {
    parameters["depthMax"] = depthMax;
    filters.push(`depth_min <= (:depthMax)::integer`);
  }

  if (datasetPKs) {
    parameters["datasetPKs"] = datasetPKs.split(",");
    filters.push("d.pk = ANY (:datasetPKs)");
  }

  if (pointPKs) {
    parameters["pointPKs"] = pointPKs;
    filters.push("point_pk = ANY (:pointPKs)");
  }

  if (organizations) {
    parameters["organizationsString"] = organizations.split(",");
    filters.push(`organization_pks && :organizationsString`);
  }

  if (polygon) {
    const wktPolygon = polygonJSONToWKT(polygon);
    parameters["wktPolygon"] = wktPolygon;
    filters.push(
      `ST_Contains(ST_GeomFromText(:wktPolygon,4326),ST_Transform(geom,4326)) is true`
    );
  }
  const sql = filters.join(" AND \n");

  const query = db.raw(sql, parameters);

  return query;
}

module.exports = createDBFilter;
