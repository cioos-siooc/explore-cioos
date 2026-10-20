require("dotenv").config({ quiet: true });
const express = require("express");

const router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { check } = require("express-validator");

const { pipeline, MAX_TILE_ZOOM } = require("../utils/routePipeline");
const {
  ALL_PROFILE_TYPES,
  ALL_TRAJECTORY_TYPES,
  requestedProfileTypes,
  requestedTrajectoryTypes,
} = require("../utils/dataTypes");
const {
  parseMetric,
  metricValueExpr,
  metricJoin,
  countAggregate,
} = require("../utils/hexMetric");
const { tierForZoom } = require("../utils/hexTiers");
const {
  erddapVisible,
  obisVisible,
  DRAWN_AS_POINT,
  coarseRollupBranch,
  unionBranches,
} = require("../utils/selection");

// A low-zoom tile with a long trail otherwise holds ~the whole catalogue
// (~107k trajectories in one z3 tile, a ~5 MB tile that OOMs the browser).
// Applied before any point is pulled; at high zoom it never bites.
const TRACKS_MAX_PER_TILE = 2500;

// Without this each tile aggregates the entire cell tables and clips at the
// end (~2.5 s CPU per tile). Hex membership stays the exact authority, so the
// prefilter only has to be a superset: the envelope is expanded by more than
// one hex diameter so no cell of a hex straddling the tile edge is dropped.
// Below PREFILTER_MIN_ZOOM the GiST scan loses to a seq scan (~3x slower at z2).
const PREFILTER_MIN_ZOOM = 3;
function tileCellPrefilter(z) {
  const zi = Number(z);
  if (zi < PREFILTER_MIN_ZOOM) return null;
  // 2.5x the cell edge, more than its 2x diameter: err wide.
  const hexDiameterM = tierForZoom(zi).edgeMetres * 2.5;
  const tileWidthM = 40075016.686 / 2 ** zi;
  const expandM = Math.ceil(Math.max(tileWidthM * 0.25, hexDiameterM));
  return `geom && ST_Expand(ST_TileEnvelope(:z, :x, :y), ${expandM})`;
}

// Type values are allowlisted in utils/dataTypes.js, so safe to inline.
function trajectoryTypePredicate(types) {
  if (!types.length || types.length === ALL_TRAJECTORY_TYPES.length) return "";
  return `dataset_pk IN (SELECT pk FROM cde.datasets WHERE cdm_data_type IN (${types
    .map((t) => `'${t}'`)
    .join(",")}))`;
}

function profileTypePredicate(types) {
  if (!types.length || types.length === ALL_PROFILE_TYPES.length) return "";
  return `dataset_pk IN (SELECT pk FROM cde.datasets WHERE cdm_data_type IN (${types
    .map((t) => `'${t}'`)
    .join(",")}))`;
}

/*
 * The tile routes and /tiles/datasets must agree exactly on which rows are in
 * play: the card reports each dataset's share of the very cell the tile drew.
 *
 * `prefilterFor(table)` prunes each branch's scan; returning null prunes
 * nothing.
 */

function requestedSources(query) {
  const erddap = erddapVisible(query);
  const profileTypes = requestedProfileTypes(query);
  const trajectoryTypes = requestedTrajectoryTypes(query);
  return {
    profileTypes,
    trajectoryTypes,
    includeObis: obisVisible(query),
    includeProfiles: erddap && profileTypes.length > 0,
    includeTrajectory:
      query.includeTrajectory !== "false" &&
      erddap &&
      trajectoryTypes.length > 0,
  };
}

// The `combined` CTE behind /tiles and /tiles/datasets?source=main: profiles,
// plus (at hex zoom only) trajectory coverage and OBIS cells.
function mainBranchesSQL(query, { metric, hexTier, isHexGrid, prefilterFor }) {
  const {
    profileTypes,
    trajectoryTypes,
    includeObis,
    includeProfiles,
    includeTrajectory,
  } = requestedSources(query);

  // Features spanning a region (show_as_point=false) are kept off the map
  // entirely but stay searchable via the sidebar (shapeQuery has no such gate).
  const profilesTypePredicate = profileTypePredicate(profileTypes);
  const profilesTypeFilter = profilesTypePredicate
    ? ` AND ${profilesTypePredicate}`
    : "";
  const profilesPrefilter = prefilterFor("profiles");
  const profilesBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom, ${metricValueExpr("profiles", metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, bbox AS search_geom
    FROM cde.profiles ${metricJoin("profiles", metric)}
    WHERE ${DRAWN_AS_POINT}${profilesTypeFilter}${profilesPrefilter ? ` AND ${profilesPrefilter}` : ""} AND :profileFilters`;
  // Cell tables never appear as individual points: their spacing is a grid
  // artifact, not a measurement location, so at point zoom they're shown only
  // via /tiles/cells.
  const trajectoryConds = [
    prefilterFor("trajectory_hexes"),
    trajectoryTypePredicate(trajectoryTypes),
  ].filter(Boolean);
  const trajectoryBranch = `SELECT NULL::integer as point_pk, dataset_pk, hex_pk as zoom_pk, geom as point_geom, ${metricValueExpr("trajectory_hexes", metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.trajectory_hexes ${metricJoin("trajectory_hexes", metric)}
    WHERE hex_tier = ${hexTier}${trajectoryConds.length ? ` AND ${trajectoryConds.join(" AND ")}` : ""}`;
  const obisPrefilter = prefilterFor("obis_cells");
  const obisBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom,
           ${metricValueExpr("obis_cells", metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.obis_cells ${metricJoin("obis_cells", metric)}
    WHERE :obisFilters${obisPrefilter ? ` AND ${obisPrefilter}` : ""}`;

  const branches = [];
  if (includeProfiles) branches.push(profilesBranch);
  if (includeTrajectory && isHexGrid) branches.push(trajectoryBranch);
  if (includeObis && isHexGrid) branches.push(obisBranch);
  return unionBranches(branches, profilesBranch);
}

function coarseRollupBranchesSQL(query, { metric }) {
  const {
    profileTypes,
    trajectoryTypes,
    includeObis,
    includeProfiles,
    includeTrajectory,
  } = requestedSources(query);
  const conds = [];
  if (includeProfiles) {
    conds.push(
      ["source = 'profiles'", profileTypePredicate(profileTypes)]
        .filter(Boolean)
        .join(" AND "),
    );
  }
  if (includeTrajectory) {
    conds.push(
      ["source = 'trajectory'", trajectoryTypePredicate(trajectoryTypes)]
        .filter(Boolean)
        .join(" AND "),
    );
  }
  if (includeObis) conds.push("source = 'obis'");
  return coarseRollupBranch(metric, conds, "zoom_pk");
}

// `src` lets one pass produce both the unified hex count and the per-kind
// tooltip figures; trajectory_id is only ever read behind its own FILTER.
function cellsBranchesSQL(query, { metric, hexTier, prefilterFor }) {
  const { trajectoryTypes, includeObis, includeTrajectory } =
    requestedSources(query);

  const trajectoryConds = [
    prefilterFor("trajectory_hexes"),
    trajectoryTypePredicate(trajectoryTypes),
  ].filter(Boolean);
  const trajectoryBranch = `SELECT dataset_pk, hex_pk as zoom_pk, 'trajectory' as src,
           trajectory_id, ${metricValueExpr("trajectory_hexes", metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.trajectory_hexes ${metricJoin("trajectory_hexes", metric)}
    WHERE hex_tier = ${hexTier}${trajectoryConds.length ? ` AND ${trajectoryConds.join(" AND ")}` : ""}`;
  const obisPrefilter = prefilterFor("obis_cells");
  const obisBranch = `SELECT dataset_pk, :zoomPKColumn: as zoom_pk, 'obis' as src,
           NULL as trajectory_id, ${metricValueExpr("obis_cells", metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.obis_cells ${metricJoin("obis_cells", metric)}
    WHERE :obisFilters${obisPrefilter ? ` AND ${obisPrefilter}` : ""}`;

  const branches = [];
  if (includeTrajectory) branches.push(trajectoryBranch);
  if (includeObis) branches.push(obisBranch);
  return unionBranches(branches, trajectoryBranch);
}

/**
 * @swagger
 * /tiles/{z}/{x}/{y}.mvt:
 *   get:
 *     summary: Retrieve a vector tile of map data
 *     tags: [Tiles]
 *     description: Returns a Mapbox Vector Tile containing either hex bins or points with dataset aggregation.
 *     parameters:
 *       - in: path
 *         name: z
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: x
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: y
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: metric
 *         description: >
 *           What the `count` property counts, and therefore what the colour
 *           ramp represents. `records` sums measurement/occurrence/fix counts;
 *           `days` sums each feature's day span; `datasets` counts distinct
 *           datasets. Anything else falls back to `records`. Must match the metric passed to /legend.
 *         schema: { type: string, enum: [records, days, datasets], default: records }
 *     responses:
 *       200:
 *         description: MVT binary tile.
 *         content:
 *           application/x-protobuf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get(
  "/:z/:x/:y.mvt",
  ...pipeline({ tileParams: {} }),
  async (req, res) => {
    const { z, x, y } = req.params;

    const filters = await createDBFilter(req.query);

    const isHexGrid = z < 7;
    // `tier` is a numeric literal from utils/hexTiers.js, never user input.
    const {
      tier: hexTier,
      hexesTable,
      pointColumn: zoomPKColumn,
    } = tierForZoom(z);
    const cellPrefilter = tileCellPrefilter(z);

    // The same metric must reach /legend, or the ramp domain won't match.
    const metric = parseMetric(req.query.metric);

    const combinedInner =
      hexTier === 0 && filters.datasetLevelOnly
        ? coarseRollupBranchesSQL(req.query, { metric })
        : mainBranchesSQL(req.query, {
            metric,
            hexTier,
            isHexGrid,
            prefilterFor: () => cellPrefilter,
          });

    // `count` must mean the same quantity at hex and point zoom, or the ramp
    // changes meaning mid-zoom.
    const relevantPointsSQL = isHexGrid
      ? `SELECT p.zoom_pk pk, ${countAggregate(metric, "p")} count,
                array_to_json(array_agg(distinct d.pk_url)) datasets,
                h.geom AS geom
         FROM combined p
         JOIN cde.datasets d ON p.dataset_pk = d.pk
         JOIN ${hexesTable} h ON h.pk = p.zoom_pk
         ${filters.hasShared ? "WHERE :filters" : ""}
         GROUP BY p.zoom_pk, h.geom`
      : `SELECT p.point_pk pk, d.platform as platform, ${countAggregate(metric, "p")} count,
                array_to_json(array_agg(distinct d.pk_url)) datasets,
                p.point_geom AS geom
         FROM combined p
         JOIN cde.datasets d ON p.dataset_pk = d.pk
         ${filters.hasShared ? "WHERE :filters" : ""}
         GROUP BY p.point_geom, p.point_pk, d.platform`;

    const SQL = `
  with combined as (
    ${combinedInner}
  ),
  relevent_points as (
    ${relevantPointsSQL}
  ),
    te AS (select ST_TileEnvelope(:z, :x, :y) tile_envelope ),
    mvtgeom AS (
      SELECT pk,count,
       ${isHexGrid ? "" : "platform,"} datasets,
        ST_AsMVTGeom (
          relevent_points.geom,
          tile_envelope
        ) AS geom
      FROM
        relevent_points, te
      WHERE relevent_points.geom && tile_envelope
    )
    SELECT ST_AsMVT(mvtgeom.*, 'internal-layer-name', 4096, 'geom') AS st_asmvt from mvtgeom;
  `;

    const tileRaw = await db.raw(SQL, {
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      profileFilters: filters.profileOnly,
      zoomPKColumn,
      z,
      x,
      y,
    });

    res.setHeader("Content-Type", "application/x-protobuf");
    res.status(200).send(tileRaw.rows[0].st_asmvt);
  },
);

/**
 * @swagger
 * /tiles/cells/{z}/{x}/{y}.mvt:
 *   get:
 *     summary: Retrieve a vector tile of coverage-cell hexes (trajectory + OBIS)
 *     tags: [Tiles]
 *     description: >
 *       Returns a Mapbox Vector Tile of trajectory and OBIS dataset coverage,
 *       always aggregated as hexagons — unlike /tiles/{z}/{x}/{y}.mvt this
 *       never falls back to individual points at high zoom. Each hex carries
 *       `count` — the summed metric over both kinds of cell, which is what the
 *       colour ramp reads — plus trajectory_count (distinct trajectories) and
 *       obis_count (the metric over OBIS cells alone) for the hover tooltip,
 *       which is where the per-source breakdown stays reachable now that the
 *       ramp folds the two together.
 *     parameters:
 *       - in: path
 *         name: z
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: x
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: y
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: timeMin
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: metric
 *         description: >
 *           What the `count` property counts, and therefore what the colour
 *           ramp represents. `records` sums measurement/occurrence/fix counts;
 *           `days` sums each feature's day span. Anything else falls back to
 *           `records`. Must match the metric passed to /legend.
 *         schema: { type: string, enum: [records, days, datasets], default: records }
 *     responses:
 *       200:
 *         description: MVT binary tile.
 *         content:
 *           application/x-protobuf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get(
  "/cells/:z/:x/:y.mvt",
  ...pipeline({ tileParams: {} }),
  async (req, res) => {
    const { z, x, y } = req.params;

    const filters = await createDBFilter(req.query);

    // The fine hex grid is reused uncapped past zoom 6 so coverage cells never
    // become points.
    const {
      tier: hexTier,
      hexesTable,
      pointColumn: zoomPKColumn,
    } = tierForZoom(z);
    const cellPrefilter = tileCellPrefilter(z);

    const metric = parseMetric(req.query.metric);

    const combinedInner = cellsBranchesSQL(req.query, {
      metric,
      hexTier,
      prefilterFor: () => cellPrefilter,
    });

    // The tile-envelope test runs before aggregation (hexes are disjoint, so
    // the result is identical) to bound the scan to the visible hexes. Grouping
    // by hex pk only, joining the polygon back after, keeps the sort from
    // spilling geometries to disk.
    const SQL = `
  with combined as (
    ${combinedInner}
  ),
    te AS (select ST_TileEnvelope(:z, :x, :y) tile_envelope ),
    tile_hexes AS (
      SELECT h.pk, h.geom
      FROM ${hexesTable} h, te
      WHERE h.geom && te.tile_envelope
    ),
    agg as (
      SELECT c.zoom_pk pk,
             ${countAggregate(metric, "c")} count,
             -- Tooltip only: a trajectory fix and an occurrence record aren't
             -- the same unit, so the breakdown stays reachable there.
             count(distinct (c.dataset_pk, c.trajectory_id))
               FILTER (WHERE c.src = 'trajectory') trajectory_count,
             ${countAggregate(metric, "c", "c.src = 'obis'")} obis_count,
             array_to_json(array_agg(distinct d.pk_url)) datasets
      FROM combined c
      JOIN cde.datasets d ON c.dataset_pk = d.pk
      JOIN tile_hexes th ON th.pk = c.zoom_pk
      ${filters.hasShared ? "WHERE :filters" : ""}
      GROUP BY c.zoom_pk
    ),
    mvtgeom AS (
      SELECT a.pk, a.count, a.trajectory_count, a.obis_count, a.datasets,
        ST_AsMVTGeom (
          th.geom,
          te.tile_envelope
        ) AS geom
      FROM agg a
      JOIN tile_hexes th ON th.pk = a.pk, te
    )
    SELECT ST_AsMVT(mvtgeom.*, 'coverage-hexes-layer', 4096, 'geom') AS st_asmvt from mvtgeom;
  `;

    const tileRaw = await db.raw(SQL, {
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      zoomPKColumn,
      z,
      x,
      y,
    });

    res.setHeader("Content-Type", "application/x-protobuf");
    res.status(200).send(tileRaw.rows[0].st_asmvt);
  },
);

/**
 * @swagger
 * /tiles/datasets:
 *   get:
 *     summary: Per-dataset metric for the tile buckets under a map click
 *     tags: [Tiles]
 *     description: >
 *       Splits a tile bucket's `count` among the datasets inside it, for the
 *       what's-here card. A tile carries only the bucket total and the list of
 *       dataset pks, and for `days` the per-dataset figure cannot be derived
 *       from the total: a bucket's day count is the UNION of its datasets' day
 *       sets, so a hex reading 1120 days can hold a mooring with 1115 and a
 *       single cast with 1. Takes the same filters and layer switches as the
 *       tile it describes, plus the clicked buckets, and aggregates exactly
 *       the rows that tile aggregated.
 *     parameters:
 *       - in: query
 *         name: z
 *         required: true
 *         description: >
 *           Zoom the click happened at; picks the hex tier and, for
 *           source=main, whether the cell layers are in play — exactly as the
 *           tile route does.
 *         schema: { type: integer }
 *       - in: query
 *         name: source
 *         description: >
 *           Which layer was clicked - `main` for /tiles (hexes and markers),
 *           `cells` for /tiles/cells (trajectory + OBIS coverage).
 *         schema: { type: string, enum: [main, cells], default: main }
 *       - in: query
 *         name: hexes
 *         description: Comma list of hex pks that were clicked.
 *         schema: { type: string }
 *       - in: query
 *         name: points
 *         description: >
 *           Comma list of point pks that were clicked (source=main at point
 *           zoom).
 *         schema: { type: string }
 *       - in: query
 *         name: metric
 *         schema: { type: string, enum: [records, days, datasets], default: records }
 *     responses:
 *       200:
 *         description: One row per dataset in the requested buckets.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   pk: { type: integer }
 *                   count: { type: integer }
 */
router.get(
  "/datasets",
  ...pipeline({
    checks: [
      check("z").isInt({ min: 0, max: MAX_TILE_ZOOM }),
      check("source").isIn(["main", "cells"]).optional(),
      // Bounded: a click gathers a handful of buckets, never hundreds.
      check(["hexes", "points"])
        .matches(/^[0-9]+(,[0-9]+)*$/)
        .isLength({ max: 2000 })
        .optional(),
    ],
  }),
  async (req, res) => {
    const filters = await createDBFilter(req.query);

    const { source = "main" } = req.query;
    const z = Number(req.query.z);
    const isHexGrid = z < 7;
    const { tier: hexTier, pointColumn: zoomPKColumn } = tierForZoom(z);
    const metric = parseMetric(req.query.metric);

    const hexPks = req.query.hexes ? req.query.hexes.split(",") : [];
    const pointPks = req.query.points ? req.query.points.split(",") : [];
    if (!hexPks.length && !pointPks.length) {
      return res.status(400).json({ errors: ["hexes or points is required"] });
    }

    // Pushed into each branch to prune the scan, like tileCellPrefilter.
    const prefilterFor = (table) => {
      if (pointPks.length && table === "profiles") {
        return "point_pk = ANY(:pointPks)";
      }
      if (!hexPks.length) return null;
      return table === "trajectory_hexes"
        ? "hex_pk = ANY(:hexPks)"
        : ":zoomPKColumn: = ANY(:hexPks)";
    };

    const combinedInner =
      source === "cells"
        ? cellsBranchesSQL(req.query, { metric, hexTier, prefilterFor })
        : mainBranchesSQL(req.query, {
            metric,
            hexTier,
            isHexGrid,
            prefilterFor,
          });

    // The bucket total is not recomputed: summing these parts would be wrong
    // for `days`, where they overlap. Grouped by pk_url because that is the id
    // the card holds.
    const SQL = `
  with combined as (
    ${combinedInner}
  )
  SELECT d.pk_url pk, ${countAggregate(metric, "p")} count
  FROM combined p
  JOIN cde.datasets d ON p.dataset_pk = d.pk
  WHERE d.pk_url IS NOT NULL${filters.hasShared ? " AND :filters" : ""}
  GROUP BY d.pk_url
  ORDER BY count DESC`;

    const { rows } = await db.raw(SQL, {
      filters: filters.shared,
      obisFilters: filters.obisOnly,
      profileFilters: filters.profileOnly,
      zoomPKColumn,
      hexPks,
      pointPks,
    });

    return res
      .status(200)
      .json(
        rows.map((row) => ({ pk: Number(row.pk), count: Number(row.count) })),
      );
  },
);

/**
 * @swagger
 * /tiles/tracks/{z}/{x}/{y}.mvt:
 *   get:
 *     summary: Retrieve a vector tile of trajectory track lines and head positions
 *     tags: [Tiles]
 *     description: >
 *       Returns a Mapbox Vector Tile with TWO layers built from
 *       cde.trajectory_points: 'track-lines' (per-trajectory LineStrings over
 *       the requested time window, ordered by time, each carrying the segment's
 *       own 'time_min'/'time_max' as epoch ms) and 'track-heads' (each
 *       trajectory's position on the selected date, the window's last day:
 *       its latest fix, kept only when the trajectory runs to that day and
 *       the fix is within its reporting gap of it; with its 'head_time' and
 *       'profile_id', and 'cog' — course over
 *       ground in degrees clockwise from north, absent when undefined).
 *       timeMin/timeMax are
 *       REQUIRED — the window is the scrub bar's trailing interval. Clients
 *       should snap the window to UTC day boundaries so the URL-keyed tile
 *       cache gets high hit rates across scrubs and users.
 *     parameters:
 *       - in: path
 *         name: z
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: x
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: y
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: timeMin
 *         required: true
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: timeMax
 *         required: true
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: MVT binary tile (layers track-lines + track-heads).
 *         content:
 *           application/x-protobuf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get(
  "/tracks/:z/:x/:y.mvt",
  ...pipeline({ tileParams: {} }),
  async (req, res) => {
    const { z, x, y } = req.params;
    const { timeMin, timeMax } = req.query;

    // Unbounded queries would assemble every trajectory's full track per tile.
    if (!timeMin || !timeMax) {
      return res
        .status(400)
        .json({ errors: ["timeMin and timeMax are required for track tiles"] });
    }

    // Tracks are ERDDAP data, so the OBIS-only modes hide them wholesale.
    const trajectoryTypes = requestedTrajectoryTypes(req.query);
    if (
      !erddapVisible(req.query) ||
      !trajectoryTypes.length ||
      req.query.includeTrajectory === "false"
    ) {
      return res.status(204).send();
    }
    const trackTypeFilter =
      trajectoryTypes.length < ALL_TRAJECTORY_TYPES.length
        ? ` AND d.cdm_data_type IN (${trajectoryTypes.map((t) => `'${t}'`).join(",")})`
        : "";

    // cde.trajectory_track_stats has no column for depth or pointPKs.
    const { depthMin, depthMax, pointPKs, ...trackQuery } = req.query;
    const filters = await createDBFilter(trackQuery);

    // Lines are assembled with no per-point spatial predicate, since a segment
    // can cross a tile neither endpoint is in; pruning is per trajectory only,
    // against its bbox expanded by 25% of the tile width.
    const SQL = `
  WITH te AS (SELECT ST_TileEnvelope(:z, :x, :y) tile_envelope),
    -- The shared filter is written against the profile column names and the
    -- dataset alias d, so the candidate row carries them. A SELECT alias is
    -- not visible to its own WHERE, hence the separate CTE; the planner
    -- flattens it and the bbox GiST index is still used.
    cand_rows AS (
      -- The gap threshold lives in SQL (4_create_hexes.sql) because the hex
      -- coverage sweep applies the same one: a chord this route refuses to
      -- draw must not light hexes either.
      SELECT s.dataset_pk, s.trajectory_id, s.time_min, s.time_max,
             s.bbox AS search_geom,
             trajectory_gap_secs(
               s.median_gap_secs, s.time_min, s.time_max, s.n_points
             ) AS gap_secs,
             d.pk_url, d.eovs, d.platform, d.organization_pks,
             d.obis_nodes, d.erddap_url,
             d.coverage_time_max, d.verified_at, d.cdm_data_type
      FROM cde.trajectory_track_stats s
      JOIN cde.datasets d ON d.pk = s.dataset_pk, te
      WHERE s.bbox && ST_Expand(
              te.tile_envelope,
              (ST_XMax(te.tile_envelope) - ST_XMin(te.tile_envelope)) * 0.25
            )
        AND s.time_max >= :timeMin::timestamptz
        AND s.time_min <= :timeMax::timestamptz
        ${trackTypeFilter}
    ),
    cand AS (
      SELECT dataset_pk, trajectory_id, gap_secs, time_max
      FROM cand_rows d
      ${filters.hasShared ? "WHERE :filters" : ""}
      -- Tie-break on the pk for deterministic, cache-stable tiles.
      ORDER BY time_max DESC, dataset_pk, trajectory_id
      LIMIT :maxTracksPerTile
    ),
    pts AS (
      SELECT p.dataset_pk, p.trajectory_id, p.time, p.longitude, p.latitude,
             p.geom, p.profile_id, d.pk_url, d.title AS dataset_title, c.gap_secs,
             c.time_max AS trajectory_end
      FROM cde.trajectory_points p
      JOIN cand c ON c.dataset_pk = p.dataset_pk
                 AND c.trajectory_id = p.trajectory_id
      JOIN cde.datasets d ON d.pk = p.dataset_pk
      WHERE p.time >= :timeMin::timestamptz
        AND p.time <= :timeMax::timestamptz
    ),
    -- Segment breaks: an antimeridian jump; a time gap beyond gap_secs
    -- (unknown path, so no chord through possibly-land); or >50km between
    -- fixes under 96h apart, since the harvester densifies data-backed chords
    -- to 25km (TRACK_MAX_CHORD_KM), so a long chord means a reporting outage.
    -- The 96h guard keeps slow reporters like Argo floats from being shredded.
    segs AS (
      SELECT *, sum(brk) OVER (
        PARTITION BY dataset_pk, trajectory_id ORDER BY time
      ) AS seg
      FROM (
        -- The first fix has no lag row; a NULL brk would sum into a NULL seg.
        SELECT *, coalesce((
          abs(longitude - lag(longitude) OVER w) > 180
          OR extract(epoch FROM time - lag(time) OVER w) > gap_secs
          OR (
            ST_DistanceSphere(
              ST_MakePoint(longitude, latitude),
              ST_MakePoint(lag(longitude) OVER w, lag(latitude) OVER w)
            ) > 50000
            AND extract(epoch FROM time - lag(time) OVER w) < 345600
          )
        )::int, 0) AS brk
        FROM pts
        WINDOW w AS (PARTITION BY dataset_pk, trajectory_id ORDER BY time)
      ) q
    ),
    lines AS (
      -- MVT dedupes strings per layer, so carrying dataset_title is cheap.
      -- Times are epoch ms because MVT has no timestamp type.
      SELECT trajectory_id, pk_url, dataset_title,
             (extract(epoch FROM min(time)) * 1000)::bigint AS time_min,
             (extract(epoch FROM max(time)) * 1000)::bigint AS time_max,
             ST_MakeLine(geom ORDER BY time) AS geom
      FROM segs
      GROUP BY dataset_pk, trajectory_id, pk_url, dataset_title, seg
      HAVING count(*) >= 2
    ),
    heads AS (
      -- cog is NULL for single-fix or stationary trajectories; the frontend
      -- renders those heads as circles instead of arrows.
      SELECT DISTINCT ON (dataset_pk, trajectory_id)
             trajectory_id, pk_url, dataset_title, profile_id, time,
             gap_secs, trajectory_end,
             (extract(epoch FROM time) * 1000)::bigint AS head_time,
             round(degrees(ST_Azimuth(
               ST_SetSRID(ST_MakePoint(lag(longitude) OVER w, lag(latitude) OVER w), 4326)::geography,
               ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
             )))::int AS cog,
             geom
      FROM pts
      WINDOW w AS (PARTITION BY dataset_pk, trajectory_id ORDER BY time)
      ORDER BY dataset_pk, trajectory_id, time DESC
    ),
    line_mvt AS (
      -- Tolerance is one MVT grid unit, the resolution ST_AsMVTGeom snaps to
      -- anyway, so the simplify is visually lossless.
      SELECT l.trajectory_id, l.pk_url, l.dataset_title, l.time_min, l.time_max,
             ST_AsMVTGeom(
               ST_Simplify(
                 l.geom,
                 (ST_XMax(te.tile_envelope) - ST_XMin(te.tile_envelope)) / 4096.0
               ),
               te.tile_envelope
             ) AS geom
      FROM lines l, te
      WHERE l.geom && te.tile_envelope
    ),
    head_mvt AS (
      SELECT h.trajectory_id, h.pk_url, h.dataset_title, h.profile_id,
             h.head_time, h.cog,
             ST_AsMVTGeom(h.geom, te.tile_envelope) AS geom
      FROM heads h, te
      WHERE h.geom && te.tile_envelope
        -- A head is the position on the selected date, the window's last day:
        -- an ended trajectory, or one silent past its own gap threshold, has
        -- none. Filtered after DISTINCT ON so cog still sees the prior fix.
        AND h.trajectory_end >= :timeMax::timestamptz - interval '1 day'
        AND h.time >= :timeMax::timestamptz - interval '1 day'
                      - make_interval(secs => h.gap_secs)
    )
    -- A valid MVT is a concatenation of layer messages.
    SELECT coalesce((SELECT ST_AsMVT(l.*, 'track-lines', 4096, 'geom') FROM line_mvt l), ''::bytea)
        || coalesce((SELECT ST_AsMVT(h.*, 'track-heads', 4096, 'geom') FROM head_mvt h), ''::bytea)
        AS st_asmvt;
  `;

    const tileRaw = await db.raw(SQL, {
      filters: filters.shared,
      timeMin,
      timeMax,
      maxTracksPerTile: TRACKS_MAX_PER_TILE,
      z,
      x,
      y,
    });

    res.setHeader("Content-Type", "application/x-protobuf");
    res.status(200).send(tileRaw.rows[0].st_asmvt);
  },
);

module.exports = router;
