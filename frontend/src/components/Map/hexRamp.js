// Count is told by shade alone: one opacity for the whole layer, so every
// cell shows the same amount of the basemap beneath it.
export const toRampStops = (colorStops) =>
  colorStops.map(({ stop, color }) => [stop, color]);

// Shared by 'hexes' (below z7) and 'coverage-hexes' (z7+): both read the same
// summed 'count' (web-api/utils/hexMetric.js), so darkness means the same at
// every zoom. Linear between stops because generateColorStops already
// log-spaces them.
export const rampExpression = (stops, property) => {
  if (stops.length === 0) return "lightgrey";
  if (stops.length === 1) return stops[0][1];
  return ["interpolate", ["linear"], ["get", property], ...stops.flat()];
};

// The palest cells sink into the teal sea; their edge carries them instead,
// easing to the base outline a third of the way up the ramp.
export const outlineRampExpression = (
  stops,
  property,
  palestColor,
  baseColor,
) => {
  const easedIndex = Math.round((stops.length - 1) / 3);
  if (stops.length < 2 || stops[0][0] >= stops[easedIndex][0]) return baseColor;
  return [
    "interpolate",
    ["linear"],
    ["get", property],
    stops[0][0],
    palestColor,
    stops[easedIndex][0],
    baseColor,
  ];
};
