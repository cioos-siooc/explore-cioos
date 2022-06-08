-- 
-- 
-- Used by the API in size estimates, finds length of overlap of date range or number range
-- 
-- 

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