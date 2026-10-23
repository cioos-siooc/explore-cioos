import { test } from "node:test";
import assert from "node:assert/strict";

import { COLUMNS, ROWS } from "./previewFacetPlan.js";
import { pinnedAxisSizeFor } from "./previewFacetSizing.js";
import {
  pinnedAxisFigureFor,
  pinnedViewFor,
  splitPinnedAxis,
} from "./previewPinnedAxis.js";

const SHARED_X = {
  domain: [0, 1],
  anchor: "y",
  showspikes: true,
  tickmode: "array",
  tickvals: [0, 1],
  ticktext: ["start", "end"],
  title: { text: "Time ( UTC )", font: { size: 18 } },
};
const PANEL_Y = { domain: [0, 1], title: { text: "Temperature" } };
const STACK = {
  data: [{ x: [0, 1], y: [2, 3] }],
  layout: { xaxis: SHARED_X, yaxis: PANEL_Y },
};

const VIEW = {
  range: [10, 0],
  type: "linear",
  width: 800,
  height: 500,
  l: 90,
  r: 30,
  t: 60,
  b: 4,
};

test("the figure keeps its shared axis, unlabelled, and nothing else changes", () => {
  const { figure } = splitPinnedAxis(STACK, ROWS);
  assert.equal(figure.data, STACK.data);
  assert.equal(figure.layout.xaxis.showticklabels, false);
  assert.equal(figure.layout.xaxis.title.text, "");
  // Gridlines, spikes and the panels' wiring stay with the panels.
  assert.equal(figure.layout.xaxis.showspikes, true);
  assert.equal(figure.layout.xaxis.anchor, "y");
  assert.equal(figure.layout.yaxis, PANEL_Y);
  assert.equal(STACK.layout.xaxis.title.text, "Time ( UTC )"); // not mutated
});

test("the strip takes the axis's label and scale, not the panels' wiring", () => {
  const { axis } = splitPinnedAxis(STACK, ROWS);
  assert.deepEqual(axis, {
    title: SHARED_X.title,
    tickmode: "array",
    tickvals: [0, 1],
    ticktext: ["start", "end"],
  });
});

test("a profile pins its vertical axis", () => {
  const profile = {
    data: [],
    layout: { yaxis: { title: { text: "depth ( m )" } }, xaxis: PANEL_Y },
  };
  const { figure, axis } = splitPinnedAxis(profile, COLUMNS);
  assert.equal(figure.layout.yaxis.showticklabels, false);
  assert.equal(figure.layout.xaxis, PANEL_Y);
  assert.equal(axis.title.text, "depth ( m )");
});

test("the view is what Plotly resolved: the range it drew and the margins it grew", () => {
  const fullLayout = {
    width: 800,
    height: 500,
    _size: { l: 90, r: 30, t: 60, b: 4, w: 680, h: 436, p: 0 },
    xaxis: { range: [10, 0], type: "linear" },
    yaxis: { range: ["2024-01-01", "2024-01-02"], type: "date" },
  };
  assert.deepEqual(pinnedViewFor(fullLayout, ROWS), VIEW);
  assert.deepEqual(pinnedViewFor(fullLayout, COLUMNS), {
    ...VIEW,
    range: ["2024-01-01", "2024-01-02"],
    type: "date",
  });
});

test("a stack's strip runs under the panels, across their exact width", () => {
  const { axis } = splitPinnedAxis(STACK, ROWS);
  const { data, layout } = pinnedAxisFigureFor(axis, VIEW, ROWS);
  assert.deepEqual(data, []);
  assert.equal(layout.width, VIEW.width);
  assert.equal(layout.height, pinnedAxisSizeFor(ROWS));
  assert.equal(layout.margin.l, VIEW.l);
  assert.equal(layout.margin.r, VIEW.r);
  assert.equal(layout.margin.autoexpand, false);
  assert.deepEqual(layout.xaxis.range, [10, 0]); // reversed stays reversed
  assert.equal(layout.xaxis.autorange, false);
  assert.equal(layout.xaxis.type, "linear");
  assert.deepEqual(layout.xaxis.ticktext, ["start", "end"]);
  assert.equal(layout.xaxis.title.text, "Time ( UTC )");
  assert.equal(layout.xaxis.fixedrange, true);
  assert.equal(layout.yaxis.visible, false);
});

test("a profile's strip runs beside the panels, down their exact height", () => {
  const { layout } = pinnedAxisFigureFor(
    { title: { text: "depth ( m )" } },
    VIEW,
    COLUMNS,
  );
  assert.equal(layout.width, pinnedAxisSizeFor(COLUMNS));
  assert.equal(layout.height, VIEW.height);
  assert.equal(layout.margin.t, VIEW.t);
  assert.equal(layout.margin.b, VIEW.b);
  assert.deepEqual(layout.yaxis.range, [10, 0]);
  assert.equal(layout.yaxis.fixedrange, true);
  assert.equal(layout.xaxis.visible, false);
});
