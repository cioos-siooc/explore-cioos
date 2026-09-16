import { HEX_METRIC } from "../config";
import {
  PROFILE_TYPE_KEYS,
  TRAJECTORY_TYPE_KEYS,
} from "../../state/dataLayers.js";

// Combine the filter-derived query string with the geometry selection into a
// tile-URL suffix. OBIS off adds includeObis=false, OR-ed with any the Source
// filter already emitted; a profile-type subset adds profileTypes=<comma list>
// and a trajectory-type subset trajectoryTypes=<comma list> (empty = none). A
// param is omitted when its layer(s) are fully on, so the URL stays clean.
// Returns '' or '?...'.
//
// Trajectory cells are requested whenever a trajectory geometry is selected,
// full stop — their counts belong to the hexes the same way every other
// geometry's do, and there is one switch for all of them (the hex/point
// visibility one). There used to be a second, trajectory-only hex switch here,
// which meant trajectory data could be missing from a hexagon for a reason the
// hex ramp had no way of showing. The track lines are unaffected either way:
// they come from a separate source (/tiles/tracks).
export function buildTileSuffix(baseQuery, dataLayers) {
  const params = new URLSearchParams(baseQuery);
  // Always written out: the API counts something else when the param is absent
  // — see HEX_METRIC.
  params.set("metric", HEX_METRIC);
  if (dataLayers) {
    if (!dataLayers.obis || params.get("includeObis") === "false") {
      params.set("includeObis", "false");
    }
    const enabledTypes = PROFILE_TYPE_KEYS.filter(
      ([key]) => dataLayers[key],
    ).map(([, type]) => type);
    if (enabledTypes.length < PROFILE_TYPE_KEYS.length) {
      params.set("profileTypes", enabledTypes.join(","));
    }
    const enabledTrajectoryTypes = TRAJECTORY_TYPE_KEYS.filter(
      ([key]) => dataLayers[key],
    ).map(([, type]) => type);
    if (enabledTrajectoryTypes.length < TRAJECTORY_TYPE_KEYS.length) {
      params.set("trajectoryTypes", enabledTrajectoryTypes.join(","));
    }
    if (!enabledTrajectoryTypes.length) {
      params.set("includeTrajectory", "false");
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}
