export const smallCircleSize = 2.75;
export const largeCircleSize = 6;

// Point markers size by the same count the hexes colour by, log-spaced over
// the point-tier range so the marker for a long mooring record reads bigger
// than one for a single cast. Log because the range spans orders of
// magnitude — linear would leave every marker at the minimum but one.
//
// `padding` is the halo's extra radius: it sits under the markers and has to
// grow with them or it stops being a halo.
//
// A degenerate range (every point the same count, or the legend not back
// yet) has nothing to ramp: use the small radius flat.
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

// The same ramp evaluated in JS, for the hit-tests that need to know how big
// a circle actually got drawn. MapLibre clamps an `interpolate` outside its
// domain to the endpoint value, so this clamps too — otherwise a count past
// the legend's range would report a radius larger than the one on screen.
// Only the padding = 0 ramp needs a twin: that is the `points` layer the
// hit-tests measure against.
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
