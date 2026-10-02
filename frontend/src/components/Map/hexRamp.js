import { withAlpha } from "../../utilities";

// How much of the basemap the palest hex on the ramp lets through, as a
// fraction of what the darkest one lets through. The count is told twice on
// purpose — in the shade AND in how solid it is — because a sparse cell that
// is merely pale still covers the coastline underneath it as completely as a
// busy one does, and the two channels agree at every point on the ramp, so
// neither can contradict the other or the legend's key.
export const HEX_RAMP_MIN_ALPHA = 0.55;

// The ramp's colours with that alpha baked in, rising with the stop just as
// the colour darkens with it. Linked to the ramp rather than measured on its
// own: this replaces a second data-driven fill-opacity that carried a
// 95th-percentile threshold of the counts on screen, which meant a percentile
// pass over every rendered hex on every settled camera, a threshold to hold
// and re-apply, and an expression evaluated per feature per frame — all of it
// to say what these stops already say. The stops are rebuilt only when the
// domain moves (setColorStops); the fill-opacity left on the layers is now
// zoom-only, so nothing here is recomputed while panning.
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

// The one hex ramp, shared by the combined 'hexes' layer below z7 and the
// 'coverage-hexes' layer at and above it. Both read the same 'count'
// property (the summed metric — see web-api/utils/hexMetric.js), so hex
// darkness means the same thing at every zoom.
//
// The stops are log-spaced by generateColorStops, but the interpolation
// between them is linear: the non-linearity lives in where the stops sit,
// not in how MapLibre blends across them.
//
// A single-stop ramp (a range of one value, e.g. a filter that leaves one
// hex) can't be interpolated: fall back to the flat color, since there's
// nothing to interpolate between.
export const rampExpression = (stops, property) => {
  if (stops.length === 0) return "lightgrey";
  if (stops.length === 1) return stops[0][1];
  return ["interpolate", ["linear"], ["get", property], ...stops.flat()];
};
