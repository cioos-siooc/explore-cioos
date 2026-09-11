const express = require("express");
const { check } = require("express-validator");

const router = express.Router();
const db = require("../db");
const { pipeline } = require("../utils/routePipeline");

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

module.exports = router;
