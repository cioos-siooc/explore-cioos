const { polygonJSONToWKT } = require("./polygon");

const unique = (arr) => [...new Set(arr)];
const db = require("../db");

// A Phylum/Kingdom rolldown would force a multi-minute GIN OR over tens of
// thousands of posting lists. /scientificNames flags such names tooBroad for
// the frontend; this 400 is the safety net for programmatic clients.
const MAX_EXPANDED_APHIA_IDS = 5000;

// Params whose predicates read feature columns rather than cde.datasets.
const FEATURE_LEVEL_PARAMS = [
  "timeMin",
  "timeMax",
  "depthMin",
  "depthMax",
  "latMin",
  "latMax",
  "lonMin",
  "lonMax",
  "polygon",
  "eovs",
  "excludeEovs",
  "pointPKs",
  "scientificNames",
  "excludeScientificNames",
];

// Selected names' accepted AphiaIDs (synonyms share valid_AphiaID) UNION every
// taxon whose ancestor chain contains one; index-only via the GIN on
// ancestor_aphia_ids (~30ms even for a Phylum).
const APHIA_EXPANSION_SQL = `
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

// The only query this module runs; injectable so createDBFilter can be tested
// without Postgres.
async function fetchAphiaIdsFromDb(scientificNamesArr) {
  const { rows } = await db.raw(APHIA_EXPANSION_SQL, { scientificNamesArr });
  return rows.map((r) => r.aphia_id);
}

// One taxon selection would otherwise re-run the expansion ~20 times per
// viewport (once per tile). The promise is memoized, not the value, because a
// viewport's tiles arrive together; rejections are evicted so a failure isn't
// pinned. The TTL matches the route cache in utils/routePipeline.js.
const APHIA_CACHE_TTL_MS = 5 * 60 * 1000;
const APHIA_CACHE_MAX_ENTRIES = 500;
const aphiaCache = new Map();

function memoizeAphiaFetch(fetcher) {
  return function fetchAphiaIdsMemoized(scientificNamesArr) {
    // Sorted: the frontend's order follows the click sequence.
    const key = JSON.stringify([...scientificNamesArr].sort());
    const hit = aphiaCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.promise;

    const promise = Promise.resolve(fetcher(scientificNamesArr)).catch(
      (error) => {
        aphiaCache.delete(key);
        throw error;
      },
    );
    aphiaCache.set(key, {
      promise,
      expiresAt: Date.now() + APHIA_CACHE_TTL_MS,
    });
    if (aphiaCache.size > APHIA_CACHE_MAX_ENTRIES) {
      aphiaCache.delete(aphiaCache.keys().next().value);
    }
    return promise;
  };
}

const fetchAphiaIdsCached = memoizeAphiaFetch(fetchAphiaIdsFromDb);

class InvalidPolygonError extends Error {
  constructor() {
    super(
      "Invalid polygon: expected a closed ring of at least 4 [lon,lat] pairs.",
    );
    this.name = "InvalidPolygonError";
    this.statusCode = 400;
  }
}

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

async function createDBFilter(
  request,
  { fetchAphiaIds = fetchAphiaIdsCached } = {},
) {
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
    realtimeOnly,
    eovsMatch,
    organizationsMatch,
    scientificNamesMatch,

    // comma-separated lists
    eovs,
    organizations,
    datasetPKs,
    excludeDatasetPKs,
    pointPKs,
    scientificNames,
    obisNodes,
    erddapServers,
    excludePlatforms,
    excludeOrganizations,
    organizationRoles,
    excludeObisNodes,
    excludeErddapServers,
    excludeEovs,
    excludeScientificNames,
  } = request;

  const filters = [];
  const obisFilters = [];
  const profileFilters = [];
  const parameters = {};

  if (eovs) {
    parameters.eovsCommaSeparatedString = unique(eovs.split(","));
    const eovsOp = eovsMatch === "all" ? "@>" : "&&";
    // Bare `eovs` resolves to cde.datasets.eovs: every route joins it first.
    filters.push(`eovs ${eovsOp} :eovsCommaSeparatedString`);
    // Per-feature EOVs (a subset of the dataset's), applied inside the
    // profiles branch where bare `eovs` is profiles.eovs. Every branch reading
    // cde.profiles must apply it or silently stays dataset-level —
    // utils/selectionAgreement.test.js guards this. Branches that cannot
    // answer it (OBIS/trajectory cells, griddap) rely on the clause above.
    profileFilters.push(`eovs ${eovsOp} :eovsCommaSeparatedString`);
  }

  // Both levels, so a dataset that measured an excluded EOV is dropped whole
  // and every branch agrees with the profiles one.
  if (excludeEovs) {
    parameters.excludeEovsArr = unique(excludeEovs.split(","));
    filters.push("NOT coalesce(eovs && :excludeEovsArr, false)");
    profileFilters.push("NOT coalesce(eovs && :excludeEovsArr, false)");
  }

  if (platforms) {
    parameters.platformsCommaSeparatedString = unique(platforms.split(","));
    filters.push("platform = any(:platformsCommaSeparatedString)");
  }

  // exclude* params must keep NULL-column rows, which a bare `<> ALL` or
  // `NOT (&&)` would evaluate to NULL and drop.
  if (excludePlatforms) {
    parameters.excludePlatformsArr = unique(excludePlatforms.split(","));
    filters.push("(platform IS NULL OR platform <> ALL(:excludePlatformsArr))");
  }

  if (timeMin) {
    parameters.timeMin = timeMin;
    filters.push("time_max >= :timeMin::timestamptz");
  }
  if (timeMax) {
    parameters.timeMax = timeMax;
    filters.push("time_min <= :timeMax::timestamptz");
  }

  // Matched against each feature's extent (search_geom), not its display
  // point, so a feature passing through the rectangle is found.
  if (latMin || latMax || lonMin || lonMax) {
    // search_geom is EPSG:3857; transforming a ±90° envelope throws
    // "tolerance condition error" in PostGIS, so clamp to Mercator's range.
    const clampLat = (v, dflt) => {
      const n = v === undefined || v === null || v === "" ? dflt : Number(v);
      return Math.max(-85.05, Math.min(85.05, n));
    };
    parameters.rectLonMin = lonMin || -180;
    parameters.rectLatMin = clampLat(latMin, -85.05);
    parameters.rectLonMax = lonMax || 180;
    parameters.rectLatMax = clampLat(latMax, 85.05);
    filters.push(
      "ST_Intersects(search_geom, ST_Transform(ST_MakeEnvelope(" +
        "(:rectLonMin)::double precision,(:rectLatMin)::double precision," +
        "(:rectLonMax)::double precision,(:rectLatMax)::double precision,4326),3857))",
    );
  }

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

  // Inverse of datasetPKs: past ~2300 kept pks the request line exceeds the
  // header limit (431), so the frontend's applyDatasetPKs sends whichever
  // list is shorter.
  if (excludeDatasetPKs) {
    parameters.excludeDatasetPKs = excludeDatasetPKs.split(",");
    // pk_url is NULL until 5_profile_process.sql back-fills it.
    filters.push("(d.pk_url IS NULL OR d.pk_url <> ALL (:excludeDatasetPKs))");
  }

  if (pointPKs) {
    parameters.pointPKs = pointPKs.split(",");
    filters.push("point_pk = ANY (:pointPKs)");
  }

  // organizationRoles scopes both the include and the exclude list to those
  // roles: organization_role_keys holds "<pk_url>:<role>" per dataset, so the
  // selection becomes the orgs x roles cross product of the same keys.
  const roles = organizationRoles ? unique(organizationRoles.split(",")) : [];
  const roleKeys = (pks) => pks.flatMap((pk) => roles.map((r) => `${pk}:${r}`));

  if (organizations) {
    const pks = unique(organizations.split(","));
    if (roles.length) {
      parameters.organizationRoleKeys = roleKeys(pks);
      if (organizationsMatch === "all") {
        // every selected org holds at least one selected role
        parameters.organizationsCount = pks.length;
        filters.push(
          "(SELECT count(DISTINCT split_part(k, ':', 1)) FROM unnest(organization_role_keys) k WHERE k = ANY(:organizationRoleKeys)) = :organizationsCount",
        );
      } else {
        filters.push("organization_role_keys && :organizationRoleKeys");
      }
    } else {
      parameters.organizationsString = pks;
      const organizationsOp = organizationsMatch === "all" ? "@>" : "&&";
      filters.push(`organization_pks ${organizationsOp} :organizationsString`);
    }
  }

  if (excludeOrganizations) {
    const pks = unique(excludeOrganizations.split(","));
    if (roles.length) {
      parameters.excludeOrganizationRoleKeys = roleKeys(pks);
      filters.push(
        "NOT coalesce(organization_role_keys && :excludeOrganizationRoleKeys, false)",
      );
    } else {
      parameters.excludeOrganizationsArr = pks;
      filters.push(
        "NOT coalesce(organization_pks && :excludeOrganizationsArr, false)",
      );
    }
  }

  // dataset_is_realtime (database/8_range_functions.sql) never returns NULL,
  // so a plain boolean test is safe. verified_at, not last_updated_at: the
  // latter doesn't move for a dead feed an incremental harvest skips.
  if (realtimeOnly === "true") {
    filters.push(
      "dataset_is_realtime(d.coverage_time_max, d.verified_at, d.cdm_data_type)",
    );
  }

  // Combined "Data Source" filter: ERDDAP datasets have NULL obis_nodes and
  // OBIS datasets carry the sentinel https://obis.org as erddap_url, so with
  // both params a dataset matches either.
  if (obisNodes) {
    parameters.obisNodesArr = obisNodes.split(",");
  }
  if (erddapServers) {
    parameters.erddapServersArray = erddapServers.split(",");
  }
  if (obisNodes && erddapServers) {
    filters.push(
      "(d.obis_nodes && :obisNodesArr OR d.erddap_url = ANY(:erddapServersArray))",
    );
  } else if (obisNodes) {
    filters.push("d.obis_nodes && :obisNodesArr");
  } else if (erddapServers) {
    filters.push("d.erddap_url = ANY(:erddapServersArray)");
  }

  // Source excludes take no part in the OBIS-only gate (utils/selection.js).
  if (excludeErddapServers) {
    parameters.excludeErddapServersArr = excludeErddapServers.split(",");
    filters.push(
      "(d.erddap_url IS NULL OR d.erddap_url <> ALL(:excludeErddapServersArr))",
    );
  }
  if (excludeObisNodes) {
    parameters.excludeObisNodesArr = excludeObisNodes.split(",");
    filters.push("NOT coalesce(d.obis_nodes && :excludeObisNodesArr, false)");
  }

  if (polygon) {
    const wktPolygon = polygonJSONToWKT(polygon);
    if (!wktPolygon) throw new InvalidPolygonError();
    parameters.wktPolygon = wktPolygon;
    filters.push(
      "ST_Intersects(search_geom, ST_Transform(ST_GeomFromText(:wktPolygon,4326),3857)) is true",
    );
  }

  const splitNames = (list) =>
    unique(
      list
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );

  // NULL ids (not_found rows) are dropped here so it holds for any fetcher.
  const expandNames = async (namesArr) => {
    const expanded = (await fetchAphiaIds(namesArr)).filter((n) =>
      Number.isInteger(n),
    );
    if (expanded.length > MAX_EXPANDED_APHIA_IDS) {
      throw new ScientificNameSelectionTooBroadError(
        expanded.length,
        MAX_EXPANDED_APHIA_IDS,
      );
    }
    return expanded;
  };

  // A flat int[] param plans as one BitmapOr over GIN posting lists (no
  // InitPlan). The scientific_names arm covers names WoRMS never resolved and
  // cells whose aphia_ids aren't back-filled yet by 5_profile_process.sql.
  const taxonMatch = (idsParam, namesParam) =>
    `(aphia_ids && :${idsParam} OR scientific_names && :${namesParam})`;

  if (scientificNames) {
    const scientificNamesArr = splitNames(scientificNames);
    if (scientificNamesMatch === "all") {
      // One rolldown per name: a merged expansion cannot express "each of".
      const expansions = await Promise.all(
        scientificNamesArr.map((name) => expandNames([name])),
      );
      scientificNamesArr.forEach((name, i) => {
        parameters[`expandedAphiaIds${i}`] = expansions[i];
        parameters[`scientificName${i}`] = [name];
        obisFilters.push(
          taxonMatch(`expandedAphiaIds${i}`, `scientificName${i}`),
        );
      });
    } else {
      parameters.scientificNamesArr = scientificNamesArr;
      parameters.expandedAphiaIds = await expandNames(scientificNamesArr);
      obisFilters.push(taxonMatch("expandedAphiaIds", "scientificNamesArr"));
    }
  }

  // Cells only: ERDDAP features carry no taxa, so they pass an exclude.
  if (excludeScientificNames) {
    const excludeScientificNamesArr = splitNames(excludeScientificNames);
    parameters.excludeScientificNamesArr = excludeScientificNamesArr;
    parameters.excludedAphiaIds = await expandNames(excludeScientificNamesArr);
    obisFilters.push(
      `NOT coalesce(${taxonMatch("excludedAphiaIds", "excludeScientificNamesArr")}, false)`,
    );
  }

  const sharedSql = filters.join(" AND \n") || "TRUE";
  const obisSql = obisFilters.join(" AND \n") || "TRUE";
  const profileSql = profileFilters.join(" AND \n") || "TRUE";

  // `datasetLevelOnly`: a pre-aggregated row set (cde.hexes_zoom_0_rollup)
  // answers the selection exactly.
  return {
    shared: db.raw(sharedSql, parameters),
    obisOnly: db.raw(obisSql, parameters),
    profileOnly: db.raw(profileSql, parameters),
    hasShared: filters.length > 0,
    datasetLevelOnly: !FEATURE_LEVEL_PARAMS.some((name) => request[name]),
  };
}

module.exports = createDBFilter;
module.exports.ScientificNameSelectionTooBroadError =
  ScientificNameSelectionTooBroadError;
module.exports.InvalidPolygonError = InvalidPolygonError;
module.exports.MAX_EXPANDED_APHIA_IDS = MAX_EXPANDED_APHIA_IDS;
module.exports.memoizeAphiaFetch = memoizeAphiaFetch;
module.exports.APHIA_CACHE_TTL_MS = APHIA_CACHE_TTL_MS;
module.exports._resetAphiaCacheForTests = () => aphiaCache.clear();
