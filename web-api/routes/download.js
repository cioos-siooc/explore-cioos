require("dotenv").config({ quiet: true });

const { randomUUID } = require("node:crypto");
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

// The downloader clips the first four to a polygon; ERDDAP's other file types
// pass through over the polygon's bounding box (RAW_FORMATS in
// downloader/cioos_downloader/formats.py).
const FORMATS = [
  "csv",
  "parquet",
  "odv",
  "nccf",
  "csvp",
  "csv0",
  "tsv",
  "tsvp",
  "tsv0",
  "nccsv",
  "esriCsv",
  "json",
  "jsonlCSV1",
  "jsonlCSV",
  "jsonlKVP",
  "geoJson",
  "ncoJson",
  "dataTable",
  "nc",
  "ncCFMA",
  "mat",
  "itx",
  "asc",
  "dods",
  "htmlTable",
  "xhtml",
  "kml",
];
// OBIS occurrences are a flat table: there is no ODV or CF-DSG rendition.
const OBIS_FORMATS = ["csv", "parquet"];
// Past this many matched features, a bounding-box request beats a regex over
// their IDs (the downloader also caps the number of requests it splits into).
const MAX_FEATURE_IDS = 5000;
// The Data Explorer's public address: compose sets PUBLIC_BASE_URL to it + /api.
const EXPLORER_URL = (
  process.env.PUBLIC_BASE_URL || "http://localhost:8098/api"
).replace(/\/api\/?$/, "");
// The ID variable whose values select a feature in ERDDAP, per cdm_data_type.
const FEATURE_ID_SQL = `CASE WHEN d.cdm_data_type IN ('TimeSeries', 'TimeSeriesProfile') THEN p.timeseries_id
               WHEN d.cdm_data_type = 'Profile' THEN p.profile_id END`;
// The package's reproduce.py installs the downloader from the public repo at
// the commit this API was deployed from; local stacks have none and track the
// development branch.
const DOWNLOADER_REF = process.env.SOURCE_COMMIT || "development-v2";
const DOWNLOADER_URL = `https://github.com/cioos-siooc/explore-cioos/archive/${DOWNLOADER_REF}.tar.gz#subdirectory=downloader`;

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
 *         schema: { type: string, enum: [csv, parquet, odv, nccf, csvp, csv0, tsv, tsvp, tsv0, nccsv, esriCsv, json, jsonlCSV1, jsonlCSV, jsonlKVP, geoJson, ncoJson, dataTable, nc, ncCFMA, mat, itx, asc, dods, htmlTable, xhtml, kml], default: csv }
 *         description: Only csv, parquet, odv and nccf are clipped to a polygon; the other ERDDAP file types cover its bounding box.
 *       - in: query
 *         name: obisFormat
 *         schema: { type: string, enum: [csv, parquet] }
 *         description: Format for OBIS datasets; defaults to format, as CSV when OBIS has no such rendition.
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
// The datasets matching the selection (null when none) and the query the
// downloader reads.
async function downloadSelection(query) {
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
    obisFormat,
  } = query;

  const filters = await createDBFilter(query);
  const includeProfiles = erddapVisible(query);
  const showObis = obisVisible(query);

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
  if (!branches.length) return { datasets: null };

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

  const tileRaw = await db.raw(SQL, {
    filters: filters.shared,
    obisFilters: filters.obisOnly,
    profileFilters: filters.profileOnly,
  });
  const datasets = tileRaw.rows[0].json_agg;
  if (!datasets || !datasets.length) return { datasets: null };

  const userQuery = {
    language: lang,
    time_min: timeMin,
    time_max: timeMax,
    lat_min: Number.parseFloat(latMin),
    lat_max: Number.parseFloat(latMax),
    lon_min: Number.parseFloat(lonMin),
    lon_max: Number.parseFloat(lonMax),
    depth_min: Number.parseFloat(depthMin),
    depth_max: Number.parseFloat(depthMax),
    polygon_region: polygon ? polygonJSONToWKT(polygon) : null,
    format,
    obis_format: obisFormat || null,
    // Every filter as the Data Explorer sent it, for the package README.
    filters: Object.fromEntries(
      Object.entries(query).filter(
        ([key]) => !["polygon", "lang", "format", "obisFormat"].includes(key),
      ),
    ),
    // The explorer reads these same parameters back from its URL, so the
    // package can link to the selection it was made from.
    explorer_url: `${EXPLORER_URL}/?${new URLSearchParams(
      Object.entries(query).filter(
        ([key]) => !["format", "obisFormat"].includes(key),
      ),
    )}`,
    job_id: randomUUID().slice(0, 6),
    // Installed by the package's reproduce.py.
    downloader_url: DOWNLOADER_URL,
  };
  return { datasets, userQuery };
}

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
      check("obisFormat").isIn(OBIS_FORMATS).optional(),
    ],
    cacheFor: null,
  }),
  async (req, res) => {
    const { email } = req.body;

    const shapeQueryResponse = await getShapeQuery(req.query, true, false);
    const estimateTotalSize = shapeQueryResponse.reduce(
      (partialSum, { size }) => partialSum + size,
      0,
    );

    const { datasets, userQuery } = await downloadSelection(req.query);
    if (!datasets) return res.send({ count: 0 });

    const downloadJobEntry = {
      job_id: userQuery.job_id,
      email,
      // Outlives the address, which the download scheduler clears after 7
      // days, so usage can still be counted by institution.
      email_domain: email.split("@").pop().toLowerCase(),
      downloader_input: {
        user_query: { ...userQuery, email },
        cache_filtered: datasets,
      },
      estimate_details: JSON.stringify(shapeQueryResponse),
      estimate_size: estimateTotalSize,
    };
    console.log(`queued download job ${userQuery.job_id}`);
    await db("cde.download_jobs").insert(downloadJobEntry);

    res.send({ count: datasets.length });
  },
);

module.exports = router;
