import { describe, it, expect } from "vitest";

import { rampExpression, toRampStops } from "./hexRamp.js";

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
