require("dotenv").config();
const express = require("express");

const router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const cache = require("../utils/cache");
/**
 * /tiles/z/x/y/.mvt
 *
 * Tile generator - returns the hex shapes or points with some data attached
 * Takes all the filters
 */

/**
 * @swagger
 * /tiles/{z}/{x}/{y}.mvt:
 *   get:
 *     summary: Retrieve a vector tile of map data
 *     tags: [Tiles]
 *     description: Returns a Mapbox Vector Tile containing either hex bins or points with dataset aggregation.
 *     parameters:
 *       - in: path
 *         name: z
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: x
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: y
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: MVT binary tile.
 *         content:
 *           application/x-protobuf:
 *             schema:
 *               type: string
 *               format: binary
 */
/* GET /tiles/:z/:x/:y.mvt */
/* Retreive a vector tile by tileid */
router.get(
  "/:z/:x/:y.mvt",
  validatorMiddleware(),
  cache.route({ binary: true }),
  async (req, res) => {
    const { z, x, y } = req.params;

    let filters;
    try {
      filters = await createDBFilter(req.query);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }

    // zoom levels: 0-4,5-6,7+
    const isHexGrid = z < 7;
    const zoomPKColumn = z < 5 ? "hex_0_pk" : "hex_1_pk";
    const hexesTable = z < 5 ? "cde.hexes_zoom_0" : "cde.hexes_zoom_1";

    const includeObis = req.query.includeObis !== 'false';
    // Data-type layer toggle (map layer selector): an explicit
    // includeProfiles / includeTrajectory = 'false' hides that type. Defaults
    // to shown, so callers that omit the params get the pre-toggle behaviour.
    const profilesToggledOn = req.query.includeProfiles !== 'false';
    const trajectoryToggledOn = req.query.includeTrajectory !== 'false';
    // ERDDAP-sourced data (profiles + trajectory coverage) is hidden wholesale
    // when an OBIS-only filter is active: scientific-name filters are
    // OBIS-only, and an OBIS-node selection also hides it, unless ERDDAP
    // servers are selected alongside it (combined Source filter — show both,
    // OR'd in the shared dataset filter).
    const erddapVisible = !req.query.scientificNames
      && (!req.query.obisNodes || Boolean(req.query.erddapServers));
    const includeProfiles = profilesToggledOn && erddapVisible;
    const includeTrajectory = trajectoryToggledOn && erddapVisible;

    // At hex zoom we only need the hex FK and point_pk (for distinct counts);
    // the polygon is fetched once per hex via JOIN to hexes_zoom_*. At point
    // zoom we project the actual point geom.
    const profilesBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom, days as record_count,
           time_min, time_max, latitude, longitude, depth_min, depth_max
    FROM cde.profiles`;
    // Trajectory coverage cells merge into the combined hex counts (z<7,
    // the green ramp) but never appear as individual points (z>=7) — at
    // that zoom they're only shown via the dedicated always-hex purple
    // layer from /tiles/trajectories/:z/:x/:y.mvt.
    const trajectoryBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom, days as record_count,
           time_min, time_max, latitude, longitude, depth_min, depth_max
    FROM cde.trajectory_cells`;
    const obisBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom,
           date_part('days', time_max - time_min) + 1 as record_count,
           time_min, time_max, latitude, longitude, depth_min, depth_max
    FROM cde.obis_cells
    WHERE :obisFilters`;

    const branches = [];
    if (includeProfiles) branches.push(profilesBranch);
    // Trajectory coverage cells only join the combined hex counts at hex zoom;
    // at point zoom they're shown via the dedicated /tiles/trajectories layer.
    if (includeTrajectory && isHexGrid) branches.push(trajectoryBranch);
    if (includeObis) branches.push(obisBranch);
    // Guard: if nothing to show, return an empty CTE that still has the right columns
    const combinedInner = branches.length
      ? branches.join("\n    UNION ALL\n    ")
      : `${profilesBranch} WHERE FALSE`;

    const relevantPointsSQL = isHexGrid
      ? `SELECT p.zoom_pk pk, count(distinct p.point_pk) count,
                array_to_json(array_agg(distinct d.pk_url)) datasets,
                h.geom AS geom
         FROM combined p
         JOIN cde.datasets d ON p.dataset_pk = d.pk
         JOIN ${hexesTable} h ON h.pk = p.zoom_pk
         ${filters.hasShared ? "WHERE :filters" : ""}
         GROUP BY p.zoom_pk, h.geom`
      : `SELECT p.point_pk pk, d.platform as platform, sum(p.record_count)::bigint count,
                array_to_json(array_agg(distinct d.pk_url)) datasets,
                p.point_geom AS geom
         FROM combined p
         JOIN cde.datasets d ON p.dataset_pk = d.pk
         ${filters.hasShared ? "WHERE :filters" : ""}
         GROUP BY p.point_geom, p.point_pk, d.platform`;

    // Combine profiles and obis_cells so both appear on the map
    const SQL = `
  with combined as (
    ${combinedInner}
  ),
  relevent_points as (
    ${relevantPointsSQL}
  ),
    te AS (select ST_TileEnvelope(:z, :x, :y) tile_envelope ),
    mvtgeom AS (
      SELECT pk,count,
       ${isHexGrid ? "" : "platform,"} datasets,
        ST_AsMVTGeom (
          relevent_points.geom,
          tile_envelope
        ) AS geom
      FROM
        relevent_points, te
      WHERE relevent_points.geom && tile_envelope
    )
    SELECT ST_AsMVT(mvtgeom.*, 'internal-layer-name', 4096, 'geom') AS st_asmvt from mvtgeom;
  `;

    try {
      const q = db.raw(SQL, {
        filters: filters.shared,
        obisFilters: filters.obisOnly,
        zoomPKColumn,
        z,
        x,
        y,
      });

      const tileRaw = await q;
      const tile = tileRaw.rows[0];

      res.setHeader("Content-Type", "application/x-protobuf");
      res.status(200).send(tile.st_asmvt);
    } catch (e) {
      console.error(e);
      res.status(500).send({
        error: e.toString(),
      });
    }
  },
);

/**
 * @swagger
 * /tiles/trajectories/{z}/{x}/{y}.mvt:
 *   get:
 *     summary: Retrieve a vector tile of trajectory coverage hexes
 *     tags: [Tiles]
 *     description: >
 *       Returns a Mapbox Vector Tile of trajectory dataset coverage, always
 *       aggregated as hexagons (colored by distinct trajectory count) —
 *       unlike /tiles/{z}/{x}/{y}.mvt this never falls back to individual
 *       points at high zoom.
 *     parameters:
 *       - in: path
 *         name: z
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: x
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: y
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: MVT binary tile.
 *         content:
 *           application/x-protobuf:
 *             schema:
 *               type: string
 *               format: binary
 */
/* GET /tiles/trajectories/:z/:x/:y.mvt */
/* Trajectory coverage cells, always rendered as hexagons regardless of zoom */
router.get(
  "/trajectories/:z/:x/:y.mvt",
  validatorMiddleware(),
  cache.route({ binary: true }),
  async (req, res) => {
    const { z, x, y } = req.params;

    let filters;
    try {
      filters = await createDBFilter(req.query);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }

    // Only two hex grids exist (hex_0 for z<5, hex_1 for z>=5); hex_1 is
    // reused uncapped past zoom 6 so trajectories never become points.
    const zoomPKColumn = z < 5 ? "hex_0_pk" : "hex_1_pk";
    const hexesTable = z < 5 ? "cde.hexes_zoom_0" : "cde.hexes_zoom_1";

    const combinedInner = `SELECT point_pk, dataset_pk, trajectory_id, :zoomPKColumn: as zoom_pk,
           time_min, time_max, latitude, longitude, depth_min, depth_max
    FROM cde.trajectory_cells`;

    // The tile-envelope test is applied BEFORE the aggregation (hexes are
    // disjoint, so filtering hexes before or after grouping yields identical
    // tiles). This bounds each tile request to the cells under the visible
    // hexes — via the hex_0_pk/hex_1_pk indexes — instead of re-aggregating
    // the whole trajectory_cells table per tile. Grouping is by hex pk only,
    // with the polygon joined back afterwards, so the group sort runs over
    // narrow rows instead of spilling hex geometries to disk.
    const SQL = `
  with combined as (
    ${combinedInner}
  ),
    te AS (select ST_TileEnvelope(:z, :x, :y) tile_envelope ),
    tile_hexes AS (
      SELECT h.pk, h.geom
      FROM ${hexesTable} h, te
      WHERE h.geom && te.tile_envelope
    ),
    agg as (
      SELECT c.zoom_pk pk, count(distinct (c.dataset_pk, c.trajectory_id)) count,
             array_to_json(array_agg(distinct d.pk_url)) datasets
      FROM combined c
      JOIN cde.datasets d ON c.dataset_pk = d.pk
      JOIN tile_hexes th ON th.pk = c.zoom_pk
      ${filters.hasShared ? "WHERE :filters" : ""}
      GROUP BY c.zoom_pk
    ),
    mvtgeom AS (
      SELECT a.pk, a.count, a.datasets,
        ST_AsMVTGeom (
          th.geom,
          te.tile_envelope
        ) AS geom
      FROM agg a
      JOIN tile_hexes th ON th.pk = a.pk, te
    )
    SELECT ST_AsMVT(mvtgeom.*, 'trajectory-hexes-layer', 4096, 'geom') AS st_asmvt from mvtgeom;
  `;

    try {
      const q = db.raw(SQL, {
        filters: filters.shared,
        zoomPKColumn,
        z,
        x,
        y,
      });

      const tileRaw = await q;
      const tile = tileRaw.rows[0];

      res.setHeader("Content-Type", "application/x-protobuf");
      res.status(200).send(tile.st_asmvt);
    } catch (e) {
      console.error(e);
      res.status(500).send({
        error: e.toString(),
      });
    }
  },
);

/**
 * @swagger
 * /tiles/tracks/{z}/{x}/{y}.mvt:
 *   get:
 *     summary: Retrieve a vector tile of trajectory track lines and head positions
 *     tags: [Tiles]
 *     description: >
 *       Returns a Mapbox Vector Tile with TWO layers built from
 *       cde.trajectory_points: 'track-lines' (per-trajectory LineStrings over
 *       the requested time window, ordered by time) and 'track-heads' (each
 *       trajectory's latest fix within the window, with 'cog' — course over
 *       ground in degrees clockwise from north, absent when undefined).
 *       timeMin/timeMax are
 *       REQUIRED — the window is the scrub bar's trailing interval. Clients
 *       should snap the window to UTC day boundaries so the URL-keyed tile
 *       cache gets high hit rates across scrubs and users.
 *     parameters:
 *       - in: path
 *         name: z
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: x
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: y
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: timeMin
 *         required: true
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         required: true
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: MVT binary tile (layers track-lines + track-heads).
 *         content:
 *           application/x-protobuf:
 *             schema:
 *               type: string
 *               format: binary
 */
/* GET /tiles/tracks/:z/:x/:y.mvt */
/* Trajectory track lines + head positions from cde.trajectory_points */
router.get(
  "/tracks/:z/:x/:y.mvt",
  validatorMiddleware(),
  cache.route({ binary: true }),
  async (req, res) => {
    const { z, x, y } = req.params;
    const { timeMin, timeMax } = req.query;

    // The scrub window is the whole point of this layer; unbounded queries
    // would assemble every trajectory's full track on every tile.
    if (!timeMin || !timeMax) {
      return res
        .status(400)
        .json({ error: "timeMin and timeMax are required for track tiles" });
    }

    // Only dataset-level filters apply here. The shared filter's per-point
    // fragments (depth_min/max, lat/lon bounds, polygon-on-geom, pointPKs,
    // and its OWN time fragments which target time_min/time_max columns)
    // reference columns cde.trajectory_track_stats doesn't have — the time
    // window is bound explicitly below instead.
    const datasetLevelQuery = {};
    ["eovs", "platforms", "datasetPKs", "organizations", "obisNodes", "erddapServers"]
      .forEach((k) => { if (req.query[k]) datasetLevelQuery[k] = req.query[k]; });

    let filters;
    try {
      filters = await createDBFilter(datasetLevelQuery);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }

    // Correctness invariant: lines are assembled from the FULL time window
    // with no per-point spatial predicate — a segment can cross a tile that
    // neither of its endpoints is in. Spatial pruning happens only at
    // trajectory level, against the per-trajectory summary bbox (expanded by
    // 25% of the tile width so near-boundary tracks aren't missed), and
    // ST_AsMVTGeom does the actual clipping with its built-in buffer.
    const SQL = `
  WITH te AS (SELECT ST_TileEnvelope(:z, :x, :y) tile_envelope),
    cand AS (
      -- gap_secs: per-trajectory time-gap split threshold — 4x the
      -- trajectory's MEDIAN inter-fix gap (its typical reporting cadence,
      -- robust to idle periods; the mean fallback covers pre-migration NULL
      -- rows), floored at 48 hours. An Argo float's ~10-day cycles never
      -- split; a multi-expedition ship track (months dark between summers)
      -- or a monitoring vessel idle between short cruises always does,
      -- instead of drawing a connector chord across the map.
      SELECT s.dataset_pk, s.trajectory_id,
             GREATEST(
               COALESCE(
                 s.median_gap_secs,
                 extract(epoch FROM s.time_max - s.time_min)
                   / GREATEST(s.n_points - 1, 1)
               ) * 4,
               172800
             ) AS gap_secs
      FROM cde.trajectory_track_stats s
      JOIN cde.datasets d ON d.pk = s.dataset_pk, te
      WHERE s.bbox && ST_Expand(
              te.tile_envelope,
              (ST_XMax(te.tile_envelope) - ST_XMin(te.tile_envelope)) * 0.25
            )
        AND s.time_max >= :timeMin::timestamptz
        AND s.time_min <= :timeMax::timestamptz
        ${filters.hasShared ? "AND :filters" : ""}
    ),
    pts AS (
      SELECT p.dataset_pk, p.trajectory_id, p.time, p.longitude, p.latitude,
             p.geom, d.pk_url, d.title AS dataset_title, c.gap_secs
      FROM cde.trajectory_points p
      JOIN cand c ON c.dataset_pk = p.dataset_pk
                 AND c.trajectory_id = p.trajectory_id
      JOIN cde.datasets d ON d.pk = p.dataset_pk
      WHERE p.time >= :timeMin::timestamptz
        AND p.time <= :timeMax::timestamptz
    ),
    -- Split tracks into segments, three break conditions:
    --   1. antimeridian: consecutive fixes jumping >180 deg of longitude
    --      would draw a line looping around the globe;
    --   2. large time gap (> per-trajectory gap_secs): no data = unknown
    --      path — draw nothing rather than a chord through possibly-land;
    --   3. outage chord: >50km between fixes closer than 96h in time. The
    --      harvester densifies data-backed chords to <=25km
    --      (TRACK_MAX_CHORD_KM), so a long chord on a sub-96h gap means a
    --      reporting outage on a fast platform (a ferry dark for a day
    --      covers hundreds of km) — unknown path again. The 96h guard keeps
    --      genuinely slow reporters (an Argo float drifts ~30-100km per
    --      10-day cycle) from being shredded by condition 3; their real
    --      gaps are handled by condition 2's cadence-scaled threshold.
    segs AS (
      SELECT *, sum(brk) OVER (
        PARTITION BY dataset_pk, trajectory_id ORDER BY time
      ) AS seg
      FROM (
        SELECT *, (
          abs(longitude - lag(longitude) OVER w) > 180
          OR extract(epoch FROM time - lag(time) OVER w) > gap_secs
          OR (
            ST_DistanceSphere(
              ST_MakePoint(longitude, latitude),
              ST_MakePoint(lag(longitude) OVER w, lag(latitude) OVER w)
            ) > 50000
            AND extract(epoch FROM time - lag(time) OVER w) < 345600
          )
        )::int AS brk
        FROM pts
        WINDOW w AS (PARTITION BY dataset_pk, trajectory_id ORDER BY time)
      ) q
    ),
    lines AS (
      SELECT trajectory_id, pk_url, ST_MakeLine(geom ORDER BY time) AS geom
      FROM segs
      GROUP BY dataset_pk, trajectory_id, pk_url, seg
      HAVING count(*) >= 2
    ),
    heads AS (
      -- cog: course over ground at the head — spheroid azimuth (degrees
      -- clockwise from north) from the previous fix to the head fix. NULL
      -- when undefined: single-fix trajectories (lag is NULL) or a
      -- stationary platform (coincident fixes make ST_Azimuth NULL); the
      -- frontend renders those heads as circles instead of arrows.
      SELECT DISTINCT ON (dataset_pk, trajectory_id)
             trajectory_id, pk_url, dataset_title,
             (extract(epoch FROM time) * 1000)::bigint AS head_time,
             round(degrees(ST_Azimuth(
               ST_MakePoint(lag(longitude) OVER w, lag(latitude) OVER w)::geography,
               ST_MakePoint(longitude, latitude)::geography
             )))::int AS cog,
             geom
      FROM pts
      WINDOW w AS (PARTITION BY dataset_pk, trajectory_id ORDER BY time)
      ORDER BY dataset_pk, trajectory_id, time DESC
    ),
    line_mvt AS (
      SELECT l.trajectory_id, l.pk_url,
             ST_AsMVTGeom(l.geom, te.tile_envelope) AS geom
      FROM lines l, te
      WHERE l.geom && te.tile_envelope
    ),
    head_mvt AS (
      SELECT h.trajectory_id, h.pk_url, h.dataset_title, h.head_time, h.cog,
             ST_AsMVTGeom(h.geom, te.tile_envelope) AS geom
      FROM heads h, te
      WHERE h.geom && te.tile_envelope
    )
    -- A valid MVT is a concatenation of layer messages.
    SELECT coalesce((SELECT ST_AsMVT(l.*, 'track-lines', 4096, 'geom') FROM line_mvt l), ''::bytea)
        || coalesce((SELECT ST_AsMVT(h.*, 'track-heads', 4096, 'geom') FROM head_mvt h), ''::bytea)
        AS st_asmvt;
  `;

    try {
      const q = db.raw(SQL, {
        filters: filters.shared,
        timeMin,
        timeMax,
        z,
        x,
        y,
      });

      const tileRaw = await q;
      const tile = tileRaw.rows[0];

      res.setHeader("Content-Type", "application/x-protobuf");
      res.status(200).send(tile.st_asmvt);
    } catch (e) {
      console.error(e);
      res.status(500).send({
        error: e.toString(),
      });
    }
  },
);

module.exports = router;
