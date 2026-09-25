import { describe, it, expect } from "vitest";

import { featureHasDataset, focusedPointFeatures } from "./focusedPoints.js";

// Shaped the way queryRenderedFeatures returns markers: the pk promoted to id,
// the datasets as the JSON string MapLibre hands back.
const marker = (id, datasets, count = 1) => ({
  id,
  geometry: { type: "Point", coordinates: [id, id] },
  properties: { pk: id, count, datasets },
});

describe("featureHasDataset", () => {
  it("matches a pk in the datasets array, not a substring of one", () => {
    expect(featureHasDataset(marker(1, "[12,5]"), 5)).toBe(true);
    expect(featureHasDataset(marker(1, "[12,5]"), 1)).toBe(false);
  });

  it("treats malformed datasets as not matching", () => {
    expect(featureHasDataset(marker(1, "not json"), 5)).toBe(false);
  });
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
