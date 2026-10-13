import { describe, it, expect } from "vitest";

import { viewportRequest } from "./viewportDatasetPks.js";
import { defaultQuery } from "../filters/FilterProvider.jsx";

const SALISH = [
  [-123.8, 48.2],
  [-122.8, 48.9],
];

function paramsOf(request) {
  return new URL(request.url).searchParams;
}

describe("viewportRequest", () => {
  it("sends the viewport as the rectangle filter alongside the filters", () => {
    const request = viewportRequest(SALISH, {
      ...defaultQuery,
      startDepth: 10,
    });
    expect(new URL(request.url).pathname).toMatch(/\/pointQuery\/inView$/);
    const params = paramsOf(request);
    expect(params.get("depthMin")).toBe("10");
    expect(params.get("lonMin")).toBe("-123.8000");
    expect(params.get("latMin")).toBe("48.2000");
    expect(params.get("lonMax")).toBe("-122.8000");
    expect(params.get("latMax")).toBe("48.9000");
    expect(params.get("polygon")).toBeNull();
  });

  it("clips the viewport to a drawn box instead of sending both rectangles", () => {
    const box = [
      [-123.5, 48],
      [-122, 48],
      [-122, 49],
      [-123.5, 49],
      [-123.5, 48],
    ];
    const params = paramsOf(viewportRequest(SALISH, defaultQuery, box));
    expect(params.get("lonMin")).toBe("-123.5000");
    expect(params.get("latMin")).toBe("48.2000");
    expect(params.get("lonMax")).toBe("-122.8000");
    expect(params.get("latMax")).toBe("48.9000");
    expect(params.get("polygon")).toBeNull();
  });

  it("adds a freeform shape's ring on top of the clipped rectangle", () => {
    const triangle = [
      [-124, 48],
      [-122, 48],
      [-123, 50],
      [-124, 48],
    ];
    const params = paramsOf(viewportRequest(SALISH, defaultQuery, triangle));
    expect(JSON.parse(params.get("polygon"))).toEqual(triangle);
    expect(params.get("lonMin")).toBe("-123.8000");
  });

  it("answers empty without a request when the view misses the drawn shape", () => {
    const elsewhere = [
      [-60, 40],
      [-50, 40],
      [-50, 45],
      [-60, 45],
      [-60, 40],
    ];
    expect(viewportRequest(SALISH, defaultQuery, elsewhere)).toEqual({
      empty: true,
    });
  });

  it("leaves a view wrapping the antimeridian to the bbox test", () => {
    expect(
      viewportRequest(
        [
          [170, 50],
          [190, 60],
        ],
        defaultQuery,
      ),
    ).toBeNull();
    expect(viewportRequest(undefined, defaultQuery)).toBeNull();
  });
});
