/*

range_intersection_length( numrange, numrange )
range_intersection_length( tstzrange, tstzrange )

Used by the API to estimate download size. Finds length of overlapping ranges

eg:

  SELECT range_intersection_length(numrange(1,10),numrange(2,4));  = 2
  SELECT range_intersection_length(tstzrange('2010-01-01','2012-01-01'),tstzrange('2011-01-01','2011-01-05')); = "4 days"

*/

DROP FUNCTION IF EXISTS range_intersection_length( numrange, numrange );
CREATE OR REPLACE FUNCTION range_intersection_length(a numrange,b numrange )
   RETURNS numeric
   LANGUAGE plpgsql
  AS
$$
DECLARE
BEGIN
RETURN upper(a*b)-lower(a*b);
END;
$$;

DROP FUNCTION IF EXISTS range_intersection_length( tstzrange, tstzrange );
CREATE OR REPLACE FUNCTION range_intersection_length(a tstzrange,b tstzrange )
   RETURNS interval
   LANGUAGE plpgsql
  as
$$
DECLARE
BEGIN
RETURN upper(a*b)-lower(a*b);
END;
$$;

/*

day_union_days( daterange[] )

Total number of days covered by a set of day ranges, counting overlaps once —
the map's "days of data" metric (see web-api/utils/hexMetric.js).

Hand-rolled because range_agg needs PostgreSQL 14 and this database is 13.x.
The single-range fast path (most rows) skips the sort, roughly halving the cost.

eg:

  SELECT day_union_days(ARRAY[daterange('2020-01-01','2020-01-11'),
                              daterange('2020-01-06','2020-01-21')]);  = 20
  SELECT day_union_days(ARRAY[]::daterange[]);                         = 0

*/

DROP FUNCTION IF EXISTS day_union_days( daterange[] );
CREATE OR REPLACE FUNCTION day_union_days(ranges daterange[])
  RETURNS bigint
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS
$$
DECLARE
  r       daterange;
  total   bigint := 0;
  cur_lo  date;
  cur_hi  date;
BEGIN
  IF ranges IS NULL THEN
    RETURN 0;
  END IF;

  IF coalesce(array_length(ranges, 1), 0) = 1 THEN
    r := ranges[1];
    IF r IS NULL OR isempty(r) THEN
      RETURN 0;
    END IF;
    RETURN upper(r) - lower(r);
  END IF;

  FOR r IN
    SELECT x FROM unnest(ranges) x
     WHERE x IS NOT NULL AND NOT isempty(x)
     ORDER BY x
  LOOP
    IF cur_hi IS NULL THEN
      cur_lo := lower(r);
      cur_hi := upper(r);
    ELSIF lower(r) <= cur_hi THEN          -- overlaps or abuts the current run
      cur_hi := GREATEST(cur_hi, upper(r));
    ELSE
      total  := total + (cur_hi - cur_lo);
      cur_lo := lower(r);
      cur_hi := upper(r);
    END IF;
  END LOOP;

  IF cur_hi IS NOT NULL THEN
    total := total + (cur_hi - cur_lo);
  END IF;

  RETURN total;
END;
$$;


/*

day_range_overlap_days( daterange[], daterange )

Days of the query window that the feature actually holds data on: the day set
intersected with the window, overlaps counted once. This is the day factor in
the download-size estimate (web-api/utils/shapeQuery.js).

`records_per_day` is a rate over days WITH DATA, so pairing it with an elapsed
span over-counts. A NULL or empty array means "day set unknown"; the caller
falls back to the span rather than reading a 0 here as "no data".

eg:

  SELECT day_range_overlap_days(ARRAY[daterange('2020-01-01','2020-01-11')],
                                daterange('2020-01-05','2020-01-07'));   = 2
  SELECT day_range_overlap_days(NULL, daterange('2020-01-01','2020-02-01')); = 0

*/

DROP FUNCTION IF EXISTS day_range_overlap_days( daterange[], daterange );
CREATE OR REPLACE FUNCTION day_range_overlap_days(ranges daterange[], window_range daterange)
  RETURNS bigint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS
$$
  SELECT day_union_days(
           coalesce(
             (SELECT array_agg(x * window_range)
                FROM unnest(coalesce(ranges, '{}'::daterange[])) x
               WHERE x IS NOT NULL
                 AND window_range IS NOT NULL
                 AND x && window_range),
             '{}'::daterange[]
           )
         );
$$;

/*

dataset_is_realtime( coverage_time_max, harvested_at, cdm_data_type )

"Was this dataset still producing data at the moment we harvested it?"

IMMUTABLE on purpose: measured against the harvest, not now(), so a badge does
not flip between page loads; it ages until the next harvest re-measures it.

7 days, not 1: near-real-time feeds lag for QC and the default harvest cadence
is 3 days (HARVESTER_CRON), so this allows that lag plus a missed run.

Callers pass verified_at, not last_updated_at: a dead feed skipped as unchanged
keeps its old last_updated_at, which would read realtime forever.

coverage_time_max is capped at harvested_at + 90 days (past real forecast
horizons) so bogus metadata like a 2050 time_coverage_end is not "live".

Only Grid and the TimeSeries* and Trajectory* families are continuous feeds; Profile
and Point (OBIS) recency means recent data entry, not a live feed.

NULL inputs return false rather than NULL so callers avoid three-valued logic.

  SELECT dataset_is_realtime(coverage_time_max, verified_at, cdm_data_type)
    FROM cde.datasets;

*/

-- Dropped first: CREATE OR REPLACE refuses to rename an existing function's
-- parameters, so re-applying over an older signature would error out.
DROP FUNCTION IF EXISTS dataset_is_realtime( timestamptz, timestamptz );
DROP FUNCTION IF EXISTS dataset_is_realtime( timestamptz, timestamptz, text );
CREATE OR REPLACE FUNCTION dataset_is_realtime(
    coverage_time_max timestamptz,
    harvested_at timestamptz,
    cdm_data_type text
  )
  RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS
$$
  SELECT coverage_time_max IS NOT NULL
     AND harvested_at IS NOT NULL
     AND coverage_time_max >= harvested_at - interval '7 days'
     AND coverage_time_max <= harvested_at + interval '90 days'
     AND (cdm_data_type = 'Grid'
          OR cdm_data_type ILIKE 'TimeSeries%'
          OR cdm_data_type ILIKE 'Trajectory%');
$$;
