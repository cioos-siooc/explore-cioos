import { describe, it, expect } from "vitest";

import { HEX_RAMP_MIN_ALPHA, rampExpression, toRampStops } from "./hexRamp.js";

const stops = (...colors) =>
  colors.map((color, index) => ({ stop: index * 10, color }));

describe("toRampStops", () => {
  it("rises from the minimum alpha to opaque along the ramp", () => {
    expect(toRampStops(stops("#000000", "#000000", "#000000"))).toEqual([
      [0, `rgba(0, 0, 0, ${HEX_RAMP_MIN_ALPHA})`],
      [10, `rgba(0, 0, 0, ${(HEX_RAMP_MIN_ALPHA + 1) / 2})`],
      [20, "rgba(0, 0, 0, 1)"],
    ]);
  });

  it("makes a one-stop ramp opaque", () => {
    expect(toRampStops(stops("#ff0000"))).toEqual([[0, "rgba(255, 0, 0, 1)"]]);
  });
});

describe("rampExpression", () => {
  it("interpolates the property over the stops", () => {
    expect(
      rampExpression(
        [
          [0, "a"],
          [10, "b"],
        ],
        "count",
      ),
    ).toEqual(["interpolate", ["linear"], ["get", "count"], 0, "a", 10, "b"]);
  });

  it("falls back to a flat colour when there is nothing to interpolate", () => {
    expect(rampExpression([[0, "a"]], "count")).toBe("a");
    expect(rampExpression([], "count")).toBe("lightgrey");
  });
});
