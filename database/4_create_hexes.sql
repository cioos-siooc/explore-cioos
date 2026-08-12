/*

   hex_cell()     - covering hex-grid cell (i, j, geom) for a point, pure function
   create_hexes() - assign hex cells to points and propagate the FKs

   The hex grid is PostGIS's origin-anchored hexagon tiling
   (ST_HexagonGrid / ST_Hexagon): cell (i, j) at a given size sits at a fixed
   position in the plane regardless of any bounds argument. A point's cell is
   therefore a pure function of its geometry, and cells never move between
   runs. hexes_zoom_0 (100 km) / hexes_zoom_1 (10 km) are append-only, keyed
   on (i, j): create_hexes() inserts newly-occupied cells and NEVER deletes or
   renumbers, so hex pks are stable across loads. Cells that lose their last
   point are harmless leftovers (tile/legend queries reach hexes only via the
   FKs on profiles/obis_cells/trajectory_cells) and can be GC'd out of band.

   This replaces the previous delete-and-retile-everything implementation,
   which re-tiled the whole data extent (from a moving ST_EstimatedExtent) and
   rewrote every row of points on every load.

 */


-- Covering grid cell for a point. ST_HexagonGrid with a degenerate (point)
-- bounds emits just the covering cell(s); a point exactly on a cell edge can
-- match several, so ORDER BY makes the choice deterministic across runs.
CREATE OR REPLACE FUNCTION hex_cell(pt geometry, size float8)
RETURNS TABLE (i integer, j integer, geom geometry) AS $$
  SELECT g.i::int, g.j::int, g.geom
  FROM ST_HexagonGrid(size, pt) g
  WHERE ST_Intersects(pt, g.geom)
  ORDER BY g.i, g.j
  LIMIT 1
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;


CREATE OR REPLACE FUNCTION create_hexes() RETURNS VOID AS $$
  BEGIN

  -- Add newly-occupied cells; existing cells (and their pks) are untouched.
  INSERT INTO cde.hexes_zoom_0 (i, j, geom)
  SELECT DISTINCT ON (h.i, h.j) h.i, h.j, h.geom
  FROM cde.points p
  CROSS JOIN LATERAL hex_cell(p.geom, 100000) h
  WHERE p.hex_0_pk IS NULL
  ON CONFLICT (i, j) DO NOTHING;

  INSERT INTO cde.hexes_zoom_1 (i, j, geom)
  SELECT DISTINCT ON (h.i, h.j) h.i, h.j, h.geom
  FROM cde.points p
  CROSS JOIN LATERAL hex_cell(p.geom, 10000) h
  WHERE p.hex_1_pk IS NULL
  ON CONFLICT (i, j) DO NOTHING;

  -- Assign cells to the points that don't have one yet — only points added
  -- by this load (cde.points is append-only with stable pks, so existing
  -- assignments never change).
  WITH assign AS (
    SELECT p.pk AS point_pk, hz.pk AS hex_pk
    FROM cde.points p
    CROSS JOIN LATERAL hex_cell(p.geom, 100000) h
    JOIN cde.hexes_zoom_0 hz ON hz.i = h.i AND hz.j = h.j
    WHERE p.hex_0_pk IS NULL
  )
  UPDATE cde.points p
  SET hex_0_pk = a.hex_pk
  FROM assign a
  WHERE p.pk = a.point_pk;

  WITH assign AS (
    SELECT p.pk AS point_pk, hz.pk AS hex_pk
    FROM cde.points p
    CROSS JOIN LATERAL hex_cell(p.geom, 10000) h
    JOIN cde.hexes_zoom_1 hz ON hz.i = h.i AND hz.j = h.j
    WHERE p.hex_1_pk IS NULL
  )
  UPDATE cde.points p
  SET hex_1_pk = a.hex_pk
  FROM assign a
  WHERE p.pk = a.point_pk;

  -- Only the FK is propagated to profiles/obis_cells, and only to rows that
  -- don't have it yet (rows this load inserted/replaced — point and hex pks
  -- are stable, so rows linked by a previous run are already correct).
  -- Tile/legend queries JOIN cde.hexes_zoom_0/1 to fetch the polygon when
  -- needed.
  UPDATE cde.profiles
  SET hex_0_pk = points.hex_0_pk,
      hex_1_pk = points.hex_1_pk
  FROM cde.points
  WHERE points.pk = profiles.point_pk
    AND (profiles.hex_0_pk IS NULL OR profiles.hex_1_pk IS NULL);

  UPDATE cde.obis_cells
  SET hex_0_pk = points.hex_0_pk,
      hex_1_pk = points.hex_1_pk
  FROM cde.points
  WHERE points.pk = obis_cells.point_pk
    AND (obis_cells.hex_0_pk IS NULL OR obis_cells.hex_1_pk IS NULL);

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
  WHERE points.geom = trajectory_cells.geom
    AND (trajectory_cells.point_pk IS NULL
         OR trajectory_cells.hex_0_pk IS NULL
         OR trajectory_cells.hex_1_pk IS NULL);

  END;
$$ LANGUAGE plpgsql;
