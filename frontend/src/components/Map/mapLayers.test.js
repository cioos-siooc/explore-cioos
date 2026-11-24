import { beforeAll, describe, it, expect, vi } from "vitest";

import { FIRST_LABEL_LAYER_ID } from "./basemapStyle.js";
import {
  SELECTION_FILTERED_LAYERS,
  addDataLayers,
  applyStyle,
  observationLayerIds,
  rampStyle,
  revealStyle,
  trackFocusStyle,
  trackLayerIds,
} from "./mapLayers.js";

function fakeMap(existing = []) {
  const layers = new Map(existing.map((id) => [id, { id }]));
  const sources = new Map();
  return {
    layers,
    sources,
    order: [...layers.keys()],
    getLayer: (id) => layers.get(id),
    addSource: (id, source) => sources.set(id, source),
    addImage: vi.fn(),
    addLayer(spec, beforeId) {
      if (beforeId && !layers.has(beforeId)) {
        throw new Error(`beforeId ${beforeId} does not exist`);
      }
      if (!sources.has(spec.source)) {
        throw new Error(`source ${spec.source} does not exist`);
      }
      layers.set(spec.id, spec);
      this.order.push(spec.id);
    },
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
  };
}

const styles = () => [
  revealStyle(false),
  rampStyle({ stops: [], coverageStops: [], radiusRange: [1, 100] }),
  trackFocusStyle(undefined),
];
const queries = {
  tileQuery: "tiles",
  cellTileQuery: "cells",
  tracksQuery: "tracks",
  griddapCoverage: null,
  tracksVisible: false,
};

describe("addDataLayers", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      new Proxy(
        { getImageData: () => ({}) },
        { get: (target, key) => target[key] ?? (() => {}) },
      ),
    );
  });

  it("adds every layer after its beforeId and its source", () => {
    const map = fakeMap([FIRST_LABEL_LAYER_ID]);
    expect(() => addDataLayers(map, queries, styles())).not.toThrow();
    [
      ...observationLayerIds,
      ...trackLayerIds,
      ...Object.keys(SELECTION_FILTERED_LAYERS),
    ].forEach((id) => expect(map.getLayer(id)).toBeDefined());
  });

  it("creates layers in the state the styles describe", () => {
    const map = fakeMap([FIRST_LABEL_LAYER_ID]);
    addDataLayers(map, { ...queries, tracksVisible: true }, styles());
    expect(map.getLayer("hexes").paint["fill-opacity"]).toBe(0);
    expect(map.getLayer("points-halo").paint["circle-radius"]).toBeDefined();
    expect(map.getLayer("track-heads").layout["icon-image"]).toBe(
      "track-head-arrow",
    );
    expect(map.getLayer("track-lines").layout.visibility).toBe("visible");
  });
});

describe("applyStyle", () => {
  it("writes paint and layout, skipping layers not in the style yet", () => {
    const map = fakeMap(["track-lines", "track-heads"]);
    applyStyle(map, trackFocusStyle("selection"));
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      "track-lines",
      "line-color",
      expect.anything(),
    );
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "track-heads",
      "icon-image",
      "track-head-arrow-dim",
    );
    expect(map.setPaintProperty).not.toHaveBeenCalledWith(
      "track-heads-fixed",
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("revealStyle", () => {
  it("holds every count-ramp layer at zero until revealed", () => {
    const hidden = Object.values(revealStyle(false)).flatMap(({ paint }) =>
      Object.values(paint),
    );
    expect(hidden.every((value) => value === 0)).toBe(true);
    const shown = Object.values(revealStyle(true)).flatMap(({ paint }) =>
      Object.values(paint),
    );
    expect(shown.some((value) => value === 0)).toBe(false);
  });
});

describe("trackFocusStyle", () => {
  it("greys only the other datasets' tracks for a focused dataset", () => {
    const color = trackFocusStyle(42)["track-lines"].paint["line-color"];
    expect(color[0]).toBe("case");
    expect(JSON.stringify(color)).toContain("42");
  });
});
