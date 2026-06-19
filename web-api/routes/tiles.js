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
    // Scientific-name and OBIS-node filters are OBIS-only: when either is
    // set, hide profiles and narrow to OBIS rows.
    const includeProfiles = !req.query.scientificNames && !req.query.obisNodes;
    // Trajectories are not OBIS, so they follow the same gate as profiles.
    const includeTrajectories = includeProfiles;

    // At hex zoom we only need the hex FK and point_pk (for distinct counts);
    // the polygon is fetched once per hex via JOIN to hexes_zoom_*. At point
    // zoom we project the actual point geom.
    const profilesBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom, days as record_count,
           time_min, time_max, latitude, longitude, depth_min, depth_max
    FROM cde.profiles`;
    const obisBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom,
           date_part('days', time_max - time_min) + 1 as record_count,
           time_min, time_max, latitude, longitude, depth_min, depth_max
    FROM cde.obis_cells
    WHERE :obisFilters`;
    // Trajectories fold into the hex layer ONLY at low zoom (z<7); at high zoom
    // they render as their own line layer (see trajectory MVT below), so this
    // branch is excluded there. point_pk is the negated trajectory pk so a
    // track counts once per hex via count(distinct point_pk) without colliding
    // with profile/obis point_pks. lat/lon/geom are NULL (a line has no single
    // point); at hex zoom the polygon filter uses the hex geom and the rect
    // filter isn't used.
    const trajectoryHexBranch = `SELECT (-t.pk) as point_pk, th.dataset_pk, :zoomPKColumn: as zoom_pk,
           NULL::geometry as point_geom, t.days as record_count,
           t.time_min, t.time_max,
           NULL::double precision as latitude, NULL::double precision as longitude,
           t.depth_min, t.depth_max
    FROM cde.trajectory_hexes th
    JOIN cde.trajectories t ON t.pk = th.trajectory_pk`;

    const branches = [];
    if (includeProfiles) branches.push(profilesBranch);
    if (includeObis) branches.push(obisBranch);
    if (includeTrajectories && isHexGrid) branches.push(trajectoryHexBranch);
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

    // At high zoom, render trajectories as their own line source-layer
    // ('trajectories'), simplified per-zoom and concatenated into the same
    // tile as the hex/point ('internal-layer-name') layer.
    const includeTrajLayer = !isHexGrid && includeTrajectories;
    // Web-Mercator resolution (m/px) at this zoom, ~2px of tolerance — trims
    // vertices before the 4096-grid quantization without visible distortion.
    const simplifyTolerance = (156543.03392804097 / Math.pow(2, z)) * 2;

    const trajLayerCTE = includeTrajLayer
      ? `,
    traj AS (
      SELECT t.pk AS pk, d.platform AS platform,
             array_to_json(array[d.pk_url]) AS datasets,
             ST_AsMVTGeom(ST_Simplify(t.geom, :simplifyTolerance), te.tile_envelope) AS geom
      FROM cde.trajectories t
      JOIN cde.datasets d ON t.dataset_pk = d.pk, te
      WHERE t.geom && te.tile_envelope
        ${filters.hasTrajectory ? "AND :trajectoryFilters" : ""}
    ),
    traj_mvt AS (
      SELECT ST_AsMVT(tg.*, 'trajectories', 4096, 'geom') AS bytes
      FROM (SELECT pk, platform, datasets, geom FROM traj WHERE geom IS NOT NULL) tg
    )`
      : "";

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
    ),
    base_mvt AS (
      SELECT ST_AsMVT(mvtgeom.*, 'internal-layer-name', 4096, 'geom') AS bytes FROM mvtgeom
    )${trajLayerCTE}
    SELECT COALESCE((SELECT bytes FROM base_mvt), ''::bytea)
           ${includeTrajLayer ? "|| COALESCE((SELECT bytes FROM traj_mvt), ''::bytea)" : ""} AS st_asmvt;
  `;

    try {
      const q = db.raw(SQL, {
        filters: filters.shared,
        obisFilters: filters.obisOnly,
        trajectoryFilters: filters.trajectory,
        simplifyTolerance,
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

module.exports = router;
