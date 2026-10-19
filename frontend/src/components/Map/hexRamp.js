import { withAlpha } from "../../utilities";

// Opacity of the palest hex relative to the darkest. The count is told in both
// shade and solidity on purpose: a merely pale sparse cell would still hide
// the coastline as completely as a busy one.
export const HEX_RAMP_MIN_ALPHA = 0.55;

// Alpha is baked into the stops rather than a data-driven fill-opacity, so
// nothing is evaluated per feature per frame or recomputed while panning.
export const toRampStops = (colorStops) =>
  colorStops.map(({ stop, color }, index) => [
    stop,
    withAlpha(
      color,
      HEX_RAMP_MIN_ALPHA +
        (1 - HEX_RAMP_MIN_ALPHA) *
          (colorStops.length > 1 ? index / (colorStops.length - 1) : 1),
    ),
  ]);

// Shared by 'hexes' (below z7) and 'coverage-hexes' (z7+): both read the same
// summed 'count' (web-api/utils/hexMetric.js), so darkness means the same at
// every zoom. Linear between stops because generateColorStops already
// log-spaces them.
export const rampExpression = (stops, property) => {
  if (stops.length === 0) return "lightgrey";
  if (stops.length === 1) return stops[0][1];
  return ["interpolate", ["linear"], ["get", property], ...stops.flat()];
};
