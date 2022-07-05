/* 
 
   create_hexes()
   
   Create tables to store the hex polygons. Once they are joined with cde.points
   the polygons are copied over to that table 
 
 */


CREATE OR REPLACE FUNCTION create_hexes() RETURNS VOID AS $$
  BEGIN
  

  DROP TABLE IF EXISTS cde.hexes_zoom_0;
  CREATE TABLE cde.hexes_zoom_0 AS SELECT geom from ST_HexagonGrid(
          100000,
          st_setsrid(ST_EstimatedExtent('cde','points', 'geom'),3857)
      ); 
  CREATE INDEX
    ON cde.hexes_zoom_0
    USING GIST (geom);

  DROP TABLE IF EXISTS cde.hexes_zoom_1;
  CREATE TABLE cde.hexes_zoom_1 AS SELECT geom from ST_HexagonGrid(
          10000,
          st_setsrid(ST_EstimatedExtent('cde','points', 'geom'),3857)
      ); 
  CREATE INDEX
    ON cde.hexes_zoom_1
    USING GIST (geom);
    
    -- clear existing hexes from profiles
  UPDATE cde.profiles SET hex_zoom_0=null,hex_zoom_1=null;

    
  UPDATE cde.points SET hex_zoom_0=null,hex_zoom_1=null; 
  -- There are many profiles with the same lat/long. 
  -- The points table is distinct on lat/long
  -- Hex binning is much faster if done on this table as there are half the records as the profiles table

  -- takes a few mins, most zoomed out level
  with zoom as (
  select p.pk,hexes.geom from cde.hexes_zoom_0 AS hexes
      inner JOIN cde.points p
      ON ST_Intersects(p.geom, hexes.geom)
      )
  UPDATE cde.points p
  SET hex_zoom_0 = z.geom
  FROM zoom AS z
  WHERE z.pk = p.pk  AND hex_zoom_0 is null;

  with zoom as ( 
  select p.pk,hexes.geom from cde.hexes_zoom_1 as hexes
      
      inner JOIN cde.points p
      ON ST_Intersects(p.geom, hexes.geom)
      )
  UPDATE cde.points p
  SET hex_zoom_1 = z.geom
  FROM zoom AS z
  WHERE z.pk = p.pk  AND hex_zoom_1 is null;     

  -- update the profiles table, this is denormalized for speed
  UPDATE cde.profiles
  SET hex_zoom_0=points.hex_zoom_0, hex_zoom_1=points.hex_zoom_1
  FROM cde.points
  WHERE profiles.point_pk=points.pk;


  END;
$$ LANGUAGE plpgsql;
