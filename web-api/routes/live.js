const express = require("express");
const axios = require("axios");
const { check } = require("express-validator");

const router = express.Router();
const db = require("../db");
const cache = require("../utils/cache");
const { errorHandler } = require("../utils/validatorMiddlewares");

// Harvests run every few days, but some datasets update every minute. These
// routes read the current state straight from ERDDAP for the dataset the user
// is looking at, so "data through" and the latest position are live even
// though the harvested aggregates (hexes, counts) are not.
//
// Everything here is best-effort by design: an upstream server that is slow,
// down, or has dropped the dataset must leave the page showing harvested
// values, never an error. Each handler degrades to an empty/partial answer.
const UPSTREAM_TIMEOUT_MS = 15000;
// A tail is the gap since the last harvest. A dataset that has gone unharvested
// for months would otherwise return its whole history through this route.
const MAX_TAIL_ROWS = 5000;

const datasetCheck = check("dataset").isInt();

/** Latest row per group, degrading to [] on any upstream trouble. */
async function fetchTabledap(url) {
  try {
    const { data } = await axios.get(url, { timeout: UPSTREAM_TIMEOUT_MS });
    const { columnNames = [], rows = [] } = data?.table ?? {};
    return rows.map((row) =>
      Object.fromEntries(columnNames.map((name, i) => [name, row[i]])),
    );
  } catch (e) {
    // Expected whenever a server is down or the dataset was withdrawn; the
    // caller shows harvested values instead. Logged, not raised.
    console.warn(`live: upstream query failed (${e.message}): ${url}`);
    return [];
  }
}

/** The dataset row the /live/* routes need, or undefined. */
async function loadDataset(pkUrl) {
  const SQL = `
    SELECT d.pk, d.dataset_id, d.erddap_url, d.cdm_data_type, d.first_eov_column,
           d.source_time_max, d.last_updated_at,
           COALESCE(NULLIF(d.trajectory_id_variable, ''),
                    NULLIF(d.timeseries_id_variable, ''),
                    NULLIF(d.profile_id_variable, '')) AS id_variable
    FROM cde.datasets d
    WHERE d.pk_url = :pkUrl`;
  return (await db.raw(SQL, { pkUrl: parseInt(pkUrl, 10) })).rows[0];
}

/**
 * @swagger
 * /live/freshness:
 *   get:
 *     summary: Live "data through" for every dataset, straight from ERDDAP
 *     tags: [Live]
 *     description: >
 *       One allDatasets request per harvested ERDDAP server (a few KB each,
 *       column-selected), fetched in parallel. Servers that fail to answer are
 *       omitted, so the caller keeps their harvested values.
 *     responses:
 *       200:
 *         description: '{ [erddapUrl]: { [datasetId]: maxTime } }'
 */
router.get("/freshness", cache.route("5 minutes"), async (req, res) => {
  // Servers list far more than we harvest (one holds 1642 datasets for the 2 we
  // keep), so the harvested ids also serve as the response filter.
  const harvested = new Map();
  (
    await db.raw(
      "SELECT erddap_url, dataset_id FROM cde.datasets " +
        "WHERE erddap_url IS NOT NULL AND source_type IS DISTINCT FROM 'obis'",
    )
  ).rows.forEach(({ erddap_url, dataset_id }) => {
    if (!harvested.has(erddap_url)) harvested.set(erddap_url, new Set());
    harvested.get(erddap_url).add(dataset_id);
  });

  const entries = await Promise.all(
    [...harvested].map(async ([server, wanted]) => {
      const url =
        `${server.replace(/\/$/, "")}/tabledap/allDatasets.csv` +
        `?datasetID,maxTime&accessible=%22public%22`;
      try {
        const { data } = await axios.get(url, { timeout: UPSTREAM_TIMEOUT_MS });
        const byDataset = {};
        String(data)
          .split("\n")
          // Row 0 is the header and row 1 the units; data follows. (The
          // allDatasets self-row is dropped by the harvested filter below,
          // wherever the server places it.)
          .slice(2)
          .forEach((line) => {
            const [datasetId, maxTime] = line.split(",");
            // A dataset we never harvested has nothing to refresh, and a blank
            // maxTime (dataset with no rows) is not a freshness signal.
            const id = datasetId?.trim();
            if (id && wanted.has(id) && maxTime?.trim()) {
              byDataset[id] = maxTime.trim();
            }
          });
        return [server, byDataset];
      } catch (e) {
        console.warn(`live: freshness unavailable for ${server}: ${e.message}`);
        return null;
      }
    }),
  );

  res.send(Object.fromEntries(entries.filter(Boolean)));
});

/**
 * @swagger
 * /live/latest:
 *   get:
 *     summary: Latest observation for one dataset, straight from ERDDAP
 *     tags: [Live]
 *     description: >
 *       Returns the most recent row per station/trajectory (grouped by the
 *       dataset's id variable), so a multi-buoy dataset yields one marker each.
 *       Griddap datasets have no tabledap endpoint and return time only.
 *     parameters:
 *       - in: query
 *         name: dataset
 *         required: true
 *         schema: { type: integer }
 *         description: The dataset's pk_url.
 *     responses:
 *       200:
 *         description: Latest rows plus the harvest date the map coverage reflects.
 *       404:
 *         description: No such dataset.
 */
router.get(
  "/latest",
  [datasetCheck, errorHandler],
  cache.route("5 minutes"),
  async (req, res) => {
    const dataset = await loadDataset(req.query.dataset);
    if (!dataset) return res.status(404).send({ error: "Dataset not found" });

    const {
      dataset_id,
      erddap_url,
      first_eov_column,
      id_variable,
      source_time_max,
      last_updated_at,
    } = dataset;

    // Coverage on the map comes from the last harvest whatever happens here,
    // so every answer carries the date it reflects — that label is the whole
    // mitigation for hexes and counts being stale.
    const envelope = {
      source_time_max,
      coverage_through: last_updated_at,
      // Which returned column carries the observation itself: the caller sees
      // only column names, and cannot tell the dataset's variable from the
      // time/position ones.
      value_column: first_eov_column,
      latest: [],
    };

    // Griddap is metadata-only for us: no tabledap endpoint to query, so the
    // listing's maxTime (already in source_time_max) is all there is.
    if (dataset.cdm_data_type === "Grid") return res.send(envelope);

    const columns = ["time", "latitude", "longitude", first_eov_column]
      .filter(Boolean)
      // The id variable is what orderByMax groups on, so it must be selected.
      .concat(id_variable ? [id_variable] : [])
      .filter((c, i, all) => all.indexOf(c) === i);

    // orderByMax over (id, time) returns the last row per station/trajectory;
    // with no id variable it degrades to the single latest row overall.
    const orderBy = id_variable ? `${id_variable},time` : "time";
    const base =
      `${erddap_url.replace(/\/$/, "")}/tabledap/${dataset_id}.json` +
      `?${columns.join(",")}`;
    const grouped = `&orderByMax(%22${encodeURIComponent(orderBy)}%22)`;

    // Unconstrained, orderByMax makes ERDDAP scan the dataset's whole history —
    // enough to blow the timeout on a buoy with years of minute data. Anchoring
    // at the dataset's own last day bounds that work without changing the
    // answer: every group's newest row is in the window by construction, unless
    // one station stopped reporting a day before the others, whose stale row is
    // no longer a "latest observation" worth drawing anyway.
    envelope.latest = await fetchTabledap(
      `${base}&time%3E=max(time)-1day${grouped}`,
    );
    // max(time) constraints need ERDDAP 2.x; an older server rejects the query
    // and gets the (slower) unwindowed one it does understand.
    if (!envelope.latest.length) {
      envelope.latest = await fetchTabledap(`${base}${grouped}`);
    }
    res.send(envelope);
  },
);

/**
 * @swagger
 * /live/track:
 *   get:
 *     summary: The un-harvested tail of a trajectory
 *     tags: [Live]
 *     description: >
 *       Fixes recorded since the last harvest, in the same shape as
 *       /trajectories/track so the caller can append them to the drawn track.
 *       Capped at the newest 5000 fixes.
 *     parameters:
 *       - in: query
 *         name: dataset
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: trajectoryId
 *         schema: { type: string }
 *         description: Restrict to one trajectory; omit for all of them.
 *     responses:
 *       200:
 *         description: Tail coordinates/times, empty when nothing is newer.
 *       404:
 *         description: No such dataset.
 */
router.get(
  "/track",
  [
    datasetCheck,
    check("trajectoryId").optional().matches(/^[\w .:/\-]*$/).isLength({ max: 256 }),
    errorHandler,
  ],
  cache.route("5 minutes"),
  async (req, res) => {
    const { trajectoryId } = req.query;
    const dataset = await loadDataset(req.query.dataset);
    if (!dataset) return res.status(404).send({ error: "Dataset not found" });

    const { pk, dataset_id, erddap_url, id_variable, last_updated_at } = dataset;

    // The tail starts where the drawn track ends, so the two meet without a
    // gap or an overlap.
    const storedMax = (
      await db.raw(
        `SELECT MAX(time_max) AS time_max FROM cde.trajectory_track_stats
         WHERE dataset_pk = :pk` + (trajectoryId ? " AND trajectory_id = :trajectoryId" : ""),
        trajectoryId ? { pk, trajectoryId } : { pk },
      )
    ).rows[0]?.time_max;

    const envelope = {
      trajectory_id: trajectoryId ?? null,
      since: storedMax,
      coverage_through: last_updated_at,
      coordinates: [],
      times: [],
    };
    if (!storedMax) return res.send(envelope);

    const columns = ["time", "latitude", "longitude"]
      .concat(id_variable ? [id_variable] : [])
      .join(",");
    let url =
      `${erddap_url.replace(/\/$/, "")}/tabledap/${dataset_id}.json` +
      `?${columns}&time%3E${encodeURIComponent(new Date(storedMax).toISOString())}`;
    if (trajectoryId && id_variable) {
      url += `&${id_variable}=%22${encodeURIComponent(trajectoryId)}%22`;
    }

    // A fix with no position cannot extend the line.
    const rows = (await fetchTabledap(url)).filter(
      (r) => r.longitude != null && r.latitude != null,
    );
    // Newest N: the tail we care about is the recent end of a long gap.
    const tail = rows.slice(-MAX_TAIL_ROWS);
    envelope.n_points = tail.length;
    envelope.truncated = rows.length > tail.length;
    envelope.coordinates = tail.map((r) => [r.longitude, r.latitude]);
    envelope.times = tail.map((r) => r.time);
    res.send(envelope);
  },
);

module.exports = router;
