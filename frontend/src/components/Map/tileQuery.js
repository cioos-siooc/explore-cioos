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

// A param is omitted when its layer(s) are fully on, so the URL stays clean;
// includeObis=false is OR-ed with any the Source filter already emitted, and
// an empty trajectoryTypes means none, not all.
export function buildTileSuffix(baseQuery, dataLayers) {
  const params = new URLSearchParams(baseQuery);
  // Always written out: the API counts something else when the param is absent
  // — see HEX_METRIC.
  params.set("metric", HEX_METRIC);
  if (dataLayers) {
    // OBIS cells are the only Point rows the API holds, so the switch maps
    // here.
    if (!dataLayers.point || params.get("includeObis") === "false") {
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

// Bounds are the API's own (date-only, UTC midnight, both inclusive), so a
// track is clipped to exactly the span the counts beside it cover. Unlike
// tracksTimeWindow, which the tracks tiles use and which ignores this filter.
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

// [scrub - N days, scrub + 1 day), or from tracksMinDate for the 'all' trail.
// Day snapping keeps tile URLs stable for the server's URL-keyed cache. The
// trail is clamped by zoom first: a long window costs far more zoomed out.
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
