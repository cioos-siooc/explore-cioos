import {
  HEX_METRIC,
  TRAIL_ALL,
  effectiveTrailingDays,
  tracksMinDate,
} from "../config";
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

// The time filter as two instants, read back out of the map query string —
// the same timeMin/timeMax the hexes, the points, the counts and the record
// lists are filtered by (createDataFilterQueryString writes them, and leaves
// them out entirely while the range is still the full default one). Bounds are
// the API's own: date-only strings at UTC midnight, both ends inclusive, so a
// track is clipped to exactly the span the numbers beside it are counted over.
//
// Not to be confused with tracksTimeWindow below, which is the scrub bar's
// trailing window — the tracks TILES are drawn for that and deliberately
// ignore this filter (see buildTracksTileUrl and TrajectoryDate.jsx).
export function filterTimeWindow(queryString) {
  const params = new URLSearchParams(queryString);
  const instant = (value) => {
    const ms = value ? Date.parse(value) : NaN;
    return Number.isNaN(ms) ? undefined : ms;
  };
  return {
    min: instant(params.get("timeMin")),
    max: instant(params.get("timeMax")),
  };
}

// UTC-day-snapped scrub window: [scrub date - N days, scrub date + 1 day),
// or [tracksMinDate, scrub date + 1 day) for the 'all' trail (full tracks
// up to the scrub date; see config.js). Day snapping keeps the tile URLs
// stable so the server's URL-keyed tile cache gets hits across scrubs and
// users. The requested trail is clamped by zoom first — a long window costs
// far more zoomed out, where one tile can carry the whole catalogue (see
// effectiveTrailingDays).
export function tracksTimeWindow(scrub, trailing, zoom) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const days = effectiveTrailingDays(trailing, zoom);
  const end = new Date(`${scrub}T00:00:00Z`).getTime();
  const timeMax = `${new Date(end + MS_PER_DAY).toISOString().split("T")[0]}T00:00:00Z`;
  const timeMin =
    days === TRAIL_ALL
      ? `${tracksMinDate}T00:00:00Z`
      : `${new Date(end - days * MS_PER_DAY).toISOString().split("T")[0]}T00:00:00Z`;
  return { timeMin, timeMax };
}
