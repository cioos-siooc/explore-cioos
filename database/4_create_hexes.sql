/* 
 
   create_hexes()
   
   Create tables to store the hex polygons. Once they are joined with cde.points
   the polygons are copied over to that table 
 
 */


CREATE OR REPLACE FUNCTION create_hexes() RETURNS VOID AS $$
  BEGIN
  

  -- create tables to store the hex polygons. Once they are joined with cde.points
  -- the polygons are copied over to that table
 
drop index if exists cde.hexes_zoom_0_geom_idx;
drop index if exists cde.hexes_zoom_1_geom_idx;


  INSERT INTO cde.hexes_zoom_0 (geom)  SELECT geom from ST_HexagonGrid(
          100000,
          st_setsrid(ST_EstimatedExtent('cde','points', 'geom'),3857)
      ); 


  INSERT INTO cde.hexes_zoom_1 (geom) SELECT geom from ST_HexagonGrid(
          10000,
          st_setsrid(ST_EstimatedExtent('cde','points', 'geom'),3857)
      ); 
    
     CREATE INDEX hexes_zoom_0_geom_idx
    ON cde.hexes_zoom_0
    USING GIST (geom);
    
  CREATE INDEX hexes_zoom_1_geom_idx
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
  select p.pk,hexes.geom, hexes.pk hex_pk from cde.hexes_zoom_0 AS hexes
      inner JOIN cde.points p
      ON ST_Intersects(p.geom, hexes.geom)
      )
  UPDATE cde.points p
  SET hex_zoom_0 = z.geom, hex_0_pk=z.hex_pk
  FROM zoom AS z
  WHERE z.pk = p.pk  AND hex_zoom_0 is null;

  with zoom as ( 
  select p.pk,hexes.geom,hexes.pk hex_pk from cde.hexes_zoom_1 as hexes
      
      inner JOIN cde.points p
      ON ST_Intersects(p.geom, hexes.geom)
      )
  UPDATE cde.points p
  SET hex_zoom_1 = z.geom, hex_1_pk=z.hex_pk
  FROM zoom AS z
  WHERE z.pk = p.pk  AND hex_zoom_1 is null;     

  -- update the profiles table, this is denormalized for speed
  UPDATE cde.profiles
  SET hex_zoom_0=points.hex_zoom_0, hex_zoom_1=points.hex_zoom_1, hex_0_pk=points.hex_0_pk, hex_1_pk=points.hex_1_pk
  FROM cde.points
  WHERE profiles.point_pk=points.pk;


  END;
$$ LANGUAGE plpgsql;
