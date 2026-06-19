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
  } = query;

  // Scientific-name and OBIS-node filters are OBIS-only: when either is set,
  // hide profiles and narrow to OBIS rows.
  const includeProfiles = !scientificNames && !obisNodes;
  const showObis = includeObis !== 'false';
  // Trajectories are not OBIS, so they follow the same gate as profiles.
  const includeTrajectories = includeProfiles;

  const profilesBranch = `SELECT dataset_pk, time_min, time_max, depth_min, depth_max, records_per_day,
               profile_id, timeseries_id,
               latitude, longitude, point_pk, geom
        FROM cde.profiles`;
  const obisBranch = `SELECT dataset_pk, time_min, time_max, depth_min, depth_max, 0 as records_per_day,
               NULL as profile_id, NULL as timeseries_id,
               latitude, longitude, point_pk, geom
        FROM cde.obis_cells
        WHERE :obisFilters`;

  const branches = [];
  if (includeProfiles) branches.push(profilesBranch);
  if (showObis) branches.push(obisBranch);
  const combinedInner = branches.length
    ? branches.join("\n        UNION ALL\n        ")
    : `${profilesBranch} WHERE FALSE`;

  // Per-dataset query-records estimate. p.* columns; reused verbatim for the
  // trajectory aggregation below by aliasing the trajectory table as p.
  const estimateExpr = `SUM(
                  coalesce(nullif(date_part('days',range_intersection_length(tstzrange(:timeMin,:timeMax),tstzrange(p.time_min,p.time_max))),0),1) * p.records_per_day *
                  coalesce(nullif(range_intersection_length(numrange(:depthMin,:depthMax),numrange(p.depth_min::NUMERIC,p.depth_max::NUMERIC)),0),1) / (coalesce(nullif(p.depth_max-p.depth_min,0),1)) ) AS records_count`;

  const estimateFragment = doEstimate ? `,${estimateExpr}` : "";
  const recordsFragment = (idExpr) => getRecordsList
    ? `,json_agg(json_build_object( 'profile_id',${idExpr}, 'time_min',p.time_min::DATE, 'time_max',p.time_max::DATE, 'depth_min',p.depth_min, 'depth_max',p.depth_max ) ORDER BY time_min DESC ) AS profiles`
    : "";

  // The selected columns are identical for the point-source aggregation (sub)
  // and the trajectory aggregation (subTraj) so they can UNION ALL. `p` is the
  // row alias in both (cde.trajectories aliased as p in subTraj).
  const subSelect = (idExpr) => `SELECT   d.pk,
                  d.pk_url,
                  d.dataset_id,
                  d.n_profiles,
                  d.cdm_data_type,
                  d.title title,
                  d.platform,
                  d.num_columns,
                  d.first_eov_column,
                  json_build_object('en',title,'fr',title_fr)     title_translated,
                  d.eovs                                          eovs,
                  organizations,
                  count(p.*)::integer profiles_count,
                  d.source_type,
                  d.erddap_url AS erddap_server_url,
                  CASE WHEN d.source_type = 'obis'
                           THEN 'https://obis.org/dataset/' || d.dataset_id
                           ELSE d.erddap_url || '/tabledap/' || d.dataset_id || '.html'
                  END AS erddap_url,
                  'https://catalogue.cioos.ca/dataset/'
                           || ckan_id AS ckan_url
                  ${estimateFragment}
                  ${recordsFragment(idExpr)}`;

  const subTrajCTE = includeTrajectories
    ? `, subTraj AS
        (${subSelect("p.trajectory_id")}
         FROM     cde.trajectories p
         JOIN     cde.datasets d
         ON       p.dataset_pk = d.pk
         WHERE :trajectoryFilters
         GROUP BY d.pk)`
    : "";

  const unionTraj = includeTrajectories ? "UNION ALL SELECT * FROM subTraj" : "";

  const sql = `WITH combined AS (
        ${combinedInner}
  ),
  sub AS
        (${subSelect("coalesce(p.profile_id, p.timeseries_id)")}
         FROM     combined p
         JOIN     cde.datasets d
         ON       p.dataset_pk = d.pk
         WHERE :filters
         GROUP BY d.pk)${subTrajCTE}
SELECT *
       ${doEstimate ? ",round(:adder + records_count * num_columns * :multiplier) AS SIZE" : ""}
FROM   (SELECT * FROM sub ${unionTraj}) allsub`;
  let queryParams;

  if (doEstimate) {
    queryParams = {
      timeMin,
      timeMax,
      depthMin,
      depthMax,
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      trajectoryFilters: filters.trajectory,
      adder: 0,
      multiplier: 10,
    };
  } else queryParams = {
    filters: filters.shared,
    obisFilters: filters.obisOnly,
    trajectoryFilters: filters.trajectory,
  };

  const q = db.raw(sql, queryParams);

  const rows = await q;

  return rows.rows.map(changePKtoPkURL);
}
module.exports = { getShapeQuery };
