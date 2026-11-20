/*

   hex_cell()               - covering H3 cell for a point, pure function
   hex_geom()               - an H3 cell's polygon in EPSG:3857
   create_hexes()           - assign hex cells to points and propagate the FKs
   trajectory_gap_secs()    - per-trajectory "no data past here" threshold
   trajectory_segments()    - consecutive-fix track segments worth trusting
   trajectory_build_hexes() - sweep those segments through the hex grid into
                              cde.trajectory_hexes

   The hex grid is H3, which is (near) equal-area: a cell covers the same
   ground everywhere, so it looks larger toward the poles on the Mercator map.
   A point's cell is a pure function of its position and never moves between
   runs. hexes_zoom_0 (res 3, ~12,400 km2) / hexes_zoom_1 (res 6, ~36 km2) are
   append-only, keyed on h3: cells are inserted and NEVER deleted or
   renumbered, so hex pks are stable across loads. Cells that lose their last
   row are harmless leftovers (queries reach hexes only via FKs) and can be
   GC'd out of band.

   The resolutions must match web-api/utils/hexTiers.js, and res 6 must match
   the OBIS harvester's binning (OBIS_H3_RES), so an OBIS cell is exactly one
   fine hex.

 */


CREATE OR REPLACE FUNCTION hex_cell(pt geometry, res integer)
RETURNS h3index AS $$
  SELECT h3_latlng_to_cell(ST_Transform(pt, 4326), res)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;


-- Clipped to Web Mercator's latitude limit: a polar cell's boundary reaches
-- the pole, which transforms to infinity. A cell crossing the antimeridian
-- comes back split in two, hence ST_Multi.
CREATE OR REPLACE FUNCTION hex_geom(cell h3index)
RETURNS geometry AS $$
  SELECT ST_Multi(ST_Transform(
           ST_Intersection(h3_cell_to_boundary_geometry(cell),
                           ST_MakeEnvelope(-180, -85.0511287798, 180, 85.0511287798, 4326)),
           3857))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;


CREATE OR REPLACE FUNCTION create_hexes() RETURNS VOID AS $$
  BEGIN

  -- Add newly-occupied cells; existing cells (and their pks) are untouched.
  INSERT INTO cde.hexes_zoom_0 (h3, geom)
  SELECT c, hex_geom(c)
  FROM (SELECT DISTINCT hex_cell(p.geom, 3) AS c
        FROM cde.points p WHERE p.hex_0_pk IS NULL) cells
  ON CONFLICT (h3) DO NOTHING;

  INSERT INTO cde.hexes_zoom_1 (h3, geom)
  SELECT c, hex_geom(c)
  FROM (SELECT DISTINCT hex_cell(p.geom, 6) AS c
        FROM cde.points p WHERE p.hex_1_pk IS NULL) cells
  ON CONFLICT (h3) DO NOTHING;

  -- Assign cells to the points that don't have one yet — only points added
  -- by this load (cde.points is append-only with stable pks, so existing
  -- assignments never change).
  UPDATE cde.points p
  SET hex_0_pk = hz.pk
  FROM cde.hexes_zoom_0 hz
  WHERE p.hex_0_pk IS NULL
    AND hz.h3 = hex_cell(p.geom, 3);

  UPDATE cde.points p
  SET hex_1_pk = hz.pk
  FROM cde.hexes_zoom_1 hz
  WHERE p.hex_1_pk IS NULL
    AND hz.h3 = hex_cell(p.geom, 6);

  -- Only rows without an FK yet: point and hex pks are stable, so rows linked
  -- by a previous run are already correct.
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

  -- Trajectory coverage does NOT come through cde.points: trajectory_build_hexes()
  -- sweeps it from the track so a fast platform's coverage stays continuous.

  END;
$$ LANGUAGE plpgsql;


/* ------------------------------------------------------------------------
   Trajectory coverage hexes, swept from the track itself.

   Consecutive fixes in cde.trajectory_points define segments intersected with
   the hex grid, so EVERY hex the platform crossed lights up. Entry/exit times
   assume constant speed between fixes, which makes a distinct-day count per
   hex possible. Attributes come from cde.trajectory_days, joined by day and
   apportioned by time spent in each hex.
   ------------------------------------------------------------------------ */


-- Per-trajectory time-gap threshold: 4x the MEDIAN inter-fix gap (robust to
-- idle periods; the mean fallback covers rows written before median_gap_secs
-- existed), floored at 48 hours. Beyond it the path is unknown: no line, no
-- hex. Also called by /tiles/tracks so map lines and coverage hexes agree.
CREATE OR REPLACE FUNCTION trajectory_gap_secs(
  median_gap_secs float8, time_min timestamptz, time_max timestamptz, n_points bigint
) RETURNS float8 AS $$
  SELECT GREATEST(
           COALESCE(
             median_gap_secs,
             extract(epoch FROM time_max - time_min) / GREATEST(n_points - 1, 1)
           ) * 4,
           172800
         );
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;


-- Consecutive-fix segments of every track, minus the ones whose path is
-- unknown. The three break conditions are the ones /tiles/tracks uses:
--   1. antimeridian: fixes more than 180 deg of longitude apart (in EPSG:3857
--      such a segment would sweep a band of hexes across the whole world);
--   2. time gap beyond the trajectory's cadence (trajectory_gap_secs);
--   3. outage chord: >50 km between fixes closer than 96 h in time. The
--      harvester densifies data-backed chords to <=25 km, so a long chord on a
--      short gap means a reporting outage on a fast platform. The 96 h guard
--      keeps slow reporters (an Argo float drifts 30-100 km per 10-day cycle)
--      out of it; their real gaps are condition 2's job.
-- Zero-length segments (a platform holding position) are kept: they carry the
-- time the platform spent there, which is exactly what the day count needs.
CREATE OR REPLACE FUNCTION trajectory_segments(p_dataset_pks integer[] DEFAULT NULL)
RETURNS TABLE (
  dataset_pk integer, trajectory_id text,
  t1 timestamptz, t2 timestamptz, seg geometry
) AS $$
  WITH pts AS (
    SELECT p.dataset_pk, p.trajectory_id, p.time, p.geom, p.longitude, p.latitude,
           trajectory_gap_secs(s.median_gap_secs, s.time_min, s.time_max, s.n_points)
             AS gap_secs
      FROM cde.trajectory_points p
      JOIN cde.trajectory_track_stats s
        ON s.dataset_pk = p.dataset_pk AND s.trajectory_id = p.trajectory_id
     WHERE p.dataset_pk IS NOT NULL
       AND (p_dataset_pks IS NULL OR p.dataset_pk = ANY (p_dataset_pks))
  ),
  paired AS (
    SELECT *,
           lead(time)      OVER w AS next_time,
           lead(geom)      OVER w AS next_geom,
           lead(longitude) OVER w AS next_lon,
           lead(latitude)  OVER w AS next_lat
      FROM pts
    WINDOW w AS (PARTITION BY dataset_pk, trajectory_id ORDER BY time)
  )
  SELECT dataset_pk, trajectory_id, time, next_time, ST_MakeLine(geom, next_geom)
    FROM paired
   WHERE next_time IS NOT NULL
     AND abs(next_lon - longitude) <= 180
     AND extract(epoch FROM next_time - time) <= gap_secs
     AND NOT (
           ST_DistanceSphere(ST_MakePoint(longitude, latitude),
                             ST_MakePoint(next_lon, next_lat)) > 50000
           AND extract(epoch FROM next_time - time) < 345600
         );
$$ LANGUAGE sql STABLE PARALLEL SAFE;


-- Rebuild cde.trajectory_hexes. Scoped to p_dataset_pks (the datasets an
-- incremental load touched); NULL rebuilds everything.
--
-- Pure DML on the shared tables — no ALTER/TRUNCATE/DROP INDEX — so it can run
-- against a live web-api without deadlocking readers.
CREATE OR REPLACE FUNCTION trajectory_build_hexes(p_dataset_pks integer[] DEFAULT NULL)
RETURNS bigint AS $$
DECLARE n bigint;
BEGIN

  -- 1. Every (trajectory, tier, hex) occupancy interval.
  DROP TABLE IF EXISTS _traj_hex_span;
  CREATE TEMP TABLE _traj_hex_span ON COMMIT DROP AS
  WITH tiers AS (
    -- edge_m: the resolution's average edge length, for sampling segments.
    SELECT * FROM (VALUES (0::smallint, 3, 68980::float8),
                          (1::smallint, 6,  3725::float8)) t(tier, res, edge_m)
  ),
  seg AS (
    SELECT * FROM trajectory_segments(p_dataset_pks)
  ),
  -- moving: the segment crosses one or more hexes; the fraction of the segment
  -- inside each hex gives the entry/exit times.
  moving AS (
    SELECT s.dataset_pk, s.trajectory_id, t.tier, h.cell,
           s.t1 + (s.t2 - s.t1) * LEAST(f.f1, f.f2)    AS t_enter,
           s.t1 + (s.t2 - s.t1) * GREATEST(f.f1, f.f2) AS t_exit
      FROM seg s
      CROSS JOIN tiers t
      -- Candidate cells: those of points sampled along the segment, plus their
      -- neighbours, which catch a cell the segment only clips at a corner. A
      -- Mercator metre is never longer than a ground metre, so sampling at
      -- half an edge in EPSG:3857 is at least that dense on the ground.
      CROSS JOIN LATERAL (
        SELECT DISTINCT d.cell, hex_geom(d.cell) AS geom
          FROM ST_DumpPoints(ST_Segmentize(s.seg, t.edge_m / 2)) dp
          CROSS JOIN LATERAL h3_grid_disk(hex_cell(dp.geom, t.res), 1) d(cell)
      ) h
      CROSS JOIN LATERAL (SELECT ST_Intersection(s.seg, h.geom) AS part) x
      CROSS JOIN LATERAL (
        -- A hexagon is convex, so a line's intersection with it is a single
        -- LineString; a segment merely touching a vertex yields a Point and is
        -- filtered out below (the neighbouring hex it actually crossed keeps it).
        SELECT ST_LineLocatePoint(s.seg, ST_StartPoint(x.part)) AS f1,
               ST_LineLocatePoint(s.seg, ST_EndPoint(x.part))   AS f2
      ) f
     WHERE ST_Length(s.seg) > 0
       AND ST_Intersects(s.seg, h.geom)
       AND ST_GeometryType(x.part) = 'ST_LineString'
  ),
  -- still: consecutive fixes at the same position (a vessel alongside, a
  -- beached drifter). One hex, the whole interval — dropping these would lose
  -- every day between the two fixes.
  still AS (
    SELECT s.dataset_pk, s.trajectory_id, t.tier,
           hex_cell(ST_StartPoint(s.seg), t.res), s.t1, s.t2
      FROM seg s
      CROSS JOIN tiers t
     WHERE ST_Length(s.seg) = 0
  ),
  -- fixes: every retained fix as an instantaneous occupancy, so a single-fix
  -- trajectory and the far side of a dropped segment still light their hex.
  fixes AS (
    SELECT p.dataset_pk, p.trajectory_id, t.tier, hex_cell(p.geom, t.res),
           p.time, p.time
      FROM cde.trajectory_points p
      CROSS JOIN tiers t
     WHERE p.dataset_pk IS NOT NULL
       AND (p_dataset_pks IS NULL OR p.dataset_pk = ANY (p_dataset_pks))
  )
  SELECT * FROM moving
  UNION ALL SELECT * FROM still
  UNION ALL SELECT * FROM fixes;

  -- 2. Split each interval by UTC day, and record how long the platform was in
  --    the hex on that day (the weight used to apportion the day's records).
  DROP TABLE IF EXISTS _traj_hex_day;
  CREATE TEMP TABLE _traj_hex_day ON COMMIT DROP AS
  SELECT dataset_pk, trajectory_id, tier, cell, day,
         min(d_start) AS time_min,
         max(d_end)   AS time_max,
         sum(extract(epoch FROM d_end - d_start)) AS secs
    FROM (
      SELECT sp.dataset_pk, sp.trajectory_id, sp.tier, sp.cell,
             g.day::date AS day,
             GREATEST(sp.t_enter, g.day)                     AS d_start,
             LEAST(sp.t_exit, g.day + interval '1 day')      AS d_end
        FROM _traj_hex_span sp
        CROSS JOIN LATERAL generate_series(date_trunc('day', sp.t_enter),
                                           date_trunc('day', sp.t_exit),
                                           interval '1 day') g(day)
    ) split
   GROUP BY 1,2,3,4,5;

  -- 3. Make sure every occupied cell exists in the hex tables. Append-only and
  --    keyed on h3 — an existing cell keeps its pk (see the header).
  INSERT INTO cde.hexes_zoom_0 (h3, geom)
  SELECT cell, hex_geom(cell)
    FROM (SELECT DISTINCT cell FROM _traj_hex_day WHERE tier = 0) c
  ON CONFLICT (h3) DO NOTHING;

  INSERT INTO cde.hexes_zoom_1 (h3, geom)
  SELECT cell, hex_geom(cell)
    FROM (SELECT DISTINCT cell FROM _traj_hex_day WHERE tier = 1) c
  ON CONFLICT (h3) DO NOTHING;

  -- 4. Aggregate to one row per (dataset, trajectory, tier, hex), joining the
  --    per-day ERDDAP aggregates. `share` splits a day's records across the
  --    hexes visited that day by time spent in each. The +1 second gives
  --    instantaneous occupancy a non-zero weight and keeps the denominator
  --    non-zero.
  DROP TABLE IF EXISTS _traj_hex_agg;
  CREATE TEMP TABLE _traj_hex_agg ON COMMIT DROP AS
  WITH weighted AS (
    SELECT hd.*,
           (hd.secs + 1) / sum(hd.secs + 1) OVER w AS share
      FROM _traj_hex_day hd
    WINDOW w AS (PARTITION BY hd.dataset_pk, hd.trajectory_id, hd.tier, hd.day)
  ), agg AS (
    SELECT w.dataset_pk, w.trajectory_id, w.tier, w.cell,
           count(DISTINCT w.day)::integer         AS days,
           min(w.time_min)                        AS time_min,
           max(w.time_max)                        AS time_max,
           min(d.depth_min)                       AS depth_min,
           max(d.depth_max)                       AS depth_max,
           round(sum(coalesce(d.n_records, 0) * w.share))::bigint  AS n_records,
           round(sum(coalesce(d.n_profiles, 0) * w.share))::bigint AS n_profiles
      FROM weighted w
      LEFT JOIN cde.trajectory_days d
             ON d.dataset_pk = w.dataset_pk
            AND d.trajectory_id = w.trajectory_id
            AND d.day = w.day
     GROUP BY 1,2,3,4
  ), runs AS (
    -- The same day set as `days`, as maximal runs of consecutive UTC days so
    -- the map can union day sets across features (day_union_days).
    -- `day - row_number()` is constant within a run of consecutive days.
    SELECT dataset_pk, trajectory_id, tier, cell,
           array_agg(daterange(lo, hi + 1) ORDER BY lo) AS day_ranges
      FROM (
        SELECT dataset_pk, trajectory_id, tier, cell,
               min(day) AS lo, max(day) AS hi
          FROM (
            SELECT dataset_pk, trajectory_id, tier, cell, day,
                   day - (row_number() OVER (PARTITION BY dataset_pk,
                                                          trajectory_id,
                                                          tier, cell
                                                 ORDER BY day))::integer AS run
              FROM _traj_hex_day
          ) numbered
         GROUP BY 1,2,3,4, run
      ) r
     GROUP BY 1,2,3,4
  )
  SELECT agg.*, runs.day_ranges
    FROM agg
    JOIN runs USING (dataset_pk, trajectory_id, tier, cell);

  -- 5. Swap in the new rows for the scoped datasets. DELETE+INSERT (not
  --    TRUNCATE): TRUNCATE takes ACCESS EXCLUSIVE and deadlocks with live
  --    readers.
  DELETE FROM cde.trajectory_hexes
   WHERE p_dataset_pks IS NULL OR dataset_pk = ANY (p_dataset_pks);

  -- The display point is a property of the HEX, not of the row (many
  -- trajectories sweep the same cell), so resolve it once per distinct cell.
  -- The H3 cell centre, not the polygon centroid: an antimeridian cell's two
  -- halves would put its centroid on the far side of the world.
  WITH used_cells AS (
    SELECT DISTINCT tier, cell, h3_cell_to_geometry(cell) AS centre
      FROM _traj_hex_agg
  ),
  hex_pos AS (
    SELECT u.tier, u.cell, h.pk, ST_Y(u.centre) AS latitude,
           ST_X(u.centre) AS longitude
      FROM used_cells u
      JOIN cde.hexes_zoom_0 h ON u.tier = 0 AND h.h3 = u.cell
    UNION ALL
    SELECT u.tier, u.cell, h.pk, ST_Y(u.centre), ST_X(u.centre)
      FROM used_cells u
      JOIN cde.hexes_zoom_1 h ON u.tier = 1 AND h.h3 = u.cell
  )
  INSERT INTO cde.trajectory_hexes
        (dataset_pk, trajectory_id, hex_tier, hex_pk, latitude, longitude,
         time_min, time_max, depth_min, depth_max, days, day_ranges,
         n_records, n_profiles, records_per_day)
  SELECT a.dataset_pk, a.trajectory_id, a.tier, p.pk, p.latitude, p.longitude,
         a.time_min, a.time_max, a.depth_min, a.depth_max, a.days, a.day_ranges,
         a.n_records, a.n_profiles,
         a.n_records::float / GREATEST(a.days, 1)
    FROM _traj_hex_agg a
    JOIN hex_pos p USING (tier, cell);

  GET DIAGNOSTICS n = ROW_COUNT;

  DROP TABLE IF EXISTS _traj_hex_span;
  DROP TABLE IF EXISTS _traj_hex_day;
  DROP TABLE IF EXISTS _traj_hex_agg;

  RETURN n;
END;
$$ LANGUAGE plpgsql;
