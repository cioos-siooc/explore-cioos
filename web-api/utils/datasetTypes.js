/*
 * The cdm_data_type vocabulary, in one place.
 *
 * cdm_data_type comes straight from the ERDDAP NC_GLOBAL attribute of the same
 * name and is stored verbatim on cde.datasets. Which values exist is decided by
 * the harvester's handler registry
 * (harvester/cde_harvester/dataset_types/__init__.py) — a dataset whose type is
 * not registered there is skipped at harvest time and never reaches this
 * database. Point rows therefore only ever come from OBIS, and there are no
 * 'Other' rows at all.
 *
 * Which feature table a dataset's records live in follows from the type, and
 * that is what callers actually need to know:
 *
 *   Profile / TimeSeries / TimeSeriesProfile  -> cde.profiles
 *   Trajectory / TrajectoryProfile            -> cde.trajectory_days
 *                                                + cde.trajectory_track_stats
 *   Grid                                      -> no feature rows; the extent
 *                                                lives on cde.datasets
 *
 * The frontend keeps its own copy of this vocabulary in
 * frontend/src/state/dataLayers.js, because the map's layer selector is driven
 * by the same values.
 */

// Share cde.profiles.
const ALL_PROFILE_TYPES = ["Profile", "TimeSeries", "TimeSeriesProfile"];

// Share cde.trajectory_hexes / cde.trajectory_points / cde.trajectory_days.
const ALL_TRAJECTORY_TYPES = ["Trajectory", "TrajectoryProfile"];

// Metadata-only: no feature rows anywhere.
const GRID_TYPE = "Grid";

module.exports = {
  ALL_PROFILE_TYPES,
  ALL_TRAJECTORY_TYPES,
  GRID_TYPE,
  isTrajectoryType: (t) => ALL_TRAJECTORY_TYPES.includes(t),
  isProfileType: (t) => ALL_PROFILE_TYPES.includes(t),
};
