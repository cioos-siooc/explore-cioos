const { FINE } = require("./hexTiers");
const { metricValueExpr, metricJoin } = require("./hexMetric");

// Every route answering a question about a selection must agree on which
// feature sources are in it; those shared parts live here, while each route
// keeps its own projection (`SELECT <cols> ${rowSetFromHere}`).

// Taxa are OBIS-only, so a taxon selection hides ERDDAP data. An OBIS-node
// selection does too, unless paired with erddapServers: that pair is the
// combined "Data Source" OR filter in dbFilter, which needs both sets.
function erddapVisible(query) {
  return (
    !query.scientificNames && (!query.obisNodes || Boolean(query.erddapServers))
  );
}

// Absent means on.
function obisVisible(query) {
  return query.includeObis !== "false";
}

// A feature whose bbox spans more than POINT_THRESHOLD_M
// (harvester/cde_harvester/dataset_types/geo.py) is left off the map but is
// still in the selection, so only rendering routes apply this.
const DRAWN_AS_POINT = "show_as_point";

// Not for the tile routes. The hex polygon, not the centroid, is what the
// spatial filter matches, so a drawn selection smaller than a hex still
// selects data the track left inside it.
const TRAJECTORY_COVERAGE_FROM = `FROM cde.trajectory_hexes t
        JOIN ${FINE.hexesTable} h ON h.pk = t.hex_pk
        WHERE t.hex_tier = ${FINE.tier}`;

// dbFilter's predicates are unqualified, so griddap's coverage_* columns
// must be aliased to their names. A static (timeless) grid coalesces to
// +-infinity so any time filter matches it.
const GRIDDAP_TIME_DEPTH_COLUMNS = `coalesce(d.coverage_time_min, '-infinity'::timestamptz) AS time_min,
               coalesce(d.coverage_time_max, 'infinity'::timestamptz) AS time_max,
               coalesce(d.coverage_depth_min, 0) AS depth_min,
               coalesce(d.coverage_depth_max, 0) AS depth_max`;

// For callers that bin by time: a timeless grid belongs in no bin, and its
// NULL bounds drop it from the window comparison.
const GRIDDAP_EXACT_TIME_DEPTH_COLUMNS = `d.coverage_time_min AS time_min,
               d.coverage_time_max AS time_max,
               coalesce(d.coverage_depth_min, 0) AS depth_min,
               coalesce(d.coverage_depth_max, 0) AS depth_max`;

const GRIDDAP_FROM = `FROM cde.datasets d
        WHERE d.cdm_data_type = 'Grid' AND d.coverage_bbox IS NOT NULL`;

// The loader can leave a dataset row with no features (all dropped, or
// skipped upstream); /pointQuery never returns one, so a catalog total
// counting it would read "N-1 / N".
const DATASET_HAS_FEATURES = `(EXISTS (SELECT 1 FROM cde.profiles p WHERE p.dataset_pk = d.pk)
        OR EXISTS (SELECT 1 FROM cde.trajectory_hexes t
                   WHERE t.dataset_pk = d.pk AND t.hex_tier = ${FINE.tier})
        OR EXISTS (SELECT 1 FROM cde.obis_cells o WHERE o.dataset_pk = d.pk)
        OR (d.cdm_data_type = 'Grid' AND d.coverage_bbox IS NOT NULL))`;

// Only valid when createDBFilter's datasetLevelOnly holds: nothing else can
// be answered from a per-(hex, dataset) row. Each sourceCond starts
// `source = '<name>'`; none means no rows.
function coarseRollupBranch(metric, sourceConds, hexAs) {
  const where = sourceConds.length
    ? sourceConds.map((c) => `(${c})`).join(" OR ")
    : "FALSE";
  return `SELECT dataset_pk, hex_pk AS ${hexAs}, ${metricValueExpr("hexes_zoom_0_rollup", metric)}
        FROM cde.hexes_zoom_0_rollup ${metricJoin("hexes_zoom_0_rollup", metric)}
        WHERE ${where}`;
}

// An empty UNION is invalid SQL and every branch has its own WHERE, so the
// empty set wraps a real branch to keep its column names and types.
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
  GRIDDAP_EXACT_TIME_DEPTH_COLUMNS,
  GRIDDAP_FROM,
  DATASET_HAS_FEATURES,
  coarseRollupBranch,
  unionBranches,
};
