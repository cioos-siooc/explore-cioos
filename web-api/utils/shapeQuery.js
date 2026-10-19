const db = require("../db");
const { changePKtoPkURL } = require("./misc");

const createDBFilter = require("./dbFilter");
const {
  erddapVisible,
  obisVisible,
  TRAJECTORY_COVERAGE_FROM,
  GRIDDAP_TIME_DEPTH_COLUMNS,
  GRIDDAP_FROM,
  unionBranches,
} = require("./selection");

const DEPTH_VARIABLE_PROBE = JSON.stringify([{ name: "depth" }]);
// OBIS datasets carry no num_columns, so the estimate uses the width of the
// CSV the downloader writes for them (download_obis_parquet in
// downloader/erddap_downloader/download_erddap.py).
const OBIS_DOWNLOAD_COLUMNS = 8;

// Split from getShapeQuery so the SQL can be asserted without Postgres.
async function buildShapeSql(
  query,
  {
    doEstimate = true,
    getRecordsList = true,
    pksOnly = false,
    fetchAphiaIds,
  } = {},
) {
  const filters = await createDBFilter(query, { fetchAphiaIds });

  const {
    timeMin = null,
    timeMax = null,
    depthMin = null,
    depthMax = null,
  } = query;

  const includeProfiles = erddapVisible(query);
  const showObis = obisVisible(query);

  // search_geom is what dbFilter's spatial filter matches: the profile bbox,
  // the OBIS cell point, or the trajectory hex polygon.
  const profilesBranch = `SELECT dataset_pk, time_min, time_max, depth_min, depth_max, records_per_day,
               day_ranges,
               profile_id, timeseries_id, eovs AS feature_eovs,
               latitude, longitude, point_pk, geom, bbox AS search_geom
        FROM cde.profiles
        WHERE :profileFilters`;
  // records_per_day is a rate over days WITH DATA (4_create_hexes.sql), so
  // the estimate must multiply it by a day-set overlap, not an elapsed span.
  const trajectoryBranch = `SELECT t.dataset_pk, t.time_min, t.time_max, t.depth_min, t.depth_max, t.records_per_day,
               t.day_ranges,
               t.trajectory_id as profile_id, NULL as timeseries_id, NULL::text[] as feature_eovs,
               t.latitude, t.longitude, NULL::integer AS point_pk, t.geom, h.geom AS search_geom
        ${TRAJECTORY_COVERAGE_FROM}`;
  // OBIS cells store a count, not a rate. The denominator switches on
  // day_ranges exactly as the estimate's day factor does, so an unfiltered
  // estimate sums back to n_records.
  const obisBranch = `SELECT dataset_pk, time_min, time_max, depth_min, depth_max,
               n_records::float / GREATEST(CASE WHEN coalesce(array_length(day_ranges, 1), 0) > 0 THEN days ELSE date_part('days', time_max - time_min) END, 1) AS records_per_day,
               day_ranges,
               NULL as profile_id, NULL as timeseries_id, NULL::text[] as feature_eovs,
               latitude, longitude, point_pk, geom, geom AS search_geom
        FROM cde.obis_cells
        WHERE :obisFilters`;
  // Column order is the combined-CTE contract shared by every branch.
  const griddapBranch = `SELECT d.pk AS dataset_pk,
               ${GRIDDAP_TIME_DEPTH_COLUMNS},
               0 AS records_per_day,
               NULL::daterange[] AS day_ranges,
               NULL::text AS profile_id, NULL::text AS timeseries_id,
               NULL::text[] AS feature_eovs,
               NULL::double precision AS latitude, NULL::double precision AS longitude,
               NULL::integer AS point_pk, NULL::geometry AS geom,
               d.coverage_bbox AS search_geom
        ${GRIDDAP_FROM}`;

  const branches = [];
  if (includeProfiles) branches.push(profilesBranch, trajectoryBranch);
  if (showObis) branches.push(obisBranch);
  // Grids are never estimated: they are downloaded from ERDDAP directly.
  if (includeProfiles && !doEstimate) branches.push(griddapBranch);
  const combinedInner = unionBranches(branches, profilesBranch);

  if (pksOnly) {
    return {
      sql: `WITH combined AS (
        ${combinedInner}
  )
  SELECT DISTINCT d.pk_url AS pk
  FROM   combined p
  JOIN   cde.datasets d
  ON     p.dataset_pk = d.pk
  WHERE  :filters`,
      params: {
        filters: filters.shared,
        obisFilters: filters.obisOnly,
        profileFilters: filters.profileOnly,
      },
    };
  }

  // One row per record, not per matched feature: a mission crossing 40 hexes
  // is 40 `filtered` rows sharing one trajectory_id. profiles_count and the
  // estimate still count features.
  const recordsCte = `records AS (
        SELECT   dataset_pk,
                 json_agg(json_build_object(
                   'profile_id', profile_id,
                   'time_min',   time_min,
                   'time_max',   time_max,
                   'depth_min',  depth_min,
                   'depth_max',  depth_max,
                   'eovs',       eovs
                 ) ORDER BY time_min DESC) AS profiles
        FROM     (SELECT   dataset_pk,
                           coalesce(profile_id, timeseries_id) AS profile_id,
                           -- Explicit UTC: json_agg would use the session's
                           -- timezone offset.
                           to_char(min(time_min) AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time_min,
                           to_char(max(time_max) AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time_max,
                           min(depth_min)       AS depth_min,
                           max(depth_max)       AS depth_max,
                           -- NULL for sources without per-feature EOVs; the
                           -- inspector falls back to the dataset's. The
                           -- lateral's duplicate rows don't affect min/max.
                           array_agg(DISTINCT eov.name)
                             FILTER (WHERE eov.name IS NOT NULL) AS eovs
                  FROM     filtered
                  LEFT JOIN LATERAL unnest(filtered.feature_eovs) AS eov(name)
                         ON TRUE
                  GROUP BY dataset_pk, coalesce(profile_id, timeseries_id)) r
        GROUP BY dataset_pk
  ),`;

  const sql = `WITH combined AS (
        ${combinedInner}
  ),
  filtered AS (
        SELECT p.*
        FROM   combined p
        JOIN   cde.datasets d
        ON     p.dataset_pk = d.pk
        WHERE  :filters
  ),
  ${getRecordsList ? recordsCte : ""}
  -- Grouped on the integer key before joining datasets: grouping on d.pk made
  -- the planner sort ~1.2M wide rows (spilled to disk) into ~2.8k groups.
  per_dataset AS
        (SELECT   p.dataset_pk,
                  count(*)::integer AS profiles_count,
                  ST_Extent(p.search_geom) AS filtered_extent
                  ${
                    doEstimate
                      ? `,SUM(
                  -- Day factor must be days WITH DATA to match records_per_day;
                  -- the span is the fallback when day_ranges is unknown. Zero
                  -- becomes one so a kept row never estimates as no data.
                  coalesce(nullif(
                    CASE WHEN coalesce(array_length(p.day_ranges, 1), 0) > 0
                         THEN day_range_overlap_days(p.day_ranges, daterange(:timeMin::date, (:timeMax::date) + 1))
                         ELSE date_part('days',range_intersection_length(tstzrange(:timeMin,:timeMax),tstzrange(p.time_min,p.time_max)))
                    END, 0), 1) * p.records_per_day *
                  coalesce(nullif(range_intersection_length(numrange(:depthMin,:depthMax),numrange(p.depth_min::NUMERIC,p.depth_max::NUMERIC)),0),1) / (coalesce(nullif(p.depth_max-p.depth_min,0),1)) ) AS records_count`
                      : ""
                  }
         FROM     filtered p
         GROUP BY p.dataset_pk),
  sub AS
        (SELECT   d.pk,
                  d.pk_url,
                  d.dataset_id,
                  d.n_profiles,
                  d.cdm_data_type,
                  d.title title,
                  d.platform,
                  d.num_columns,
                  d.first_eov_column,
                  d.timeseries_id_variable,
                  d.profile_id_variable,
                  d.trajectory_id_variable,
                  json_build_object('en',title,'fr',title_fr)     title_translated,
                  d.eovs                                          eovs,
                  organizations,
                  p.profiles_count,
                  d.source_type,
                  d.obis_nodes,
                  -- tabledap 400s on a depth constraint for a dataset without
                  -- a variable named 'depth', so direct-download links must
                  -- know. The probe is bound, not inlined, so its '"name"' +
                  -- colon isn't read as a knex named binding.
                  coalesce(d.table_variables @> :depthVariableProbe::jsonb, false)
                                                                  AS has_depth,
                  d.erddap_url AS erddap_server_url,
                  CASE WHEN d.source_type = 'obis'
                           THEN 'https://obis.org/dataset/' || d.dataset_id
                       WHEN d.cdm_data_type = 'Grid'
                           THEN d.erddap_url || '/griddap/' || d.dataset_id || '.html'
                           ELSE d.erddap_url || '/tabledap/' || d.dataset_id || '.html'
                  END AS erddap_url,
                  'https://catalogue.cioos.ca/dataset/'
                           || ckan_id AS ckan_url,
                  d.wms_url,
                  d.grid_variables,
                  d.grid_dimensions,
                  to_char(d.coverage_time_max AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS coverage_time_max,
                  d.verified_at,
                  dataset_is_realtime(d.coverage_time_max,
                                      d.verified_at,
                                      d.cdm_data_type) AS is_realtime,
                  -- Dataset-level day set clipped to the time filter only:
                  -- unioning the matched features' ranges cost ~3 s per cold
                  -- request.
                  ${
                    doEstimate
                      ? ""
                      : `day_range_overlap_days(d.day_ranges,
                           daterange(:timeMin::date, (:timeMax::date) + 1))::integer
                           AS days,`
                  }
                  CASE WHEN d.cdm_data_type = 'Grid'
                           THEN ST_AsGeoJSON(ST_Transform(d.coverage_bbox, 4326), 6)::json
                  END AS coverage_bbox_geojson,
                  ST_AsGeoJSON(
                    ST_Transform(ST_SetSRID(p.filtered_extent::geometry, 3857), 4326), 6
                  )::json AS filtered_bbox_geojson
                  ${doEstimate ? ",p.records_count" : ""}
         FROM     per_dataset p
         JOIN     cde.datasets d
         ON       p.dataset_pk = d.pk)
SELECT sub.*
       ${getRecordsList ? ",coalesce(records.profiles, '[]'::json) AS profiles" : ""}
       ${doEstimate ? ",round(:adder + records_count * CASE WHEN source_type = 'obis' THEN :obisColumns ELSE num_columns END * :multiplier) AS SIZE" : ""}
FROM   sub
       ${getRecordsList ? "LEFT JOIN records ON records.dataset_pk = sub.pk" : ""}`;
  const queryParams = {
    filters: filters.shared,
    obisFilters: filters.obisOnly,
    profileFilters: filters.profileOnly,
    depthVariableProbe: DEPTH_VARIABLE_PROBE,
    timeMin,
    timeMax,
    ...(doEstimate
      ? {
          depthMin,
          depthMax,
          adder: 0,
          multiplier: 10,
          obisColumns: OBIS_DOWNLOAD_COLUMNS,
        }
      : {}),
  };

  return { sql, params: queryParams };
}

async function getShapeQuery(query, doEstimate = true, getRecordsList = true) {
  const { sql, params } = await buildShapeSql(query, {
    doEstimate,
    getRecordsList,
  });

  const rows = await db.raw(sql, params);

  return rows.rows.map(changePKtoPkURL);
}

async function getDatasetPksInShape(query) {
  const { sql, params } = await buildShapeSql(query, {
    doEstimate: false,
    pksOnly: true,
  });
  const { rows } = await db.raw(sql, params);
  return rows.map((row) => row.pk);
}

module.exports = { getShapeQuery, getDatasetPksInShape, buildShapeSql };
