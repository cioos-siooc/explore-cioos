import { describe, it, expect } from "vitest";
import { expression } from "@maplibre/maplibre-gl-style-spec";

import {
  largeCircleSize,
  pointRadiusFor,
  radiusExpression,
  smallCircleSize,
} from "./pointRadius.js";

// What MapLibre would draw for a feature with this count: the expression is
// evaluated by the style spec's own evaluator, not re-implemented here, so the
// JS twin is checked against the real thing.
const drawnRadius = (range, count) => {
  const value = radiusExpression(range);
  if (typeof value === "number") return value;
  const parsed = expression.createExpression(value);
  if (parsed.result !== "success") throw new Error(parsed.value[0].message);
  return parsed.value.evaluate({ zoom: 0 }, { properties: { count } });
};

const RANGES = [
  [1, 10],
  [1, 1_000_000],
  [3, 250],
  [0, 40],
  [500, 2_000_000],
];

const COUNTS = [
  0, 1, 2, 3, 7, 10, 42, 100, 250, 999, 5_000, 1_000_000, 50_000_000,
];

describe("the hit-test radius matches the drawn radius", () => {
  it.each(RANGES)("across a swept range of counts for [%d, %d]", (lo, hi) => {
    for (const count of COUNTS) {
      expect(pointRadiusFor(count, [lo, hi])).toBeCloseTo(
        drawnRadius([lo, hi], count),
        10,
      );
    }
  });

  it.each([[null], [undefined], [[5, 5]], [[10, 2]], [[1, NaN]]])(
    "falls back to the small radius for a degenerate range %j",
    (range) => {
      expect(radiusExpression(range)).toBe(smallCircleSize);
      expect(pointRadiusFor(100, range)).toBe(smallCircleSize);
    },
  );
});

describe("the ramp clamps to its endpoints", () => {
  it("never draws smaller than the small radius", () => {
    expect(pointRadiusFor(0, [10, 1000])).toBe(smallCircleSize);
    expect(drawnRadius([10, 1000], 0)).toBe(smallCircleSize);
  });

  it("never draws larger than the large radius", () => {
    expect(pointRadiusFor(1e9, [10, 1000])).toBe(largeCircleSize);
    expect(drawnRadius([10, 1000], 1e9)).toBe(largeCircleSize);
  });
});

describe("padding grows the halo with the marker", () => {
  it("offsets both ends of the ramp", () => {
    expect(radiusExpression([1, 100], 1.25)).toEqual([
      "interpolate",
      ["linear"],
      ["log10", ["max", ["get", "count"], 1]],
      0,
      smallCircleSize + 1.25,
      2,
      largeCircleSize + 1.25,
    ]);
  });

  it("offsets the flat fallback", () => {
    expect(radiusExpression(null, 6)).toBe(smallCircleSize + 6);
  });
});
