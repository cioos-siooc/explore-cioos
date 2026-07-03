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
    // Scientific-name filters are OBIS-only: hide profiles when set. An
    // OBIS-node selection also hides profiles, unless ERDDAP servers are
    // selected alongside it (combined Source filter — show both, OR'd in
    // the shared dataset filter).
    const includeProfiles = !req.query.scientificNames
      && (!req.query.obisNodes || Boolean(req.query.erddapServers));

    // At hex zoom we only need the hex FK and point_pk (for distinct counts);
    // the polygon is fetched once per hex via JOIN to hexes_zoom_*. At point
    // zoom we project the actual point geom.
    const profilesBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom, days as record_count,
           time_min, time_max, latitude, longitude, depth_min, depth_max
    FROM cde.profiles`;
    // Trajectory coverage cells are ERDDAP data: gated with profiles (an
    // OBIS-only filter can never match them).
    const trajectoryBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom, days as record_count,
           time_min, time_max, latitude, longitude, depth_min, depth_max
    FROM cde.trajectory_cells`;
    const obisBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom,
           date_part('days', time_max - time_min) + 1 as record_count,
           time_min, time_max, latitude, longitude, depth_min, depth_max
    FROM cde.obis_cells
    WHERE :obisFilters`;

    const branches = [];
    // At point zoom trajectory datasets render as coverage corridors (the
    // trajectory-footprints MVT layer below), NOT as decimated cell points —
    // the cells are full-res binned, so sparse fix spacing reads as a dotted
    // track once symbols are smaller than the spacing.
    if (includeProfiles) {
      branches.push(profilesBranch);
      if (isHexGrid) branches.push(trajectoryBranch);
    }
    if (includeObis) branches.push(obisBranch);
    // Guard: if nothing to show, return an empty CTE that still has the right columns
    const combinedInner = branches.length
      ? branches.join("\n    UNION ALL\n    ")
      : `${profilesBranch} WHERE FALSE`;

    const includeFootprints = !isHexGrid && includeProfiles;

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

    // Coverage-corridor layer (z >= 7): one dissolved translucent polygon per
    // trajectory dataset, aggregated per tile so the feature carries live
    // hover stats. `days` is CUMULATIVE coverage — the passing slices are
    // clamped to the time filter, merged where they overlap/touch (classic
    // gaps-and-islands; PG13, so no range_agg/multirange), then summed —
    // never last-minus-first, which would misread multi-mission datasets.
    // Merging across trajectories is deliberate: days = "days with data
    // present"; simultaneous deployments carry their multiplicity in
    // n_trajectories instead. The inner subquery exposes NULL
    // latitude/longitude/point_pk so the shared point-branch filters hide
    // corridors rather than erroring on missing columns.
    const footprintCTEs = `,
    fp AS (
      SELECT f.dataset_pk, f.trajectory_id, d.platform, d.pk_url, d.title,
             greatest(f.time_min, coalesce(:timeMin::timestamptz, f.time_min)) AS t0,
             least(f.time_max, coalesce(:timeMax::timestamptz, f.time_max)) AS t1,
             f.geom
      FROM (SELECT dataset_pk, trajectory_id, time_min, time_max,
                   depth_min, depth_max, geom,
                   NULL::double precision AS latitude,
                   NULL::double precision AS longitude,
                   NULL::integer AS point_pk
            FROM cde.trajectory_footprints) f
      JOIN cde.datasets d ON f.dataset_pk = d.pk
      CROSS JOIN te
      WHERE f.geom && te.tile_envelope
        AND f.time_min IS NOT NULL AND f.time_max IS NOT NULL
        ${filters.hasShared ? "AND :filters" : ""}
    ),
    fp_ordered AS (
      SELECT dataset_pk, t0, t1,
             max(t1) OVER (PARTITION BY dataset_pk ORDER BY t0, t1
                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
      FROM fp
    ),
    fp_islands AS (
      SELECT dataset_pk, t0, t1,
             sum(CASE WHEN prev_max IS NULL OR t0 > prev_max THEN 1 ELSE 0 END)
               OVER (PARTITION BY dataset_pk ORDER BY t0, t1
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
      FROM fp_ordered
    ),
    fp_days AS (
      SELECT dataset_pk,
             greatest(1, round(sum(extract(epoch FROM merged_end - merged_start)) / 86400))::int AS days
      FROM (SELECT dataset_pk, grp,
                   min(t0) AS merged_start, max(t1) AS merged_end
            FROM fp_islands GROUP BY dataset_pk, grp) merged
      GROUP BY dataset_pk
    ),
    fp_mvt AS (
      SELECT fp.dataset_pk AS pk, min(fp.pk_url) AS pk_url,
             min(fp.platform) AS platform, min(fp.title) AS title,
             count(DISTINCT fp.trajectory_id)::int AS n_trajectories,
             min(fp_days.days) AS days,
             ST_AsMVTGeom(ST_Union(fp.geom), te.tile_envelope) AS geom
      FROM fp JOIN fp_days USING (dataset_pk) CROSS JOIN te
      GROUP BY fp.dataset_pk, te.tile_envelope
    )`;

    // Combine profiles and obis_cells so both appear on the map
    const SQL = `
  with te AS (select ST_TileEnvelope(:z, :x, :y) tile_envelope ),
  combined as (
    ${combinedInner}
  ),
  relevent_points as (
    ${relevantPointsSQL}
  ),
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
    )${includeFootprints ? footprintCTEs : ""}
    SELECT (SELECT coalesce(ST_AsMVT(mvtgeom.*, 'internal-layer-name', 4096, 'geom'), ''::bytea) FROM mvtgeom)
        ${includeFootprints
    ? "|| (SELECT coalesce(ST_AsMVT(fp_mvt.*, 'trajectory-footprints', 4096, 'geom'), ''::bytea) FROM fp_mvt)"
    : ""} AS st_asmvt;
  `;

    try {
      const q = db.raw(SQL, {
        filters: filters.shared,
        obisFilters: filters.obisOnly,
        zoomPKColumn,
        z,
        x,
        y,
        ...(includeFootprints
          ? {
            timeMin: req.query.timeMin || null,
            timeMax: req.query.timeMax || null,
          }
          : {}),
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
