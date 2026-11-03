import { describe, it, expect } from "vitest";

import {
  outlineRampExpression,
  rampExpression,
  toRampStops,
} from "./hexRamp.js";

describe("toRampStops", () => {
  it("keeps every colour as given, so the layer opacity alone sets transparency", () => {
    expect(
      toRampStops([
        { stop: 0, color: "#C6E3DF" },
        { stop: 10, color: "#152F37" },
      ]),
    ).toEqual([
      [0, "#C6E3DF"],
      [10, "#152F37"],
    ]);
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

describe("outlineRampExpression", () => {
  const stops = (...values) => values.map((value) => [value, "#000000"]);

  it("eases from the palest outline to the base a third up the ramp", () => {
    expect(outlineRampExpression(stops(1, 2, 3, 4), "count", "P", "B")).toEqual(
      ["interpolate", ["linear"], ["get", "count"], 1, "P", 2, "B"],
    );
  });

  it("falls back to the base outline without a usable range", () => {
    expect(outlineRampExpression([], "count", "P", "B")).toBe("B");
    expect(outlineRampExpression(stops(5), "count", "P", "B")).toBe("B");
    expect(outlineRampExpression(stops(5, 5), "count", "P", "B")).toBe("B");
  });
});
