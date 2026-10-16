import { describe, it, expect } from "vitest";
import turfPointsWithinPolygon from "@turf/points-within-polygon";
import { points, polygon } from "@turf/helpers";

import { polygonIsRectangle } from "../utilities.jsx";
import {
  MAX_RING_VERTICES,
  parseRegions,
  prefixQuery,
  regionBox,
  regionDescription,
  regionOutline,
  regionRecordUrl,
  regionSearchUrl,
} from "./regionSearch.js";

// A ragged coastline: a ring of 3000 points whose radius wobbles, which
// simplifying alone would cut into.
function coastline(n = 3000) {
  const ring = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    const r = 2 + 0.3 * Math.sin(a * 40) + 0.1 * Math.sin(a * 333);
    return [-64 + r * Math.cos(a), 46 + 0.7 * r * Math.sin(a)];
  });
  return [...ring, ring[0]];
}

const feature = (featureid, type, coordinates, name = "Bay") => ({
  type: "Feature",
  properties: { featureid, name, concise: "BAY" },
  geometry: { type, coordinates },
});

describe("regionSearchUrl", () => {
  it("asks GeoNames in the UI language for area-type features only", () => {
    const url = new URL(regionSearchUrl("baie de fundy", "fr"));
    expect(url.pathname).toBe("/services/geoname/fr/geonames.geojson");
    expect(url.searchParams.get("q")).toBe("baie de fundy");
    expect(url.searchParams.get("concise").split(",")).toContain("BAY");
  });
});

describe("prefixQuery", () => {
  it.each([
    ["bay of fund", "bay of fund*"],
    ["  îles de la madel ", "îles de la madel*"],
    ["saint-laur", "saint-laur*"],
    ["st.", "st."],
  ])("reads %j as %j", (term, query) => {
    expect(prefixQuery(term)).toBe(query);
  });
});

describe("regionRecordUrl", () => {
  it("is the CGNDB record page in the UI language", () => {
    expect(regionRecordUrl("DBBWO", "fr")).toBe(
      "https://geogratis.gc.ca/services/geoname/fr/geonames/DBBWO.html",
    );
  });
});

describe("parseRegions", () => {
  it("keeps one hit per feature, and marks those with an outline as areas", () => {
    const square = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ];
    const regions = parseRegions({
      features: [
        feature("gulf", "MultiPolygon", [square]),
        feature("gulf", "MultiPolygon", [square]),
        feature("shelf", "MultiPoint", [[-62, 43]]),
        feature("fundy", "Polygon", square),
      ],
    });
    expect(regions.map((r) => [r.id, r.area])).toEqual([
      ["gulf", true],
      ["shelf", false],
      ["fundy", true],
    ]);
    expect(regions[0]).toMatchObject({ name: "Bay", type: "BAY" });
  });

  it("reads an empty or missing reply as no regions", () => {
    expect(parseRegions({ features: [] })).toEqual([]);
    expect(parseRegions(undefined)).toEqual([]);
  });
});

describe("place details", () => {
  const row = (province, location, name = "Bay of Fundy") => ({
    type: "Feature",
    properties: {
      featureid: "fundy",
      name,
      concise: "BAY",
      province,
      location,
    },
    geometry: { type: "MultiPolygon", coordinates: [] },
  });
  const t = (key) => ({ regionTypeBAY: "Bay" })[key] ?? "";

  it("gathers the provinces of every row of a feature, as postal symbols", () => {
    const [fundy] = parseRegions({
      features: [
        row("13", null, "Baie de Fundy"),
        row("12", "Annapolis"),
        row("12", "Annapolis", "Baie de Fundy"),
      ],
    });
    expect(fundy).toMatchObject({
      name: "Baie de Fundy",
      otherNames: ["Bay of Fundy"],
      provinces: ["NB", "NS"],
      locations: ["Annapolis"],
    });
  });

  it.each([
    [["NB"], ["Kings"], "Bay · Kings, NB"],
    [["NB", "NS"], ["Albert", "Annapolis"], "Bay · NB, NS"],
    [["NB", "NS"], ["Annapolis"], "Bay · NB, NS"],
    [[], ["Thunder Bay"], "Bay · Thunder Bay"],
    [[], [], "Bay"],
  ])("describes %j %j as %j", (provinces, locations, text) => {
    expect(regionDescription({ type: "BAY", provinces, locations }, t)).toBe(
      text,
    );
  });
});

describe("regionBox", () => {
  it("is the rectangle the box filter sends as bounds", () => {
    const ring = regionBox({ type: "Polygon", coordinates: [coastline()] });
    expect(polygonIsRectangle(ring)).toBe(true);
  });
});

describe("regionOutline", () => {
  it("fits the vertex budget and still holds every point of the region", async () => {
    const original = coastline();
    const ring = await regionOutline({
      type: "MultiPolygon",
      coordinates: [
        [original],
        [
          [
            [-50, 40],
            [-49.9, 40],
            [-49.9, 40.1],
            [-50, 40],
          ],
        ],
      ],
    });

    expect(ring.length).toBeLessThanOrEqual(MAX_RING_VERTICES);
    expect(ring[0]).toEqual(ring.at(-1));
    const inside = turfPointsWithinPolygon(points(original), polygon([ring]));
    expect(inside.features).toHaveLength(original.length);
  });
});
