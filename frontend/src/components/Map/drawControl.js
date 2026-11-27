import MapboxDraw from "@mapbox/mapbox-gl-draw";
import DrawRectangle from "mapbox-gl-draw-rectangle-mode";

import { polygonIsRectangle } from "../../utilities";
import { withBoxHint, withPolygonHint } from "./DrawHint/drawHintModes.js";

// Captured before the overrides below replace them.
const defaultDragVertex = MapboxDraw.modes.direct_select.dragVertex;
const defaultDirectSelectToDisplayFeatures =
  MapboxDraw.modes.direct_select.toDisplayFeatures;

// mapbox-gl-draw strips a rectangle's closing point; polygonIsRectangle
// expects a closed 5-point ring.
function isRectangleFeature(feature) {
  const ring = feature?.type === "Polygon" && feature.coordinates?.[0];
  return (
    Boolean(ring) && ring.length === 4 && polygonIsRectangle([...ring, ring[0]])
  );
}

// Hides vertex/midpoint handles for a merely-selected shape; a second click
// enters direct_select, whose default toDisplayFeatures draws them.
const disabledEvent = function (state, geojson, display) {
  display(geojson);
};

const modes = MapboxDraw.modes;
MapboxDraw.modes.simple_select.toDisplayFeatures = disabledEvent;

// Keeps a drawn box an axis-aligned rectangle: a single-corner drag also
// slides its two adjacent corners along their shared axes, leaving the
// opposite corner as the anchor. Anything else keeps the library behaviour.
modes.direct_select.dragVertex = function (state, e, delta) {
  const path = state.selectedCoordPaths[0];
  if (
    state.selectedCoordPaths.length !== 1 ||
    !isRectangleFeature(state.feature)
  ) {
    defaultDragVertex.call(this, state, e, delta);
    return;
  }
  const [ringIndex, index] = path.split(".").map((x) => parseInt(x, 10));
  const oldCoord = state.feature.getCoordinate(path);
  const newCoord = [oldCoord[0] + delta.lng, oldCoord[1] + delta.lat];
  [(index + 3) % 4, (index + 1) % 4].forEach((neighborIndex) => {
    const neighborPath = `${ringIndex}.${neighborIndex}`;
    const neighborOld = state.feature.getCoordinate(neighborPath);
    if (neighborOld[0] === oldCoord[0]) {
      state.feature.updateCoordinate(neighborPath, newCoord[0], neighborOld[1]);
    } else {
      state.feature.updateCoordinate(neighborPath, neighborOld[0], newCoord[1]);
    }
  });
  state.feature.updateCoordinate(path, newCoord[0], newCoord[1]);
};

// A spatial filter can only be resized from its handles, never moved
// wholesale; dragMoveLocation is still tracked so a later handle-drag in the
// same gesture doesn't jump.
modes.direct_select.dragFeature = function (state, e) {
  state.dragMoveLocation = e.lngLat;
};

// A midpoint would add a 5th vertex and break a rectangle's 4 corners.
modes.direct_select.toDisplayFeatures = function (state, geojson, push) {
  if (
    state.featureId === geojson.properties.id &&
    isRectangleFeature(state.feature)
  ) {
    defaultDirectSelectToDisplayFeatures.call(
      this,
      state,
      geojson,
      (feature) => {
        if (feature.properties?.meta === "midpoint") return;
        push(feature);
      },
    );
    return;
  }
  defaultDirectSelectToDisplayFeatures.call(this, state, geojson, push);
};

// Keep a drawn shape "active" rather than exiting to simple_select's plain
// look when clicking empty water or another feature.
modes.direct_select.clickNoTarget = modes.direct_select.clickActiveFeature;
modes.direct_select.clickInactive = modes.direct_select.clickActiveFeature;

modes.draw_polygon = withPolygonHint(MapboxDraw.modes.draw_polygon);
modes.draw_rectangle = withBoxHint(DrawRectangle);

export const drawControlOptions = {
  displayControlsDefault: false,
  // Driven imperatively from the top bar (see the drawRequest effect).
  controls: {
    point: false,
    line_string: false,
    polygon: false,
    trash: false,
    combine_features: false,
    uncombine_features: false,
    modes,
    pitchWithRotate: false,
    dragRotate: false,
    touchZoomRotate: false,
  },
  styles: [
    {
      id: "gl-draw-polygon-fill",
      type: "fill",
      filter: ["all", ["==", "$type", "Polygon"]],
      paint: {
        // One colour selected or not: a searched place rests unselected.
        "fill-color": "#fbb03b",
        "fill-opacity": 0.1,
      },
    },
    {
      id: "gl-draw-lines",
      type: "line",
      filter: [
        "any",
        ["==", "$type", "LineString"],
        ["==", "$type", "Polygon"],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#fbb03b",
        "line-dasharray": ["literal", [0.2, 2]],
        "line-width": 2,
      },
    },
    {
      id: "gl-draw-point-outer",
      type: "circle",
      filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5],
        "circle-color": "#fff",
      },
    },
    {
      id: "gl-draw-point-inner",
      type: "circle",
      filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3],
        "circle-color": [
          "case",
          ["==", ["get", "active"], "true"],
          "#fbb03b",
          "#3bb2d0",
        ],
      },
    },
    {
      id: "gl-draw-vertex-outer",
      type: "circle",
      filter: [
        "all",
        ["==", "$type", "Point"],
        ["==", "meta", "vertex"],
        ["!=", "mode", "simple_select"],
      ],
      paint: {
        "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5],
        "circle-color": "#fff",
      },
    },
    {
      id: "gl-draw-vertex-inner",
      type: "circle",
      filter: [
        "all",
        ["==", "$type", "Point"],
        ["==", "meta", "vertex"],
        ["!=", "mode", "simple_select"],
      ],
      paint: {
        "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3],
        "circle-color": "#fbb03b",
      },
    },
    {
      id: "gl-draw-midpoint",
      type: "circle",
      filter: ["all", ["==", "meta", "midpoint"]],
      paint: { "circle-radius": 3, "circle-color": "#fbb03b" },
    },
  ],
};
