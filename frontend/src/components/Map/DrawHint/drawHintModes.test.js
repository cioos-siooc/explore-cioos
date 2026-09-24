import { describe, it, expect, vi } from "vitest";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import DrawRectangle from "mapbox-gl-draw-rectangle-mode";

import { withBoxHint, withPolygonHint } from "./drawHintModes.js";

// Stands in for mapbox-gl-draw's mode interface, which carries the mode's own
// methods too: the modes' onClick/onStop logic runs for real, and every hint
// they fire is recorded.
function run(mode) {
  const hints = [];
  const ctx = {
    map: { fire: (type, { hint }) => type === "draw.hint" && hints.push(hint) },
    changeMode: vi.fn(function () {
      mode.onStop.call(ctx, ctx.state);
    }),
  };
  const feature = {
    id: "f",
    coordinates: [[]],
    updateCoordinate(path, lng, lat) {
      this.coordinates[0][path.split(".")[1]] = [lng, lat];
    },
    removeCoordinate() {},
  };
  Object.assign(ctx, mode, {
    newFeature: () => feature,
    addFeature() {},
    clearSelectedFeatures() {},
    updateUIClasses() {},
    activateUIButton() {},
    setActionableState() {},
    getFeature: () => undefined,
    deleteFeature() {},
  });
  const state = mode.onSetup.call(ctx, {});
  ctx.state = state;
  const click = (lng) =>
    mode.onClick.call(ctx, state, {
      lngLat: { lng, lat: lng },
      featureTarget: undefined,
      point: { x: lng, y: lng },
    });
  return { hints, click };
}

describe("draw hint modes", () => {
  it("walks a box from its first corner to done", () => {
    const { hints, click } = run(withBoxHint(DrawRectangle));
    click(1);
    click(2);
    expect(hints).toEqual(["boxStart", "boxEnd", null]);
  });

  it("asks for three polygon points before offering to finish", () => {
    const { hints, click } = run(
      withPolygonHint(MapboxDraw.modes.draw_polygon),
    );
    [1, 2, 3].forEach(click);
    expect(hints).toEqual([
      "polygonStart",
      "polygonNext",
      "polygonNext",
      "polygonFinish",
    ]);
  });
});
