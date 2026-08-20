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
are ignored, and the single-range case (every profile and OBIS cell, and most
trajectory hexes) skips the sort entirely — that fast path is the difference
between ~3x and ~5x the cost of the plain sum it replaces.

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
