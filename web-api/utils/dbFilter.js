const { polygonJSONToWKT } = require("./polygon");

const unique = (arr) => [...new Set(arr)];
const db = require("../db");

function createDBFilter(request) {
  const {
    timeMin,
    timeMax,
    depthMin,
    depthMax,
    latMin,
    latMax,
    lonMin,
    lonMax,
    polygon,
    platforms,

    // These are comma separated lists
    eovs,
    organizations,
    datasetPKs,
    pointPKs,
    scientificNames,
  } = request;

  const filters = [];
  const obisFilters = [];
  const parameters = {};

  if (eovs) {
    parameters.eovsCommaSeparatedString = unique(eovs.split(","));
    filters.push("eovs && :eovsCommaSeparatedString");
  }

  if (platforms) {
    parameters.platformsCommaSeparatedString = unique(platforms.split(","));
    filters.push("platform = any(:platformsCommaSeparatedString)");
  }

  if (timeMin) {
    parameters.timeMin = timeMin;
    filters.push("time_max >= :timeMin::timestamptz");
  }
  if (timeMax) {
    parameters.timeMax = timeMax;
    filters.push("time_min <= :timeMax::timestamptz");
  }

  // This would be used if there was a rectangle selection for download
  if (latMin) {
    parameters.latMin = latMin;
    filters.push("latitude >= (:latMin)::double precision");
  }
  if (latMax) {
    parameters.latMax = latMax;
    filters.push("latitude <= (:latMax)::double precision");
  }

  if (lonMin) {
    parameters.lonMin = lonMin;
    filters.push("longitude >= (:lonMin)::double precision");
  }
  if (lonMax) {
    parameters.lonMax = lonMax;
    filters.push("longitude <= (:lonMax)::double precision");
  }

  // disabled until we get depth data into the database
  if (depthMin) {
    parameters.depthMin = depthMin;
    filters.push("depth_max >= (:depthMin)::integer");
  }
  if (depthMax) {
    parameters.depthMax = depthMax;
    filters.push("depth_min <= (:depthMax)::integer");
  }

  if (datasetPKs) {
    parameters.datasetPKs = datasetPKs.split(",");
    filters.push("d.pk_url = ANY (:datasetPKs)");
  }

  if (pointPKs) {
    parameters.pointPKs = pointPKs;
    filters.push("point_pk = ANY (:pointPKs)");
  }

  if (organizations) {
    parameters.organizationsString = organizations.split(",");
    filters.push("organization_pks && :organizationsString");
  }

  if (polygon) {
    const wktPolygon = polygonJSONToWKT(polygon);
    parameters.wktPolygon = wktPolygon;
    filters.push("ST_Contains(ST_GeomFromText(:wktPolygon,4326),ST_Transform(geom,4326)) is true");
  }

  if (scientificNames) {
    parameters.scientificNamesArr = unique(
      scientificNames.split(",").map((s) => s.trim()).filter(Boolean),
    );
    // Rank-aware match: a cell hits if it overlaps the selected names directly
    // (literal back-compat — also covers the case where the vernacular cache
    // was never populated), OR if any of its names share an accepted AphiaID
    // with a selection (synonyms), OR if any of its names lists a selected
    // name's AphiaID in their ancestor chain (descendants — the rolldown).
    obisFilters.push(`(
      scientific_names && :scientificNamesArr
      OR scientific_names && ARRAY(
           SELECT v2.scientific_name
             FROM cde.scientific_name_vernaculars v2
            WHERE v2.aphia_id IS NOT NULL
              AND (
                v2.aphia_id IN (
                  SELECT v1.aphia_id FROM cde.scientific_name_vernaculars v1
                   WHERE v1.scientific_name = ANY(:scientificNamesArr)
                     AND v1.aphia_id IS NOT NULL
                )
                OR v2.ancestor_aphia_ids && ARRAY(
                  SELECT v3.aphia_id FROM cde.scientific_name_vernaculars v3
                   WHERE v3.scientific_name = ANY(:scientificNamesArr)
                     AND v3.aphia_id IS NOT NULL
                )
              )
         )
    )`);
  }

  const sharedSql = filters.join(" AND \n") || "TRUE";
  const obisSql = obisFilters.join(" AND \n") || "TRUE";

  return {
    shared: db.raw(sharedSql, parameters),
    obisOnly: db.raw(obisSql, parameters),
    hasShared: filters.length > 0,
    hasObisOnly: obisFilters.length > 0,
  };
}

module.exports = createDBFilter;
