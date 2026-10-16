require("dotenv").config({ quiet: true });

const { v4: uuidv4 } = require("uuid");
const express = require("express");

const router = express.Router();
const { body, check } = require("express-validator");
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { getShapeQuery } = require("../utils/shapeQuery");
const { polygonJSONToWKT } = require("../utils/polygon");
const { pipeline } = require("../utils/routePipeline");
const {
  erddapVisible,
  obisVisible,
  TRAJECTORY_COVERAGE_FROM,
} = require("../utils/selection");

// The email rides in the JSON body so it never reaches access logs or traces.

const FORMATS = ["csv", "parquet", "odv", "nccf"];
// Past this many matched features, a bounding-box request beats a regex over
// their IDs (the downloader also caps the number of requests it splits into).
const MAX_FEATURE_IDS = 5000;
// The ID variable whose values select a feature in ERDDAP, per cdm_data_type.
const FEATURE_ID_SQL = `CASE WHEN d.cdm_data_type IN ('TimeSeries', 'TimeSeriesProfile') THEN p.timeseries_id
               WHEN d.cdm_data_type = 'Profile' THEN p.profile_id END`;

/**
 * @swagger
 * /download:
 *   post:
 *     summary: Submit download job
 *     tags: [Download]
 *     description: Creates a download job for datasets matching filters and spatial selection.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     parameters:
 *       - in: query
 *         name: polygon
 *         schema: { type: string }
 *         description: GeoJSON polygon string.
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, parquet, odv, nccf], default: csv }
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
// Not cached: this route enqueues a job, and a cached 200 would drop the
// second identical request on the floor.
router.post(
  "/",
  ...pipeline({
    shape: true,
    checks: [
      body("email").isEmail(),
      check("lang").isIn(["en", "fr"]).optional(),
      check("format").isIn(FORMATS).optional(),
    ],
    cacheFor: null,
  }),
  async (req, res) => {
    const {
      timeMin,
      timeMax,
      latMin,
      latMax,
      depthMin,
      depthMax,
      lonMin,
      lonMax,
      polygon,
      lang = "en",
      format = "csv",
    } = req.query;
    const { email } = req.body;

    const shapeQueryResponse = await getShapeQuery(req.query, true, false);
    const filters = await createDBFilter(req.query);
    const estimateTotalSize = shapeQueryResponse.reduce(
      (partialSum, { size }) => partialSum + size,
      0,
    );

    const wktPolygon = polygon ? polygonJSONToWKT(polygon) : null;

    const includeProfiles = erddapVisible(req.query);
    const showObis = obisVisible(req.query);

    const profilesBranch = `SELECT dataset_pk, point_pk, geom, latitude, longitude,
               time_min, time_max, depth_min, depth_max, bbox AS search_geom,
               timeseries_id, profile_id
        FROM cde.profiles
        WHERE :profileFilters`;
    const trajectoryBranch = `SELECT t.dataset_pk, NULL::integer AS point_pk, t.geom, t.latitude, t.longitude,
               t.time_min, t.time_max, t.depth_min, t.depth_max, h.geom AS search_geom,
               NULL::text AS timeseries_id, NULL::text AS profile_id
        ${TRAJECTORY_COVERAGE_FROM}`;
    const obisBranch = `SELECT dataset_pk, point_pk, geom, latitude, longitude,
               time_min, time_max, depth_min, depth_max, geom AS search_geom,
               NULL::text AS timeseries_id, NULL::text AS profile_id
        FROM cde.obis_cells
        WHERE :obisFilters`;

    const branches = [];
    if (includeProfiles) branches.push(profilesBranch, trajectoryBranch);
    if (showObis) branches.push(obisBranch);

    // Nothing to download (e.g. a scientific-name selection with OBIS disabled).
    if (!branches.length) return res.send({ count: 0 });

    const SQL = `
        WITH combined AS (
        ${branches.join("\n        UNION ALL\n        ")}
        ),
        profiles_subset AS (
        SELECT d.erddap_url,
               d.dataset_id,
               d.title,
               d.title_fr,
               d.profile_variables,
               d.cdm_data_type,
               d.source_type,
               d.ckan_id ckan_id,
               'https://catalogue.cioos.ca/dataset/' || d.ckan_id AS ckan_url,
               d.metadata,
               d.table_variables,
               -- The features the search matched, so the downloader fetches
               -- exactly those rather than everything in the polygon's box.
               CASE WHEN d.cdm_data_type IN ('TimeSeries', 'TimeSeriesProfile') THEN d.timeseries_id_variable
                    WHEN d.cdm_data_type = 'Profile' THEN d.profile_id_variable END AS feature_id_variable,
               CASE WHEN count(DISTINCT ${FEATURE_ID_SQL}) <= ${MAX_FEATURE_IDS}
                    THEN array_remove(array_agg(DISTINCT ${FEATURE_ID_SQL}), NULL) END AS feature_ids
        FROM combined p
        JOIN cde.datasets d ON p.dataset_pk = d.pk
        ${filters.hasShared ? "WHERE :filters" : ""}
        GROUP BY d.pk)
        SELECT json_agg(t) FROM profiles_subset t;
      `;

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
          format,
          // Every filter as the Data Explorer sent it, for the package README.
          filters: Object.fromEntries(
            Object.entries(req.query).filter(
              ([key]) => !["polygon", "lang", "format"].includes(key),
            ),
          ),
          email,
          job_id: jobID,
        },
        cache_filtered: tile.json_agg,
      };
      const downloadJobEntry = {
        job_id: jobID,
        email,
        // Outlives the address, which the download scheduler clears after 7
        // days, so usage can still be counted by institution.
        email_domain: email.split("@").pop().toLowerCase(),
        downloader_input: downloaderInput,
        estimate_details: JSON.stringify(shapeQueryResponse),
        estimate_size: estimateTotalSize,
      };
      console.log(`queued download job ${jobID}`);
      await db("cde.download_jobs").insert(downloadJobEntry);

      count = tile.json_agg.length;
    }
    res.send({ count });
  },
);

module.exports = router;
