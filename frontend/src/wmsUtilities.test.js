import { describe, it, expect } from "vitest";

import {
  clampBoundsForWms,
  buildWmsGetMapUrl,
  buildGriddapLegendUrl,
  pickDefaultVariable,
  wmsSliceParams,
  wmsSliceFromParams,
  buildWmsOverlay,
  intersectBoundsWithPolygonBbox,
  getTimeDimension,
  gridAxisNodes,
  snapToGridNode,
  getVerticalDimension,
  toElevation,
  defaultElevation,
  formatGridSize,
  gridNodeFactors,
  totalGridNodes,
} from "./wmsUtilities.js";

// A stand-in for MapLibre's LngLatBounds — clampBoundsForWms only ever calls
// these four getters.
function bounds(west, south, east, north) {
  return {
    getWest: () => west,
    getSouth: () => south,
    getEast: () => east,
    getNorth: () => north,
  };
}

describe("clampBoundsForWms", () => {
  it("passes an already-valid extent through unchanged", () => {
    expect(clampBoundsForWms(bounds(-10, -10, 10, 10))).toEqual({
      west: -10,
      south: -10,
      east: 10,
      north: 10,
    });
  });

  it("clamps latitude to the Mercator-valid range, not to +-90", () => {
    expect(clampBoundsForWms(bounds(-10, -89, 10, 89))).toEqual({
      west: -10,
      south: -85.05,
      east: 10,
      north: 85.05,
    });
  });

  it("clamps longitude to +-180", () => {
    expect(clampBoundsForWms(bounds(-200, -10, 200, 10))).toEqual({
      west: -180,
      south: -10,
      east: 180,
      north: 10,
    });
  });
});

describe("buildWmsGetMapUrl", () => {
  const base = {
    wmsUrl: "https://erddap.example/wms/ds1/request",
    datasetId: "ds1",
    variable: "temperature",
    bounds: { west: -130, south: 45, east: -120, north: 55 },
    width: 512.4,
    height: 256.6,
  };

  it("builds a WMS 1.1.0 GetMap request with a lon,lat bbox order", () => {
    const url = buildWmsGetMapUrl(base);
    const params = new URL(url).searchParams;
    expect(params.get("version")).toBe("1.1.0");
    expect(params.get("srs")).toBe("EPSG:4326");
    expect(params.get("layers")).toBe("ds1:temperature");
    expect(params.get("bbox")).toBe("-130,45,-120,55");
  });

  it("rounds width/height to whole pixels", () => {
    const url = buildWmsGetMapUrl(base);
    const params = new URL(url).searchParams;
    expect(params.get("width")).toBe("512");
    expect(params.get("height")).toBe("257");
  });

  it("normalizes a harvested +00:00 offset to Z for the time param", () => {
    const url = buildWmsGetMapUrl({
      ...base,
      time: "2020-01-01T00:00:00+00:00",
    });
    expect(new URL(url).searchParams.get("time")).toBe(
      "2020-01-01T00:00:00Z",
    );
  });

  it("omits time and elevation when absent", () => {
    const url = buildWmsGetMapUrl(base);
    const params = new URL(url).searchParams;
    expect(params.has("time")).toBe(false);
    expect(params.has("elevation")).toBe(false);
  });

  it("includes elevation 0, which is falsy but a real value", () => {
    const url = buildWmsGetMapUrl({ ...base, elevation: 0 });
    expect(new URL(url).searchParams.get("elevation")).toBe("0");
  });
});

describe("buildGriddapLegendUrl", () => {
  const base = {
    erddapUrl: "https://erddap.example/griddap/ds1.html",
    variable: "temperature",
    dimensions: [
      { name: "time" },
      { name: "latitude" },
      { name: "longitude" },
    ],
  };

  it("returns null without an erddapUrl or a variable", () => {
    expect(buildGriddapLegendUrl({ ...base, erddapUrl: null })).toBeNull();
    expect(buildGriddapLegendUrl({ ...base, variable: null })).toBeNull();
  });

  it("swaps .html for .png and adds the legend-only params", () => {
    const url = buildGriddapLegendUrl(base);
    expect(url.startsWith("https://erddap.example/griddap/ds1.png?")).toBe(
      true,
    );
    expect(url).toContain("&.legend=Only&.size=360|150");
  });

  it("strides lat/lon and names the time slice, or (last) without one", () => {
    const withoutTime = decodeURIComponent(buildGriddapLegendUrl(base));
    expect(withoutTime).toContain("temperature[(last)][0:10:last][0:10:last]");

    const withTime = decodeURIComponent(
      buildGriddapLegendUrl({ ...base, time: "2020-06-01T00:00:00+00:00" }),
    );
    expect(withTime).toContain(
      "temperature[(2020-06-01T00:00:00Z)][0:10:last][0:10:last]",
    );
  });

  it("names the vertical dimension's elevation slice when given one", () => {
    const dimensions = [...base.dimensions, { name: "depth" }];
    const url = decodeURIComponent(
      buildGriddapLegendUrl({ ...base, dimensions, elevation: -10 }),
    );
    // toElevation negates depth<->elevation, so elevation -10 is depth 10.
    expect(url).toContain("[(10)]");
  });

  it("slices every other (non-spatial, non-time) dimension at its first level", () => {
    const dimensions = [...base.dimensions, { name: "scenario" }];
    const url = decodeURIComponent(buildGriddapLegendUrl({ ...base, dimensions }));
    expect(url).toContain("temperature[(last)][0:10:last][0:10:last][0]");
  });
});

describe("pickDefaultVariable", () => {
  const withEov = { name: "temp", eovs: ["seaSurfaceTemperature"] };
  const withOtherEov = { name: "sal", eovs: ["salinity"] };
  const withNoEov = { name: "misc", eovs: [] };

  it("prefers a variable matching one of the currently-selected EOVs", () => {
    expect(
      pickDefaultVariable(
        [withNoEov, withOtherEov, withEov],
        ["seaSurfaceTemperature"],
      ),
    ).toBe(withEov);
  });

  it("falls back to any variable carrying an EOV when none is selected", () => {
    expect(pickDefaultVariable([withNoEov, withOtherEov], [])).toBe(
      withOtherEov,
    );
  });

  it("falls back to the first variable when none carry EOVs (pre-harvest-change datasets)", () => {
    expect(pickDefaultVariable([withNoEov], [])).toBe(withNoEov);
  });

  it("handles an empty/missing variable list without throwing", () => {
    expect(pickDefaultVariable(undefined, [])).toBeUndefined();
    expect(pickDefaultVariable([], [])).toBeUndefined();
  });
});

describe("wmsSliceParams / wmsSliceFromParams", () => {
  it("round-trips variable, time and elevation through share-link params", () => {
    const overlay = {
      variable: { name: "temperature" },
      time: "2020-06-01T00:00:00Z",
      elevation: -10,
    };
    const params = wmsSliceParams(overlay);
    expect(params).toEqual({
      var: "temperature",
      date: "2020-06-01T00:00:00Z",
      z: -10,
    });

    const restored = wmsSliceFromParams(new URLSearchParams(params));
    expect(restored).toEqual({
      variable: "temperature",
      time: "2020-06-01T00:00:00Z",
      elevation: -10,
    });
  });

  it("includes elevation 0 (falsy but real) in both directions", () => {
    expect(wmsSliceParams({ elevation: 0 })).toEqual({ z: 0 });
    expect(wmsSliceFromParams(new URLSearchParams("z=0"))).toEqual({
      elevation: 0,
    });
  });

  it("returns undefined for an empty overlay/search", () => {
    expect(wmsSliceParams({})).toEqual({});
    expect(wmsSliceFromParams(new URLSearchParams())).toBeUndefined();
  });

  it("drops an unparseable date rather than producing a value the rails would crash on", () => {
    expect(
      wmsSliceFromParams(new URLSearchParams("date=not-a-date")),
    ).toBeUndefined();
  });

  it("drops a non-numeric elevation", () => {
    expect(wmsSliceFromParams(new URLSearchParams("z=abc"))).toBeUndefined();
  });
});

describe("buildWmsOverlay", () => {
  const dataset = {
    pk: 1,
    dataset_id: "ds1",
    title: "Test grid",
    wms_url: "https://erddap.example/wms/ds1/request",
    erddap_url: "https://erddap.example/griddap/ds1.html",
    coverage_bbox_geojson: { type: "Polygon", coordinates: [] },
    grid_dimensions: [{ name: "time", min: "2020-01-01", max: "2020-12-31" }],
    grid_variables: [
      { name: "temp", eovs: ["seaSurfaceTemperature"] },
      { name: "sal", eovs: ["salinity"] },
    ],
  };

  it("picks a default variable and the latest time when no slice is given", () => {
    const overlay = buildWmsOverlay(dataset, ["salinity"], undefined);
    expect(overlay.variable.name).toBe("sal");
    expect(overlay.time).toBe("2020-12-31");
    expect(overlay.pk).toBe(1);
    expect(overlay.datasetId).toBe("ds1");
  });

  it("honours a share-link slice naming a variable this dataset actually serves", () => {
    const overlay = buildWmsOverlay(dataset, [], { variable: "temp" });
    expect(overlay.variable.name).toBe("temp");
  });

  it("falls back to the default pick when the slice names a variable this dataset doesn't have", () => {
    const overlay = buildWmsOverlay(dataset, ["seaSurfaceTemperature"], {
      variable: "doesNotExist",
    });
    expect(overlay.variable.name).toBe("temp");
  });

  it("honours a share-link time over the dataset's own latest", () => {
    const overlay = buildWmsOverlay(dataset, [], { time: "2020-06-01" });
    expect(overlay.time).toBe("2020-06-01");
  });
});

describe("intersectBoundsWithPolygonBbox", () => {
  const viewport = { west: -10, south: -10, east: 10, north: 10 };

  it("returns the viewport unchanged without a polygon", () => {
    expect(intersectBoundsWithPolygonBbox(viewport, undefined)).toBe(
      viewport,
    );
    expect(intersectBoundsWithPolygonBbox(viewport, [[0, 0]])).toBe(viewport);
  });

  it("clips to the intersection of the viewport and the polygon's bbox", () => {
    const ring = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ];
    expect(intersectBoundsWithPolygonBbox(viewport, ring)).toEqual({
      west: -5,
      south: -5,
      east: 5,
      north: 5,
    });
  });

  it("returns null when the polygon's bbox lies outside the viewport", () => {
    const ring = [
      [20, 20],
      [30, 20],
      [30, 30],
      [20, 30],
    ];
    expect(intersectBoundsWithPolygonBbox(viewport, ring)).toBeNull();
  });
});

describe("getTimeDimension / getVerticalDimension", () => {
  const dimensions = [
    { name: "longitude" },
    { name: "latitude" },
    { name: "time" },
    { name: "depth" },
  ];

  it("finds the time dimension by name", () => {
    expect(getTimeDimension(dimensions)).toBe(dimensions[2]);
  });

  it("finds depth or altitude as the vertical dimension", () => {
    expect(getVerticalDimension(dimensions)).toBe(dimensions[3]);
    expect(
      getVerticalDimension([{ name: "altitude" }]).name,
    ).toBe("altitude");
  });

  it("returns undefined when absent, without throwing on a missing list", () => {
    expect(getTimeDimension([])).toBeUndefined();
    expect(getTimeDimension(undefined)).toBeUndefined();
  });
});

describe("gridAxisNodes / snapToGridNode", () => {
  it("computes the step across an evenly-spaced axis", () => {
    expect(gridAxisNodes(0, 100, 5)).toEqual({
      min: 0,
      max: 100,
      count: 5,
      step: 25,
    });
  });

  it("returns null for a degenerate or single-node axis", () => {
    expect(gridAxisNodes(0, 100, 1)).toBeNull();
    expect(gridAxisNodes(100, 0, 5)).toBeNull();
    expect(gridAxisNodes(NaN, 100, 5)).toBeNull();
  });

  it("snaps a value to the nearest node and clamps within range", () => {
    const nodes = gridAxisNodes(0, 100, 5); // nodes at 0,25,50,75,100
    expect(snapToGridNode(nodes, 30)).toBe(25);
    expect(snapToGridNode(nodes, 38)).toBe(50);
    expect(snapToGridNode(nodes, -50)).toBe(0);
    expect(snapToGridNode(nodes, 500)).toBe(100);
  });

  it("passes the value through unchanged without axis nodes", () => {
    expect(snapToGridNode(null, 42)).toBe(42);
  });
});

describe("toElevation / defaultElevation", () => {
  it("negates depth into elevation, leaves altitude as-is", () => {
    expect(toElevation({ name: "depth" }, 10)).toBe(-10);
    expect(toElevation({ name: "altitude" }, 10)).toBe(10);
  });

  it("defaults to the endpoint nearest the surface", () => {
    expect(
      defaultElevation([{ name: "depth", min: 5, max: 500 }]),
    ).toBe(-5);
    expect(
      defaultElevation([{ name: "altitude", min: 5, max: 500 }]),
    ).toBe(5);
  });

  it("returns undefined without a vertical dimension", () => {
    expect(defaultElevation([{ name: "time" }])).toBeUndefined();
    expect(defaultElevation([])).toBeUndefined();
  });
});

describe("formatGridSize / gridNodeFactors / totalGridNodes", () => {
  const dimensions = [
    { name: "longitude", n_values: 184 },
    { name: "latitude", n_values: 80 },
    { name: "time", n_values: 10 },
  ];

  it("formats lon x lat node counts", () => {
    expect(formatGridSize(dimensions)).toBe("184×80");
  });

  it("returns null when lon or lat is missing", () => {
    expect(formatGridSize([{ name: "time", n_values: 10 }])).toBeNull();
  });

  it("orders factors spatial-first, then by declaration for the rest", () => {
    const withDepth = [...dimensions, { name: "depth", n_values: 5 }];
    expect(gridNodeFactors(withDepth).map((d) => d.name)).toEqual([
      "longitude",
      "latitude",
      "time",
      "depth",
    ]);
  });

  it("drops dimensions with no node count", () => {
    const withEmpty = [...dimensions, { name: "scenario" }];
    expect(gridNodeFactors(withEmpty)).toHaveLength(3);
  });

  it("multiplies every dimension's node count", () => {
    expect(totalGridNodes(dimensions)).toBe(184 * 80 * 10);
  });

  it("returns null without dimensions", () => {
    expect(totalGridNodes([])).toBeNull();
    expect(totalGridNodes(undefined)).toBeNull();
  });
});
