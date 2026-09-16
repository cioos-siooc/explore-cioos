const { FINE } = require("./hexTiers");

/*
 * What a selection is.
 *
 * A request's filters resolve to a set of FEATURE SOURCES — cde.profiles,
 * trajectory coverage hexes, OBIS occurrence cells, griddap footprints — and
 * every route that answers a question about the selection has to agree on
 * which sources are in it: the map tiles, the coverage tiles, the legend's
 * ramp domain, the time axis, the dataset list, the griddap layer and the
 * download queue.
 *
 * They each used to spell that out. The ERDDAP gate below was written eight
 * times and the OBIS gate six, verbatim, which is how /downloadEstimate and
 * /download came to disagree about whether OBIS was part of a selection, and
 * /timeExtent and the dataset list about whether a region-spanning feature
 * was. Nothing announced the divergence; every copy still ran.
 *
 * What this module does NOT own is the projection. Each route selects the
 * columns its own query needs, so a branch reads
 *
 *     `SELECT <the route's columns> ${aRowSetFromHere}`
 *
 * and only the parts that must agree across routes live here.
 */

// ---------------------------------------------------------------------------
// Which sources a selection contains

/*
 * Whether ERDDAP-sourced data — cde.profiles, trajectory coverage and griddap
 * footprints — is part of this selection at all.
 *
 * A scientific-name filter is OBIS-only by construction: only occurrence
 * records carry taxa, so a taxon selection hides everything else. An
 * OBIS-node selection does the same, UNLESS ERDDAP servers are selected
 * alongside it — that pair is the frontend's combined "Data Source" filter,
 * which dbFilter turns into a single OR'd dataset predicate, so both feature
 * sets have to be present for that OR to mean anything.
 *
 * The map routes gate further on their own layer toggles (see
 * utils/dataTypes.js); those are display state, not part of the selection.
 */
function erddapVisible(query) {
  return (
    !query.scientificNames && (!query.obisNodes || Boolean(query.erddapServers))
  );
}

// The OBIS layer toggle. Absent means on, so only an explicit "false" hides
// occurrence cells.
function obisVisible(query) {
  return query.includeObis !== "false";
}

// ---------------------------------------------------------------------------
// Where each source's rows come from

/*
 * Restricts cde.profiles to the features the map can draw.
 *
 * A feature whose bbox spans more than POINT_THRESHOLD_M has no meaningful
 * single location (harvester/cde_harvester/dataset_types/geo.py), so the tile
 * and legend routes leave it off the map entirely — but it is still IN the
 * selection: still searchable through its stored bbox, still listed, still
 * downloadable. So this is a rendering restriction, and only the rendering
 * routes apply it.
 *
 * It is named here because that asymmetry was previously an accident:
 * /timeExtent applied it and the dataset list did not, so the time axis and
 * the list that axis bounds were computed over different features.
 */
const DRAWN_AS_POINT = "show_as_point";

/*
 * Trajectory coverage as everything outside the map reads it: one tier only,
 * with the hex polygon joined back in.
 *
 * The polygon — not the row's centroid — is what the shared spatial filter
 * matches against, so a drawn selection smaller than a hex still selects the
 * data the track left inside it. The tile routes read this table differently
 * (their own tier, from the zoom, and no polygon join: they already have the
 * hex), which is why this covers the other three callers rather than all four.
 */
const TRAJECTORY_COVERAGE_FROM = `FROM cde.trajectory_hexes t
        JOIN ${FINE.hexesTable} h ON h.pk = t.hex_pk
        WHERE t.hex_tier = ${FINE.tier}`;

/*
 * Griddap datasets are metadata-only: no feature rows at all, their coverage
 * lives on cde.datasets under coverage_* columns.
 *
 * Both callers — the shape query's griddap arm and /griddapCoverage — have to
 * alias those columns to the names dbFilter's predicates are written in
 * (time_min, time_max, depth_min, depth_max, point_pk, search_geom), because
 * those predicates are UNQUALIFIED: a row set missing one of the names makes
 * the whole statement fail to parse. point_pk (NULL::integer, which keeps
 * grids out of map-click queries) and search_geom (d.coverage_bbox) are one
 * self-evident expression each and sit at whichever position the caller's
 * column order needs. The time and depth bounds carry a decision instead —
 * a timeless (static) grid coalesces to +-infinity so that any time filter
 * matches it, and a depthless one to zero — so they are shared, and they are
 * contiguous in both callers.
 */
const GRIDDAP_TIME_DEPTH_COLUMNS = `coalesce(d.coverage_time_min, '-infinity'::timestamptz) AS time_min,
               coalesce(d.coverage_time_max, 'infinity'::timestamptz) AS time_max,
               coalesce(d.coverage_depth_min, 0) AS depth_min,
               coalesce(d.coverage_depth_max, 0) AS depth_max`;

const GRIDDAP_FROM = `FROM cde.datasets d
        WHERE d.cdm_data_type = 'Grid' AND d.coverage_bbox IS NOT NULL`;

// ---------------------------------------------------------------------------
// Assembly

/*
 * The UNION ALL of a selection's branches, with the guard every caller needs
 * for the case where the selection contains no source at all (a taxon filter
 * with OBIS switched off, every layer toggled away).
 *
 * An empty UNION is not valid SQL, and neither is `${branch} WHERE FALSE` —
 * every branch here carries a WHERE of its own. So the empty set is one of the
 * real branches wrapped in a subquery: it yields no rows while keeping the
 * exact column names and types the enclosing CTE was written against, which a
 * hand-written NULL shell has to be kept in sync with by hand.
 *
 * @param {string[]} branches  the arms of the union, in order
 * @param {string}   fallback  a branch to shape the empty result set from
 */
function unionBranches(branches, fallback) {
  if (!branches.length) {
    return `SELECT * FROM (${fallback}) empty_combined WHERE FALSE`;
  }
  return branches.join("\n        UNION ALL\n        ");
}

module.exports = {
  erddapVisible,
  obisVisible,
  DRAWN_AS_POINT,
  TRAJECTORY_COVERAGE_FROM,
  GRIDDAP_TIME_DEPTH_COLUMNS,
  GRIDDAP_FROM,
  unionBranches,
};
