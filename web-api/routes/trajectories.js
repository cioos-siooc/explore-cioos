const express = require("express");
const { check } = require("express-validator");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");
const { errorHandler } = require("../utils/validatorMiddlewares");

// datasetPKs here is a single dataset's pk_url (same key the tile/filter
// queries use — the plural name kept for consistency, but only one pk is
// accepted); trajectoryId is the cf_role=trajectory_id value ('' for
// datasets with one unnamed trajectory). The charset stays permissive for
// glider mission names; length-capped as a safety net.
const trajectoryIdCheck = check("trajectoryId")
  .matches(/^[\w .:/\-]*$/)
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
  [check("datasetPKs").isInt(), errorHandler],
  cache.route(),
  async (req, res) => {
    const { datasetPKs } = req.query;

    const SQL = `
      SELECT s.trajectory_id, s.time_min, s.time_max, s.n_points
      FROM cde.trajectory_track_stats s
      JOIN cde.datasets d ON d.pk = s.dataset_pk
      WHERE d.pk_url = :datasetPK
      ORDER BY s.trajectory_id`;

    try {
      const rows = (
        await db.raw(SQL, { datasetPK: parseInt(datasetPKs, 10) })
      ).rows;
      res.send(rows);
    } catch (e) {
      console.error(e);
      res.status(500).send({ error: e.toString() });
    }
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
  [check("datasetPKs").isInt(), trajectoryIdCheck, errorHandler],
  cache.route(),
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

    try {
      const rows = (
        await db.raw(SQL, { datasetPK: parseInt(datasetPKs, 10), trajectoryId })
      ).rows;
      res.send({
        trajectory_id: trajectoryId,
        n_points: rows.length,
        coordinates: rows.map((r) => [r.longitude, r.latitude]),
        times: rows.map((r) => r.time),
        profile_ids: rows.map((r) => r.profile_id),
      });
    } catch (e) {
      console.error(e);
      res.status(500).send({ error: e.toString() });
    }
  },
);

module.exports = router;
