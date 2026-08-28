require("dotenv").config();

const { v4: uuidv4 } = require("uuid");
const express = require("express");

const router = express.Router();
const { check } = require("express-validator");
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { getShapeQuery } = require("../utils/shapeQuery");
const { polygonJSONToWKT } = require("../utils/polygon");
const { requiredShapeMiddleware } = require("../utils/validatorMiddlewares");

/**
 * /download
 * Requires a shape (either polygon or latMin/Max) and email
 */

/**
 * @swagger
 * /download:
 *   get:
 *     summary: Submit download job
 *     tags: [Download]
 *     description: Creates a download job for datasets matching filters and spatial selection.
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema: { type: string, format: email }
 *       - in: query
 *         name: polygon
 *         schema: { type: string }
 *         description: GeoJSON polygon string.
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: depthMin
 *         schema: { type: number }
 *       - in: query
 *         name: depthMax
 *         schema: { type: number }
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
 *     responses:
 *       200:
 *         description: Download job accepted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *       400:
 *         description: Validation error
 */
router.get(
  "/",
  requiredShapeMiddleware(),
  check("email").isEmail(),
  async (req, res, next) => {
    const {
      timeMin,
      timeMax,
      latMin,
      latMax,
      depthMin,
      depthMax,
      lonMin,
      lonMax,
      email,
      polygon,
      lang = "en",
    } = req.query;

    let shapeQueryResponse;
    let filters;
    try {
      shapeQueryResponse = await getShapeQuery(req.query, true, false);
      filters = await createDBFilter(req.query);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }
    const estimateTotalSize = shapeQueryResponse.reduce(
      (partialSum, { size }) => partialSum + size,
      0,
    );

    const wktPolygon = polygon ? polygonJSONToWKT(polygon) : null;

    // Which feature sources feed the queue. Mirror shapeQuery.js so the queued
    // set matches the size estimate the user was shown: profiles + trajectory
    // coverage hexes for ERDDAP data, obis_cells for OBIS. Scientific-name /
    // OBIS-node selections hide the profile branches (OBIS-only mode) unless
    // ERDDAP servers are also selected.
    const { includeObis = "true", scientificNames, obisNodes, erddapServers } = req.query;
    const includeProfiles = !scientificNames && (!obisNodes || Boolean(erddapServers));
    const showObis = includeObis !== "false";

    // search_geom is the geometry filters.shared matches against: the per-feature
    // bbox for profiles (extent search), the cell point for obis, the hex polygon
    // for trajectory coverage.
    const profilesBranch = `SELECT dataset_pk, point_pk, geom, latitude, longitude,
               time_min, time_max, depth_min, depth_max, bbox AS search_geom
        FROM cde.profiles
        WHERE :profileFilters`;
    // Trajectory coverage hexes are downloadable ERDDAP datasets too, so a
    // selection over a glider/ship track queues its dataset. 10 km tier only:
    // the 100 km rows describe the same data at a coarser grain. search_geom is
    // the hex polygon, not its centroid (see shapeQuery.js).
    const trajectoryBranch = `SELECT t.dataset_pk, NULL::integer AS point_pk, t.geom, t.latitude, t.longitude,
               t.time_min, t.time_max, t.depth_min, t.depth_max, h.geom AS search_geom
        FROM cde.trajectory_hexes t
        JOIN cde.hexes_zoom_1 h ON h.pk = t.hex_pk
        WHERE t.hex_tier = 1`;
    // OBIS occurrence cells. The scientific-name/aphia predicate lives in
    // filters.obisOnly (obis_cells columns) and is applied inside the branch;
    // the shared spatial/time/source filter still applies in the outer WHERE.
    const obisBranch = `SELECT dataset_pk, point_pk, geom, latitude, longitude,
               time_min, time_max, depth_min, depth_max, geom AS search_geom
        FROM cde.obis_cells
        WHERE :obisFilters`;

    const branches = [];
    if (includeProfiles) branches.push(profilesBranch, trajectoryBranch);
    if (showObis) branches.push(obisBranch);

    // Nothing to download (e.g. a scientific-name selection with OBIS disabled).
    if (!branches.length) return res.send({ count: 0 });

    // (Pre-M2 this interpolated the filter OBJECT into the SQL string instead
    // of binding filters.shared — fixed to match the other routes.)
    const SQL = `
        WITH combined AS (
        ${branches.join("\n        UNION ALL\n        ")}
        ),
        profiles_subset AS (
        SELECT d.erddap_url,
               d.dataset_id,
               d.title,
               d.profile_variables,
               d.cdm_data_type,
               d.source_type,
               d.ckan_id ckan_id,
               'https://catalogue.cioos.ca/dataset/' ckan_url
        FROM combined p
        JOIN cde.datasets d ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        GROUP BY d.pk)
        SELECT json_agg(t) FROM profiles_subset t;
      `;

    try {
      let count = 0;
      const tileRaw = await db.raw(SQL, {
        filters: filters.shared,
        obisFilters: filters.obisOnly,
        profileFilters: filters.profileOnly,
      });
      const tile = tileRaw.rows[0];
      if (tile.json_agg && tile.json_agg.length) {
        const jobID = uuidv4().substr(0, 6);
        const downloaderInput = {
          user_query: {
            language: lang,
            time_min: timeMin,
            time_max: timeMax,
            lat_min: Number.parseFloat(latMin),
            lat_max: Number.parseFloat(latMax),
            lon_min: Number.parseFloat(lonMin),
            lon_max: Number.parseFloat(lonMax),
            depth_min: Number.parseFloat(depthMin),
            depth_max: Number.parseFloat(depthMax),
            polygon_region: wktPolygon,
            email,
            job_id: jobID,
          },
          cache_filtered: tile.json_agg,
        };
        // add to the jobs queue

        const downloadJobEntry = {
          job_id: jobID,
          email,
          downloader_input: downloaderInput,
          estimate_details: JSON.stringify(shapeQueryResponse),
          estimate_size: estimateTotalSize,
        };
        console.log(downloadJobEntry);
        await db("cde.download_jobs").insert(downloadJobEntry);

        count = tile.json_agg.length;
      }
      res.send({ count });
    } catch (e) {
      res.status(404).send({
        error: e.toString(),
      });
    }
  },
);

module.exports = router;
