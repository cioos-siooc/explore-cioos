import { test } from "node:test";
import assert from "node:assert/strict";

import { COLUMNS, ROWS } from "./previewFacetPlan.js";
import { COLORBAR_ROOM_PX, pinnedAxisSizeFor } from "./previewFacetSizing.js";
import { splitPinnedAxis } from "./previewPinnedAxis.js";
import { exportFigureFor } from "./previewExportFigure.js";

const MARGIN = { l: 90, r: 26, t: 30, b: 4 };
const STACK = {
  data: [{ x: [0, 1], y: [2, 3], marker: { coloraxis: "coloraxis" } }],
  layout: {
    width: 800,
    height: 500,
    margin: MARGIN,
    xaxis: {
      domain: [0, 1],
      tickmode: "array",
      tickvals: [0, 1],
      ticktext: ["start", "end"],
      title: { text: "Time ( UTC )" },
    },
    yaxis: { domain: [0, 1], title: { text: "Temperature" } },
    coloraxis: {
      colorscale: [
        [0, "#000"],
        [1, "#fff"],
      ],
      cmin: 10,
      cmax: 30,
      showscale: false,
    },
  },
};
const LEGEND = {
  label: "Salinity ( PSU )",
  stops: STACK.layout.coloraxis.colorscale,
  ticks: [
    { position: 0, text: "10" },
    { position: 0.5, text: "20" },
    { position: 1, text: "30" },
  ],
};

// What the graph div holds once drawn and zoomed: the split figure, with the
// range Plotly wrote back into the shared axis.
function liveStack() {
  const { figure, axis } = splitPinnedAxis(STACK, ROWS);
  const layout = {
    ...figure.layout,
    xaxis: { ...figure.layout.xaxis, range: [0.2, 0.8], autorange: false },
  };
  return { data: figure.data, layout, pinnedAxis: axis };
}

test("the pinned axis is labelled again, at the range it was zoomed to", () => {
  const { data, layout, pinnedAxis } = liveStack();
  const exported = exportFigureFor({
    data,
    layout,
    pinnedAxis,
    orientation: ROWS,
    colorLegend: null,
  });
  const { xaxis } = exported.layout;
  assert.equal(xaxis.showticklabels, true);
  assert.equal(xaxis.title.text, "Time ( UTC )");
  assert.deepEqual(xaxis.ticktext, ["start", "end"]);
  assert.deepEqual(xaxis.range, [0.2, 0.8]);
});

test("a stack grows downwards by the strip's room, a profile leftwards", () => {
  const { data, layout, pinnedAxis } = liveStack();
  const stack = exportFigureFor({
    data,
    layout,
    pinnedAxis,
    orientation: ROWS,
    colorLegend: null,
  });
  assert.equal(stack.height, 500 + pinnedAxisSizeFor(ROWS));
  assert.equal(stack.width, 800);
  assert.equal(stack.layout.margin.b, MARGIN.b + pinnedAxisSizeFor(ROWS));
  assert.equal(stack.layout.height, stack.height);

  const profile = exportFigureFor({
    data,
    layout,
    pinnedAxis,
    orientation: COLUMNS,
    colorLegend: null,
  });
  assert.equal(profile.layout.yaxis.showticklabels, true);
  assert.equal(profile.width, 800 + pinnedAxisSizeFor(COLUMNS));
  assert.equal(profile.height, 500);
  assert.equal(profile.layout.margin.l, MARGIN.l + pinnedAxisSizeFor(COLUMNS));
});

test("the colour legend becomes a colourbar with the legend's own ticks", () => {
  const { data, layout, pinnedAxis } = liveStack();
  const exported = exportFigureFor({
    data,
    layout,
    pinnedAxis,
    orientation: ROWS,
    colorLegend: LEGEND,
  });
  const { coloraxis } = exported.layout;
  assert.equal(coloraxis.showscale, true);
  assert.deepEqual(coloraxis.colorbar.tickvals, [10, 20, 30]);
  assert.deepEqual(coloraxis.colorbar.ticktext, ["10", "20", "30"]);
  assert.equal(coloraxis.colorbar.title.text, "Salinity ( PSU )");
  assert.equal(exported.width, 800 + COLORBAR_ROOM_PX);
  assert.equal(exported.layout.margin.r, MARGIN.r + COLORBAR_ROOM_PX);
});

test("without a colour legend the colour axis is left as drawn", () => {
  const { data, layout, pinnedAxis } = liveStack();
  const exported = exportFigureFor({
    data,
    layout,
    pinnedAxis,
    orientation: ROWS,
    colorLegend: null,
  });
  assert.deepEqual(exported.layout.coloraxis, STACK.layout.coloraxis);
  assert.equal(exported.layout.margin.r, MARGIN.r);
});

test("the live graph's figure is not written into", () => {
  const { data, layout, pinnedAxis } = liveStack();
  const exported = exportFigureFor({
    data,
    layout,
    pinnedAxis,
    orientation: ROWS,
    colorLegend: LEGEND,
  });
  assert.equal(layout.xaxis.showticklabels, false);
  assert.equal(layout.coloraxis.showscale, false);
  assert.equal(layout.margin.b, MARGIN.b);
  assert.notEqual(exported.data[0], data[0]);
});
