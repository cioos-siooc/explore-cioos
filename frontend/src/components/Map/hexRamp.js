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
