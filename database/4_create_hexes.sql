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
    ST_SetSRID(ST_EstimatedExtent('cde', 'points', 'geom'), 3857)
  ) hexes
  WHERE ST_Intersects(points.geom, hexes.geom);

  -- this takes a few mins
  UPDATE cde.points
  SET hex_zoom_1 = hexes.geom
  FROM ST_HexagonGrid(
    10000,
    ST_SetSRID(ST_EstimatedExtent('cde', 'points', 'geom'), 3857)
  ) hexes
  WHERE ST_Intersects(points.geom, hexes.geom);

  INSERT INTO cde.hexes_zoom_0 (geom) SELECT DISTINCT hex_zoom_0 FROM cde.points;
  INSERT INTO cde.hexes_zoom_1 (geom) SELECT DISTINCT hex_zoom_1 FROM cde.points;

  UPDATE cde.points
  SET hex_0_pk = hexes_zoom_0.pk
  FROM cde.hexes_zoom_0
  WHERE hexes_zoom_0.geom = points.hex_zoom_0;

  UPDATE cde.points
  SET hex_1_pk = hexes_zoom_1.pk
  FROM cde.hexes_zoom_1
  WHERE hexes_zoom_1.geom = points.hex_zoom_1;

  -- Only the FK is propagated to profiles/obis_cells. Tile/legend queries
  -- JOIN cde.hexes_zoom_0/1 to fetch the polygon when needed.
  UPDATE cde.profiles
  SET hex_0_pk = points.hex_0_pk,
      hex_1_pk = points.hex_1_pk
  FROM cde.points
  WHERE points.pk = profiles.point_pk;

  UPDATE cde.obis_cells
  SET hex_0_pk = points.hex_0_pk,
      hex_1_pk = points.hex_1_pk
  FROM cde.points
  WHERE points.pk = obis_cells.point_pk;

  -- trajectory_cells: link point_pk AND hex FKs in a single pass, joining by
  -- geom rather than a pre-set point_pk. profiles/obis link point_pk in their
  -- own process functions; trajectory_cells is by far the largest cells table,
  -- so folding the two rewrites into one halves its post-load write
  -- amplification (see trajectory_process() in 5_profile_process.sql).
  UPDATE cde.trajectory_cells
  SET point_pk = points.pk,
      hex_0_pk = points.hex_0_pk,
      hex_1_pk = points.hex_1_pk
  FROM cde.points
  WHERE points.geom = trajectory_cells.geom;

  END;
$$ LANGUAGE plpgsql;
