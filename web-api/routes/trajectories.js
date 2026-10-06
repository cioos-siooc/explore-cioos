const express = require("express");
const { check } = require("express-validator");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");
const createDBFilter = require("../utils/dbFilter");
const { TRAJECTORY_COVERAGE_FROM } = require("../utils/selection");
const { tierForZoom } = require("../utils/hexTiers");

// datasetPKs here is a single dataset's pk_url (same key the tile/filter
// queries use — the plural name kept for consistency, but only one pk is
// accepted); trajectoryId is the cf_role=trajectory_id value ('' for
// datasets with one unnamed trajectory). The charset stays permissive for
// glider mission names; length-capped as a safety net.
const trajectoryIdCheck = check("trajectoryId")
  .matches(/^[\w .:/-]*$/)
  .isLength({ max: 256 });

/**
 * @swagger
 * /trajectories/platforms:
 *   get:
 *     summary: List a trajectory dataset's platforms (trajectory ids)
 *     tags: [Trajectories]
 *     description: >
 *       Returns one row per trajectory_id in the dataset, from the
 *       per-trajectory summary (cde.trajectory_track_stats) the harvester
 *       rebuilds on each load — time extents and retained-fix counts included.
 *     parameters:
 *       - in: query
 *         name: datasetPKs
 *         required: true
 *         schema: { type: integer }
 *         description: The dataset's pk_url.
 *     responses:
 *       200:
 *         description: Array of platform/trajectory summaries.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   trajectory_id: { type: string }
 *                   time_min: { type: string, format: date-time }
 *                   time_max: { type: string, format: date-time }
 *                   n_points: { type: integer }
 */
router.get(
  "/platforms",
  ...pipeline({ filters: false, checks: [check("datasetPKs").isInt()] }),
  async (req, res) => {
    const { datasetPKs } = req.query;

    const SQL = `
      SELECT s.trajectory_id, s.time_min, s.time_max, s.n_points
      FROM cde.trajectory_track_stats s
      JOIN cde.datasets d ON d.pk = s.dataset_pk
      WHERE d.pk_url = :datasetPK
      ORDER BY s.trajectory_id`;

    const { rows } = await db.raw(SQL, {
      datasetPK: parseInt(datasetPKs, 10),
    });
    res.send(rows);
  },
);

/**
 * @swagger
 * /trajectories/track:
 *   get:
 *     summary: Full ordered track for one platform (trajectory id)
 *     tags: [Trajectories]
 *     description: >
 *       Returns the platform's complete downsampled track as parallel arrays
 *       ordered by time (arrays rather than GeoJSON features — much smaller;
 *       the frontend assembles the geometry). Bounded by the harvester's
 *       per-trajectory retained-fix cap.
 *     parameters:
 *       - in: query
 *         name: datasetPKs
 *         required: true
 *         schema: { type: integer }
 *         description: The dataset's pk_url.
 *       - in: query
 *         name: trajectoryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The ordered track.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 trajectory_id: { type: string }
 *                 n_points: { type: integer }
 *                 coordinates:
 *                   type: array
 *                   items:
 *                     type: array
 *                     items: { type: number }
 *                 times:
 *                   type: array
 *                   items: { type: string, format: date-time }
 *                 profile_ids:
 *                   type: array
 *                   items: { type: string, nullable: true }
 */
router.get(
  "/track",
  ...pipeline({
    filters: false,
    checks: [check("datasetPKs").isInt(), trajectoryIdCheck],
  }),
  async (req, res) => {
    const { datasetPKs, trajectoryId } = req.query;

    if (trajectoryId === undefined) {
      return res.status(400).json({ error: "trajectoryId is required" });
    }

    const SQL = `
      SELECT p.longitude, p.latitude, p.time, p.profile_id
      FROM cde.trajectory_points p
      JOIN cde.datasets d ON d.pk = p.dataset_pk
      WHERE d.pk_url = :datasetPK
        AND p.trajectory_id = :trajectoryId
      ORDER BY p.time`;

    const { rows } = await db.raw(SQL, {
      datasetPK: parseInt(datasetPKs, 10),
      trajectoryId,
    });
    res.send({
      trajectory_id: trajectoryId,
      n_points: rows.length,
      coordinates: rows.map((r) => [r.longitude, r.latitude]),
      times: rows.map((r) => r.time),
      profile_ids: rows.map((r) => r.profile_id),
    });
  },
);

/**
 * @swagger
 * /trajectories/passes:
 *   get:
 *     summary: When each of a dataset's trajectories was inside the selection
 *     tags: [Trajectories]
 *     description: >
 *       One entry per trajectory with coverage inside the selection, listing
 *       its passes as inclusive runs of consecutive UTC days. The selection is
 *       the shared filter set (polygon, lat/lon bounds, time, depth, ...) and,
 *       when `at` is given, the hex at zoom `z`'s tier containing that point —
 *       what a click on a hex or a track names.
 *     parameters:
 *       - in: query
 *         name: datasetPKs
 *         required: true
 *         schema: { type: integer }
 *         description: The dataset's pk_url.
 *       - in: query
 *         name: at
 *         schema: { type: string }
 *         description: The clicked point as "lng,lat".
 *       - in: query
 *         name: z
 *         schema: { type: integer }
 *         description: Map zoom of the click; required with `at`.
 *     responses:
 *       200:
 *         description: Passes per trajectory, ordered by first pass.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   trajectory_id: { type: string }
 *                   passes:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         start: { type: string, format: date }
 *                         end: { type: string, format: date }
 */
router.get(
  "/passes",
  ...pipeline({
    checks: [
      check("datasetPKs").isInt(),
      check("at")
        .optional()
        .custom((value) => {
          const [lng, lat, ...rest] = String(value).split(",").map(Number);
          return (
            rest.length === 0 &&
            Number.isFinite(lng) &&
            Number.isFinite(lat) &&
            Math.abs(lat) <= 90
          );
        }),
      check("z").if(check("at").exists()).isInt({ min: 0, max: 24 }),
    ],
  }),
  async (req, res) => {
    const { at, z, timeMin, timeMax } = req.query;
    const filters = await createDBFilter(req.query);

    // The clicked hex is matched on the fine hexes' CENTROIDS: their polygons
    // share edges with the clicked one, so an intersects test on them would
    // pull in every neighbour. A coarse click gets the fine hexes centred in it.
    let areaSQL = "";
    const params = { filters: filters.shared };
    if (at) {
      const [lng, lat] = at.split(",").map(Number);
      // MapLibre reports clicks on a world copy past ±180.
      params.lng = ((((lng + 180) % 360) + 360) % 360) - 180;
      params.lat = lat;
      areaSQL = `AND ST_Intersects(p.geom, (
          SELECT a.geom FROM ${tierForZoom(z).hexesTable} a
          WHERE ST_Contains(a.geom, ST_Transform(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), 3857))
          LIMIT 1))`;
    }

    // The column list is what the shared filter references, as in
    // /timeExtent's trajectory branch.
    const SQL = `
      WITH coverage AS (
        SELECT t.dataset_pk, NULL::integer AS point_pk, t.time_min, t.time_max,
               t.depth_min, t.depth_max, h.geom AS search_geom,
               t.geom, t.trajectory_id, t.day_ranges
        ${TRAJECTORY_COVERAGE_FROM}
      )
      SELECT p.trajectory_id,
             to_char(lower(r), 'YYYY-MM-DD') AS first_day,
             to_char(upper(r) - 1, 'YYYY-MM-DD') AS last_day
      FROM coverage p
      JOIN cde.datasets d ON d.pk = p.dataset_pk
      CROSS JOIN LATERAL unnest(p.day_ranges) r
      WHERE :filters ${areaSQL}
      ORDER BY p.trajectory_id, first_day`;

    const { rows } = await db.raw(SQL, params);

    // Rows are per hex, so a trajectory crossing several selected hexes in one
    // voyage repeats overlapping runs; merged here into one pass per visit.
    // ISO dates compare as strings.
    const windowStart = timeMin?.slice(0, 10);
    const windowEnd = timeMax?.slice(0, 10);
    const byTrajectory = new Map();
    rows.forEach(({ trajectory_id, first_day, last_day }) => {
      const start =
        windowStart && windowStart > first_day ? windowStart : first_day;
      const end = windowEnd && windowEnd < last_day ? windowEnd : last_day;
      if (start > end) return;
      if (!byTrajectory.has(trajectory_id)) byTrajectory.set(trajectory_id, []);
      const passes = byTrajectory.get(trajectory_id);
      const last = passes[passes.length - 1];
      if (last && start <= nextDay(last.end)) {
        if (end > last.end) last.end = end;
      } else {
        passes.push({ start, end });
      }
    });
    res.send(
      [...byTrajectory]
        .map(([trajectory_id, passes]) => ({ trajectory_id, passes }))
        .sort((a, b) => a.passes[0].start.localeCompare(b.passes[0].start)),
    );
  },
);

function nextDay(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

module.exports = router;
