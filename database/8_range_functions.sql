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