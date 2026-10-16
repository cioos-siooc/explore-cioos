export const smallCircleSize = 2.75;
export const largeCircleSize = 6;

// Log because the count range spans orders of magnitude: linear would leave
// every marker at the minimum but one. `padding` is the halo's extra radius,
// which has to grow with the marker.
export const radiusExpression = (range, padding = 0) => {
  const lo = Math.max(range?.[0] ?? 1, 1);
  const hi = range?.[1];
  if (!Number.isFinite(hi) || hi <= lo) return smallCircleSize + padding;
  return [
    "interpolate",
    ["linear"],
    ["log10", ["max", ["get", "count"], 1]],
    Math.log10(lo),
    smallCircleSize + padding,
    Math.log10(hi),
    largeCircleSize + padding,
  ];
};

// JS twin of radiusExpression (padding 0, the `points` layer) for hit-tests.
// Clamps because MapLibre clamps an `interpolate` outside its domain.
export const pointRadiusFor = (count, range) => {
  const lo = Math.max(range?.[0] ?? 1, 1);
  const hi = range?.[1];
  if (!Number.isFinite(hi) || hi <= lo) return smallCircleSize;
  const loLog = Math.log10(lo);
  const hiLog = Math.log10(hi);
  const at = Math.log10(Math.max(Number(count) || 1, 1));
  const ratio = Math.min(Math.max((at - loLog) / (hiLog - loLog), 0), 1);
  return smallCircleSize + ratio * (largeCircleSize - smallCircleSize);
};
