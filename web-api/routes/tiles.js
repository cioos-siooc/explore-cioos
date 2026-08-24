require("dotenv").config();
const express = require("express");

const router = express.Router();
const db = require("../db");
const createDBFilter = require("../utils/dbFilter");
const { validatorMiddleware } = require("../utils/validatorMiddlewares");
const cache = require("../utils/cache");
const {
  parseMetric,
  recordCountExpr,
  countAggregate,
} = require("../utils/hexMetric");

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
  const hexDiameterM = zi < 5 ? 250000 : 25000; // > true diameter (hex_0 200km / hex_1 20km)
  const tileWidthM = 40075016.686 / 2 ** zi;
  const expandM = Math.ceil(Math.max(tileWidthM * 0.25, hexDiameterM));
  return `geom && ST_Expand(ST_TileEnvelope(:z, :x, :y), ${expandM})`;
}

// The cdm_data_types that share cde.trajectory_hexes / cde.trajectory_points.
// They are separate layers in the map's geometry selector, so the routes below
// take a trajectoryTypes param that works exactly like profileTypes: absent =
// both (pre-split behaviour, and what any older client sends), a comma list =
// only those, empty = neither. Values are matched against this fixed set, which
// is what makes them safe to inline into the branch SQL.
const ALL_TRAJECTORY_TYPES = ["Trajectory", "TrajectoryProfile"];

function requestedTrajectoryTypes(query) {
  if (query.trajectoryTypes === undefined) return ALL_TRAJECTORY_TYPES;
  return String(query.trajectoryTypes)
    .split(",")
    .filter((t) => ALL_TRAJECTORY_TYPES.includes(t));
}

// Point is the one cdm_data_type that is not tied to a single table: the
// harvester stores a small Point dataset as exact rows in cde.profiles and a
// large one as day/hex coverage in cde.trajectory_hexes, sharing the
// trajectory pipeline as a single unnamed pseudo-trajectory (see the Point
// handler).
// A dataset's rows only ever live in ONE of them, so naming Point in both
// allowlists yields the right union without the client needing to know which
// table any given dataset landed in.
//
// Which means the Point layer is carried on the profileTypes param alone —
// one switch, both branches — and ALL_TRAJECTORY_TYPES stays as it was, since
// it also drives /tiles/tracks where Point has nothing to contribute.
const ALL_CELL_TYPES = [...ALL_TRAJECTORY_TYPES, "Point"];

function requestedCellTypes(query, profileTypes) {
  const types = requestedTrajectoryTypes(query);
  return profileTypes.includes("Point") ? [...types, "Point"] : types;
}

// A predicate restricting a cell table to the requested types, or '' when the
// restriction would be a no-op. Every type requested needs no filter; none
// requested never reaches a branch (callers drop it instead), so the emptiness
// check here is belt-and-braces rather than a live case.
function cellTypePredicate(types) {
  if (!types.length || types.length === ALL_CELL_TYPES.length) return "";
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
  validatorMiddleware(),
  cache.route(),
  async (req, res) => {
    const { z, x, y } = req.params;

    let filters;
    try {
      filters = await createDBFilter(req.query);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }

    // zoom levels: 0-4,5-6,7+
    const isHexGrid = z < 7;
    const zoomPKColumn = z < 5 ? "hex_0_pk" : "hex_1_pk";
    const hexesTable = z < 5 ? "cde.hexes_zoom_0" : "cde.hexes_zoom_1";
    // cde.trajectory_hexes stores one row per tier instead of two hex FK
    // columns (each tier's day count is aggregated independently, so they
    // can't share a row). Numeric literal, never user input.
    const hexTier = z < 5 ? 0 : 1;
    // Prune each branch's scan to the tile region (see tileCellPrefilter).
    const cellPrefilter = tileCellPrefilter(z);

    const includeObis = req.query.includeObis !== 'false';
    // What the hex/point `count` property means — see utils/hexMetric.js. The
    // same metric must reach /legend, or the ramp domain won't match the tiles.
    const metric = parseMetric(req.query.metric);
    // Data-type layer toggle (map layer selector). Trajectories: an explicit
    // includeTrajectory=false hides them. Profiles: the profileTypes param is
    // the comma list of cdm_data_types to show (Profile / TimeSeries /
    // TimeSeriesProfile / Point — all four can appear in cde.profiles);
    // absent = all of them (pre-toggle behaviour), empty = none. Values are
    // validated against the fixed set below so they can be inlined into the
    // branch SQL safely.
    const ALL_PROFILE_TYPES = ['Profile', 'TimeSeries', 'TimeSeriesProfile', 'Point'];
    const profileTypes = req.query.profileTypes === undefined
      ? ALL_PROFILE_TYPES
      : String(req.query.profileTypes)
          .split(',')
          .filter((t) => ALL_PROFILE_TYPES.includes(t));
    const trajectoryToggledOn = req.query.includeTrajectory !== 'false';
    // ERDDAP-sourced data (profiles + coverage cells) is hidden wholesale
    // when an OBIS-only filter is active: scientific-name filters are
    // OBIS-only, and an OBIS-node selection also hides it, unless ERDDAP
    // servers are selected alongside it (combined Source filter — show both,
    // OR'd in the shared dataset filter).
    const erddapVisible = !req.query.scientificNames
      && (!req.query.obisNodes || Boolean(req.query.erddapServers));
    const includeProfiles = erddapVisible && profileTypes.length > 0;
    // includeTrajectory=false is the trajectory layer's own switch (tracks
    // mode, where lines replace the coverage hexes). It must not take Point
    // cells down with it — those belong to a different layer that happens to
    // share the table.
    const cellTypes = requestedCellTypes(req.query, profileTypes);
    const visibleCellTypes = trajectoryToggledOn
      ? cellTypes
      : cellTypes.filter((t) => t === 'Point');
    const includeCells = erddapVisible && visibleCellTypes.length > 0;

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
    // safe to inline). All of them, or none → no type filter (none never
    // reaches the branch).
    const profilesTypeFilter =
      profileTypes.length && profileTypes.length < ALL_PROFILE_TYPES.length
        ? ` AND dataset_pk IN (SELECT pk FROM cde.datasets WHERE cdm_data_type IN (${profileTypes
            .map((t) => `'${t}'`)
            .join(',')}))`
        : '';
    const profilesBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom, ${recordCountExpr('profiles', metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, bbox AS search_geom
    FROM cde.profiles WHERE show_as_point${profilesTypeFilter}${cellPrefilter ? ` AND ${cellPrefilter}` : ''} AND :profileFilters`;
    // Both cell tables (trajectory + Point coverage hexes and OBIS occurrence
    // cells) merge into the combined hex counts (z<7, the green ramp) but
    // never appear as individual points (z>=7). Their cell spacing is a grid
    // artifact, not a measurement location, so at point zoom they're shown
    // only via the dedicated always-hex coverage layer from
    // /tiles/cells/:z/:x/:y.mvt.
    // Same shape as profilesTypeFilter above: restrict to the requested
    // geometries when only some are on, and combine with the tile prefilter
    // into one WHERE (either, both, or neither can be present).
    const cellConds = [
      cellPrefilter,
      cellTypePredicate(visibleCellTypes),
    ].filter(Boolean);
    // cde.trajectory_hexes is already keyed on the hex, one row per
    // (dataset, trajectory, tier, hex) — hence `hex_pk as zoom_pk` and a tier
    // predicate where the other branches carry two hex FK columns. point_pk is
    // NULL because trajectory/Point coverage never renders at the point tier
    // (a large Point dataset lands here too — see the Point handler — sharing
    // this table via cellTypePredicate rather than a dedicated one).
    const cellBranch = `SELECT NULL::integer as point_pk, dataset_pk, hex_pk as zoom_pk, geom as point_geom, ${recordCountExpr('trajectory_hexes', metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.trajectory_hexes WHERE hex_tier = ${hexTier}${cellConds.length ? ` AND ${cellConds.join(' AND ')}` : ''}`;
    const obisBranch = `SELECT point_pk, dataset_pk, :zoomPKColumn: as zoom_pk, geom as point_geom,
           ${recordCountExpr('obis_cells', metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.obis_cells
    WHERE :obisFilters${cellPrefilter ? ` AND ${cellPrefilter}` : ''}`;

    const branches = [];
    if (includeProfiles) branches.push(profilesBranch);
    // Coverage cells only join the combined hex counts at hex zoom; at point
    // zoom they're shown via the dedicated /tiles/cells layer.
    if (includeCells && isHexGrid) branches.push(cellBranch);
    if (includeObis && isHexGrid) branches.push(obisBranch);
    // Guard: if nothing to show, return an empty CTE that still has the right
    // columns. Wrapped in a subquery so it holds even when profilesBranch
    // carries its own WHERE (profile-type filter).
    const combinedInner = branches.length
      ? branches.join("\n    UNION ALL\n    ")
      : `SELECT * FROM (${profilesBranch}) empty_combined WHERE FALSE`;

    // `count` is the same quantity at both tiers — the summed metric. It used
    // to be count(distinct point_pk) at hex zoom and sum(record_count) at point
    // zoom, so the property changed meaning mid-zoom and the hex ramp ranked a
    // 20-year mooring level with a single CTD cast. Summing at both tiers fixes
    // the ramp and drops a distinct-aggregate at the same time.
    const relevantPointsSQL = isHexGrid
      ? `SELECT p.zoom_pk pk, ${countAggregate(metric, 'p')} count,
                array_to_json(array_agg(distinct d.pk_url)) datasets,
                h.geom AS geom
         FROM combined p
         JOIN cde.datasets d ON p.dataset_pk = d.pk
         JOIN ${hexesTable} h ON h.pk = p.zoom_pk
         ${filters.hasShared ? "WHERE :filters" : ""}
         GROUP BY p.zoom_pk, h.geom`
      : `SELECT p.point_pk pk, d.platform as platform, ${countAggregate(metric, 'p')} count,
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

    try {
      const q = db.raw(SQL, {
        filters: filters.shared,
        obisFilters: filters.obisOnly,
        profileFilters: filters.profileOnly,
        zoomPKColumn,
        z,
        x,
        y,
      });

      const tileRaw = await q;
      const tile = tileRaw.rows[0];

      res.setHeader("Content-Type", "application/x-protobuf");
      res.status(200).send(tile.st_asmvt);
    } catch (e) {
      console.error(e);
      res.status(500).send({
        error: e.toString(),
      });
    }
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
  validatorMiddleware(),
  cache.route(),
  async (req, res) => {
    const { z, x, y } = req.params;

    let filters;
    try {
      filters = await createDBFilter(req.query);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }

    // Only two hex grids exist (hex_0 for z<5, hex_1 for z>=5); hex_1 is
    // reused uncapped past zoom 6 so coverage cells never become points.
    const zoomPKColumn = z < 5 ? "hex_0_pk" : "hex_1_pk";
    const hexesTable = z < 5 ? "cde.hexes_zoom_0" : "cde.hexes_zoom_1";
    const hexTier = z < 5 ? 0 : 1; // see the main tile route
    // Prune each branch's scan to the tile region (see tileCellPrefilter).
    const cellPrefilter = tileCellPrefilter(z);

    const includeObis = req.query.includeObis !== 'false';
    const metric = parseMetric(req.query.metric);
    // Same gating as the main tile route: scientific-name filters are
    // OBIS-only, so they hide the (ERDDAP) coverage cells; an OBIS-node
    // selection does too, unless ERDDAP servers are selected alongside it.
    // On top of that, an explicit includeTrajectory=false hides the
    // trajectory ones — the trajectories layer toggle, and tracks mode (where
    // track lines replace the coverage hexes but OBIS cells stay). Large
    // Point datasets share this table but not that switch, so they survive it.
    // ...and, since the geometries are separate layers, the requested subset
    // of them; with none on there is nothing to draw.
    const cellProfileTypes = req.query.profileTypes === undefined
      ? ['Point']
      : String(req.query.profileTypes).split(',');
    const cellTypes = requestedCellTypes(req.query, cellProfileTypes);
    const visibleCellTypes = req.query.includeTrajectory !== 'false'
      ? cellTypes
      : cellTypes.filter((t) => t === 'Point');
    const includeCells = visibleCellTypes.length > 0
      && !req.query.scientificNames
      && (!req.query.obisNodes || Boolean(req.query.erddapServers));

    // A `src` discriminator lets one pass over the union produce both the
    // unified count that colours the hex AND the per-kind figures the hover
    // tooltip names. trajectory_id is meaningless for OBIS cells and is only
    // ever read behind its own FILTER below.
    const trajectoryConds = [
      cellPrefilter,
      cellTypePredicate(visibleCellTypes),
    ].filter(Boolean);
    const trajectoryBranch = `SELECT dataset_pk, hex_pk as zoom_pk, 'trajectory' as src,
           trajectory_id, ${recordCountExpr('trajectory_hexes', metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.trajectory_hexes WHERE hex_tier = ${hexTier}${trajectoryConds.length ? ` AND ${trajectoryConds.join(' AND ')}` : ''}`;
    const obisBranch = `SELECT dataset_pk, :zoomPKColumn: as zoom_pk, 'obis' as src,
           NULL as trajectory_id, ${recordCountExpr('obis_cells', metric)},
           time_min, time_max, latitude, longitude, depth_min, depth_max, geom AS search_geom
    FROM cde.obis_cells
    WHERE :obisFilters${cellPrefilter ? ` AND ${cellPrefilter}` : ''}`;

    const branches = [];
    if (includeCells) branches.push(trajectoryBranch);
    if (includeObis) branches.push(obisBranch);
    // Guard: if nothing to show, return an empty CTE that still has the right
    // columns. Wrapped in a subquery so it holds even when trajectoryBranch
    // carries its own WHERE (the tile prefilter, present from z3 up).
    const combinedInner = branches.length
      ? branches.join("\n    UNION ALL\n    ")
      : `SELECT * FROM (${trajectoryBranch}) empty_combined WHERE FALSE`;

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
             ${countAggregate(metric, 'c')} count,
             -- Kept for the hover tooltip only. The ramp folds the two kinds
             -- together; the tooltip is where the breakdown stays reachable,
             -- since a trajectory fix and an occurrence record aren't the
             -- same unit.
             count(distinct (c.dataset_pk, c.trajectory_id))
               FILTER (WHERE c.src = 'trajectory') trajectory_count,
             coalesce(sum(c.record_count) FILTER (WHERE c.src = 'obis'), 0)::bigint obis_count,
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

    try {
      const q = db.raw(SQL, {
        filters: filters.shared,
        obisFilters: filters.obisOnly,
        zoomPKColumn,
        z,
        x,
        y,
      });

      const tileRaw = await q;
      const tile = tileRaw.rows[0];

      res.setHeader("Content-Type", "application/x-protobuf");
      res.status(200).send(tile.st_asmvt);
    } catch (e) {
      console.error(e);
      res.status(500).send({
        error: e.toString(),
      });
    }
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
 *       the requested time window, ordered by time) and 'track-heads' (each
 *       trajectory's latest fix within the window, with 'cog' — course over
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
  validatorMiddleware(),
  cache.route({ binary: true }),
  async (req, res) => {
    const { z, x, y } = req.params;
    const { timeMin, timeMax } = req.query;

    // The scrub window is the whole point of this layer; unbounded queries
    // would assemble every trajectory's full track on every tile.
    if (!timeMin || !timeMax) {
      return res
        .status(400)
        .json({ error: "timeMin and timeMax are required for track tiles" });
    }

    // Only dataset-level filters apply here. The shared filter's per-point
    // fragments (depth_min/max, lat/lon bounds, polygon-on-geom, pointPKs,
    // and its OWN time fragments which target time_min/time_max columns)
    // reference columns cde.trajectory_track_stats doesn't have — the time
    // window is bound explicitly below instead.
    const datasetLevelQuery = {};
    ["eovs", "platforms", "datasetPKs", "organizations", "obisNodes", "erddapServers"]
      .forEach((k) => { if (req.query[k]) datasetLevelQuery[k] = req.query[k]; });

    // Track lines are drawn for whichever trajectory geometries are switched
    // on. With neither on the client stops asking for this layer at all, but
    // answer honestly rather than serving every track if a request arrives.
    const trajectoryTypes = requestedTrajectoryTypes(req.query);
    if (!trajectoryTypes.length) {
      return res.status(204).send();
    }
    // The cand CTE already joins cde.datasets, so the type test rides along
    // there — filtering candidate trajectories before any fix is pulled.
    const trackTypeFilter = trajectoryTypes.length < ALL_TRAJECTORY_TYPES.length
      ? ` AND d.cdm_data_type IN (${trajectoryTypes.map((t) => `'${t}'`).join(",")})`
      : "";

    let filters;
    try {
      filters = await createDBFilter(datasetLevelQuery);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }

    // Correctness invariant: lines are assembled from the FULL time window
    // with no per-point spatial predicate — a segment can cross a tile that
    // neither of its endpoints is in. Spatial pruning happens only at
    // trajectory level, against the per-trajectory summary bbox (expanded by
    // 25% of the tile width so near-boundary tracks aren't missed), and
    // ST_AsMVTGeom does the actual clipping with its built-in buffer.
    const SQL = `
  WITH te AS (SELECT ST_TileEnvelope(:z, :x, :y) tile_envelope),
    cand AS (
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
      SELECT s.dataset_pk, s.trajectory_id,
             trajectory_gap_secs(
               s.median_gap_secs, s.time_min, s.time_max, s.n_points
             ) AS gap_secs
      FROM cde.trajectory_track_stats s
      JOIN cde.datasets d ON d.pk = s.dataset_pk, te
      WHERE s.bbox && ST_Expand(
              te.tile_envelope,
              (ST_XMax(te.tile_envelope) - ST_XMin(te.tile_envelope)) * 0.25
            )
        AND s.time_max >= :timeMin::timestamptz
        AND s.time_min <= :timeMax::timestamptz
        ${trackTypeFilter}
        ${filters.hasShared ? "AND :filters" : ""}
      -- Cap per tile (see TRACKS_MAX_PER_TILE): keep the most recently-active
      -- trajectories; tie-break on the pk for deterministic, cache-stable tiles.
      ORDER BY s.time_max DESC, s.dataset_pk, s.trajectory_id
      LIMIT :maxTracksPerTile
    ),
    pts AS (
      SELECT p.dataset_pk, p.trajectory_id, p.time, p.longitude, p.latitude,
             p.geom, d.pk_url, d.title AS dataset_title, c.gap_secs
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
      SELECT trajectory_id, pk_url, dataset_title,
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
      SELECT DISTINCT ON (dataset_pk, trajectory_id)
             trajectory_id, pk_url, dataset_title,
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
      SELECT l.trajectory_id, l.pk_url, l.dataset_title,
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
      SELECT h.trajectory_id, h.pk_url, h.dataset_title, h.head_time, h.cog,
             ST_AsMVTGeom(h.geom, te.tile_envelope) AS geom
      FROM heads h, te
      WHERE h.geom && te.tile_envelope
    )
    -- A valid MVT is a concatenation of layer messages.
    SELECT coalesce((SELECT ST_AsMVT(l.*, 'track-lines', 4096, 'geom') FROM line_mvt l), ''::bytea)
        || coalesce((SELECT ST_AsMVT(h.*, 'track-heads', 4096, 'geom') FROM head_mvt h), ''::bytea)
        AS st_asmvt;
  `;

    try {
      const q = db.raw(SQL, {
        filters: filters.shared,
        timeMin,
        timeMax,
        maxTracksPerTile: TRACKS_MAX_PER_TILE,
        z,
        x,
        y,
      });

      const tileRaw = await q;
      const tile = tileRaw.rows[0];

      res.setHeader("Content-Type", "application/x-protobuf");
      res.status(200).send(tile.st_asmvt);
    } catch (e) {
      console.error(e);
      res.status(500).send({
        error: e.toString(),
      });
    }
  },
);

module.exports = router;
