var express = require("express");
var router = express.Router();
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

router.get(
  "/",
  cache.route(),
  validatorMiddleware(),
  async function (req, res, next) {
    const filters = createDBFilter(req.query);
    const hasFilter = filters.toSQL().sql;

    const sql = `
        WITH records AS (
        SELECT hex_zoom_0, hex_zoom_1, point_pk
        FROM cde.profiles p
        JOIN cde.datasets d
        ON p.dataset_pk = d.pk
        ${hasFilter ? "WHERE :filters" : ""}
        ),

        sub1 AS (SELECT json_build_array(min(count),max(count)) zoom0 FROM (SELECT count(*) FROM records GROUP BY hex_zoom_0) s),
        sub2 AS (SELECT json_build_array(min(count),max(count)) zoom1 FROM (SELECT count(*) FROM records GROUP BY hex_zoom_1) s),
        sub3 AS (SELECT json_build_array(min(count),max(count)) zoom2 FROM (SELECT count(*) FROM records GROUP BY point_pk) s)
        
        SELECT * from sub1,sub2,sub3
        `;

    const rows = await db.raw(sql);

    res.send(rows && { recordsCount: rows.rows[0] });
  }
);

module.exports = router;
