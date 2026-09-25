import { describe, it, expect, vi } from "vitest";

import {
  GRIDDAP_PRIORITY_ZOOM,
  POINT_HIT_GRACE_PX,
  buildFeatureQuery,
  datasetPksOf,
  dedupeGriddapByPk,
  featureHasDataset,
  griddapCoveredIn,
  griddapOutranksHexesIn,
  griddapTitle,
  isOnAPointIn,
  trackFeatureIn,
  trackItemsIn,
} from "./hitTest.js";
import { largeCircleSize, smallCircleSize } from "./pointRadius.js";

// Hits are shaped the way queryRenderedFeatures returns them: the ranking only
// ever reads layer.id, which is the whole reason it can be tested without a map.
const hits = (...layerIds) => layerIds.map((id) => ({ layer: { id } }));

const GRID = "griddap-coverage-fill";

describe("the grid outranks the hexes only once it is zoomed in", () => {
  it("stands aside below the threshold", () => {
    expect(
      griddapOutranksHexesIn(hits(GRID), GRIDDAP_PRIORITY_ZOOM - 0.01),
    ).toBe(false);
  });

  it("takes precedence at the threshold itself", () => {
    // The boundary is inclusive: griddapCoveredIn in Map.jsx tests the same
    // scalar with the same >=, and the two halves of the rule must agree on it.
    expect(griddapOutranksHexesIn(hits(GRID), GRIDDAP_PRIORITY_ZOOM)).toBe(
      true,
    );
  });

  it("takes precedence above it", () => {
    expect(griddapOutranksHexesIn(hits(GRID), 12)).toBe(true);
  });
});

describe("only a coverage rectangle can outrank them", () => {
  it("is false with nothing under the cursor", () => {
    expect(griddapOutranksHexesIn([], 12)).toBe(false);
  });

  it("is false for hexes and points alone, however far in", () => {
    expect(griddapOutranksHexesIn(hits("hexes", "points"), 12)).toBe(false);
  });

  it("finds the rectangle among other hits, in any order", () => {
    expect(griddapOutranksHexesIn(hits("hexes", GRID, "points"), 12)).toBe(
      true,
    );
  });

  it("ignores the coverage outline, which is a different layer", () => {
    // The rectangles are drawn as a fill plus griddap-coverage-line on top of
    // it, and only the fill is hit-tested — matching the outline too would
    // count every rectangle twice.
    expect(griddapOutranksHexesIn(hits("griddap-coverage-line"), 12)).toBe(
      false,
    );
  });
});

// Characterisation tests: they pin what the rules did when they were moved out
// of Map.jsx, so a later tidy-up that changes a ranking fails here first.

const feature = (layerId, properties = {}, geometry) => ({
  type: "Feature",
  layer: { id: layerId },
  properties,
  geometry,
});

const square = (x0, y0, x1, y1) => ({
  type: "Polygon",
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

const pointAt = (x, y) => ({ type: "Point", coordinates: [x, y] });

// Screen space equal to lng/lat, so distances in the tests read directly.
const identity = {
  project: ([x, y]) => ({ x, y }),
  radiusRange: null,
};

describe("isOnAPointIn", () => {
  const marker = (count) => feature("points", { count }, pointAt(0, 0));
  const edge = smallCircleSize + POINT_HIT_GRACE_PX;

  it("counts a cursor inside the drawn circle plus the grace", () => {
    expect(isOnAPointIn([marker(1)], { x: edge - 0.01, y: 0 }, identity)).toBe(
      true,
    );
  });

  it("does not count one outside it", () => {
    expect(isOnAPointIn([marker(1)], { x: edge + 0.01, y: 0 }, identity)).toBe(
      false,
    );
  });

  it("sizes the circle from the count and the ramp range", () => {
    const context = { ...identity, radiusRange: [1, 100] };
    const bigEdge = largeCircleSize + POINT_HIT_GRACE_PX;
    expect(
      isOnAPointIn([marker(100)], { x: bigEdge - 0.01, y: 0 }, context),
    ).toBe(true);
    expect(
      isOnAPointIn([marker(1)], { x: bigEdge - 0.01, y: 0 }, context),
    ).toBe(false);
  });

  it("only measures the points layer", () => {
    const halo = feature("points-halo", { count: 1 }, pointAt(0, 0));
    expect(isOnAPointIn([halo], { x: 0, y: 0 }, identity)).toBe(false);
  });
});

describe("trackFeatureIn", () => {
  it("ranks an arrowhead over a line, whatever the render order", () => {
    const line = feature("track-lines");
    const head = feature("track-heads");
    expect(trackFeatureIn([line, head])).toBe(head);
    expect(trackFeatureIn([head, line])).toBe(head);
  });

  it("is undefined with no track under the cursor", () => {
    expect(trackFeatureIn(hits("hexes", "points"))).toBeUndefined();
  });
});

describe("griddapCoveredIn", () => {
  it("lets hexes cover a grid below the priority zoom", () => {
    expect(griddapCoveredIn(hits("hexes"), GRIDDAP_PRIORITY_ZOOM - 1)).toBe(
      true,
    );
  });

  it("stops hexes covering it at the priority zoom", () => {
    expect(griddapCoveredIn(hits("hexes"), GRIDDAP_PRIORITY_ZOOM)).toBe(false);
  });

  it("always lets points and tracks cover it", () => {
    expect(griddapCoveredIn(hits("points"), 12)).toBe(true);
    expect(griddapCoveredIn(hits("track-heads-fixed"), 12)).toBe(true);
  });
});

describe("dedupeGriddapByPk", () => {
  it("keeps the first feature per dataset", () => {
    const a = feature(GRID, { pk: 1 });
    const b = feature(GRID, { pk: 2 });
    expect(dedupeGriddapByPk([a, feature(GRID, { pk: 1 }), b])).toEqual([a, b]);
  });
});

describe("griddapTitle", () => {
  const titled = (properties) => feature(GRID, properties);

  it("picks the title in the current language", () => {
    const title = JSON.stringify({ en: "Sea", fr: "Mer" });
    expect(griddapTitle(titled({ title_translated: title }), "fr")).toBe("Mer");
  });

  it("falls back to English, then to the dataset id", () => {
    const enOnly = JSON.stringify({ en: "Sea" });
    expect(griddapTitle(titled({ title_translated: enOnly }), "fr")).toBe(
      "Sea",
    );
    expect(
      griddapTitle(
        titled({ title_translated: "{}", dataset_id: "grid_1" }),
        "fr",
      ),
    ).toBe("grid_1");
  });

  it("survives a title that is not JSON", () => {
    expect(
      griddapTitle(titled({ title_translated: "x", dataset_id: "g" }), "en"),
    ).toBe("g");
    expect(griddapTitle(titled({ title_translated: "x" }), "en")).toBe("");
  });
});

describe("datasetPksOf", () => {
  it("parses the stringified list into numbers", () => {
    expect(datasetPksOf(feature("hexes", { datasets: '["3", 7]' }))).toEqual([
      3, 7,
    ]);
  });

  it("is empty for anything else", () => {
    expect(datasetPksOf(feature("hexes", { datasets: "nope" }))).toEqual([]);
    expect(datasetPksOf(feature("hexes", { datasets: "5" }))).toEqual([]);
    expect(datasetPksOf(feature("hexes", {}))).toEqual([]);
  });
});

describe("trackItemsIn", () => {
  const track = (layerId, pk, trajectoryId, title = "T") =>
    feature(layerId, {
      pk_url: pk,
      trajectory_id: trajectoryId,
      dataset_title: title,
    });

  it("dedupes a head on its own line into one track", () => {
    expect(
      trackItemsIn([
        track("track-heads", "4", "a"),
        track("track-lines", 4, "a"),
      ]),
    ).toEqual([{ kind: "track", pk: 4, trajectoryId: "a", title: "T" }]);
  });

  it("keeps different trajectories of one dataset apart", () => {
    expect(
      trackItemsIn([
        track("track-lines", 4, "a"),
        track("track-lines", 4, "b"),
      ]),
    ).toHaveLength(2);
  });

  it("accepts the empty trajectory id and skips a missing one", () => {
    expect(
      trackItemsIn([
        track("selected-track-line", 4, ""),
        track("track-lines", 5, undefined),
        track("track-lines", undefined, "a"),
      ]),
    ).toEqual([{ kind: "track", pk: 4, trajectoryId: "", title: "T" }]);
  });

  it("ignores layers that are not tracks", () => {
    expect(trackItemsIn([track("hexes", 4, "a")])).toEqual([]);
  });
});

describe("buildFeatureQuery", () => {
  const lngLat = { lng: -63.5, lat: 44.6 };
  const context = (overrides = {}) => ({
    zoom: 6.7,
    queryRendered: () => [],
    language: "en",
    ...overrides,
  });

  it("is null for an empty click", () => {
    expect(buildFeatureQuery(lngLat, [], context())).toBeNull();
  });

  it("is null when nothing under the click is a card item", () => {
    expect(
      buildFeatureQuery(lngLat, hits("griddap-coverage-line"), context()),
    ).toBeNull();
  });

  it("reports the click point, a nonce and the floored zoom", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234);
    const hex = feature(
      "hexes",
      { pk: 9, count: 3, datasets: "[1]" },
      square(0, 0, 1, 1),
    );
    const query = buildFeatureQuery(lngLat, [hex], context());
    vi.useRealTimers();
    expect(query.lngLat).toEqual([-63.5, 44.6]);
    expect(query.nonce).toBe(1234);
    expect(query.buckets.z).toBe(6);
  });

  it("counts a hex once however many tiles it straddles", () => {
    const hex = () =>
      feature(
        "hexes",
        { pk: 9, count: 3, datasets: "[1]" },
        square(0, 0, 1, 1),
      );
    const query = buildFeatureQuery(lngLat, [hex(), hex()], context());
    expect(query.observationCount).toBe(3);
    expect(query.buckets).toEqual({
      hexPks: [9],
      pointPks: [],
      source: "main",
      z: 6,
    });
    expect(query.items).toEqual([
      { kind: "observation", pk: 1, platform: undefined, aggregate: true },
    ]);
  });

  it("re-queries a hex's fragments and unions them into one outline", () => {
    const queryRendered = vi.fn(({ layers }) =>
      layers[0] === "hexes"
        ? [
            feature("hexes", { pk: 9 }, square(0, 0, 1, 1)),
            feature("hexes", { pk: 9 }, square(1, 0, 2, 1)),
          ]
        : [],
    );
    const hex = feature(
      "hexes",
      { pk: 9, count: 3, datasets: "[1]" },
      square(0, 0, 1, 1),
    );
    const query = buildFeatureQuery(lngLat, [hex], context({ queryRendered }));
    expect(queryRendered).toHaveBeenCalledWith({
      layers: ["hexes"],
      filter: ["==", ["get", "pk"], 9],
    });
    const [outline] = query.highlight.features;
    expect(query.highlight.features).toHaveLength(1);
    expect(outline.properties.role).toBe("both");
    expect(outline.geometry.type).toBe("Polygon");
    const xs = outline.geometry.coordinates[0].map(([x]) => x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 2]);
  });

  it("asks the cells source about a coverage hex", () => {
    const hex = feature(
      "coverage-hexes",
      { pk: 2, count: 1, datasets: "[1]" },
      square(0, 0, 1, 1),
    );
    expect(buildFeatureQuery(lngLat, [hex], context()).buckets.source).toBe(
      "cells",
    );
  });

  it("adds the markers drawn inside a clicked coverage hex, once each", () => {
    const station = (pk, x) =>
      feature(
        "points",
        { pk, count: 4, datasets: "[7]", platform: "buoy" },
        { type: "Point", coordinates: [x, 0.5] },
      );
    const queryRendered = ({ layers }) =>
      layers[0] === "points"
        ? [station(5, 0.5), station(5, 0.5), station(6, 3)]
        : [];
    const hex = feature(
      "coverage-hexes",
      { pk: 2, count: 1, datasets: "[1]" },
      square(0, 0, 1, 1),
    );
    const query = buildFeatureQuery(lngLat, [hex], context({ queryRendered }));
    expect(query.observationCount).toBe(5);
    expect(query.buckets.pointPks).toEqual([5]);
    expect(query.items).toEqual([
      { kind: "observation", pk: 1, platform: undefined, aggregate: true },
      { kind: "observation", pk: 7, platform: "buoy", aggregate: false },
    ]);
    expect(
      query.highlight.features.filter((f) => f.geometry.type === "Point"),
    ).toHaveLength(1);
  });

  it("rings a marker without re-querying, and names its platform", () => {
    const queryRendered = vi.fn(() => []);
    const marker = feature(
      "points",
      { pk: 5, count: 2, datasets: "[1]", platform: "mooring" },
      pointAt(1, 1),
    );
    const query = buildFeatureQuery(
      lngLat,
      [marker],
      context({ queryRendered }),
    );
    expect(queryRendered).not.toHaveBeenCalled();
    expect(query.buckets.pointPks).toEqual([5]);
    expect(query.items).toEqual([
      { kind: "observation", pk: 1, platform: "mooring", aggregate: false },
    ]);
    expect(query.highlight.features).toEqual([
      {
        type: "Feature",
        geometry: pointAt(1, 1),
        properties: { count: 2, role: "both" },
      },
    ]);
  });

  it("fills a dataset's platform from a later hit that knows it", () => {
    const hex = feature(
      "hexes",
      { pk: 1, count: 1, datasets: "[7]" },
      square(0, 0, 1, 1),
    );
    const marker = feature(
      "points",
      { pk: 2, count: 1, datasets: "[7]", platform: "ship" },
      pointAt(0, 0),
    );
    const [item] = buildFeatureQuery(lngLat, [hex, marker], context()).items;
    expect(item).toEqual({
      kind: "observation",
      pk: 7,
      platform: "ship",
      aggregate: true,
    });
  });

  it("lists stacked grids once each, outlined apart and filled as one", () => {
    const title = (en) => JSON.stringify({ en });
    const grids = [
      feature(
        GRID,
        { pk: 1, title_translated: title("A") },
        square(0, 0, 2, 2),
      ),
      feature(
        GRID,
        { pk: 1, title_translated: title("A") },
        square(0, 0, 2, 2),
      ),
      feature(
        GRID,
        { pk: 2, title_translated: title("B") },
        square(1, 1, 3, 3),
      ),
    ];
    const query = buildFeatureQuery(lngLat, grids, context());
    expect(query.items).toEqual([
      { kind: "grid", pk: 1, title: "A" },
      { kind: "grid", pk: 2, title: "B" },
    ]);
    expect(query.highlight.features.map((f) => f.properties.role)).toEqual([
      "outline",
      "outline",
      "fill",
    ]);
    expect(query.observationCount).toBe(0);
  });

  it("puts tracks first, then observations, then grids", () => {
    const query = buildFeatureQuery(
      lngLat,
      [
        feature(GRID, { pk: 3, dataset_id: "g" }, square(0, 0, 1, 1)),
        feature(
          "hexes",
          { pk: 1, count: 1, datasets: "[2]" },
          square(0, 0, 1, 1),
        ),
        feature("track-lines", {
          pk_url: 1,
          trajectory_id: "a",
          dataset_title: "T",
        }),
      ],
      context(),
    );
    expect(query.items.map((item) => item.kind)).toEqual([
      "track",
      "observation",
      "grid",
    ]);
    expect(query.datasetPks).toEqual([1, 2, 3]);
  });
});

describe("featureHasDataset", () => {
  it("finds a dataset in the stringified list", () => {
    expect(featureHasDataset(feature("hexes", { datasets: "[3,7]" }), 7)).toBe(
      true,
    );
    expect(featureHasDataset(feature("hexes", { datasets: "[3,7]" }), 8)).toBe(
      false,
    );
  });

  it("is false for a list it cannot read", () => {
    expect(featureHasDataset(feature("hexes", { datasets: "x" }), 3)).toBe(
      false,
    );
    expect(featureHasDataset(feature("hexes", {}), 3)).toBe(false);
  });
});
