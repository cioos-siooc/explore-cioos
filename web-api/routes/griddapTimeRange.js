const express = require("express");
const { check } = require("express-validator");
const Sentry = require("@sentry/node");

/**
 * @swagger
 * /griddapTimeRange:
 *   get:
 *     summary: A griddap dataset's time axis, as the server reports it right now
 *     tags: [Griddap]
 *     description: >
 *       Returns the live time dimension of one griddap dataset, shaped like an
 *       entry of datasets.grid_dimensions so the caller can substitute it for
 *       the harvested one. Read on demand when the WMS view opens, because a
 *       rolling product (many satellite grids keep only the last week or two)
 *       moves both ends of its time axis between harvests, and the harvested
 *       copy would otherwise cap the time slider short of the newest slice.
 *     parameters:
 *       - in: query
 *         name: dataset
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: >
 *           { name, n_values, min, max, spacing, even_spacing, units } - min and
 *           max are ISO-8601 UTC. Fields the server does not report are null.
 *       400:
 *         description: Missing or invalid parameters.
 *       404:
 *         description: Unknown dataset, or it declares no time dimension.
 *       502:
 *         description: The upstream ERDDAP server failed or timed out.
 */

const router = express.Router();
const axios = require("axios");
const db = require("../db");
const cache = require("../utils/cache");
const { pipeline } = require("../utils/routePipeline");

// ERDDAP publishes times as epoch seconds or ISO 8601, sometimes both within one
// document. Mirrors erddap_time_to_iso() in harvester/cde_harvester/utils.py --
// the two must agree, or a refresh would appear to move a dataset's time axis.
function erddapTimeToIso(value) {
  const raw = String(value ?? "").trim();
  if (!raw || ["nan", "none", "nat"].includes(raw.toLowerCase())) return null;
  // Number() accepts ERDDAP's '1.0257408E9' exponent form.
  const seconds = Number(raw);
  const date = Number.isFinite(seconds)
    ? new Date(seconds * 1000)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const N_VALUES = /nValues=(\d+)/;
const EVENLY_SPACED = /evenlySpaced=(true|false)/;
const AVERAGE_SPACING = /averageSpacing=(.+)$/;

/*
 * Pull the time dimension out of ERDDAP's info document.
 *
 * Requested as .json rather than the .csv the harvester reads, purely so there
 * is no CSV to parse here: the Value column legitimately contains commas
 * ("nValues=5827, evenlySpaced=false, ...") and an actual_range is itself a
 * comma-separated pair.
 *
 * Two rows carry what we need, the same two the harvester's grid handler reads:
 * the `dimension` row's Value holds nValues/evenlySpaced/averageSpacing, and the
 * variable's `actual_range` attribute holds the bounds.
 */
function timeDimensionFrom(table) {
  const columns = table?.columnNames || [];
  const at = {
    rowType: columns.indexOf("Row Type"),
    variable: columns.indexOf("Variable Name"),
    attribute: columns.indexOf("Attribute Name"),
    value: columns.indexOf("Value"),
  };
  if (Object.values(at).some((i) => i < 0)) return null;

  const rows = (table.rows || []).filter((row) => row[at.variable] === "time");
  const dimensionRow = rows.find((row) => row[at.rowType] === "dimension");
  if (!dimensionRow) return null;

  const valueOf = (attribute) =>
    rows.find((row) => row[at.attribute] === attribute)?.[at.value];

  const attrs = String(dimensionRow[at.value] ?? "");
  const nValues = attrs.match(N_VALUES);
  const evenlySpaced = attrs.match(EVENLY_SPACED);
  const averageSpacing = attrs.match(AVERAGE_SPACING);
  const bounds = String(valueOf("actual_range") ?? "").split(",");

  return {
    name: "time",
    n_values: nValues ? Number.parseInt(nValues[1], 10) : null,
    min: erddapTimeToIso(bounds[0]),
    max: erddapTimeToIso(bounds[1]),
    spacing: averageSpacing ? averageSpacing[1].trim() : null,
    even_spacing: evenlySpaced ? evenlySpaced[1] === "true" : null,
    units: valueOf("units") || null,
  };
}

router.get(
  "/",
  ...pipeline({
    // `dataset` is the only param; the shared filter set does not apply.
    filters: false,
    // Same reasoning as /preview: this calls ERDDAP live, so cache the good
    // answer and never the failure, or every render re-hits a server that has
    // just failed. Short enough that a newly published slice shows up promptly.
    cacheFor: "5 minutes",
    cacheToggle: cache.onlyOk,
    checks: [check("dataset").isLength({ min: 1, max: 256 })],
  }),
  async (req, res, next) => {
    const { dataset } = req.query;

    // Same single-column lookup /preview does, and the same caveat: a
    // dataset_id published on two servers resolves to whichever row sorts
    // first, because the frontend only ever sends the id.
    const { rows } = await db.raw(
      `SELECT dataset_id, erddap_url
         FROM cde.datasets
        WHERE dataset_id = :dataset AND cdm_data_type = 'Grid'
        LIMIT 1`,
      { dataset },
    );
    if (!rows?.length) {
      return res.status(404).send({ error: "DATASET_NOT_FOUND", dataset });
    }
    const { dataset_id, erddap_url } = rows[0];
    const infoUrl = `${erddap_url}/info/${dataset_id}/index.json`;

    try {
      const { data } = await axios.get(infoUrl, { timeout: 30000 });
      const time = timeDimensionFrom(data?.table);
      if (!time || (!time.min && !time.max)) {
        // A static grid with no time axis. Not an error: the caller keeps the
        // harvested dimensions and its slider simply has nothing to move.
        return res
          .status(404)
          .send({ error: "NO_TIME_DIMENSION", dataset: dataset_id });
      }
      return res.send(time);
    } catch (error) {
      const status = error.response?.status;
      if (status === 404) {
        return res
          .status(404)
          .send({ error: "DATASET_NOT_FOUND", dataset: dataset_id });
      }
      console.error(
        "Griddap time range upstream failure",
        status,
        error.message,
      );
      Sentry.captureException(error, {
        tags: { route: "griddapTimeRange", erddap_status: status ?? "none" },
        extra: { infoUrl, dataset: dataset_id },
      });
      return res.status(502).send({
        error: "ERDDAP_UNAVAILABLE",
        dataset: dataset_id,
        upstreamStatus: status ?? null,
      });
    }
  },
);

module.exports = router;
module.exports.timeDimensionFrom = timeDimensionFrom;
module.exports.erddapTimeToIso = erddapTimeToIso;
