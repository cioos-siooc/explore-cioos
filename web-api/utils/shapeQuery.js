const db = require("../db");

const createDBFilter = require("../utils/dbFilter");
const unique = (arr) => [...new Set(arr)];

async function getShapeQuery(query) {
  const filters = createDBFilter(query);

  let { eovs, timeMin, timeMax, depthMin, depthMax } = query;
  let eovsQuery = "";
  if (eovs) {
    const eovsCommaSeparatedString = unique(eovs.split(","));
    eovsQuery = db.raw("eovs && :eovsCommaSeparatedString", {
      eovsCommaSeparatedString,
    });
  }

  const adder = 0;
  const multiplier = 10;

  if (!timeMax) timeMax = null;
  if (!timeMin) timeMin = null;
  if (!depthMin) depthMin = null;
  if (!depthMax) depthMax = null;

  const sql = `WITH sub AS
        (SELECT   d.pk,
                  d.dataset_id,
                  d.n_profiles,
                  d.cdm_data_type,
                  d.title title,
                  d.platform,
                  json_build_object('en',title,'fr',title_fr)     title_translated,
                  json_build_object('en',summary,'fr',summary_fr) summary_translated,
                  d.eovs                                          eovs,
                  organizations,
                  d.erddap_url
                           || '/tabledap/'
                           || d.dataset_id
                           || '.html' AS erddap_url,
                  'https://catalogue.cioos.ca/dataset/'
                           || ckan_id AS ckan_url,
                  -- replace '0 days' with '1 day' when its a single day profile
                  -- query records count = sum((number of days covered by the query that are in the profile) * profile records per day * fraction of the depth range that profile covers)
                  SUM(
                  -- number of days covered by this query that overlap this profile time range
                  coalesce(nullif(date_part('days',range_intersection_length(tstzrange(:timeMin,:timeMax),tstzrange(p.time_min,p.time_max))),0),1) * p.records_per_day *
                  -- depth multiplier - fraction of depth range that this query overlaps with profile depth range
                  coalesce(nullif(range_intersection_length(numrange(:depthMin,:depthMax),numrange(p.depth_min::NUMERIC,p.depth_max::NUMERIC)),0),1) / (coalesce(nullif(p.depth_max-p.depth_min,0),1)) ) AS records_count,
                  (
                         SELECT count(*)
                         FROM   cde.erddap_variables
                         WHERE  d.pk=dataset_pk
                         AND    (
                                       standard_name = ANY(
                                       (
                                              SELECT standard_name
                                              FROM   cde.eov_to_standard_name ${
                                                eovs ? "WHERE :eovsQuery" : ""
                                              }))
                                OR     cf_role IS NOT NULL
                                OR     name = ANY(ARRAY['time', 'latitude', 'longitude', 'depth']) ) )                                                                                                                                       eov_cols,
                  json_agg(json_build_object( 'profile_id',coalesce(p.profile_id, p.timeseries_id), 'time_min',p.time_min::DATE, 'time_max',p.time_max::DATE, 'depth_min',p.depth_min, 'depth_max',p.depth_max ) ORDER BY time_min DESC ) AS profiles
         FROM     cde.profiles p
         JOIN     cde.datasets d
         ON       p.dataset_pk =d.pk
         WHERE    :filters
                  -- AND ckan_record IS NOT NULL
         GROUP BY d.pk)
SELECT *,
       round(:adder + records_count * eov_cols * :multiplier) AS SIZE
FROM   sub`;

  const rows = await db.raw(sql, {
    eovsQuery,
    timeMin,
    timeMax,
    depthMin,
    depthMax,
    multiplier,
    adder,
    filters,
  });

  return rows.rows;
}
module.exports = { getShapeQuery };
