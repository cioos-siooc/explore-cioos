var express = require("express");
var router = express.Router();
const db = require("../db");

const createDBFilter = require("../utils/dbFilter");

/*
 * Get the range of counts for the hexes/points to set the color in the front end
 */

router.get("/", async function (req, res, next) {
  const filters = createDBFilter(req.query);

  const sql = `
        WITH records AS (
        select hex_zoom_0, hex_zoom_1, point_pk
        FROM cioos_api.profiles p
        JOIN cioos_api.datasets d
        ON p.dataset_pk = d.pk
        ${filters ? "WHERE " + filters : ""}
        ),

        sub1 as (select json_build_array(min(count),max(count)) zoom0 from (select count(*) from records group by hex_zoom_0) s),
        sub2 as (select json_build_array(min(count),max(count)) zoom1 from (select count(*) from records group by hex_zoom_1) s),
        sub3 as (select json_build_array(min(count),max(count)) zoom2 from (select count(*) from records group by point_pk) s)
        
        select * from sub1,sub2,sub3
        `;

  console.log(sql);

  const rows = await db.raw(sql);

  res.send(rows && { recordsCount: rows.rows[0] });
});

module.exports = router;
