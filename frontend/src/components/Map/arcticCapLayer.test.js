import { describe, it, expect } from "vitest";

import {
  buildCapMesh,
  capOpacityAt,
  mosaicUV,
  polarStereographic,
} from "./arcticCapLayer.js";
import { basemapHandoffEndZoom, basemapHandoffStartZoom } from "../config.js";

describe("polarStereographic", () => {
  // Reference values from pyproj, EPSG:4326 -> EPSG:3996.
  it.each([
    [0, 85.0511287798066, 0, -543668.235],
    [90, 85.0511287798066, 543668.235, 0],
    [-135, 88, -155283.715, 155283.715],
    [30, 80, 550298.778, -953145.443],
  ])("projects %s°, %s° like PROJ", (lng, lat, x, y) => {
    const [px, py] = polarStereographic(lng, lat);
    expect(px).toBeCloseTo(x, 0);
    expect(py).toBeCloseTo(y, 0);
  });
});

describe("mosaicUV", () => {
  it("puts the pole where the z4 grid's tile 8 corner falls", () => {
    // The pole is 3368012.081 m right of and 3368075.983 m below the grid
    // origin; the mosaic starts 6 z4 tiles (421455.0127 m each) in.
    const [u, v] = mosaicUV(0, 90);
    expect(u).toBeCloseTo(
      (3368012.081 - 6 * 421455.0127) / (4 * 421455.0127),
      4,
    );
    expect(v).toBeCloseTo(
      (3368075.983 - 6 * 421455.0127) / (4 * 421455.0127),
      4,
    );
  });

  it("keeps the whole cap inside the mosaic", () => {
    for (let lng = -180; lng <= 180; lng += 15) {
      const [u, v] = mosaicUV(lng, 85.0511287798066);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("buildCapMesh", () => {
  it("starts at web mercator's top edge and spans every longitude", () => {
    const { vertices, indices } = buildCapMesh(2, 4);
    const outerRing = [0, 1, 2, 3, 4].map((i) =>
      vertices.slice(i * 4, i * 4 + 2),
    );
    outerRing.forEach(([, y]) => expect(y).toBeCloseTo(0, 9));
    expect(outerRing.map(([x]) => x)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(vertices.length).toBe(3 * 5 * 4);
    expect(indices.length).toBe(2 * 4 * 6);
    expect(Math.max(...indices)).toBe(3 * 5 - 1);
  });

  it("fits the default mesh in 16-bit indices", () => {
    const { vertices } = buildCapMesh();
    expect(vertices.length / 4).toBeLessThan(65536);
  });
});

describe("capOpacityAt", () => {
  it("fades out with the EMODnet raster across the basemap hand-off", () => {
    expect(capOpacityAt(2)).toBe(1);
    expect(capOpacityAt(basemapHandoffStartZoom)).toBe(1);
    expect(capOpacityAt(basemapHandoffEndZoom)).toBe(0);
    expect(capOpacityAt(12)).toBe(0);
  });
});
