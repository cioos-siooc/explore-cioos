// `profileTypes` / `trajectoryTypes`: absent = every type in the group (what
// older clients send), empty = none. Matching a fixed set is what makes
// inlining the values into SQL safe. Mirrored in
// frontend/src/state/dataLayers.js.
const ALL_PROFILE_TYPES = ["Profile", "TimeSeries", "TimeSeriesProfile"];
const ALL_TRAJECTORY_TYPES = ["Trajectory", "TrajectoryProfile"];

// Unknown values are dropped, not rejected: the validator answers for the
// request.
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
