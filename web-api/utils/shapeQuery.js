const db = require("../db");
const { oceanVariablesToGOOS } = require("../utils/grouping");

const createDBFilter = require("../utils/dbFilter");

async function getShapeQuery(query) {
  const filters = createDBFilter(query);

  let { eovs, timeMin, timeMax, depthMin, depthMax } = query;

  const eovsQuery = eovs
    ? `where eov = any(array[${oceanVariablesToGOOS(eovs)}])`
    : "";

  const adder = 0;
  const multiplier = 10;

  if (timeMax) timeMax = `'${timeMax}'`;
  else timeMax = "NULL";
  if (timeMin) timeMin = `'${timeMin}'`;
  else timeMin = "NULL";
  if (!depthMin) depthMin = "NULL";
  if (!depthMax) depthMax = "NULL";
  const sql = `WITH sub as (
  SELECT 
        d.pk,
        d.dataset_id,
        d.cdm_data_type,
        d.title title,
        d.ceda_eovs eovs,
        organizations,
        d.erddap_url,
        -- replace '0 days' with '1 day' when its a single day profile
        -- query records count = sum((number of days covered by the query that are in the profile) * profile records per day * fraction of the depth range that profile covers)
            sum(
        -- number of days covered by this query that overlap this profile time range
		coalesce(nullif(date_part('days',range_intersection_length(tstzrange(${timeMin},${timeMax}),tstzrange(p.time_min,p.time_max))),0),1) *
        p.records_per_day * 
        -- depth multiplier - fraction of depth range that this query overlaps with profile depth range
		coalesce(nullif(range_intersection_length(numrange(${depthMin},${depthMax}),numrange(p.depth_min::numeric,p.depth_max::numeric)),0),1) / (coalesce(nullif(p.depth_max-p.depth_min,0),1))
        ) as records_count,

     (select count(*) from cioos_api.erddap_variables 
        where d.pk=dataset_pk and (
		standard_name = any((select standard_name from cioos_api.eov_to_standard_name
        ${eovsQuery} )) 
       or
		cf_role is not null or
	 	name = any(array['time', 'latitude', 'longitude', 'depth']) ) )
     
     eov_cols,
        json_agg(json_build_object(
                'profile_id',coalesce(p.profile_id, p.timeseries_id),
                'time_min',p.time_min::date,
                'time_max',p.time_max::date,
                'depth_min',p.depth_min,
                'depth_max',p.depth_max
        ) ORDER BY time_min DESC
        ) as profiles
        FROM cioos_api.profiles p
        JOIN cioos_api.datasets d
        ON p.dataset_pk =d.pk
        WHERE ${filters}
        -- AND ckan_record IS NOT NULL
        GROUP BY d.pk)
        select *,round(${adder} + records_count * eov_cols * ${multiplier}) as size from sub`;

  const rows = await db.raw(sql);

  return rows.rows;
}
module.exports = { getShapeQuery };
