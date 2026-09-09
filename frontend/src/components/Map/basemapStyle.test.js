import { describe, it, expect } from "vitest";

import {
  buildBasemapStyle,
  getLabelTextField,
  LABEL_LAYER_IDS,
  FIRST_LABEL_LAYER_ID,
} from "./basemapStyle.js";

describe("getLabelTextField", () => {
  it("prefers the localized name, falling back to the tile's default", () => {
    expect(getLabelTextField("fr")).toEqual([
      "coalesce",
      ["get", "name:fr"],
      ["get", "name"],
    ]);
  });
});

describe("buildBasemapStyle", () => {
  it("returns a v8 style with every declared source and layer", () => {
    const style = buildBasemapStyle("en");
    expect(style.version).toBe(8);
    expect(Object.keys(style.sources).sort()).toEqual([
      "bathymetry",
      "imagery",
      "nonna10",
      "nonna100",
      "ofm",
    ]);
    const layerIds = style.layers.map((layer) => layer.id);
    expect(new Set(layerIds).size).toBe(layerIds.length); // no duplicate ids
  });

  it("includes every label layer Map.js anchors data layers against", () => {
    const layerIds = buildBasemapStyle("en").layers.map((layer) => layer.id);
    LABEL_LAYER_IDS.forEach((id) => expect(layerIds).toContain(id));
    expect(layerIds).toContain(FIRST_LABEL_LAYER_ID);
  });

  it("threads the requested language into every label layer's text-field", () => {
    const style = buildBasemapStyle("fr");
    const labelLayers = style.layers.filter((layer) => layer.type === "symbol");
    expect(labelLayers.length).toBeGreaterThan(0);
    labelLayers.forEach((layer) => {
      expect(layer.layout["text-field"]).toEqual(getLabelTextField("fr"));
    });
  });

  it("defaults to English when no language is given", () => {
    const style = buildBasemapStyle();
    const waterway = style.layers.find((layer) => layer.id === "label-waterway");
    expect(waterway.layout["text-field"]).toEqual(getLabelTextField("en"));
  });

  it("fades the bathymetry raster out and the imagery raster in over the same zoom window", () => {
    const style = buildBasemapStyle("en");
    const bathymetry = style.layers.find((layer) => layer.id === "bathymetry");
    const imagery = style.layers.find((layer) => layer.id === "imagery");
    // interpolate expr: ["interpolate", ["linear"], ["zoom"], z0, v0, z1, v1]
    const [, , , bStartZoom, bStartVal, bEndZoom, bEndVal] =
      bathymetry.paint["raster-opacity"];
    const [, , , iStartZoom, iStartVal, iEndZoom, iEndVal] =
      imagery.paint["raster-opacity"];
    expect([bStartZoom, bEndZoom]).toEqual([iStartZoom, iEndZoom]);
    expect(bStartVal).toBe(1);
    expect(bEndVal).toBe(0);
    expect(iStartVal).toBe(0);
    expect(iEndVal).toBe(1);
  });
});
