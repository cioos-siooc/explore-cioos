import { describe, it, expect } from "vitest";
import MapboxDraw from "@mapbox/mapbox-gl-draw";

import "./drawControl.js";

function rectangleState(path) {
  const ring = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  return {
    selectedCoordPaths: [path],
    feature: {
      type: "Polygon",
      coordinates: [ring],
      getCoordinate: (p) => ring[Number(p.split(".")[1])],
      updateCoordinate: (p, x, y) => {
        ring[Number(p.split(".")[1])] = [x, y];
      },
    },
    ring,
  };
}

describe("drawControl's direct_select patches", () => {
  it("drags a box corner while keeping the box axis-aligned", () => {
    const state = rectangleState("0.2");
    MapboxDraw.modes.direct_select.dragVertex.call(
      {},
      state,
      {},
      {
        lng: 5,
        lat: 2,
      },
    );
    expect(state.ring).toEqual([
      [0, 0],
      [15, 0],
      [15, 12],
      [0, 12],
    ]);
  });

  it("never moves a shape wholesale", () => {
    const state = { dragMoveLocation: null };
    MapboxDraw.modes.direct_select.dragFeature(state, { lngLat: [1, 2] });
    expect(state.dragMoveLocation).toEqual([1, 2]);
  });
});
