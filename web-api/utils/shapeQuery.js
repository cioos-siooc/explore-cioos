const db = require("../db");

const createDBFilter = require("./dbFilter");

async function getShapeQuery(query, doEstimate = true, getRecordsList = true) {
  const filters = createDBFilter(query);

  const {
    timeMin = null, timeMax = null, depthMin = null, depthMax = null,
  } = query;

  const sql = `WITH sub AS
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
                  d.erddap_url
                           || '/tabledap/'
                           || d.dataset_id
                           || '.html' AS erddap_url,
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
                  
         FROM     cde.profiles p
         JOIN     cde.datasets d
         ON       p.dataset_pk = d.pk
         WHERE :filters
         GROUP BY d.pk)
SELECT *
       ${doEstimate ? ",round(:adder + records_count * num_columns * :multiplier) AS SIZE" : ""}
FROM   sub`;
  if (doEstimate) {
    queryParams = {
      timeMin,
      timeMax,
      depthMin,
      depthMax,
      filters,
      adder: 0,
      multiplier: 10,
    };
  } else queryParams = { filters };
  if (!queryParams.filters?.sql) queryParams.filters = "TRUE";

  const q = db.raw(sql, queryParams);

  const rows = await q;

  return rows.rows.map((e) => ({ ...e, pk: e.pk_url }));
}
module.exports = { getShapeQuery };
