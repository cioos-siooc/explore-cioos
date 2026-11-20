import { test } from "node:test";
import assert from "node:assert/strict";

import { variablesFrom, byColumnName, labelFor } from "./previewVariables.js";
import { facetPlanFor, COLUMNS, ROWS } from "./previewFacetPlan.js";
import {
  POSITION_INDEX_COLUMN,
  positionRowsFor,
  trackIndexFor,
} from "./previewTrackIndex.js";
import {
  buildFigure,
  TICK_SPACING_PX,
  buildGridFigure,
  rankTicksFor,
  buildOverlayFigure,
  gridBoxFor,
  plotBoxFor,
  recordTitleFor,
} from "./previewFacetFigure.js";
import {
  maxCharsFor,
  titleLinesFor,
  HOVER_FONT_PX,
  LABEL_FONT_PX,
  MAX_TITLE_LINES,
  TICK_FONT_PX,
  TITLE_FONT_PX,
} from "./previewLabelText.js";
import {
  heightBudgetFor,
  marginFor,
  panelPitch,
  plotHeightFor,
  plotWidthFor,
  titleRoomFor,
  COLUMN_GAP,
  MIN_PANEL_PX,
  TOOLBAR_ROOM_PX,
} from "./previewFacetSizing.js";
import { colorScaleFor } from "./previewColorScales.js";
import { defaultColorFor } from "./previewColors.js";
import { paletteColorFor, paletteFor } from "./erddapPalettes.js";
import {
  VIKING,
  VIKING_NO_META,
  VIKING_DATASET,
} from "./previewVariables.test.mjs";

const ALL_SIX = [
  "TE90_01",
  "CNDC_01",
  "PRES_01",
  "PSAL_01",
  "FLOR_01",
  "DOXY_01",
];

// The cf_role columns carry values because the figure is titled after them.
const DATA = Array.from({ length: 20 }, (_, i) => {
  const row = {
    station_id: "PMZA-RIKI",
    profile: "PMZA-RIKI-25/09/16-17:35:26",
    depth: i + 1,
    time: `2025-09-16T00:${String(i).padStart(2, "0")}:00Z`,
  };
  ALL_SIX.forEach((name, n) => {
    row[name] = i * (n + 1);
  });
  return row;
});

const TITLE =
  "Station Id (timeseries_id): PMZA-RIKI — Profile (profile_id): PMZA-RIKI-25/09/16-17:35:26";

// Publisher palettes on two measurements, to exercise the ERDDAP colour default.
const VIKING_PALETTES = {
  ...VIKING,
  columnMeta: VIKING.columnMeta.map((meta) => {
    if (meta.name === "TE90_01")
      return { ...meta, colorBarPalette: "KT_thermal" };
    if (meta.name === "PSAL_01")
      return { ...meta, colorBarPalette: "KT_haline" };
    return meta;
  }),
};

function figureFrom(table, type, panels, extra = {}) {
  const dataset = { ...VIKING_DATASET, cdm_data_type: type };
  const variables = variablesFrom(table, dataset);
  const variablesByName = byColumnName(variables);
  const plan = facetPlanFor(dataset, variables, DATA);
  return buildFigure({
    plan,
    variablesByName,
    panels,
    sharedAxis: plan.sharedAxis,
    data: DATA,
    title: recordTitleFor({ plan, variablesByName, data: DATA }),
    mode: "markers",
    uirevision: "test",
    ...extra,
  });
}

const figure = (type, panels, extra) => figureFrom(VIKING, type, panels, extra);

// --- profile layout (COLUMNS) ------------------------------------------------

test("a profile gets one shared y axis and one x axis per panel", () => {
  const { data, layout } = figure("Profile", ALL_SIX);
  assert.equal(data.length, 6);
  assert.equal(Object.keys(layout).filter((k) => /^yaxis/.test(k)).length, 1);
  assert.equal(Object.keys(layout).filter((k) => /^xaxis/.test(k)).length, 6);
});

test("every panel of a profile and of a stack is boxed against the shared axis", () => {
  const boxes = (type) =>
    figure(type, ["TE90_01", "PSAL_01"]).layout.shapes.map((shape) => [
      shape.type,
      shape.xref,
      shape.yref,
    ]);
  assert.deepEqual(boxes("Profile"), [
    ["rect", "x domain", "y domain"],
    ["rect", "x2 domain", "y domain"],
  ]);
  assert.deepEqual(boxes("TimeSeries"), [
    ["rect", "x domain", "y domain"],
    ["rect", "x domain", "y2 domain"],
  ]);
});

test("the shared depth axis is reversed, and titled along itself", () => {
  const { layout } = figure("Profile", ALL_SIX);
  assert.equal(layout.yaxis.autorange, "reversed");
  assert.equal(layout.yaxis.title.text, "depth of observation (m)");
  assert.equal(layout.yaxis.automargin, true);
  assert.equal(layout.annotations, undefined);
});

const withDepths = (from, to) =>
  DATA.map((row, i) => ({
    ...row,
    depth: from + ((to - from) * i) / (DATA.length - 1),
  }));
const depthRange = (data) =>
  figure("Profile", ALL_SIX, { data }).layout.yaxis.autorangeoptions;

test("a profile starting near 0 stops its depth axis at 0", () => {
  assert.deepEqual(depthRange(withDepths(2, 100)), {
    clipmin: 0,
    clipmax: 100.98,
  });
  assert.deepEqual(
    overlayFrom("Profile", ["TE90_01", "PSAL_01"], { data: withDepths(2, 100) })
      .layout.yaxis.autorangeoptions,
    { clipmin: 0, clipmax: 100.98 },
  );
});

test("a profile ending near 0 from below stops there too", () => {
  assert.deepEqual(depthRange(withDepths(-100, -2)), {
    clipmin: -100.98,
    clipmax: 0,
  });
});

test("a profile far from 0, or across it, hugs its data", () => {
  assert.deepEqual(depthRange(withDepths(50, 150)), {
    clipmin: 49,
    clipmax: 151,
  });
  assert.deepEqual(depthRange(withDepths(-50, 50)), {
    clipmin: -51,
    clipmax: 51,
  });
});

test("a profile at a single depth is left to Plotly", () => {
  assert.equal(depthRange(withDepths(5, 5)), undefined);
});

test("a timeseries' shared time axis is left to Plotly", () => {
  const { layout } = figure("TimeSeries", ["TE90_01"]);
  assert.equal(layout.xaxis.autorangeoptions, undefined);
});

test("the user can draw the shared depth axis upwards", () => {
  const { layout } = figure("Profile", ALL_SIX, {
    reversedYAxes: new Set(),
  });
  assert.equal(layout.yaxis.autorange, undefined);
});

test("a stack reverses only the panels it is asked to", () => {
  const { layout } = figure("TimeSeries", ["TE90_01", "PSAL_01"], {
    reversedYAxes: new Set(["PSAL_01"]),
  });
  assert.equal(layout.yaxis.autorange, undefined);
  assert.equal(layout.yaxis2.autorange, "reversed");
  assert.equal(layout.xaxis.autorange, undefined);
});

test("profile panel titles sit on top, one per variable", () => {
  const { layout } = figure("Profile", ["TE90_01", "PSAL_01"]);
  assert.equal(layout.xaxis.side, "top");
  assert.equal(layout.xaxis.title.text, "Temperature (1990 scale) (degree_C)");
  assert.equal(layout.xaxis2.side, "top");
  assert.equal(layout.xaxis2.title.text, "Practical Salinity (PSU)");
});

test("every profile trace shares y and takes its own x", () => {
  const { data } = figure("Profile", ALL_SIX);
  assert.deepEqual(
    data.map((t) => t.yaxis),
    Array(6).fill("y"),
  );
  assert.deepEqual(
    data.map((t) => t.xaxis),
    ["x", "x2", "x3", "x4", "x5", "x6"],
  );
});

test("a profile puts the variable across and depth down", () => {
  const { data } = figure("Profile", ["TE90_01"]);
  assert.deepEqual(
    data[0].x,
    DATA.map((r) => r.TE90_01),
  );
  assert.deepEqual(
    data[0].y,
    DATA.map((r) => r.depth),
  );
});

// --- timeseries layout (ROWS) -----------------------------------------------

test("a timeseries gets one shared x axis and one y axis per panel", () => {
  const { data, layout } = figure("TimeSeries", ALL_SIX);
  assert.equal(data.length, 6);
  assert.equal(Object.keys(layout).filter((k) => /^xaxis/.test(k)).length, 1);
  assert.equal(Object.keys(layout).filter((k) => /^yaxis/.test(k)).length, 6);
});

test("every timeseries trace shares x and takes its own y", () => {
  const { data } = figure("TimeSeries", ALL_SIX);
  assert.deepEqual(
    data.map((t) => t.xaxis),
    Array(6).fill("x"),
  );
  assert.deepEqual(
    data.map((t) => t.yaxis),
    ["y", "y2", "y3", "y4", "y5", "y6"],
  );
});

test("the first selected variable is drawn at the top", () => {
  // Rows read down in the order picked, and the shared axis sits under the last.
  const { layout } = figure("TimeSeries", ["TE90_01", "PSAL_01", "DOXY_01"]);
  assert.ok(layout.yaxis.domain[0] > layout.yaxis3.domain[0]);
  assert.equal(layout.xaxis.anchor, "y3");
  assert.equal(layout.yaxis.title.text, "Temperature (1990 scale) (degree_C)");
});

test("a timeseries puts time across and the variable up", () => {
  const { data } = figure("TimeSeries", ["TE90_01"]);
  assert.deepEqual(
    data[0].x,
    DATA.map((r) => r.time),
  );
  assert.deepEqual(
    data[0].y,
    DATA.map((r) => r.TE90_01),
  );
});

// --- shared behaviour -------------------------------------------------------

test("one variable is a single panel filling the area, not a special case", () => {
  const { data, layout } = figure("Profile", ["TE90_01"]);
  assert.equal(data.length, 1);
  assert.deepEqual(layout.xaxis.domain, [0, 1]);
  assert.equal(layout.yaxis.domain[0], 0);
});

test("the legend is off — each panel is already titled", () => {
  assert.equal(figure("Profile", ALL_SIX).layout.showlegend, false);
});

test("explicit width and height are passed through, replacing autosize", () => {
  const { layout } = figure("Profile", ALL_SIX, {
    size: { width: 900, height: 640 },
  });
  assert.equal(layout.width, 900);
  assert.equal(layout.height, 640);
  assert.ok(!("autosize" in layout));
});

test("uirevision is carried so a changed axis set does not restore a stale zoom", () => {
  assert.equal(
    figure("Profile", ALL_SIX, { uirevision: "rec|depth|a,b" }).layout
      .uirevision,
    "rec|depth|a,b",
  );
});

test("a custom label replaces the name but keeps the unit", () => {
  const { layout } = figure("Profile", ["TE90_01"], {
    labels: { TE90_01: "Temp" },
  });
  assert.equal(layout.xaxis.title.text, "Temp (degree_C)");
});

test("no rows yet still produces the full axis skeleton", () => {
  const dataset = { ...VIKING_DATASET, cdm_data_type: "Profile" };
  const variables = variablesFrom(VIKING, dataset);
  const plan = facetPlanFor(dataset, variables, undefined);
  const { data, layout } = buildFigure({
    plan,
    variablesByName: byColumnName(variables),
    panels: ["TE90_01", "PSAL_01"],
    sharedAxis: "depth",
    data: undefined,
    uirevision: "x",
  });
  assert.equal(data.length, 2);
  assert.deepEqual(data[0].x, []);
  assert.equal(layout.xaxis2.title.text, "Practical Salinity (PSU)");
});

// --- every label runs along its own axis -----------------------------------

test("every stacked panel is titled on its own y axis", () => {
  const { layout } = figure("TimeSeries", ALL_SIX);
  assert.equal(layout.annotations, undefined);
  for (let index = 0; index < ALL_SIX.length; index += 1) {
    const key = index === 0 ? "yaxis" : `yaxis${index + 1}`;
    assert.ok(layout[key].title.text, `${key} has a title`);
    assert.equal(layout[key].title.font.size, LABEL_FONT_PX);
    assert.equal(layout[key].automargin, true);
  }
});

test("a vertical axis title fits its own panel's height in two lines once it is known", () => {
  const size = { width: 900, height: 1300 };
  const { layout } = figure("TimeSeries", ALL_SIX, { size });
  const margin = marginFor(ROWS, 1);
  const [low, high] = layout.yaxis.domain;
  const fits = maxCharsFor((size.height - margin.t - margin.b) * (high - low));
  const titles = ALL_SIX.map(
    (_, index) =>
      layout[index === 0 ? "yaxis" : `yaxis${index + 1}`].title.text,
  );
  titles.forEach((text) => {
    const lines = text.split("<br>");
    assert.ok(lines.length <= 2, text);
    lines
      .filter((line) => !/^\(.*\)$/.test(line)) // a unit is never cut
      .forEach((line) =>
        assert.ok(line.length <= fits, `"${line}" (${line.length} > ${fits})`),
      );
  });
  assert.ok(
    titles.some((text) => text.includes("<br>")),
    titles.join(" | "),
  );
  // Unmeasured, nothing is cut.
  const unsized = figure("TimeSeries", ALL_SIX);
  assert.ok(!unsized.layout.yaxis2.title.text.includes("…"));
});

test("a stack keeps its shared axis title", () => {
  const { layout } = figure("TimeSeries", ["TE90_01"]);
  assert.equal(layout.xaxis.title.text, "Time (UTC)");
  assert.equal(layout.xaxis.title.font.size, LABEL_FONT_PX);
});

test("a profile titles its panels on top and its shared axis beside them", () => {
  const { layout } = figure("Profile", ALL_SIX);
  assert.equal(layout.xaxis.side, "top");
  assert.ok(layout.xaxis.title.text);
  assert.ok(layout.yaxis.title.text);
});

test("labels head their ticks and the title heads the labels, at the size the wrap estimate assumes", () => {
  const { layout } = figure("Profile", ALL_SIX);
  assert.equal(layout.font.size, TICK_FONT_PX);
  assert.ok(TICK_FONT_PX < LABEL_FONT_PX && LABEL_FONT_PX < TITLE_FONT_PX);
  assert.equal(layout.xaxis.title.font.size, LABEL_FONT_PX);
  assert.equal(layout.yaxis.title.font.size, LABEL_FONT_PX);
});

test("the hover box keeps a readable size rather than the ticks' size", () => {
  const { layout } = figure("TimeSeries", ["TE90_01"]);
  assert.equal(layout.hoverlabel.font.size, HOVER_FONT_PX);
  assert.ok(HOVER_FONT_PX > TICK_FONT_PX);
});

// --- wrapping ----------------------------------------------------------------

test("panel titles wrap to their own panel once the width is known", () => {
  const wide = figure("Profile", ALL_SIX, {
    size: { width: 1140, height: 620 },
  });
  const titles = ALL_SIX.map(
    (_, index) =>
      wide.layout[index === 0 ? "xaxis" : `xaxis${index + 1}`].title.text,
  );
  // Six panels in 1140px is 150px each, and no line may be wider than that.
  const columns = marginFor(COLUMNS);
  const [start, end] = wide.layout.xaxis.domain;
  const fits = maxCharsFor((1140 - columns.l - columns.r) * (end - start));
  titles.forEach((text) => {
    text
      .split("<br>")
      .filter((line) => !/^\(.*\)$/.test(line)) // a unit is never cut, so it alone may run over
      .forEach((line) => {
        assert.ok(line.length <= fits, `"${line}" (${line.length} > ${fits})`);
      });
  });
  assert.ok(
    titles.filter((text) => text.includes("<br>")).length >= 5,
    titles.join(" | "),
  );
  const unsized = figure("Profile", ALL_SIX);
  assert.ok(!unsized.layout.xaxis.title.text.includes("<br>"));
});

test("a profile's top margin holds its tallest panel title", () => {
  const { layout } = figure("Profile", ALL_SIX, {
    size: { width: 1140, height: 620 },
  });
  const tallest = Math.max(
    ...ALL_SIX.map(
      (_, index) =>
        layout[index === 0 ? "xaxis" : `xaxis${index + 1}`].title.text.split(
          "<br>",
        ).length,
    ),
  );
  assert.ok(tallest > 1);
  assert.equal(
    layout.margin.t,
    marginFor(COLUMNS, titleLinesFor(TITLE, 1140), tallest).t,
  );
});

test("one panel is wide enough not to wrap", () => {
  const { layout } = figure("Profile", ["TE90_01"], {
    size: { width: 1140, height: 620 },
  });
  assert.ok(!layout.xaxis.title.text.includes("<br>"));
});

test("the hover names the column by its capped long_name", () => {
  const { data } = figure("Profile", ALL_SIX, {
    size: { width: 1140, height: 620 },
  });
  assert.ok(data[0].layout === undefined);
  // Capped because a box is open on every panel at once. The panel's own title
  // carries it whole.
  assert.equal(
    data[0].hovertemplate,
    "Temperature (1990 sca…: %{x} degree_C<extra></extra>",
  );
  // The colour dimension adds a third line here, off customdata — not here.
  assert.ok(!data[0].hovertemplate.includes("customdata"));
  // The trace's own name is never drawn, and keeps the long label unwrapped: a
  // <br> belongs to the panel that needed it.
  assert.ok(data[0].name.includes("Temperature (1990 scale)"));
  assert.ok(!data[0].name.includes("<br>"));
});

test("a stacked panel prints the axis it shares first", () => {
  const { data } = figure("TimeSeries", ["TE90_01"]);
  assert.equal(
    data[0].hovertemplate,
    "Time: %{x} UTC<br>Temperature (1990 sca…: %{y} degree_C<extra></extra>",
  );
});

test("a column with no unit leaves no trailing space", () => {
  const noUnit = {
    ...VIKING,
    columnUnits: VIKING.columnUnits.map((unit, index) =>
      VIKING.columnNames[index] === "TE90_01" ? null : unit,
    ),
  };
  const { data } = figureFrom(noUnit, "Profile", ["TE90_01"]);
  assert.equal(
    data[0].hovertemplate,
    "Temperature (1990 sca…: %{x}<extra></extra>",
  );
});

test("a renamed variable is renamed in the hover too", () => {
  const { data } = figure("Profile", ["TE90_01"], {
    labels: { TE90_01: "  Temp  " },
  });
  assert.ok(data[0].hovertemplate.startsWith("Temp: %{x} degree_C"));
});

test("one hover answers on every panel that shares the axis", () => {
  const columns = figure("Profile", ALL_SIX);
  const rows = figure("TimeSeries", ALL_SIX);
  // The shared axis in each layout: depth down the side, time along the bottom.
  // Unified for the profile, because plain "y" is the one Plotly draws at 60°.
  assert.equal(columns.layout.hovermode, "y unified");
  assert.equal(rows.layout.hovermode, "x");
  // Plotly's own default is "overlaying", which answers for the hovered panel
  // alone — this is what widens it to every panel on that axis.
  assert.equal(columns.layout.hoversubplots, "axis");
  assert.equal(rows.layout.hoversubplots, "axis");
});

test("a unified box is titled with the axis its rows share", () => {
  const { layout } = figure("Profile", ALL_SIX);
  // Left alone, Plotly titles it with the bare number.
  assert.equal(
    layout.yaxis.unifiedhovertitle.text,
    "depth of observation: %{y} m",
  );
  // A stack's boxes have no title to carry it, which is why they still print it.
  assert.equal(
    figure("TimeSeries", ALL_SIX).layout.xaxis.unifiedhovertitle,
    undefined,
  );
});

test("the spike runs across the panels, on the shared axis alone", () => {
  const columns = figure("Profile", ALL_SIX).layout;
  assert.equal(columns.yaxis.showspikes, true);
  assert.equal(columns.yaxis.spikemode, "across");
  // Still reversed: the spike is spread in beside the depth direction, not over
  // it.
  assert.equal(columns.yaxis.autorange, "reversed");

  const rows = figure("TimeSeries", ALL_SIX).layout;
  assert.equal(rows.xaxis.showspikes, true);
  assert.equal(rows.xaxis.spikemode, "across");

  // One line, not one per panel.
  ALL_SIX.forEach((_, index) => {
    const suffix = index === 0 ? "" : index + 1;
    assert.equal(columns[`xaxis${suffix}`].showspikes, undefined, `x${suffix}`);
    assert.equal(rows[`yaxis${suffix}`].showspikes, undefined, `y${suffix}`);
  });
});

// --- margins -----------------------------------------------------------------

// --- one colour per variable -------------------------------------------------

test("a variable with no declared palette takes the next colour along", () => {
  const { data } = figure("Profile", ALL_SIX);
  const colors = data.map((t) => t.marker.color);
  assert.equal(new Set(colors).size, 6);
  colors.forEach((color, index) => {
    assert.equal(color, defaultColorFor(undefined, index));
    // Markers and line agree: a mode of markers+lines must not draw two colours.
    assert.equal(data[index].line.color, color);
  });
});

test("a declared colorBarPalette decides the variable's colour", () => {
  const { data } = figureFrom(VIKING_PALETTES, "Profile", [
    "TE90_01",
    "PSAL_01",
    "DOXY_01",
  ]);
  assert.equal(data[0].marker.color, paletteColorFor("KT_thermal"));
  assert.equal(data[1].marker.color, paletteColorFor("KT_haline"));
  // DOXY_01 declares nothing, so it keeps its place in the fallback list.
  assert.equal(data[2].marker.color, defaultColorFor(undefined, 2));
});

test("the user's colour beats both, on the line as well as the markers", () => {
  const { data } = figure("Profile", ["TE90_01", "PSAL_01"], {
    colors: { PSAL_01: "#123456" },
  });
  assert.equal(data[1].marker.color, "#123456");
  assert.equal(data[1].line.color, "#123456");
  assert.equal(data[0].marker.color, defaultColorFor(undefined, 0));
});

test("no colour column means no colourbar, and no width kept for one", () => {
  const { data, layout } = figure("Profile", ALL_SIX);
  data.forEach((trace) => {
    assert.ok(!trace.marker.colorbar);
    assert.ok(!("showscale" in trace.marker));
    assert.ok(!("coloraxis" in trace.marker));
    assert.ok(!trace.customdata);
  });
  assert.ok(!layout.coloraxis);
  assert.equal(plotWidthFor(COLUMNS, 8, 2000), 2000);
});

test("lines-only stays lines while no colour column is set", () => {
  // Markers are forced only when colouring is on, because a per-point colour
  // has nothing to render on without one. See the colour dimension below.
  const { data } = figure("Profile", ["TE90_01"], { mode: "lines" });
  assert.equal(data[0].mode, "lines");
});

// --- the title names the record ----------------------------------------------

test("the title names every cf_role column, in ERDDAP order", () => {
  const variables = variablesFrom(VIKING, VIKING_DATASET);
  const plan = facetPlanFor(VIKING_DATASET, variables, DATA);
  assert.deepEqual(plan.titleColumns, ["station_id", "profile"]);
  assert.equal(
    recordTitleFor({
      plan,
      variablesByName: byColumnName(variables),
      data: DATA,
    }),
    TITLE,
  );
});

test("a catalogue with no columnMeta still names the record", () => {
  // cf_role is only in columnMeta, which is absent entirely before a reharvest —
  // so the roles fall back to the dataset's own three *_id_variable fields, and
  // the labels fall back to the column names.
  const variables = variablesFrom(VIKING_NO_META, VIKING_DATASET);
  const plan = facetPlanFor(VIKING_DATASET, variables, DATA);
  assert.deepEqual(plan.titleColumns, ["station_id", "profile"]);
  assert.equal(
    recordTitleFor({
      plan,
      variablesByName: byColumnName(variables),
      data: DATA,
    }),
    "station_id (timeseries_id): PMZA-RIKI — profile (profile_id): PMZA-RIKI-25/09/16-17:35:26",
  );
});

test("a cf_role column with nothing in it is skipped, not printed empty", () => {
  const plan = { titleColumns: ["station_id", "profile"] };
  const data = [{ station_id: "PMZA-RIKI", profile: "   " }];
  assert.equal(
    recordTitleFor({ plan, variablesByName: new Map(), data }),
    "station_id: PMZA-RIKI",
  );
  assert.equal(
    recordTitleFor({ plan, variablesByName: new Map(), data: [] }),
    "",
  );
  assert.equal(
    recordTitleFor({ plan: null, variablesByName: new Map(), data }),
    "",
  );
});

test("a box without the title gives its lines back to the panels", () => {
  const dataset = { ...VIKING_DATASET, cdm_data_type: "Profile" };
  const variables = variablesFrom(VIKING, dataset);
  const box = (withTitle) =>
    plotBoxFor({
      plan: facetPlanFor(dataset, variables, DATA),
      variablesByName: byColumnName(variables),
      data: DATA,
      panelCount: 6,
      availableHeight: 620,
      measured: { width: 1140, height: 620 },
      withTitle,
    });
  assert.equal(box(true).title, TITLE);
  assert.equal(box(false).title, "");
  assert.equal(box(false).titleLines, 0);
  assert.ok(box(false).height >= box(true).height);
});

test("a window spanning several profiles names three and counts the rest", () => {
  const data = ["a", "b", "c", "d", "e"].map((profile) => ({ profile }));
  assert.equal(
    recordTitleFor({
      plan: { titleColumns: ["profile"] },
      variablesByName: new Map(),
      data,
    }),
    "profile: a, b, c +2",
  );
});

const panelTitleLines = (layout) =>
  layout.xaxis.title.text.split("<br>").length;

test("the title is drawn where Plotly draws a title, and not by automargin", () => {
  const { layout } = figure("Profile", ALL_SIX, {
    size: { width: 1140, height: 620 },
  });
  assert.equal(layout.title.text, TITLE);
  assert.equal(layout.title.font.size, TITLE_FONT_PX);
  assert.equal(layout.title.yref, "container");
  assert.equal(layout.title.y, 1);
  assert.equal(layout.title.yanchor, "top");
  assert.equal(layout.title.xanchor, "center");
  // automargin would grow the top margin inside a height that is fixed here,
  // shrinking every panel below the minimum the floor promised.
  assert.ok(!("automargin" in layout.title));
});

test("the title costs the top margin only the lines it actually used", () => {
  assert.equal(titleLinesFor(TITLE, 1140), 1);
  assert.equal(titleLinesFor(TITLE, 340), 2);
  const wide = figure("Profile", ["TE90_01"], {
    size: { width: 1140, height: 620 },
  });
  const narrow = figure("Profile", ["TE90_01"], {
    size: { width: 340, height: 620 },
  });
  assert.equal(
    wide.layout.margin.t,
    marginFor(COLUMNS, 1, panelTitleLines(wide.layout)).t,
  );
  assert.equal(
    narrow.layout.margin.t,
    marginFor(COLUMNS, 2, panelTitleLines(narrow.layout)).t,
  );
  assert.ok(narrow.layout.margin.t > wide.layout.margin.t);
  assert.ok(plotHeightFor(ROWS, 6, 100, 1) < plotHeightFor(ROWS, 6, 100, 2));
});

test("no title means no title and no room reserved for one", () => {
  const { layout } = figure("Profile", ["TE90_01"], { title: "" });
  assert.ok(!layout.title);
  assert.equal(
    layout.margin.t,
    marginFor(COLUMNS, 0, panelTitleLines(layout)).t,
  );
  assert.equal(titleRoomFor(0), 0);
  assert.equal(titleLinesFor("", 1140), 0);
});

test("a profile spends the whole budget it is given", () => {
  const budget = heightBudgetFor(700, 685);
  assert.equal(plotHeightFor(COLUMNS, 3, budget), budget);
});

// --- the colour dimension ----------------------------------------------------

const colored = (panels, extra = {}) =>
  figureFrom(VIKING_PALETTES, "Profile", panels, {
    colorAxis: "depth",
    ...extra,
  });

test("a colour column shades every panel, off one shared colour axis", () => {
  const { data, layout } = colored(["TE90_01", "PSAL_01", "FLOR_01"]);
  data.forEach((trace, index) => {
    assert.equal(trace.marker.coloraxis, "coloraxis", `panel ${index}`);
    assert.deepEqual(
      trace.marker.color,
      DATA.map((row) => row.depth),
      `panel ${index}`,
    );
  });
  assert.ok(layout.coloraxis);
});

test("shaded by itself, each panel gets its own colour axis and legend", () => {
  const panels = ["TE90_01", "PSAL_01", "FLOR_01"];
  const { data, layout, colorLegends } = figureFrom(
    VIKING_PALETTES,
    "Profile",
    panels,
    { colorBySelf: true, scales: { PSAL_01: "KT_algae" } },
  );
  const axes = ["coloraxis", "coloraxis2", "coloraxis3"];
  data.forEach((trace, index) => {
    assert.equal(trace.marker.coloraxis, axes[index], `panel ${index}`);
    assert.deepEqual(
      trace.marker.color,
      DATA.map((row) => row[panels[index]]),
      `panel ${index}`,
    );
    // The colour IS the panel's value: no second hover line for it.
    assert.ok(!trace.hovertemplate.includes("%{customdata}"));
  });
  axes.forEach((axis) => assert.equal(layout[axis].showscale, false));
  assert.deepEqual(layout.coloraxis2.colorscale, paletteFor("KT_algae"));
  assert.deepEqual(
    colorLegends.map((legend) => legend.axis),
    axes,
  );
});

test("the scale is the layout's, so no trace carries one of its own", () => {
  const { data, layout } = colored(ALL_SIX);
  data.forEach((trace) => {
    assert.ok(!("cmin" in trace.marker));
    assert.ok(!("cmax" in trace.marker));
    assert.ok(!("colorscale" in trace.marker));
    assert.ok(!("showscale" in trace.marker));
  });
  // One mapping, however many panels — which is what makes the panels
  // comparable at all. Plotly draws no bar for it: the legend beside the plot
  // does, from the same stops and the same range.
  assert.equal(layout.coloraxis.showscale, false);
  assert.ok(!layout.coloraxis.colorbar);
});

test("the range is the record's own, not the catalogue's", () => {
  // ERDDAP's colorBarMinimum/Maximum are per standard_name across the whole
  // catalogue (0-8000 for depth); a record spans metres of that. Honouring it
  // would flatten every profile to two adjacent shades. Stated all the same, so
  // the legend paints the range the markers were mapped over.
  const { layout } = colored(["TE90_01"]);
  assert.equal(layout.coloraxis.cmin, 1);
  assert.equal(layout.coloraxis.cmax, DATA.length);
});

test("the colour column's own palette is what the bar opens in", () => {
  const { layout } = figureFrom(VIKING_PALETTES, "Profile", ["FLOR_01"], {
    colorAxis: "PSAL_01",
  });
  assert.deepEqual(layout.coloraxis.colorscale, paletteFor("KT_haline"));
});

test("a rainbow colour column is drawn in viridis, and a pick beats both", () => {
  const rainbow = {
    ...VIKING,
    columnMeta: VIKING.columnMeta.map((meta) =>
      meta.name === "PSAL_01" ? { ...meta, colorBarPalette: "Rainbow" } : meta,
    ),
  };
  const auto = figureFrom(rainbow, "Profile", ["FLOR_01"], {
    colorAxis: "PSAL_01",
  });
  assert.deepEqual(auto.layout.coloraxis.colorscale, colorScaleFor("Viridis"));

  const picked = figureFrom(rainbow, "Profile", ["FLOR_01"], {
    colorAxis: "PSAL_01",
    colorScale: "KT_algae",
  });
  assert.deepEqual(picked.layout.coloraxis.colorscale, paletteFor("KT_algae"));
});

test("the line keeps the variable's own colour while the markers carry the ramp", () => {
  const { data } = colored(["TE90_01", "PSAL_01"]);
  assert.equal(data[0].line.color, paletteColorFor("KT_thermal"));
  assert.equal(data[1].line.color, paletteColorFor("KT_haline"));
});

test("a colour column draws the line in the ramp, in traces of its own", () => {
  const { data } = colored(["TE90_01"], { mode: "markers+lines" });
  const panel = data.at(-1);
  const lines = data.slice(0, -1);
  assert.ok(lines.length > 1, `${lines.length} line traces`);
  lines.forEach((trace) => {
    assert.equal(trace.mode, "lines");
    assert.equal(trace.hoverinfo, "skip");
    assert.equal(trace.xaxis, panel.xaxis);
    assert.equal(trace.yaxis, panel.yaxis);
    assert.match(trace.line.color, /^rgb\(/);
  });
  // The panel's own trace keeps the markers and the hover.
  assert.equal(panel.mode, "markers");
  assert.equal(panel.marker.coloraxis, "coloraxis");
  assert.ok(panel.hovertemplate);
});

test("every panel's line is drawn under its markers, on its own axes", () => {
  const { data } = colored(["TE90_01", "PSAL_01"], { mode: "markers+lines" });
  const panels = data.slice(-2);
  const lines = data.slice(0, -2);
  assert.deepEqual(
    panels.map((trace) => trace.mode),
    ["markers", "markers"],
  );
  assert.deepEqual(
    new Set(lines.map((trace) => trace.xaxis)),
    new Set(["x", "x2"]),
  );
});

test("Line with a colour column stays a line, its hover kept by hidden markers", () => {
  const { data } = colored(["TE90_01"], { mode: "lines" });
  const panel = data.at(-1);
  assert.ok(data.length > 1);
  assert.equal(panel.mode, "markers");
  assert.equal(panel.marker.opacity, 0);
  assert.ok(panel.hovertemplate);
  assert.ok(!("opacity" in colored(["TE90_01"]).data[0].marker));
});

test("markers alone, or no colour column, add no line traces", () => {
  assert.equal(
    colored(["TE90_01", "PSAL_01"], { mode: "markers" }).data.length,
    2,
  );
  const plain = figure("Profile", ["TE90_01", "PSAL_01"], {
    mode: "markers+lines",
  });
  assert.equal(plain.data.length, 2);
  assert.equal(plain.data[0].mode, "markers+lines");
});

test("a colour column costs the panels no width at all", () => {
  // The bar used to be drawn at the figure's right edge and reserved 86px of
  // margin for itself. It is DOM now, outside the scroller, so the figure is
  // the same width whether or not a colour column is set.
  const margin = marginFor(COLUMNS, MAX_TITLE_LINES);
  const width = plotWidthFor(COLUMNS, 6, 800);
  const panels = (width - margin.l - margin.r) / panelPitch(6, COLUMN_GAP);
  assert.ok(panels >= MIN_PANEL_PX, `${panels}px panels`);
  assert.deepEqual(colored(ALL_SIX).layout.margin, {
    ...figure("Profile", ALL_SIX).layout.margin,
  });
});

test("the legend carries the label, the stops and the ticks", () => {
  const { colorLegend, layout } = colored(["TE90_01"]);
  const depth = byColumnName(variablesFrom(VIKING, VIKING_DATASET)).get(
    "depth",
  );
  assert.equal(colorLegend.label, labelFor(depth));
  // The same stops the markers were given, not a second likeness of them.
  assert.deepEqual(colorLegend.stops, layout.coloraxis.colorscale);
  // The ends are the record's extent; the ticks between them are round.
  const last = colorLegend.ticks.at(-1);
  assert.equal(colorLegend.ticks[0].position, 0);
  assert.equal(last.position, 1);
  assert.equal(colorLegend.ticks[0].text, "1");
  assert.equal(last.text, String(DATA.length));
  colorLegend.ticks
    .slice(1, -1)
    .forEach(({ text }) => assert.match(text, /^-?\d+(\.\d)?$/));
});

test("no colour column, no legend", () => {
  assert.equal(figure("Profile", ALL_SIX).colorLegend, null);
});

test("hover gains the colour value, off customdata", () => {
  // A stacked layout, because that is the one with a box per panel: a profile's
  // rows are gathered into one box and the next test covers what that means.
  // Coloured by a column this panel does not otherwise print.
  const { data } = figureFrom(VIKING, "TimeSeries", ["TE90_01"], {
    colorAxis: "PSAL_01",
  });
  assert.deepEqual(
    data[0].customdata,
    DATA.map((row) => row.PSAL_01),
  );
  // With its own unit, like every other line in the box.
  assert.ok(
    data[0].hovertemplate.endsWith(
      "<br>Practical Salinity: %{customdata} PSU<extra></extra>",
    ),
  );
});

test("a unified box prints the colour value once, on the first panel", () => {
  // Every row of it comes from the same data row, so one line per panel would
  // be the same number N times.
  const { data } = figureFrom(VIKING, "Profile", ["TE90_01", "DOXY_01"], {
    colorAxis: "PSAL_01",
  });
  assert.ok(
    data[0].hovertemplate.endsWith(
      "<br>Practical Salinity: %{customdata} PSU<extra></extra>",
    ),
  );
  assert.ok(!data[1].hovertemplate.includes("%{customdata}"));
});

test("a unified box adds no colour line when a panel or the shared axis prints it", () => {
  const byPanel = figureFrom(VIKING, "Profile", ["TE90_01", "PSAL_01"], {
    colorAxis: "PSAL_01",
  });
  byPanel.data.forEach((trace) =>
    assert.ok(!trace.hovertemplate.includes("%{customdata}")),
  );

  const bySharedAxis = figureFrom(VIKING, "Profile", ["TE90_01"], {
    colorAxis: "depth",
  });
  assert.ok(!bySharedAxis.data[0].hovertemplate.includes("%{customdata}"));
});

test("colouring by a column the panel already prints adds no second copy", () => {
  // The shared axis is on both of this panel's axes already...
  const bySharedAxis = figureFrom(VIKING, "TimeSeries", ["TE90_01"], {
    colorAxis: "time",
  });
  assert.ok(!bySharedAxis.data[0].hovertemplate.includes("%{customdata}"));

  // ...and so is the variable this panel draws.
  const byPanel = figureFrom(VIKING, "TimeSeries", ["TE90_01", "PSAL_01"], {
    colorAxis: "PSAL_01",
  });
  assert.ok(!byPanel.data[1].hovertemplate.includes("%{customdata}"));
  assert.ok(byPanel.data[0].hovertemplate.includes("%{customdata}"));
});

test("a time colour column is ramped over epoch ms and ticked in timestamps", () => {
  const { data, colorLegend } = figureFrom(VIKING, "Profile", ["TE90_01"], {
    colorAxis: "time",
  });
  assert.equal(data[0].marker.color[0], Date.parse(DATA[0].time));
  // The hover still reads the timestamp the record published.
  assert.equal(data[0].customdata[0], DATA[0].time);
  // And the legend labels the ramp in timestamps rather than epoch ms.
  assert.equal(colorLegend.ticks.length, 4);
  colorLegend.ticks.forEach((tick) => {
    assert.match(tick.text, /^\d{2}:\d{2}$/, tick.text);
    assert.ok(tick.position >= 0 && tick.position <= 1, String(tick.position));
  });
});

test("a colour column this record cannot order leaves the figure as it was", () => {
  const plain = figure("Profile", ["TE90_01"]);
  const unorderable = figureFrom(VIKING, "Profile", ["TE90_01"], {
    colorAxis: "station_id",
  });
  assert.ok(!unorderable.layout.coloraxis);
  assert.deepEqual(unorderable.data, plain.data);
  assert.deepEqual(unorderable.layout, plain.layout);
});

// --- a trajectory's position axis --------------------------------------------

const TRACK_DATASET = { ...VIKING_DATASET, cdm_data_type: "Trajectory" };

// Out of time order on purpose, so a test that passed on input order would fail.
const TRACK_ROWS = [
  {
    time: "2021-05-24T20:38:00Z",
    latitude: 47.57189,
    longitude: -69.85413,
    TE90_01: 15.84,
  },
  {
    time: "2021-05-24T18:54:00Z",
    latitude: 47.590416,
    longitude: -69.8673,
    TE90_01: 15.06,
  },
  {
    time: "2021-05-24T17:06:00Z",
    latitude: 47.615696,
    longitude: -69.9255,
    TE90_01: 9.81,
  },
];

function trackFigure(panels = ["TE90_01"], extra = {}) {
  const columns = variablesFrom(VIKING, TRACK_DATASET);
  const trackIndex = trackIndexFor(
    TRACK_DATASET,
    columns,
    TRACK_ROWS,
    "Position along track",
  );
  const variables = [...columns, trackIndex.variable];
  const variablesByName = byColumnName(variables);
  const rows = positionRowsFor(TRACK_ROWS, trackIndex);
  const plan = facetPlanFor(TRACK_DATASET, variables, rows);
  // The whole point of the chain above: without this the figure below would be
  // drawn against longitude and the ticks would label the wrong numbers.
  assert.equal(plan.sharedAxis, POSITION_INDEX_COLUMN);
  return buildFigure({
    plan,
    variablesByName,
    panels,
    sharedAxis: plan.sharedAxis,
    data: rows,
    title: "",
    mode: "markers",
    sharedTicks: trackIndex.ticks,
    sharedText: trackIndex.labels,
    uirevision: "test",
    ...extra,
  });
}

test("a track is drawn against its rank, in time order", () => {
  const { data, layout } = trackFigure();
  assert.equal(layout.xaxis.domain[1], 1);
  assert.deepEqual(data[0].x, [1, 2, 3]);
  // The earliest sample is position 1, not the first row of the payload.
  assert.deepEqual(data[0].y, [9.81, 15.06, 15.84]);
});

test("the shared axis ticks at the positions, never at round numbers", () => {
  const { layout } = trackFigure();
  assert.equal(layout.xaxis.tickmode, "array");
  assert.deepEqual(layout.xaxis.tickvals, [1, 2, 3]);
  assert.deepEqual(layout.xaxis.ticktext, [
    "47.6157<br>-69.9255",
    "47.5904<br>-69.8673",
    "47.5719<br>-69.8541",
  ]);
});

test("the hover names the position between the rank and the value", () => {
  const { data } = trackFigure();
  assert.equal(
    data[0].hovertemplate,
    "Position along track: %{x:d}<br>%{text}<br>Temperature (1990 sca…: %{y} degree_C<extra></extra>",
  );
  assert.deepEqual(data[0].text, [
    "47.6157, -69.9255",
    "47.5904, -69.8673",
    "47.5719, -69.8541",
  ]);
});

test("the axis is labelled with the name the caller translated", () => {
  const { layout } = trackFigure();
  assert.equal(layout.xaxis.title.text, "Position along track");
});

test("picking a real column back as the shared axis drops both", () => {
  // What DatasetPreviewPlot does when ?paxis=longitude: the ticks belong to the
  // index and would label the wrong numbers on anything else.
  const { data, layout } = trackFigure(["TE90_01"], {
    sharedAxis: "longitude",
    sharedTicks: null,
    sharedText: null,
  });
  assert.equal(layout.xaxis.tickmode, undefined);
  assert.equal(data[0].text, undefined);
  assert.ok(!data[0].hovertemplate.includes("%{text}"));
});

test("without a position axis every figure is exactly what it was", () => {
  const { data, layout } = figure("TimeSeries", ALL_SIX);
  assert.equal(layout.xaxis.tickmode, undefined);
  assert.equal(layout.xaxis.tickvals, undefined);
  data.forEach((trace) => {
    assert.equal(trace.text, undefined);
    assert.ok(!trace.hovertemplate.includes("%{text}"));
  });
});

test("a profile never takes position text — its box is unified", () => {
  // Every row of a unified box is the same data row, so one %{text} per panel
  // would be one copy of the same position per panel.
  const { data } = figure("Profile", ALL_SIX, {
    sharedText: ["a", "b", "c"],
  });
  data.forEach((trace) => {
    assert.equal(trace.text, undefined);
    assert.ok(!trace.hovertemplate.includes("%{text}"));
  });
});

// --- the pinned shared axis --------------------------------------------------

const LONG_NAME =
  "a renamed axis whose label keeps going well past any line it could fit on";
const lineCount = (text) => text.split("<br>").length;

test("a profile's shared title fits its pinned strip: two lines, unit kept", () => {
  const { layout } = figure("Profile", ["TE90_01"], {
    labels: { depth: LONG_NAME },
    size: { width: 600, height: 400 },
  });
  assert.equal(lineCount(layout.yaxis.title.text), 2);
  assert.ok(layout.yaxis.title.text.endsWith("<br>(m)"));
});

// --- grids -------------------------------------------------------------------

function gridFigure(extra = {}) {
  const variables = variablesFrom(VIKING_PALETTES, VIKING_DATASET);
  return buildGridFigure({
    variablesByName: byColumnName(variables),
    xAxes: ["TE90_01", "PSAL_01"],
    yAxes: ["depth", "PRES_01"],
    panelAxis: "x",
    data: DATA,
    mode: "markers",
    uirevision: "test",
    ...extra,
  });
}

test("a grid draws one panel per X and Y pair, X across and Y down", () => {
  const { data, layout, pinnable } = gridFigure();
  assert.equal(pinnable, false);
  assert.equal(data.length, 4);
  assert.deepEqual(
    data.map((trace) => [trace.xaxis, trace.yaxis]),
    [
      ["x", "y"],
      ["x2", "y"],
      ["x", "y2"],
      ["x2", "y2"],
    ],
  );
  // A column shares its X axis, a row its Y axis, so only the edges tick.
  // The X axes run under the bottom row, the last Y picked.
  assert.equal(layout.xaxis2.anchor, "y2");
  assert.equal(layout.yaxis2.anchor, "x");
  assert.equal(layout.hovermode, "closest");
  assert.ok(layout.xaxis.domain[1] < layout.xaxis2.domain[0]);
  assert.ok(layout.yaxis.domain[0] > layout.yaxis2.domain[1]);
});

test("a grid frames every panel in a box of its own", () => {
  const { layout } = gridFigure();
  assert.deepEqual(
    layout.shapes.map((shape) => [shape.type, shape.xref, shape.yref]),
    [
      ["rect", "x domain", "y domain"],
      ["rect", "x2 domain", "y domain"],
      ["rect", "x domain", "y2 domain"],
      ["rect", "x2 domain", "y2 domain"],
    ],
  );
});

test("a grid keeps each panel variable's own colour", () => {
  const { data } = gridFigure({ colors: { PSAL_01: "#123456" } });
  assert.deepEqual(
    data.map((trace) => trace.marker.color),
    [data[0].marker.color, "#123456", data[0].marker.color, "#123456"],
  );
});

test("a grid repeats every X column once per colour column, side by side", () => {
  const { data, layout, colorLegends } = gridFigure({
    xAxes: ["TE90_01"],
    yAxes: ["depth", "PRES_01"],
    colorAxes: ["PSAL_01", "DOXY_01"],
  });
  assert.equal(data.length, 4);
  assert.deepEqual(
    data.map((trace) => trace.marker.coloraxis),
    ["coloraxis", "coloraxis2", "coloraxis", "coloraxis2"],
  );
  // The repeat zooms with the first, and each column says what it is shaded by.
  assert.equal(layout.xaxis2.matches, "x");
  const byName = byColumnName(variablesFrom(VIKING_PALETTES, VIKING_DATASET));
  assert.deepEqual(
    layout.annotations.map((annotation) => annotation.text),
    [labelFor(byName.get("PSAL_01")), labelFor(byName.get("DOXY_01"))],
  );
  assert.deepEqual(
    colorLegends.map((legend) => legend.axis),
    ["coloraxis", "coloraxis2"],
  );
  assert.equal(layout.coloraxis.showscale, false);
});

test("with colorRows, a grid repeats every Y row once per colour column, stacked", () => {
  const { data, layout, colorLegends } = gridFigure({
    xAxes: ["TE90_01", "PSAL_01"],
    yAxes: ["depth"],
    colorAxes: ["PSAL_01", "DOXY_01"],
    colorRows: true,
  });
  assert.deepEqual(
    data.map((trace) => [trace.xaxis, trace.yaxis, trace.marker.coloraxis]),
    [
      ["x", "y", "coloraxis"],
      ["x2", "y", "coloraxis"],
      ["x", "y2", "coloraxis2"],
      ["x2", "y2", "coloraxis2"],
    ],
  );
  // The repeat zooms with the first row, and the X axes run under the last.
  assert.equal(layout.yaxis2.matches, "y");
  assert.equal(layout.xaxis.anchor, "y2");
  assert.ok(layout.yaxis.domain[0] > layout.yaxis2.domain[1]);
  // Each colour is named by its own bar beside its row, not a header.
  assert.equal(layout.annotations, undefined);
  assert.deepEqual(colorLegends, []);
  assert.deepEqual(
    layout.coloraxis.colorbar.len,
    layout.yaxis.domain[1] - layout.yaxis.domain[0],
  );
  assert.ok(layout.coloraxis.colorbar.y > layout.coloraxis2.colorbar.y);
});

test("a grid's colour headers wrap within their own column", () => {
  const { layout } = gridFigure({
    xAxes: ["TE90_01"],
    yAxes: ["depth"],
    colorAxes: ["PSAL_01", "DOXY_01"],
    size: { width: 400, height: 400 },
  });
  const plottingWidth = 400 - layout.margin.l - layout.margin.r;
  layout.annotations.forEach(({ text }, column) => {
    const [start, end] = layout[column === 0 ? "xaxis" : "xaxis2"].domain;
    const fits = maxCharsFor(plottingWidth * (end - start));
    const lines = text.split("<br>");
    assert.ok(lines.length > 1);
    lines
      .filter((line) => !/^\(.*\)$/.test(line)) // a unit is never cut
      .forEach((line) => assert.ok(line.length <= fits, `"${line}"`));
  });
});

test("a grid shades each colour column in its own scale", () => {
  const { layout } = gridFigure({
    xAxes: ["TE90_01"],
    yAxes: ["depth"],
    colorAxes: ["PSAL_01", "DOXY_01"],
    scales: { PSAL_01: "Cividis", DOXY_01: "Viridis" },
  });
  assert.deepEqual(layout.coloraxis.colorscale, colorScaleFor("Cividis"));
  assert.deepEqual(layout.coloraxis2.colorscale, colorScaleFor("Viridis"));
});

test("a grid reverses each row whose Y is drawn downwards", () => {
  const { layout } = gridFigure({ reversedYAxes: new Set(["PRES_01"]) });
  assert.equal(layout.yaxis.autorange, undefined);
  assert.equal(layout.yaxis2.autorange, "reversed");
});

test("a grid gives every panel at least its minimum size, and scrolls the rest", () => {
  const box = gridBoxFor({
    plan: null,
    variablesByName: new Map(),
    data: [],
    columns: 6,
    rows: 4,
    availableHeight: 400,
    measured: { width: 500, height: 400 },
    withTitle: false,
  });
  assert.ok(box.width >= MIN_PANEL_PX * 6);
  assert.ok(box.height >= MIN_PANEL_PX * 4);
});

// --- one plot, an axis per variable (pstack) -------------------------------

function overlayFrom(type, panels, extra = {}) {
  const dataset = { ...VIKING_DATASET, cdm_data_type: type };
  const variables = variablesFrom(VIKING_PALETTES, dataset);
  const variablesByName = byColumnName(variables);
  const plan = facetPlanFor(dataset, variables, DATA);
  return buildOverlayFigure({
    plan,
    variablesByName,
    panels,
    sharedAxis: plan.sharedAxis,
    data: DATA,
    mode: "lines",
    size: { width: 900, height: 600 },
    uirevision: "test",
    ...extra,
  });
}

test("a stacked timeseries overlays every y axis on the left, shifting the extras out", () => {
  const panels = ["TE90_01", "PSAL_01", "CNDC_01", "DOXY_01"];
  const { data, layout, pinnable } = overlayFrom("TimeSeries", panels);
  assert.equal(pinnable, false);
  assert.deepEqual(
    data.map((trace) => [trace.xaxis, trace.yaxis]),
    [
      ["x", "y"],
      ["x", "y2"],
      ["x", "y3"],
      ["x", "y4"],
    ],
  );
  const extras = [layout.yaxis2, layout.yaxis3, layout.yaxis4];
  assert.equal(layout.yaxis.anchor, "x");
  assert.equal(layout.yaxis.overlaying, undefined);
  assert.deepEqual(
    [layout.yaxis, ...extras].map((axis) => axis.side),
    ["left", "left", "left", "left"],
  );
  extras.forEach((axis) => {
    assert.equal(axis.anchor, "free");
    assert.equal(axis.autoshift, true);
    assert.equal(axis.overlaying, "y");
  });
  assert.equal(layout.margin.r, TOOLBAR_ROOM_PX);
  assert.equal(layout.hovermode, "x unified");
});

test("each stacked axis takes its curve's colour, and only the first draws a grid", () => {
  const { data, layout } = overlayFrom("TimeSeries", ["TE90_01", "PSAL_01"], {
    colors: { PSAL_01: "#123456" },
  });
  assert.equal(layout.yaxis2.color, "#123456");
  assert.equal(layout.yaxis2.linecolor, "#123456");
  assert.equal(data[1].line.color, "#123456");
  assert.equal(data[1].marker.color, "#123456");
  assert.equal(layout.yaxis.color, data[0].line.color);
  assert.equal(layout.yaxis.linecolor, data[0].line.color);
  assert.equal(layout.yaxis2.showgrid, false);
  assert.equal(layout.yaxis.showgrid, undefined);
});

test("a stacked profile runs every x axis across the top, stacking the extras upward", () => {
  const panels = ["TE90_01", "PSAL_01", "CNDC_01", "DOXY_01"];
  const { data, layout } = overlayFrom("Profile", panels);
  assert.deepEqual(
    data.map((trace) => [trace.xaxis, trace.yaxis]),
    [
      ["x", "y"],
      ["x2", "y"],
      ["x3", "y"],
      ["x4", "y"],
    ],
  );
  const axes = [layout.xaxis, layout.xaxis2, layout.xaxis3, layout.xaxis4];
  assert.deepEqual(
    axes.map((axis) => axis.side),
    ["top", "top", "top", "top"],
  );
  const [bottom, top] = layout.yaxis.domain;
  assert.equal(bottom, 0);
  assert.ok(top < 1, "the plot shrinks to make room above it");
  assert.equal(layout.xaxis.anchor, "y");
  const positions = axes.slice(1).map((axis) => axis.position);
  axes.slice(1).forEach((axis) => assert.equal(axis.anchor, "free"));
  assert.ok(positions[0] > top && positions[1] > positions[0]);
  assert.equal(positions[2], 1);
  assert.equal(layout.yaxis.autorange, "reversed");
  assert.equal(layout.hovermode, "y unified");
});

test("a stacked profile leaves each axis only the room its own title wraps to", () => {
  const { layout } = overlayFrom("Profile", ["TE90_01", "PSAL_01", "DOXY_01"], {
    size: { width: 400, height: 600 },
    labels: {
      TE90_01: "A much longer temperature label that has to wrap",
      PSAL_01: "Salinity",
    },
  });
  const top = layout.yaxis.domain[1];
  const [above, aboveThat] = [layout.xaxis2, layout.xaxis3].map(
    (axis) => axis.position,
  );
  assert.ok(above - top > aboveThat - above);
});

test("stacked axes past the first pick their own round ticks", () => {
  const { layout } = overlayFrom("TimeSeries", ["TE90_01", "PSAL_01"]);
  assert.equal(layout.yaxis2.tickmode, "auto");
  assert.equal(layout.yaxis.tickmode, undefined);
});

test("a single stacked variable keeps the full plot height", () => {
  const { layout } = overlayFrom("Profile", ["TE90_01"]);
  assert.deepEqual(layout.yaxis.domain, [0, 1]);
});

test("x tick labels stay level, thinned to the panel's width", () => {
  const size = { width: 390, height: 600 };
  const { layout } = figure("Profile", ["TE90_01", "PSAL_01"], {
    size,
  });
  const xAxes = Object.keys(layout).filter((key) => /^xaxis\d*$/.test(key));
  assert.ok(xAxes.length > 0);
  xAxes.forEach((key) => {
    const axis = layout[key];
    assert.equal(axis.tickangle, 0, key);
    const [start, end] = axis.domain ?? [0, 1];
    assert.ok(
      axis.nticks <=
        Math.max(2, (size.width * (end - start)) / TICK_SPACING_PX),
      `${key}: ${axis.nticks}`,
    );
  });
});

test("an unpinned figure keeps its shared axis, starting from a small margin", () => {
  const size = { width: 390, height: 600 };
  const pinned = figure("Profile", ["TE90_01"], { size });
  const kept = figure("Profile", ["TE90_01"], {
    size,
    pinned: false,
  });
  assert.notEqual(pinned.pinnable, false);
  assert.equal(kept.pinnable, false);
  // Room for short ticks and the title; automargin grows it from there, the
  // same floor every vertical axis the figure keeps starts from.
  assert.ok(kept.layout.margin.l > pinned.layout.margin.l);
  assert.equal(kept.layout.margin.l, marginFor(ROWS, 0).l);
  assert.equal(kept.layout.yaxis.automargin, true);
});

// --- rank ticks --------------------------------------------------------------

test("rank ticks thin to what lies flat across an X axis, keeping both ends", () => {
  const ticks = {
    tickvals: [0, 1, 2, 3, 4, 5, 6, 7],
    ticktext: ["a", "b", "c", "d", "e", "f", "g", ""],
  };
  // The unlabelled last tick is dropped, so "g" is the end kept.
  assert.deepEqual(rankTicksFor(ticks, "x", 240), {
    tickmode: "array",
    tickvals: [0, 3, 6],
    ticktext: ["a", "d", "g"],
  });
  assert.equal(rankTicksFor(ticks, "x", 2000).tickvals.length, 7);
  // Unmeasured, or along Y where labels stack, nothing is thinned.
  assert.equal(rankTicksFor(ticks, "x", 0).tickvals.length, 7);
  assert.equal(rankTicksFor(ticks, "y", 240).tickvals.length, 7);
  assert.deepEqual(rankTicksFor(null, "x", 240), {});
});

// Two casts down the same depths: a section a contour can fill.
const SECTION_TABLE = {
  columnNames: ["time", "depth", "temperature", "salinity"],
  columnTypes: ["String", "float", "float", "float"],
  columnUnits: ["UTC", "m", "degree_C", "PSU"],
};
const SECTION_DATA = ["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z"].flatMap(
  (time, cast) =>
    [0, 10, 20].map((depth) => ({
      time,
      depth,
      temperature: 10 - depth / 10 + cast,
      salinity: 30 + depth / 10,
    })),
);
const SECTION_DATASET = { cdm_data_type: "TimeSeriesProfile" };
const sectionVariables = byColumnName(
  variablesFrom(SECTION_TABLE, SECTION_DATASET),
);
const sectionFigure = (mode, data = SECTION_DATA) =>
  buildFigure({
    plan: { orientation: ROWS },
    variablesByName: sectionVariables,
    panels: ["depth"],
    sharedAxis: "time",
    data,
    mode,
    colorAxis: "temperature",
    size: { width: 600, height: 400 },
  });

test("a contour fills the section under markers kept only for the hover", () => {
  const { data } = sectionFigure("contour");
  const [fill, samples] = data;
  assert.equal(fill.type, "contour");
  assert.equal(fill.coloraxis, "coloraxis");
  assert.equal(fill.hoverinfo, "skip");
  assert.deepEqual(fill.y, [0, 10, 20]);
  assert.equal(fill.x.length, 2);
  assert.equal(samples.type, "scatter");
  assert.equal(samples.mode, "markers");
  assert.equal(samples.marker.opacity, 0);
});

test("a contour with nothing to spread over draws its samples as markers", () => {
  const oneCast = SECTION_DATA.filter(
    (row) => row.time === SECTION_DATA[0].time,
  );
  const { data } = sectionFigure("contour", oneCast);
  assert.equal(data.length, 1);
  assert.equal(data[0].mode, "markers");
  assert.equal(data[0].marker.opacity, undefined);
});

test("no contour is drawn without a colour column", () => {
  const { data } = buildFigure({
    plan: { orientation: ROWS },
    variablesByName: sectionVariables,
    panels: ["depth"],
    sharedAxis: "time",
    data: SECTION_DATA,
    mode: "contour",
  });
  assert.deepEqual(
    data.map((trace) => trace.type),
    ["scatter"],
  );
});

test("a grid fills each colour repeat against its own colour axis", () => {
  const { data } = buildGridFigure({
    variablesByName: sectionVariables,
    xAxes: ["time"],
    yAxes: ["depth"],
    panelAxis: "y",
    colorAxes: ["temperature", "salinity"],
    colorRows: true,
    data: SECTION_DATA,
    mode: "contour",
    size: { width: 600, height: 400 },
  });
  const fills = data.filter((trace) => trace.type === "contour");
  assert.deepEqual(
    fills.map((trace) => [trace.coloraxis, trace.xaxis, trace.yaxis]),
    [
      ["coloraxis", "x", "y"],
      ["coloraxis2", "x", "y2"],
    ],
  );
});
