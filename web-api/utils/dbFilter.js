const { polygonJSONToWKT } = require("./polygon");

const unique = (arr) => [...new Set(arr)];
const db = require("../db");

// Hard cap on the AphiaID rolldown expansion. Selections expanding to more
// than this many distinct AphiaIDs are rejected with HTTP 400 — a Phylum or
// Kingdom selection blows past this and would force a multi-minute GIN OR
// against tens of thousands of posting lists. The frontend already hides
// those ranks from the dropdown; this is the API-level safety net for
// programmatic clients.
const MAX_EXPANDED_APHIA_IDS = 5000;

class ScientificNameSelectionTooBroadError extends Error {
  constructor(expandedCount, threshold) {
    super(
      `Scientific-name selection rolls down to ${expandedCount} taxa (max ${threshold}). ` +
      "Pick a Family or below.",
    );
    this.name = "ScientificNameSelectionTooBroadError";
    this.statusCode = 400;
    this.expandedCount = expandedCount;
    this.threshold = threshold;
  }
}

async function createDBFilter(request) {
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
    obisNodes,
    erddapServers,
  } = request;

  const filters = [];
  const obisFilters = [];
  // Trajectories are LineStrings, not points: the non-spatial predicates
  // (time/eovs/platform/depth/dataset/org/server) are identical, but the
  // spatial ones swap point-column tests for ST_Intersects on the line geom.
  // Built in parallel and returned as `trajectory`.
  const trajectoryFilters = [];
  const parameters = {};

  if (eovs) {
    parameters.eovsCommaSeparatedString = unique(eovs.split(","));
    filters.push("eovs && :eovsCommaSeparatedString");
    trajectoryFilters.push("eovs && :eovsCommaSeparatedString");
  }

  if (platforms) {
    parameters.platformsCommaSeparatedString = unique(platforms.split(","));
    filters.push("platform = any(:platformsCommaSeparatedString)");
    trajectoryFilters.push("platform = any(:platformsCommaSeparatedString)");
  }

  if (timeMin) {
    parameters.timeMin = timeMin;
    filters.push("time_max >= :timeMin::timestamptz");
    trajectoryFilters.push("time_max >= :timeMin::timestamptz");
  }
  if (timeMax) {
    parameters.timeMax = timeMax;
    filters.push("time_min <= :timeMax::timestamptz");
    trajectoryFilters.push("time_min <= :timeMax::timestamptz");
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

  // Rectangle selection as a single envelope intersect for the line geom
  // (point columns above don't exist on cde.trajectories).
  if (latMin && latMax && lonMin && lonMax) {
    trajectoryFilters.push(
      "ST_Intersects(ST_Transform(geom,4326), ST_MakeEnvelope((:lonMin)::double precision,(:latMin)::double precision,(:lonMax)::double precision,(:latMax)::double precision,4326))",
    );
  }

  // disabled until we get depth data into the database
  if (depthMin) {
    parameters.depthMin = depthMin;
    filters.push("depth_max >= (:depthMin)::integer");
    trajectoryFilters.push("depth_max >= (:depthMin)::integer");
  }
  if (depthMax) {
    parameters.depthMax = depthMax;
    filters.push("depth_min <= (:depthMax)::integer");
    trajectoryFilters.push("depth_min <= (:depthMax)::integer");
  }

  if (datasetPKs) {
    parameters.datasetPKs = datasetPKs.split(",");
    filters.push("d.pk_url = ANY (:datasetPKs)");
    trajectoryFilters.push("d.pk_url = ANY (:datasetPKs)");
  }

  if (pointPKs) {
    parameters.pointPKs = pointPKs;
    filters.push("point_pk = ANY (:pointPKs)");
  }

  if (organizations) {
    parameters.organizationsString = organizations.split(",");
    filters.push("organization_pks && :organizationsString");
    trajectoryFilters.push("organization_pks && :organizationsString");
  }

  if (obisNodes) {
    parameters.obisNodesArr = obisNodes.split(",");
    // Lives on cde.datasets; the join alias `d` is present in tile, legend
    // and shape queries. Selecting any node implies OBIS-only mode (the
    // tile/legend/shape routes drop the profiles branch when this is set).
    filters.push("d.obis_nodes && :obisNodesArr");
  }

  if (erddapServers) {
    parameters.erddapServersArray = erddapServers.split(",");
    filters.push("d.erddap_url = ANY(:erddapServersArray)");
    trajectoryFilters.push("d.erddap_url = ANY(:erddapServersArray)");
  }

  if (polygon) {
    const wktPolygon = polygonJSONToWKT(polygon);
    parameters.wktPolygon = wktPolygon;
    filters.push("ST_Contains(ST_GeomFromText(:wktPolygon,4326),ST_Transform(geom,4326)) is true");
    // A track is selected if the polygon intersects the line (not contains).
    trajectoryFilters.push("ST_Intersects(ST_GeomFromText(:wktPolygon,4326),ST_Transform(geom,4326))");
  }

  if (scientificNames) {
    const scientificNamesArr = unique(
      scientificNames.split(",").map((s) => s.trim()).filter(Boolean),
    );
    parameters.scientificNamesArr = scientificNamesArr;

    // Pre-compute the rolldown expansion in one fast query (~30ms even for
    // Phylum). Returns the set of AphiaIDs that selection rolls down to:
    // selected names' accepted AphiaIDs (covers synonyms via shared
    // valid_AphiaID) UNION every taxon whose ancestor chain contains one.
    // The GIN index on ancestor_aphia_ids makes this index-only.
    const expansionSql = `
      WITH selected_aids AS (
        SELECT DISTINCT aphia_id
          FROM cde.scientific_name_vernaculars
         WHERE scientific_name = ANY(:scientificNamesArr)
           AND aphia_id IS NOT NULL
      )
      SELECT aphia_id FROM selected_aids
      UNION
      SELECT v.aphia_id
        FROM cde.scientific_name_vernaculars v
       WHERE v.ancestor_aphia_ids && ARRAY(SELECT aphia_id FROM selected_aids)
         AND v.aphia_id IS NOT NULL`;
    const { rows: expRows } = await db.raw(expansionSql, { scientificNamesArr });
    const expandedAphiaIds = expRows
      .map((r) => r.aphia_id)
      .filter((n) => Number.isInteger(n));

    if (expandedAphiaIds.length > MAX_EXPANDED_APHIA_IDS) {
      throw new ScientificNameSelectionTooBroadError(
        expandedAphiaIds.length,
        MAX_EXPANDED_APHIA_IDS,
      );
    }

    parameters.expandedAphiaIds = expandedAphiaIds;

    // Rank-aware match against obis_cells.aphia_ids using the precomputed
    // expansion (a flat int[] parameter — PG plans this as one BitmapOr over
    // GIN posting lists, no nested InitPlan, no per-row recheck of an inline
    // subquery). The literal scientific_names branch is the back-compat
    // fallback for selections WoRMS never resolved (aphia_id IS NULL on
    // not_found rows) and for any obis_cells whose aphia_ids weren't
    // backfilled yet — e.g. freshly harvested cells before
    // 5_profile_process.sql runs.
    obisFilters.push(
      "(aphia_ids && :expandedAphiaIds OR scientific_names && :scientificNamesArr)",
    );
  }

  const sharedSql = filters.join(" AND \n") || "TRUE";
  const obisSql = obisFilters.join(" AND \n") || "TRUE";
  const trajectorySql = trajectoryFilters.join(" AND \n") || "TRUE";

  return {
    shared: db.raw(sharedSql, parameters),
    obisOnly: db.raw(obisSql, parameters),
    trajectory: db.raw(trajectorySql, parameters),
    hasShared: filters.length > 0,
    hasObisOnly: obisFilters.length > 0,
    hasTrajectory: trajectoryFilters.length > 0,
  };
}

module.exports = createDBFilter;
module.exports.ScientificNameSelectionTooBroadError = ScientificNameSelectionTooBroadError;
module.exports.MAX_EXPANDED_APHIA_IDS = MAX_EXPANDED_APHIA_IDS;
