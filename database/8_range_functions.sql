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
the map's "days of data" metric (see web-api/utils/hexMetric.js). Ten moorings
deployed over the same year read as 365 days, not 3650.

PostgreSQL 14's range_agg would do this natively; this database is 13.x, so the
merge is hand-rolled. Ranges are sorted and swept once, extending the current
island while the next range starts at or before its end. NULL and empty ranges
are ignored, and the single-range case (every profile and OBIS cell that has
not been re-harvested yet, and most trajectory hexes) skips the sort entirely —
that fast path is the difference between ~3x and ~5x the cost of the plain sum
it replaces.

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

It exists because `records_per_day` is a rate over days WITH DATA. Pairing that
rate with an elapsed span — which is what the estimator did for every source,
and still does for rows whose day set is unknown — over-counts by exactly
span/days-with-data. A NULL or empty array means "day set unknown"; the caller
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

dataset_is_realtime( coverage_time_max, harvested_at )

"Was this dataset still producing data at the moment we harvested it?"

Both arguments are stored columns on cde.datasets, so this is IMMUTABLE: the
answer is fixed at harvest time and does not drift as the clock moves. That is
deliberate. A now()-relative test would need the catalogue refreshed on a timer
to stay honest, and would flip a dataset's badge between page loads; "this
dataset is updated in real time" is a property of the dataset, not of this
instant. The cost is that the flag ages with the harvest: a feed that died
yesterday keeps its badge until the next harvest re-measures it.

coverage_time_max is the dataset's newest data as the server itself reported it
(from the allDatasets listing, or the time dimension for grids); harvested_at is
when we last looked at the dataset. A dataset whose newest data is less than a
day behind its own harvest was live at that moment.

Callers pass verified_at, not last_updated_at. last_updated_at only moves when
the dataset's content changed, so on an incremental harvest a dataset skipped as
unchanged keeps the old value (the loader bumps verified_at alone --
loading/loader.py). A feed that dies therefore freezes coverage_time_max and
last_updated_at together, a few hours apart, and would read realtime forever:
the "next harvest re-measures it" the paragraph above promises never arrives for
exactly the datasets the flag is meant to catch. verified_at advances on every
harvest that reaches the dataset, so the gap widens on its own and the flag
turns false one day after the data stops.

Forecast grids have a coverage_time_max in the future and so are realtime,
which is correct -- they are continuously reissued.

NULL on either side means "unknown", which is not evidence of being live, so
the answer is false rather than NULL. That keeps callers from needing IS TRUE /
IS NOT TRUE to avoid three-valued logic dropping rows from both sides of the
filter.

  SELECT dataset_is_realtime(coverage_time_max, verified_at)
    FROM cde.datasets;

*/

-- Dropped first, like the functions above: CREATE OR REPLACE refuses to rename
-- an existing function's parameters, so re-applying this file over a database
-- that still has the last_updated_at signature would error out mid-migration.
DROP FUNCTION IF EXISTS dataset_is_realtime( timestamptz, timestamptz );
CREATE OR REPLACE FUNCTION dataset_is_realtime(
    coverage_time_max timestamptz,
    harvested_at timestamptz
  )
  RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS
$$
  SELECT coverage_time_max IS NOT NULL
     AND harvested_at IS NOT NULL
     AND coverage_time_max >= harvested_at - interval '1 day';
$$;
