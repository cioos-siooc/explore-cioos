const express = require("express");
const { check } = require("express-validator");
const db = require("../db");
const { getShapeQuery } = require("../utils/shapeQuery");
const { pipeline } = require("../utils/routePipeline");

const router = express.Router();

/**
 * @swagger
 * /datasetRecordsList:
 *   get:
 *     summary: Get dataset record details and size estimate
 *     tags: [Datasets]
 *     description: Returns a dataset's record list and size estimates based on current filters.
 *     parameters:
 *       - in: query
 *         name: datasetPk
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Dataset record list summary.
 */

/**
 * /datasetRecordsList
 *
 * This endpoint takes any of the filters and requires a dataset PK
 * It needs all the filters so that it can estimate download size
 *
 * It is called when a user clicks to see details on a dataset
 *
 * Shape is not required
 */
router.get(
  "/",
  ...pipeline({ checks: [check("datasetPKs").isInt()] }),
  async (req, res) => {
    const rows = await getShapeQuery(req.query, false, true);
    res.send(rows.pop());
  },
);

/**
 * @swagger
 * /datasetRecordsList/location:
 *   get:
 *     summary: Where one record of a dataset was sampled
 *     tags: [Datasets]
 *     description: >
 *       The distinct marker locations of one record (a profile or a time
 *       series), keyed the way /datasetRecordsList keys its records — so the
 *       dataset page can point one out on the map. Trajectories are drawn from
 *       /trajectories/track instead.
 *     parameters:
 *       - in: query
 *         name: datasetPKs
 *         required: true
 *         schema: { type: integer }
 *         description: The dataset's pk_url.
 *       - in: query
 *         name: recordId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The record's [longitude, latitude] pairs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 coordinates:
 *                   type: array
 *                   items:
 *                     type: array
 *                     items: { type: number }
 */
router.get(
  "/location",
  ...pipeline({
    filters: false,
    checks: [
      check("datasetPKs").isInt(),
      check("recordId").isString().isLength({ min: 1, max: 256 }),
    ],
  }),
  async (req, res) => {
    const { datasetPKs, recordId } = req.query;
    // coalesce(profile_id, timeseries_id) is the record list's own key (see
    // shapeQuery's records CTE).
    const { rows } = await db.raw(
      `SELECT DISTINCT p.longitude, p.latitude
       FROM cde.profiles p
       JOIN cde.datasets d ON d.pk = p.dataset_pk
       WHERE d.pk_url = :datasetPK
         AND coalesce(p.profile_id, p.timeseries_id) = :recordId`,
      { datasetPK: parseInt(datasetPKs, 10), recordId },
    );
    res.send({ coordinates: rows.map((r) => [r.longitude, r.latitude]) });
  },
);

module.exports = router;
