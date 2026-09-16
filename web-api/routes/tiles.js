require("dotenv").config({ quiet: true });
const express = require("express");

const router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { pipeline } = require("../utils/routePipeline");
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
  unionBranches,
} = require("../utils/selection");

// Per-tile cap on how many trajectories a single /tiles/tracks tile assembles.
// A low-zoom tile spans a huge area: with a long trail (e.g. "All time") its
// candidate set is ~the whole catalogue (measured ~107k of 107k trajectories in
// one z3 tile → a ~5 MB tile that OOMs the browser tab). The cap is applied at
// the candidate stage (before any point is pulled), so it bounds BOTH the
// payload and the server-side assembly cost. It is self-scaling: at high zoom a
// tile covers a small area with far fewer than the cap, so it never bites there
// (full detail when zoomed in); it only trims the low-zoom smear, keeping the
// most recently-active trajectories. Coverage hexes convey overall density at
// low zoom.
const TRACKS_MAX_PER_TILE = 2500;

// Spatial prefilter for the hex-aggregation tile queries (/tiles and
// /tiles/cells). Without it each tile UNIONs and GROUP BYs the ENTIRE cell
// tables (trajectory_hexes, obis_cells, profiles) and only
// clips to the tile at the very end — ~2.5 s of CPU per tile on every request
// (measured, buffers warm), which shows up as half-painted tiles and slow
// layer toggles (each toggle changes the tile URL and cold-refetches). This
// prunes each branch's scan to the tile region up front via the tables' geom
// GiST indexes. Hex membership stays the exact authority (the tile_hexes join
// in /tiles/cells; the final `h.geom && tile_envelope` in /tiles), so the
// prefilter only has to be a SUPERSET of the cells under the tile's hexes:
// expand the envelope by >= one hex diameter (hex_0 ~200 km for z<5, hex_1
// ~20 km for z>=5) so no cell of a hex straddling the tile edge is dropped.
// Verified byte-identical to the unfiltered query across z3-z10. Below
// PREFILTER_MIN_ZOOM the tile covers so much of the world that the GiST scan
// loses to a plain seq scan (measured a ~3x regression at z2), so return null
// there and leave the query unchanged.
const PREFILTER_MIN_ZOOM = 3;
function tileCellPrefilter(z) {
  const zi = Number(z);
  if (zi < PREFILTER_MIN_ZOOM) return null;
  // 2.5x the cell EDGE, i.e. comfortably more than its 2x diameter — the
  // prefilter only has to be a superset, so err wide.
  const hexDiameterM = tierForZoom(zi).edgeMetres * 2.5;
  const tileWidthM = 40075016.686 / 2 ** zi;
  const expandM = Math.ceil(Math.max(tileWidthM * 0.25, hexDiameterM));
  return `geom && ST_Expand(ST_TileEnvelope(:z, :x, :y), ${expandM})`;
}

// A predicate restricting a trajectory table to the requested types, or '' when
// the restriction would be a no-op. Both types requested needs no filter; none
// requested never reaches a branch (callers drop it instead), so the emptiness
// check here is belt-and-braces rather than a live case.
function trajectoryTypePredicate(types) {
  if (!types.length || types.length === ALL_TRAJECTORY_TYPES.length) return "";
  return `dataset_pk IN (SELECT pk FROM cde.datasets WHERE cdm_data_type IN (${types
    .map((t) => `'${t}'`)
    .join(",")}))`;
}

/**
 * /tiles/z/x/y/.mvt
 *
 * Tile generator - returns the hex shapes or points with some data attached
 * Takes all the filters
 */

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
/* GET /tiles/:z/:x/:y.mvt */
/* Retreive a vector tile by tileid */
router.get(
  "/:z/:x/:y.mvt",
  ...pipeline({ tileParams: {} }),
  async (req, res) => {
    const { z, x, y } = req.params;

    const filters = await createDBFilter(req.query);

    // zoom levels: 0-4,5-6,7+
    const isHexGrid = z < 7;
    // Which hex grid this zoom aggregates on, and the three names the schema
    // gives it — see utils/hexTiers.js. `tier` is a numeric literal from that
    // table, never user input.
    const {
      tier: hexTier,
      hexesTable,
      pointColumn: zoomPKColumn,
    } = tierForZoom(z);
    // Prune each branch's scan to the tile region (see tileCellPrefilter).
    const cellPrefilter = tileCellPrefilter(z);

    const includeObis = obisVisible(req.query);
    // What the hex/point `count` property means — see utils/hexMetric.js. The
    // same metric must reach /legend, or the ramp domain won't match the tiles.
    const metric = parseMetric(req.query.metric);
    // Data-type layer toggle (map layer selector). Trajectories: an explicit
    // includeTrajectory=false hides them. Profiles: the profileTypes comma
    // list names the cdm_data_types to show — see utils/dataTypes.js, which
    // owns the vocabulary the values are matched against (that match is what
    // makes them safe to inline into the branch SQL below).
    const profileTypes = requestedProfileTypes(req.query);
    const trajectoryToggledOn = req.query.includeTrajectory !== "false";
    const trajectoryTypes = requestedTrajectoryTypes(req.query);
    // ERDDAP-sourced data (profiles + trajectory coverage) is hidden wholesale
    // when the selection is OBIS-only — see utils/selection.js. The layer
    // toggles above narrow that further; they are display state, not part of
    // what the selection contains.
    const erddap = erddapVisible(req.query);
    const includeProfiles = erddap && profileTypes.length > 0;
    const includeTrajectory =
      trajectoryToggledOn && erddap && trajectoryTypes.length > 0;

    // At hex zoom we only need the hex FK and point_pk (for distinct counts);
    // the polygon is fetched once per hex via JOIN to hexes_zoom_*. At point
    // zoom we project the actual point geom.
    // Features spanning a region (show_as_point=false) are kept off the map
    // entirely — excluded from both the individual dots (z>=7) and the hex
    // aggregation counts (z<7). They remain searchable via the sidebar
    // geospatial filters (shapeQuery has no such gate). search_geom (the bbox
    // for profiles, the cell point otherwise) backs the shared spatial filter.
    // When only some profile types are requested, additionally restrict the
    // branch to datasets of those cdm_data_types (values allowlisted above →
    // safe to inline). All-three or none → no type filter (none never reaches
    // the branch).
    const profilesTypeFilter =
      profileTypes.length && profileTypes.length < ALL_PROFILE_TYPES.length
        ? ` AND dataset_pk IN (SELECT pk FROM cde.datasets WHERE cdm_data_type IN (${profileTypes
            .map((t) => `'${t}'`)
            .join(",")}))`
        : "";
    const profilesBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom, ${metricValueExpr("profiles", metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, bbox AS search_geom
    FROM cde.profiles ${metricJoin("profiles", metric)}
    WHERE ${DRAWN_AS_POINT}${profilesTypeFilter}${cellPrefilter ? ` AND ${cellPrefilter}` : ""} AND :profileFilters`;
    // Both cell tables (trajectory coverage cells and OBIS occurrence cells)
    // merge into the combined hex counts (z<7, the green ramp) but never
    // appear as individual points (z>=7). Their cell spacing is a grid
    // artifact, not a measurement location, so at point zoom they're shown
    // only via the dedicated always-hex coverage layer from
    // /tiles/cells/:z/:x/:y.mvt.
    // Same shape as profilesTypeFilter above: restrict to the requested
    // geometries when only some are on, and combine with the tile prefilter
    // into one WHERE (either, both, or neither can be present).
    const trajectoryConds = [
      cellPrefilter,
      trajectoryTypePredicate(trajectoryTypes),
    ].filter(Boolean);
    // cde.trajectory_hexes is already keyed on the hex, one row per
    // (dataset, trajectory, tier, hex) — hence `hex_pk as zoom_pk` and a tier
    // predicate where the other branches carry two hex FK columns. point_pk is
    // NULL because trajectory coverage never renders at the point tier.
    const trajectoryBranch = `SELECT NULL::integer as point_pk, dataset_pk, hex_pk as zoom_pk, geom as point_geom, ${metricValueExpr("trajectory_hexes", metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.trajectory_hexes ${metricJoin("trajectory_hexes", metric)}
    WHERE hex_tier = ${hexTier}${trajectoryConds.length ? ` AND ${trajectoryConds.join(" AND ")}` : ""}`;
    const obisBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom,
           ${metricValueExpr("obis_cells", metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.obis_cells ${metricJoin("obis_cells", metric)}
    WHERE :obisFilters${cellPrefilter ? ` AND ${cellPrefilter}` : ""}`;

    const branches = [];
    if (includeProfiles) branches.push(profilesBranch);
    // Trajectory coverage cells only join the combined hex counts at hex zoom;
    // at point zoom they're shown via the dedicated /tiles/cells layer.
    if (includeTrajectory && isHexGrid) branches.push(trajectoryBranch);
    if (includeObis && isHexGrid) branches.push(obisBranch);
    const combinedInner = unionBranches(branches, profilesBranch);

    // `count` is the same quantity at both tiers — the aggregated metric. It
    // used to be count(distinct point_pk) at hex zoom and a sum at point zoom,
    // so the property changed meaning mid-zoom and the hex ramp ranked a
    // 20-year mooring level with a single CTD cast. Aggregating the same way at
    // both tiers fixes the ramp and drops a distinct-aggregate at the same
    // time. What the aggregate IS depends on the metric — a sum for `records`,
    // a day-set union for `days` — which is why it comes from countAggregate
    // rather than being spelled out here.
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

    // Combine profiles and obis_cells so both appear on the map
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
/* GET /tiles/cells/:z/:x/:y.mvt */
/* Trajectory + OBIS coverage cells, always rendered as hexagons regardless of zoom */
router.get(
  "/cells/:z/:x/:y.mvt",
  ...pipeline({ tileParams: {} }),
  async (req, res) => {
    const { z, x, y } = req.params;

    const filters = await createDBFilter(req.query);

    // Only two hex grids exist (utils/hexTiers.js); the fine one is reused
    // uncapped past zoom 6 so coverage cells never become points.
    const {
      tier: hexTier,
      hexesTable,
      pointColumn: zoomPKColumn,
    } = tierForZoom(z);
    // Prune each branch's scan to the tile region (see tileCellPrefilter).
    const cellPrefilter = tileCellPrefilter(z);

    const includeObis = obisVisible(req.query);
    const metric = parseMetric(req.query.metric);
    // Trajectory cells are ERDDAP data, so an OBIS-only selection hides them
    // (utils/selection.js). On top of that, an explicit includeTrajectory=false
    // hides them — the trajectories layer toggle, and tracks mode (where track
    // lines replace the coverage hexes but OBIS cells stay) — and, since the
    // two trajectory geometries are separate layers, so does deselecting both.
    const trajectoryTypes = requestedTrajectoryTypes(req.query);
    const includeTrajectory =
      req.query.includeTrajectory !== "false" &&
      trajectoryTypes.length > 0 &&
      erddapVisible(req.query);

    // A `src` discriminator lets one pass over the union produce both the
    // unified count that colours the hex AND the per-kind figures the hover
    // tooltip names. trajectory_id is meaningless for OBIS cells and is only
    // ever read behind its own FILTER below.
    const trajectoryConds = [
      cellPrefilter,
      trajectoryTypePredicate(trajectoryTypes),
    ].filter(Boolean);
    const trajectoryBranch = `SELECT dataset_pk, hex_pk as zoom_pk, 'trajectory' as src,
           trajectory_id, ${metricValueExpr("trajectory_hexes", metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.trajectory_hexes ${metricJoin("trajectory_hexes", metric)}
    WHERE hex_tier = ${hexTier}${trajectoryConds.length ? ` AND ${trajectoryConds.join(" AND ")}` : ""}`;
    const obisBranch = `SELECT dataset_pk, :zoomPKColumn: as zoom_pk, 'obis' as src,
           NULL as trajectory_id, ${metricValueExpr("obis_cells", metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.obis_cells ${metricJoin("obis_cells", metric)}
    WHERE :obisFilters${cellPrefilter ? ` AND ${cellPrefilter}` : ""}`;

    const branches = [];
    if (includeTrajectory) branches.push(trajectoryBranch);
    if (includeObis) branches.push(obisBranch);
    const combinedInner = unionBranches(branches, trajectoryBranch);

    // The tile-envelope test is applied BEFORE the aggregation (hexes are
    // disjoint, so filtering hexes before or after grouping yields identical
    // tiles). This bounds each tile request to the cells under the visible
    // hexes — via the hex_0_pk/hex_1_pk indexes — instead of re-aggregating
    // the whole cell tables per tile. Grouping is by hex pk only, with the
    // polygon joined back afterwards, so the group sort runs over narrow rows
    // instead of spilling hex geometries to disk.
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
             -- What colours the hex: one ramp over both kinds of coverage
             -- cell, the same quantity the main /tiles layer emits.
             ${countAggregate(metric, "c")} count,
             -- Kept for the hover tooltip only. The ramp folds the two kinds
             -- together; the tooltip is where the breakdown stays reachable,
             -- since a trajectory fix and an occurrence record aren't the
             -- same unit.
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
 * /tiles/tracks/{z}/{x}/{y}.mvt:
 *   get:
 *     summary: Retrieve a vector tile of trajectory track lines and head positions
 *     tags: [Tiles]
 *     description: >
 *       Returns a Mapbox Vector Tile with TWO layers built from
 *       cde.trajectory_points: 'track-lines' (per-trajectory LineStrings over
 *       the requested time window, ordered by time, each carrying the segment's
 *       own 'time_min'/'time_max' as epoch ms) and 'track-heads' (each
 *       trajectory's latest fix within the window, with its 'head_time' and
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
/* GET /tiles/tracks/:z/:x/:y.mvt */
/* Trajectory track lines + head positions from cde.trajectory_points */
router.get(
  "/tracks/:z/:x/:y.mvt",
  // The cache duration is the shared default, like the other two tile routes.
  // It used to be spelled `cache.route({ binary: true })` — not an apicache
  // option, and the object landed in its `duration` slot, so apicache fell
  // back to its own 1-hour default. Nothing here can pass one by accident now.
  ...pipeline({ tileParams: {} }),
  async (req, res) => {
    const { z, x, y } = req.params;
    const { timeMin, timeMax } = req.query;

    // The scrub window is the whole point of this layer; unbounded queries
    // would assemble every trajectory's full track on every tile.
    if (!timeMin || !timeMax) {
      return res
        .status(400)
        .json({ errors: ["timeMin and timeMax are required for track tiles"] });
    }

    // Tracks are ERDDAP data, so the OBIS-only modes hide them wholesale —
    // the same gate as the hex, cell, legend and shape queries, which is the
    // point of it living in utils/selection.js. This route used to hand-pick
    // six filter keys, which dropped scientificNames on the floor: a taxon
    // selection left every track drawn over an otherwise OBIS-only map.
    //
    // Track lines are drawn for whichever trajectory geometries are switched
    // on. With neither on the client stops asking for this layer at all, but
    // answer honestly rather than serving every track if a request arrives.
    const trajectoryTypes = requestedTrajectoryTypes(req.query);
    if (
      !erddapVisible(req.query) ||
      !trajectoryTypes.length ||
      req.query.includeTrajectory === "false"
    ) {
      return res.status(204).send();
    }
    // The cand CTE already joins cde.datasets, so the type test rides along
    // there — filtering candidate trajectories before any fix is pulled.
    const trackTypeFilter =
      trajectoryTypes.length < ALL_TRAJECTORY_TYPES.length
        ? ` AND d.cdm_data_type IN (${trajectoryTypes.map((t) => `'${t}'`).join(",")})`
        : "";

    // Everything except the two fragments cde.trajectory_track_stats has no
    // column to answer: depth (tracks carry no depth extent) and pointPKs (a
    // profile-level key). The rest — including the polygon and the lat/lon
    // rectangle, which this route used to drop silently — applies against the
    // per-trajectory summary row, which the `cand` CTE exposes under the names
    // the shared filter is written in (see below).
    const { depthMin, depthMax, pointPKs, ...trackQuery } = req.query;
    const filters = await createDBFilter(trackQuery);

    // Correctness invariant: lines are assembled from the FULL time window
    // with no per-point spatial predicate — a segment can cross a tile that
    // neither of its endpoints is in. Spatial pruning happens only at
    // trajectory level, against the per-trajectory summary bbox (expanded by
    // 25% of the tile width so near-boundary tracks aren't missed), and
    // ST_AsMVTGeom does the actual clipping with its built-in buffer.
    const SQL = `
  WITH te AS (SELECT ST_TileEnvelope(:z, :x, :y) tile_envelope),
    -- The shared filter is written against the profile column names, so the
    -- candidate row carries them: the track's summary bbox stands in for
    -- search_geom (the spatial predicates are ST_Intersects against an extent
    -- either way), and the dataset columns the filter may reference ride along
    -- under the alias d that it qualifies pk_url/obis_nodes/erddap_url with.
    -- Selected here rather than in the outer WHERE because a SELECT alias is
    -- not visible to its own WHERE; the subquery has no LIMIT or grouping, so
    -- the planner flattens it and the bbox GiST index is still used.
    cand_rows AS (
      -- gap_secs: per-trajectory time-gap split threshold — 4x the
      -- trajectory's MEDIAN inter-fix gap (its typical reporting cadence,
      -- robust to idle periods; the mean fallback covers pre-migration NULL
      -- rows), floored at 48 hours. An Argo float's ~10-day cycles never
      -- split; a multi-expedition ship track (months dark between summers)
      -- or a monitoring vessel idle between short cruises always does,
      -- instead of drawing a connector chord across the map.
      -- The threshold lives in SQL (trajectory_gap_secs, 4_create_hexes.sql)
      -- because the hex coverage sweep applies the same one: a chord this
      -- route refuses to draw must not light hexes either.
      SELECT s.dataset_pk, s.trajectory_id, s.time_min, s.time_max,
             s.bbox AS search_geom,
             trajectory_gap_secs(
               s.median_gap_secs, s.time_min, s.time_max, s.n_points
             ) AS gap_secs,
             d.pk_url, d.eovs, d.platform, d.organization_pks,
             d.obis_nodes, d.erddap_url
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
      SELECT dataset_pk, trajectory_id, gap_secs
      FROM cand_rows d
      ${filters.hasShared ? "WHERE :filters" : ""}
      -- Cap per tile (see TRACKS_MAX_PER_TILE): keep the most recently-active
      -- trajectories; tie-break on the pk for deterministic, cache-stable tiles.
      ORDER BY time_max DESC, dataset_pk, trajectory_id
      LIMIT :maxTracksPerTile
    ),
    pts AS (
      SELECT p.dataset_pk, p.trajectory_id, p.time, p.longitude, p.latitude,
             p.geom, p.profile_id, d.pk_url, d.title AS dataset_title, c.gap_secs
      FROM cde.trajectory_points p
      JOIN cand c ON c.dataset_pk = p.dataset_pk
                 AND c.trajectory_id = p.trajectory_id
      JOIN cde.datasets d ON d.pk = p.dataset_pk
      WHERE p.time >= :timeMin::timestamptz
        AND p.time <= :timeMax::timestamptz
    ),
    -- Split tracks into segments, three break conditions:
    --   1. antimeridian: consecutive fixes jumping >180 deg of longitude
    --      would draw a line looping around the globe;
    --   2. large time gap (> per-trajectory gap_secs): no data = unknown
    --      path — draw nothing rather than a chord through possibly-land;
    --   3. outage chord: >50km between fixes closer than 96h in time. The
    --      harvester densifies data-backed chords to <=25km
    --      (TRACK_MAX_CHORD_KM), so a long chord on a sub-96h gap means a
    --      reporting outage on a fast platform (a ferry dark for a day
    --      covers hundreds of km) — unknown path again. The 96h guard keeps
    --      genuinely slow reporters (an Argo float drifts ~30-100km per
    --      10-day cycle) from being shredded by condition 3; their real
    --      gaps are handled by condition 2's cadence-scaled threshold.
    segs AS (
      SELECT *, sum(brk) OVER (
        PARTITION BY dataset_pk, trajectory_id ORDER BY time
      ) AS seg
      FROM (
        -- coalesce: each trajectory's first fix has no lag row, so the OR is
        -- NULL — left as-is it would sum() into a NULL seg discarded below.
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
      -- dataset_title rides along so a track-line click can name its dataset
      -- without a second lookup (MVT dedupes strings per layer, so the whole
      -- tile carries one copy of each title).
      --
      -- time_min/time_max are the segment's own span — when this segment was
      -- sailed, which is what a hover over it can honestly say. A single fix's
      -- instant is not available on a line: MVT properties are per feature, and
      -- a LineString is many fixes. Epoch ms, like head_time below, because MVT
      -- has no timestamp type.
      SELECT trajectory_id, pk_url, dataset_title,
             (extract(epoch FROM min(time)) * 1000)::bigint AS time_min,
             (extract(epoch FROM max(time)) * 1000)::bigint AS time_max,
             ST_MakeLine(geom ORDER BY time) AS geom
      FROM segs
      GROUP BY dataset_pk, trajectory_id, pk_url, dataset_title, seg
      HAVING count(*) >= 2
    ),
    heads AS (
      -- cog: course over ground at the head — spheroid azimuth (degrees
      -- clockwise from north) from the previous fix to the head fix. NULL
      -- when undefined: single-fix trajectories (lag is NULL) or a
      -- stationary platform (coincident fixes make ST_Azimuth NULL); the
      -- frontend renders those heads as circles instead of arrows.
      -- profile_id: the record this fix belongs to, for datasets whose
      -- trajectories are made of profiles (NULL for a plain Trajectory, whose
      -- fixes are not records). Free here — the head row is already this fix.
      SELECT DISTINCT ON (dataset_pk, trajectory_id)
             trajectory_id, pk_url, dataset_title, profile_id,
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
      -- Zoom-aware simplify before MVT encoding: tolerance = one MVT grid unit
      -- (tile width / 4096), the resolution ST_AsMVTGeom snaps to anyway, so it
      -- drops vertices that would collapse on encode — visually lossless, fewer
      -- vertices to encode/transfer at low zoom where tracks carry long history.
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
