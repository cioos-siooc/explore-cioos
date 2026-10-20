import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

import { selectionLayerFilter } from "./selectionFilter.js";

describe("selectionLayerFilter", () => {
  const ring = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  const styleWith = (filter) => ({
    version: 8,
    sources: { s: { type: "vector", tiles: ["http://tiles/{z}/{x}/{y}"] } },
    layers: [
      { id: "l", type: "circle", source: "s", "source-layer": "l", filter },
    ],
  });

  it("leaves the layer's own filter alone without a shape", () => {
    expect(selectionLayerFilter(undefined, undefined)).toBeNull();
    expect(selectionLayerFilter(["has", "cog"], undefined)).toEqual([
      "has",
      "cog",
    ]);
  });

  it.each([
    ["no", undefined],
    ["a 'has'", ["has", "cog"]],
    ["a negated 'has'", ["!", ["has", "cog"]]],
  ])("is a valid filter combined with %s base filter", (_, base) => {
    expect(
      validateStyleMin(styleWith(selectionLayerFilter(base, ring))),
    ).toEqual([]);
  });
});
