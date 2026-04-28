const db = require("../db");
const { changePKtoPkURL } = require("./misc");

const createDBFilter = require("./dbFilter");

async function getShapeQuery(query, doEstimate = true, getRecordsList = true) {
  const filters = createDBFilter(query);

  const {
    timeMin = null, timeMax = null, depthMin = null, depthMax = null,
    includeObis = 'true',
    scientificNames,
  } = query;

  // Scientific-name filter is OBIS-only: when set, hide profiles and narrow OBIS.
  const includeProfiles = !scientificNames;
  const showObis = includeObis !== 'false';

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

  const sql = `WITH combined AS (
        ${combinedInner}
  ),
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
                  json_build_object('en',title,'fr',title_fr)     title_translated,
                  d.eovs                                          eovs,
                  organizations,
                  count(p.*)::integer profiles_count,
                  d.source_type,
                  CASE WHEN d.source_type = 'obis'
                           THEN 'https://obis.org/dataset/' || d.dataset_id
                           ELSE d.erddap_url || '/tabledap/' || d.dataset_id || '.html'
                  END AS erddap_url,
                  'https://catalogue.cioos.ca/dataset/'
                           || ckan_id AS ckan_url
                  -- replace '0 days' with '1 day' when its a single day profile
                  -- query records count = sum((number of days covered by the query that are in the profile) * profile records per day * fraction of the depth range that profile covers)
                  ${
  doEstimate
    ? `,SUM(
                  -- number of days covered by this query that overlap this profile time range
                  coalesce(nullif(date_part('days',range_intersection_length(tstzrange(:timeMin,:timeMax),tstzrange(p.time_min,p.time_max))),0),1) * p.records_per_day *
                  -- depth multiplier - fraction of depth range that this query overlaps with profile depth range
                  coalesce(nullif(range_intersection_length(numrange(:depthMin,:depthMax),numrange(p.depth_min::NUMERIC,p.depth_max::NUMERIC)),0),1) / (coalesce(nullif(p.depth_max-p.depth_min,0),1)) ) AS records_count`
    : ""
}
                  ${
  getRecordsList
    ? ",json_agg(json_build_object( 'profile_id',coalesce(p.profile_id, p.timeseries_id), 'time_min',p.time_min::DATE, 'time_max',p.time_max::DATE, 'depth_min',p.depth_min, 'depth_max',p.depth_max ) ORDER BY time_min DESC ) AS profiles"
    : ""
}

         FROM     combined p
         JOIN     cde.datasets d
         ON       p.dataset_pk = d.pk
         WHERE :filters
         GROUP BY d.pk)
SELECT *
       ${doEstimate ? ",round(:adder + records_count * num_columns * :multiplier) AS SIZE" : ""}
FROM   sub`;
  let queryParams;

  if (doEstimate) {
    queryParams = {
      timeMin,
      timeMax,
      depthMin,
      depthMax,
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      adder: 0,
      multiplier: 10,
    };
  } else queryParams = { filters: filters.shared, obisFilters: filters.obisOnly };

  const q = db.raw(sql, queryParams);

  const rows = await q;

  return rows.rows.map(changePKtoPkURL);
}
module.exports = { getShapeQuery };
