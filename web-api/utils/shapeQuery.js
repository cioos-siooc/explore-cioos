const db = require("../db");
const { changePKtoPkURL } = require("./misc");

const createDBFilter = require("./dbFilter");

async function getShapeQuery(query, doEstimate = true, getRecordsList = true) {
  // Caller propagates ScientificNameSelectionTooBroadError as a 400.
  const filters = await createDBFilter(query);

  const {
    timeMin = null, timeMax = null, depthMin = null, depthMax = null,
    includeObis = 'true',
    scientificNames,
    obisNodes,
    erddapServers,
  } = query;

  // Scientific-name filters are OBIS-only: hide profiles when set. An
  // OBIS-node selection also hides profiles, unless ERDDAP servers are
  // selected alongside it (combined Source filter — show both, OR'd in the
  // shared dataset filter).
  const includeProfiles = !scientificNames && (!obisNodes || Boolean(erddapServers));
  const showObis = includeObis !== 'false';

  // search_geom is the geometry the shared spatial filter (dbFilter) matches
  // against: the per-feature bbox for profiles (extent search), the cell point
  // for the already-fine-grained OBIS cells, and the hex polygon for
  // trajectory coverage.
  const profilesBranch = `SELECT dataset_pk, time_min, time_max, depth_min, depth_max, records_per_day,
               day_ranges,
               profile_id, timeseries_id, eovs AS feature_eovs,
               latitude, longitude, point_pk, geom, bbox AS search_geom
        FROM cde.profiles
        WHERE :profileFilters`;
  // Trajectory coverage hexes: ERDDAP data, gated with profiles. The
  // trajectory_id doubles as the profile_id surrogate so the records list
  // labels rows by mission/deployment. records_per_day here is records over
  // DAYS WITH DATA (n_records / count(distinct day), 4_create_hexes.sql), which
  // is why the estimate below multiplies it by a day-set overlap rather than an
  // elapsed span — pairing this rate with a span over-counted every trajectory
  // estimate by span/days-with-data, which for a ship that samples a few weeks
  // a year is an order of magnitude.
  // Only the 10 km tier: the 100 km rows describe the same data at
  // a coarser grain and would double-count every estimate.
  // search_geom is the HEX POLYGON, not its centroid — a drawn polygon smaller
  // than a hex still selects the data the track left inside it.
  const trajectoryBranch = `SELECT t.dataset_pk, t.time_min, t.time_max, t.depth_min, t.depth_max, t.records_per_day,
               t.day_ranges,
               t.trajectory_id as profile_id, NULL as timeseries_id, NULL::text[] as feature_eovs,
               t.latitude, t.longitude, NULL::integer AS point_pk, t.geom, h.geom AS search_geom
        FROM cde.trajectory_hexes t
        JOIN cde.hexes_zoom_1 h ON h.pk = t.hex_pk
        WHERE t.hex_tier = 1`;
  const obisBranch = `SELECT dataset_pk, time_min, time_max, depth_min, depth_max, 0 as records_per_day,
               day_ranges,
               NULL as profile_id, NULL as timeseries_id, NULL::text[] as feature_eovs,
               latitude, longitude, point_pk, geom, geom AS search_geom
        FROM cde.obis_cells
        WHERE :obisFilters`;
  // Griddap datasets are metadata-only: no feature rows, their coverage lives
  // on cde.datasets (coverage_* columns). The coverage_* names are aliased
  // back to the combined-CTE contract here because dbFilter emits unqualified
  // time_min/time_max/depth_* predicates that would otherwise be ambiguous.
  // Timeless (static) grids coalesce to +-infinity so any time filter matches;
  // NULL point_pk keeps grids out of map-click (pointPKs) queries.
  const griddapBranch = `SELECT pk AS dataset_pk,
               coalesce(coverage_time_min, '-infinity'::timestamptz) AS time_min,
               coalesce(coverage_time_max, 'infinity'::timestamptz) AS time_max,
               coalesce(coverage_depth_min, 0) AS depth_min,
               coalesce(coverage_depth_max, 0) AS depth_max,
               0 AS records_per_day,
               NULL::daterange[] AS day_ranges,
               NULL::text AS profile_id, NULL::text AS timeseries_id,
               NULL::text[] AS feature_eovs,
               NULL::double precision AS latitude, NULL::double precision AS longitude,
               NULL::integer AS point_pk, NULL::geometry AS geom,
               coverage_bbox AS search_geom
        FROM cde.datasets
        WHERE cdm_data_type = 'Grid' AND coverage_bbox IS NOT NULL`;

  const branches = [];
  if (includeProfiles) branches.push(profilesBranch, trajectoryBranch);
  if (showObis) branches.push(obisBranch);
  // Grids appear in /pointQuery and /datasetRecordsList but never in the
  // download-estimate path (metadata-only, downloads happen on ERDDAP).
  if (includeProfiles && !doEstimate) branches.push(griddapBranch);
  const combinedInner = branches.length
    ? branches.join("\n        UNION ALL\n        ")
    : `SELECT * FROM (${profilesBranch}) empty_combined WHERE FALSE`;

  // The record list is one row per *record* (profile / trajectory / OBIS
  // dataset), not one per matched feature. Trajectory and OBIS coverage is
  // stored per cell/hex, so a mission crossing 40 hexes is 40 rows in
  // `filtered` all carrying the same trajectory_id (or '' / NULL when the
  // record is unnamed) — collapsing them here is what keeps the inspector's
  // table from repeating the same ID down the page. The time/depth extents are
  // unioned across the cells. profiles_count and the size estimate below still
  // count features, which is what they mean.
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
                           -- Spelled out in UTC rather than left to json_agg,
                           -- which would stamp them with whatever offset the
                           -- session's timezone happens to be. A record's
                           -- extent is an instant, not a day: two casts of the
                           -- same profile an hour apart are one line in the
                           -- record list otherwise.
                           to_char(min(time_min) AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time_min,
                           to_char(max(time_max) AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time_max,
                           min(depth_min)       AS depth_min,
                           max(depth_max)       AS depth_max,
                           -- The EOVs this record carries, unioned across the
                           -- cells it was collapsed from. NULL for the sources
                           -- with no per-feature EOVs (trajectory, OBIS, grid);
                           -- the inspector falls back to the dataset's there.
                           -- The lateral duplicates rows, which the min/max
                           -- aggregates above are indifferent to, and LEFT
                           -- keeps records whose feature_eovs is NULL.
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
  -- Filtering happens once, here, so the record list and the per-dataset
  -- aggregates below agree on which features matched.
  filtered AS (
        SELECT p.*
        FROM   combined p
        JOIN   cde.datasets d
        ON     p.dataset_pk = d.pk
        WHERE  :filters
  ),
  ${getRecordsList ? recordsCte : ""}
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
                  -- The variables carrying each CF discrete-sampling role
                  -- (cf_role=timeseries_id / profile_id / trajectory_id), so
                  -- the record list can name its ID column after the role the
                  -- dataset actually uses, and after the variable behind it.
                  d.timeseries_id_variable,
                  d.profile_id_variable,
                  d.trajectory_id_variable,
                  json_build_object('en',title,'fr',title_fr)     title_translated,
                  d.eovs                                          eovs,
                  organizations,
                  count(p.*)::integer profiles_count,
                  d.source_type,
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
                  -- griddap footprint for the frontend bbox highlight; NULL
                  -- for every other type
                  CASE WHEN d.cdm_data_type = 'Grid'
                           THEN ST_AsGeoJSON(ST_Transform(d.coverage_bbox, 4326), 6)::json
                  END AS coverage_bbox_geojson,
                  -- Extent of the features this query actually matched (profile
                  -- bboxes / obis + trajectory cells / the grid footprint), so
                  -- the frontend can frame the dataset as currently filtered
                  -- rather than its full-catalogue footprint. Degenerate (a
                  -- point) for a single-location dataset — fitBounds handles it.
                  ST_AsGeoJSON(
                    ST_Transform(ST_SetSRID(ST_Extent(p.search_geom)::geometry, 3857), 4326), 6
                  )::json AS filtered_bbox_geojson
                  -- estimated records = sum(days of this query that the feature holds data on
                  --   * records per day of data
                  --   * fraction of the depth range the query overlaps)
                  ${
  doEstimate
    ? `,SUM(
                  -- Days of the query window this feature actually holds data on.
                  -- records_per_day is a rate over days WITH DATA, so the day factor
                  -- has to be too: multiplying it by an elapsed span over-counts a
                  -- seasonal station by the ratio between the two. day_ranges is the
                  -- feature's day set; where it is unknown (a dataset not re-harvested
                  -- since the day sets landed) the span is still the best available
                  -- answer, and matches the rate that was derived from it.
                  -- Zero becomes one, as before, so a row the filter kept never
                  -- estimates as no data at all.
                  coalesce(nullif(
                    CASE WHEN coalesce(array_length(p.day_ranges, 1), 0) > 0
                         THEN day_range_overlap_days(p.day_ranges, daterange(:timeMin::date, (:timeMax::date) + 1))
                         ELSE date_part('days',range_intersection_length(tstzrange(:timeMin,:timeMax),tstzrange(p.time_min,p.time_max)))
                    END, 0), 1) * p.records_per_day *
                  -- depth multiplier - fraction of depth range that this query overlaps with profile depth range
                  coalesce(nullif(range_intersection_length(numrange(:depthMin,:depthMax),numrange(p.depth_min::NUMERIC,p.depth_max::NUMERIC)),0),1) / (coalesce(nullif(p.depth_max-p.depth_min,0),1)) ) AS records_count`
    : ""
}

         FROM     filtered p
         JOIN     cde.datasets d
         ON       p.dataset_pk = d.pk
         GROUP BY d.pk)
SELECT sub.*
       ${getRecordsList ? ",coalesce(records.profiles, '[]'::json) AS profiles" : ""}
       ${doEstimate ? ",round(:adder + records_count * num_columns * :multiplier) AS SIZE" : ""}
FROM   sub
       ${getRecordsList ? "LEFT JOIN records ON records.dataset_pk = sub.pk" : ""}`;
  let queryParams;

  if (doEstimate) {
    queryParams = {
      timeMin,
      timeMax,
      depthMin,
      depthMax,
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      profileFilters: filters.profileOnly,
      adder: 0,
      multiplier: 10,
    };
  } else {
    queryParams = {
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      profileFilters: filters.profileOnly,
    };
  }

  const q = db.raw(sql, queryParams);

  const rows = await q;

  return rows.rows.map(changePKtoPkURL);
}
module.exports = { getShapeQuery };
