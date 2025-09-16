const express = require("express");

const router = express.Router();
const db = require("../db");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const cache = require("../utils/cache");

const createDBFilter = require("../utils/dbFilter");

/*
 * /legend
 *
 * Get the range of counts for the hexes/points to set the color and legend text
 * in the front end
 *
 * Takes all the filters, returns a number range for each of the 3 major zoom levels
 */

/**
 * @swagger
 * /legend:
 *   get:
 *     summary: Get hex/point density ranges for legend
 *     tags: [Legend]
 *     description: Returns min/max counts for three zoom levels used to render the map legend.
 *     parameters:
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: latMin
 *         schema: { type: number }
 *       - in: query
 *         name: latMax
 *         schema: { type: number }
 *       - in: query
 *         name: lonMin
 *         schema: { type: number }
 *       - in: query
 *         name: lonMax
 *         schema: { type: number }
 *       - in: query
 *         name: depthMin
 *         schema: { type: number }
 *       - in: query
 *         name: depthMax
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: Legend count ranges.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recordsCount:
 *                   type: object
 *                   properties:
 *                     zoom0:
 *                       type: array
 *                       items: { type: integer }
 *                     zoom1:
 *                       type: array
 *                       items: { type: integer }
 *                     zoom2:
 *                       type: array
 *                       items: { type: integer }
 */
router.get(
  "/",
  cache.route(),
  validatorMiddleware(),
  async (req, res, next) => {
    const filters = createDBFilter(req.query);
    const hasFilter = filters.toSQL().sql;
    const sql = `
        WITH records AS (
        SELECT hex_zoom_0, hex_zoom_1, point_pk, days
        FROM cde.profiles p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${hasFilter ? "WHERE :filters" : ""}
        ),

        sub1 AS (SELECT json_build_array(min(count),max(count)) zoom0 FROM (SELECT count(distinct records.point_pk) count FROM records GROUP BY hex_zoom_0) s),
        sub2 AS (SELECT json_build_array(min(count),max(count)) zoom1 FROM (SELECT count(distinct records.point_pk) count FROM records GROUP BY hex_zoom_1) s),
        sub3 AS (SELECT json_build_array(min(count),max(count)) zoom2 FROM (SELECT count(distinct records.point_pk) count FROM records GROUP BY point_pk) s)
        
        SELECT * from sub1,sub2,sub3
        `;

    const rows = await db.raw(sql, { filters });

    res.send(rows && { recordsCount: rows.rows[0] });
  },
);

module.exports = router;
