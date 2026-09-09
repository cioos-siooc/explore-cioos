/*
 * The cdm_data_types the map draws, and how a request names a subset of them.
 *
 * Two tables split them: cde.profiles holds the three station-like types,
 * cde.trajectory_hexes / cde.trajectory_points the two track-like ones. They
 * are separate layers in the map's geometry selector, so the tile routes take
 * `profileTypes` / `trajectoryTypes` as comma lists that work the same way:
 * absent = every type in that group (which is what an older client sends), a
 * comma list = only those, empty = none.
 *
 * The vocabulary lives here rather than in routes/tiles.js because two modules
 * need it — tiles.js inlines the matched values into branch SQL (matching
 * against a fixed set is exactly what makes that safe), and the request
 * validator in utils/routePipeline.js has to know the set to reject a value
 * outside it.
 */
const ALL_PROFILE_TYPES = ["Profile", "TimeSeries", "TimeSeriesProfile"];
const ALL_TRAJECTORY_TYPES = ["Trajectory", "TrajectoryProfile"];

// Unknown values are dropped rather than rejected here: the validator answers
// for the request, and this stays total so a caller always gets a usable list.
function requestedTypes(value, all) {
  if (value === undefined) return all;
  return String(value)
    .split(",")
    .filter((t) => all.includes(t));
}

const requestedProfileTypes = (query) =>
  requestedTypes(query.profileTypes, ALL_PROFILE_TYPES);

const requestedTrajectoryTypes = (query) =>
  requestedTypes(query.trajectoryTypes, ALL_TRAJECTORY_TYPES);

module.exports = {
  ALL_PROFILE_TYPES,
  ALL_TRAJECTORY_TYPES,
  requestedProfileTypes,
  requestedTrajectoryTypes,
};
