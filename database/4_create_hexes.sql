/*

   hex_cell()               - covering hex-grid cell (i, j, geom) for a point,
                              pure function
   create_hexes()           - assign hex cells to points and propagate the FKs
   trajectory_gap_secs()    - per-trajectory "no data past here" threshold
   trajectory_segments()    - consecutive-fix track segments worth trusting
   trajectory_build_hexes() - sweep those segments through the hex grid into
                              cde.trajectory_hexes

   The hex grid is PostGIS's origin-anchored hexagon tiling
   (ST_HexagonGrid / ST_Hexagon): cell (i, j) at a given size sits at a fixed
   position in the plane regardless of any bounds argument. A point's cell is
   therefore a pure function of its geometry, and cells never move between
   runs. hexes_zoom_0 (100 km) / hexes_zoom_1 (10 km) are append-only, keyed
   on (i, j): create_hexes() and trajectory_build_hexes() insert
   newly-occupied cells and NEVER delete or renumber, so hex pks are stable
   across loads. Cells that lose their last row are harmless leftovers
   (tile/legend queries reach hexes only via the FKs on profiles/obis_cells
   and via trajectory_hexes.hex_pk) and can be GC'd out of band.

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

  -- NOTE: trajectory coverage does NOT come through cde.points. Its hexes are
  -- swept from the track itself by trajectory_build_hexes() below, which is
  -- what keeps a fast platform's coverage continuous instead of lighting only
  -- the hexes that happen to contain a sampled position.

  END;
$$ LANGUAGE plpgsql;


/* ------------------------------------------------------------------------
   Trajectory coverage hexes, swept from the track itself.

   cde.trajectory_points holds the ordered (decimated) fixes of every
   trajectory. Consecutive fixes define a segment; the segment is intersected
   with the hex grid, so EVERY hex the platform crossed lights up — not just
   the ones that happen to contain a sampled position. Entry/exit times come
   from the fraction of the segment inside each hex (constant speed between
   fixes), which is what makes a distinct-day count per hex possible.

   Attributes (records, depth, profiles) come from cde.trajectory_days, the
   per-(trajectory, UTC day) aggregates the harvester fetches from ERDDAP,
   joined to the hexes by day and apportioned by time spent in each hex.
   ------------------------------------------------------------------------ */


-- Per-trajectory time-gap threshold: 4x the trajectory's MEDIAN inter-fix gap
-- (its typical reporting cadence, robust to idle periods; the mean fallback
-- covers rows written before median_gap_secs existed), floored at 48 hours.
-- Beyond it there is no data, so the path is unknown: no line is drawn and no
-- hex is claimed. Shared with the /tiles/tracks line assembly in
-- web-api/routes/tiles.js, which calls this function — the map lines and the
-- coverage hexes must agree on what counts as a data-backed path.
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
-- against a live web-api without deadlocking readers (see the standing rule in
-- docs/incremental-update-v2-plan.md). The temp tables it creates are private
-- to the session.
CREATE OR REPLACE FUNCTION trajectory_build_hexes(p_dataset_pks integer[] DEFAULT NULL)
RETURNS bigint AS $$
DECLARE n bigint;
BEGIN

  -- 1. Every (trajectory, tier, hex) occupancy interval.
  DROP TABLE IF EXISTS _traj_hex_span;
  CREATE TEMP TABLE _traj_hex_span ON COMMIT DROP AS
  WITH tiers AS (
    SELECT * FROM (VALUES (0::smallint, 100000::float8),
                          (1::smallint,  10000::float8)) t(tier, size)
  ),
  seg AS (
    SELECT * FROM trajectory_segments(p_dataset_pks)
  ),
  -- moving: the segment crosses one or more hexes; the fraction of the segment
  -- inside each hex gives the entry/exit times.
  moving AS (
    SELECT s.dataset_pk, s.trajectory_id, t.tier, h.i, h.j,
           s.t1 + (s.t2 - s.t1) * LEAST(f.f1, f.f2)    AS t_enter,
           s.t1 + (s.t2 - s.t1) * GREATEST(f.f1, f.f2) AS t_exit
      FROM seg s
      CROSS JOIN tiers t
      CROSS JOIN LATERAL ST_HexagonGrid(t.size, s.seg) h
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
    SELECT s.dataset_pk, s.trajectory_id, t.tier, h.i, h.j, s.t1, s.t2
      FROM seg s
      CROSS JOIN tiers t
      CROSS JOIN LATERAL hex_cell(ST_StartPoint(s.seg), t.size) h
     WHERE ST_Length(s.seg) = 0
  ),
  -- fixes: every retained fix as an instantaneous occupancy, so a single-fix
  -- trajectory and the far side of a dropped segment still light their hex.
  fixes AS (
    SELECT p.dataset_pk, p.trajectory_id, t.tier, h.i, h.j, p.time, p.time
      FROM cde.trajectory_points p
      CROSS JOIN tiers t
      CROSS JOIN LATERAL hex_cell(p.geom, t.size) h
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
  SELECT dataset_pk, trajectory_id, tier, i, j, day,
         min(d_start) AS time_min,
         max(d_end)   AS time_max,
         sum(extract(epoch FROM d_end - d_start)) AS secs
    FROM (
      SELECT sp.dataset_pk, sp.trajectory_id, sp.tier, sp.i, sp.j,
             g.day::date AS day,
             GREATEST(sp.t_enter, g.day)                     AS d_start,
             LEAST(sp.t_exit, g.day + interval '1 day')      AS d_end
        FROM _traj_hex_span sp
        CROSS JOIN LATERAL generate_series(date_trunc('day', sp.t_enter),
                                           date_trunc('day', sp.t_exit),
                                           interval '1 day') g(day)
    ) split
   GROUP BY 1,2,3,4,5,6;

  -- 3. Make sure every occupied cell exists in the hex tables. Append-only and
  --    keyed on (i, j) — an existing cell keeps its pk (see the header).
  INSERT INTO cde.hexes_zoom_0 (i, j, geom)
  SELECT DISTINCT i, j, ST_SetSRID(ST_Hexagon(100000, i, j), 3857)
    FROM _traj_hex_day WHERE tier = 0
  ON CONFLICT (i, j) DO NOTHING;

  INSERT INTO cde.hexes_zoom_1 (i, j, geom)
  SELECT DISTINCT i, j, ST_SetSRID(ST_Hexagon(10000, i, j), 3857)
    FROM _traj_hex_day WHERE tier = 1
  ON CONFLICT (i, j) DO NOTHING;

  -- 4. Aggregate to one row per (dataset, trajectory, tier, hex), joining the
  --    per-day ERDDAP aggregates. `share` splits a day's records across the
  --    hexes visited that day by time spent in each. The +1 second is what
  --    makes instantaneous occupancy (a single-fix trajectory, or a hex the
  --    track only touched at one fix) weigh something instead of zero, and it
  --    keeps the denominator non-zero without a special case; against a real
  --    day's tens of thousands of seconds it is noise.
  DROP TABLE IF EXISTS _traj_hex_agg;
  CREATE TEMP TABLE _traj_hex_agg ON COMMIT DROP AS
  WITH weighted AS (
    SELECT hd.*,
           (hd.secs + 1) / sum(hd.secs + 1) OVER w AS share
      FROM _traj_hex_day hd
    WINDOW w AS (PARTITION BY hd.dataset_pk, hd.trajectory_id, hd.tier, hd.day)
  )
  SELECT w.dataset_pk, w.trajectory_id, w.tier, w.i, w.j,
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
   GROUP BY 1,2,3,4,5;

  -- 5. Swap in the new rows for the scoped datasets. DELETE+INSERT (not
  --    TRUNCATE): TRUNCATE takes ACCESS EXCLUSIVE and deadlocks with live
  --    readers.
  DELETE FROM cde.trajectory_hexes
   WHERE p_dataset_pks IS NULL OR dataset_pk = ANY (p_dataset_pks);

  INSERT INTO cde.trajectory_hexes
        (dataset_pk, trajectory_id, hex_tier, hex_pk, latitude, longitude,
         time_min, time_max, depth_min, depth_max, days, n_records, n_profiles,
         records_per_day)
  SELECT a.dataset_pk, a.trajectory_id, a.tier, h.pk,
         ST_Y(ST_Transform(ST_Centroid(h.geom), 4326)),
         ST_X(ST_Transform(ST_Centroid(h.geom), 4326)),
         a.time_min, a.time_max, a.depth_min, a.depth_max, a.days,
         a.n_records, a.n_profiles,
         a.n_records::float / GREATEST(a.days, 1)
    FROM _traj_hex_agg a
    JOIN cde.hexes_zoom_0 h ON a.tier = 0 AND h.i = a.i AND h.j = a.j
  UNION ALL
  SELECT a.dataset_pk, a.trajectory_id, a.tier, h.pk,
         ST_Y(ST_Transform(ST_Centroid(h.geom), 4326)),
         ST_X(ST_Transform(ST_Centroid(h.geom), 4326)),
         a.time_min, a.time_max, a.depth_min, a.depth_max, a.days,
         a.n_records, a.n_profiles,
         a.n_records::float / GREATEST(a.days, 1)
    FROM _traj_hex_agg a
    JOIN cde.hexes_zoom_1 h ON a.tier = 1 AND h.i = a.i AND h.j = a.j;

  GET DIAGNOSTICS n = ROW_COUNT;

  DROP TABLE IF EXISTS _traj_hex_span;
  DROP TABLE IF EXISTS _traj_hex_day;
  DROP TABLE IF EXISTS _traj_hex_agg;

  RETURN n;
END;
$$ LANGUAGE plpgsql;
