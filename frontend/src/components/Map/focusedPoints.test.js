import { describe, it, expect } from "vitest";

import { focusedPointFeatures } from "./focusedPoints.js";

// Shaped the way queryRenderedFeatures returns markers: the pk promoted to id,
// the datasets as the JSON string MapLibre hands back.
const marker = (id, datasets, count = 1) => ({
  id,
  geometry: { type: "Point", coordinates: [id, id] },
  properties: { pk: id, count, datasets },
});

describe("focusedPointFeatures", () => {
  it("keeps only the focused dataset's markers, with their properties", () => {
    const { features } = focusedPointFeatures(
      [marker(1, "[5]", 7), marker(2, "[6]"), marker(3, "[6,5]")],
      5,
    );
    expect(features.map((f) => f.id)).toEqual([1, 3]);
    expect(features[0]).toEqual({
      type: "Feature",
      id: 1,
      geometry: { type: "Point", coordinates: [1, 1] },
      properties: { pk: 1, count: 7, datasets: "[5]" },
    });
  });

  it("collapses a marker returned by two tiles into one", () => {
    const { features } = focusedPointFeatures(
      [marker(1, "[5]"), marker(1, "[5]")],
      5,
    );
    expect(features).toHaveLength(1);
  });

  it("is empty without a focus", () => {
    expect(focusedPointFeatures([marker(1, "[5]")], undefined)).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });
});
