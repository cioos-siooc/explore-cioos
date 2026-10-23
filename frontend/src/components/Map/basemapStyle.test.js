import { describe, it, expect } from "vitest";

import {
  buildBasemapStyle,
  getLabelTextField,
  LABEL_LAYER_IDS,
  FIRST_LABEL_LAYER_ID,
} from "./basemapStyle.js";
import { bathymetryColorScale } from "../config.js";

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
      "nonna",
      "nonna10",
      "ofm",
    ]);
    const layerIds = style.layers.map((layer) => layer.id);
    expect(new Set(layerIds).size).toBe(layerIds.length);
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
    const waterway = style.layers.find(
      (layer) => layer.id === "label-waterway",
    );
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

  it("colours NONNA from the merged DEM and shades only NONNA 10 once the 100 m grid is upscaled", () => {
    const style = buildBasemapStyle("en");
    ["nonna", "nonna10"].forEach((id) =>
      expect(style.sources[id]).toMatchObject({
        type: "raster-dem",
        encoding: "terrarium",
      }),
    );
    const layer = (id) => style.layers.find((l) => l.id === id);
    expect(layer("bathymetry-nonna")).toMatchObject({
      type: "color-relief",
      source: "nonna",
    });
    const coarse = layer("bathymetry-nonna-hillshade");
    const fine = layer("bathymetry-nonna-10-hillshade");
    expect(coarse).toMatchObject({ type: "hillshade", source: "nonna" });
    expect(fine).toMatchObject({ type: "hillshade", source: "nonna10" });
    // One hands straight to the other.
    expect(fine.minzoom).toBe(coarse.maxzoom);
    expect(style.sources.nonna10.minzoom).toBe(fine.minzoom);
  });

  it("draws pixels without a sounding transparent and the rest on the legend's ramp", () => {
    const relief = buildBasemapStyle("en").layers.find(
      (layer) => layer.id === "bathymetry-nonna",
    );
    // ["interpolate", ["linear"], ["elevation"], e0, c0, e1, c1, ...]
    const stops = relief.paint["color-relief-color"].slice(3);
    const elevations = stops.filter((_, i) => i % 2 === 0);
    const colors = stops.filter((_, i) => i % 2 === 1);

    // A transparent Terrarium pixel decodes to -32768.
    expect([elevations[0], colors[0]]).toEqual([-32768, "rgba(0, 0, 0, 0)"]);
    expect(elevations).toEqual([...elevations].sort((a, b) => a - b));
    const deepest = bathymetryColorScale.at(-1);
    const shallowest = bathymetryColorScale[0];
    expect(colors[1]).toBe(deepest.color);
    expect(elevations.slice(2)).toEqual(
      [...bathymetryColorScale].reverse().map(({ depth }) => -depth),
    );
    expect([elevations.at(-1), colors.at(-1)]).toEqual([
      -shallowest.depth,
      shallowest.color,
    ]);
  });
});
