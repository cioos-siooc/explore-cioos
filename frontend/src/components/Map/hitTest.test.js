import { describe, it, expect } from "vitest";

import { GRIDDAP_PRIORITY_ZOOM, griddapOutranksHexesIn } from "./hitTest.js";

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
