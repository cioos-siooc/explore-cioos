/* 
 
   create_hexes()
   
   Create tables to store the hex polygons. Once they are joined with cde.points
   the polygons are copied over to that table 
 
 */


CREATE OR REPLACE FUNCTION create_hexes() RETURNS VOID AS $$
  BEGIN

  DELETE FROM cde.hexes_zoom_0; 
  DELETE FROM cde.hexes_zoom_1;

  UPDATE cde.points
  SET hex_zoom_0 = hexes.geom
  FROM ST_HexagonGrid(
        100000,
        st_setsrid(ST_EstimatedExtent('cde','points', 'geom'),3857)
    ) hexes
  WHERE ST_Intersects(points.geom, hexes.geom);

  -- this takes a few mins
  UPDATE cde.points
  SET hex_zoom_1 = hexes.geom
  FROM ST_HexagonGrid(
        10000,
        st_setsrid(ST_EstimatedExtent('cde','points', 'geom'),3857)
    ) hexes
  WHERE ST_Intersects(points.geom, hexes.geom);

  INSERT INTO cde.hexes_zoom_0 (geom) select distinct hex_zoom_0 from cde.points;
  INSERT INTO cde.hexes_zoom_1 (geom) select distinct hex_zoom_1 from cde.points;

  UPDATE cde.points
  SET hex_0_pk = hexes_zoom_0.pk
  FROM cde.hexes_zoom_0
  WHERE hexes_zoom_0.geom = points.hex_zoom_0;

  UPDATE cde.points
  SET hex_1_pk = hexes_zoom_1.pk
  FROM cde.hexes_zoom_1
  WHERE hexes_zoom_1.geom = points.hex_zoom_1;

  UPDATE cde.profiles
  SET hex_0_pk = points.hex_0_pk, hex_1_pk = points.hex_1_pk, hex_zoom_0=points.hex_zoom_0, hex_zoom_1=points.hex_zoom_1
  FROM cde.points
  WHERE points.pk = profiles.point_pk;

  END;
$$ LANGUAGE plpgsql;
