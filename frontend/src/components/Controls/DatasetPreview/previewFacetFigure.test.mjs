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
  buildColorFigure,
  buildFigure,
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
  COLORBAR_ROOM_PX,
  MIN_PANEL_PX,
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

// The two cf_role columns carry values, because they are what the figure is
// titled after — the station the user clicked, and the profile actually drawn.
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

const TITLE = "Station Id: PMZA-RIKI — Profile: PMZA-RIKI-25/09/16-17:35:26";

// Same dataset with the publisher's palettes declared on two measurements, to
// exercise the colour default that comes from ERDDAP rather than from an index.
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
  const { data, layout } = figure("TimeSeriesProfile", ALL_SIX);
  assert.equal(data.length, 6);
  assert.equal(Object.keys(layout).filter((k) => /^yaxis/.test(k)).length, 1);
  assert.equal(Object.keys(layout).filter((k) => /^xaxis/.test(k)).length, 6);
});

test("the shared depth axis is reversed, and titled along itself", () => {
  const { layout } = figure("TimeSeriesProfile", ALL_SIX);
  assert.equal(layout.yaxis.autorange, "reversed");
  assert.equal(layout.yaxis.title.text, "depth of observation ( m )");
  assert.equal(layout.yaxis.automargin, true);
  assert.equal(layout.annotations, undefined);
});

test("profile panel titles sit on top, one per variable", () => {
  const { layout } = figure("TimeSeriesProfile", ["TE90_01", "PSAL_01"]);
  assert.equal(layout.xaxis.side, "top");
  assert.equal(
    layout.xaxis.title.text,
    "Temperature (1990 scale) ( degree_C )",
  );
  assert.equal(layout.xaxis2.side, "top");
  assert.equal(layout.xaxis2.title.text, "Practical Salinity ( PSU )");
});

test("every profile trace shares y and takes its own x", () => {
  const { data } = figure("TimeSeriesProfile", ALL_SIX);
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
  const { data } = figure("TimeSeriesProfile", ["TE90_01"]);
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

test("the first selected variable is drawn at the bottom", () => {
  // The image stacks Variable 1 lowest; the domain order therefore runs opposite
  // to the panel order.
  const { layout } = figure("TimeSeries", ["TE90_01", "PSAL_01", "DOXY_01"]);
  assert.ok(layout.yaxis.domain[0] < layout.yaxis3.domain[0]);
  assert.equal(
    layout.yaxis.title.text,
    "Temperature (1990 scale) ( degree_C )",
  );
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
  const { data, layout } = figure("TimeSeriesProfile", ["TE90_01"]);
  assert.equal(data.length, 1);
  assert.deepEqual(layout.xaxis.domain, [0, 1]);
  assert.equal(layout.yaxis.domain[0], 0);
});

test("the legend is off — each panel is already titled", () => {
  assert.equal(figure("TimeSeriesProfile", ALL_SIX).layout.showlegend, false);
});

test("explicit width and height are passed through, replacing autosize", () => {
  const { layout } = figure("TimeSeriesProfile", ALL_SIX, {
    size: { width: 900, height: 640 },
  });
  assert.equal(layout.width, 900);
  assert.equal(layout.height, 640);
  assert.ok(!("autosize" in layout));
});

test("uirevision is carried so a changed axis set does not restore a stale zoom", () => {
  assert.equal(
    figure("TimeSeriesProfile", ALL_SIX, { uirevision: "rec|depth|a,b" }).layout
      .uirevision,
    "rec|depth|a,b",
  );
});

test("a custom label replaces the name but keeps the unit", () => {
  const { layout } = figure("TimeSeriesProfile", ["TE90_01"], {
    labels: { TE90_01: "Temp" },
  });
  assert.equal(layout.xaxis.title.text, "Temp ( degree_C )");
});

test("no rows yet still produces the full axis skeleton", () => {
  const dataset = { ...VIKING_DATASET, cdm_data_type: "TimeSeriesProfile" };
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
  assert.equal(layout.xaxis2.title.text, "Practical Salinity ( PSU )");
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

test("a vertical axis title wraps to its own panel's height once it is known", () => {
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
    text.split("<br>").forEach((line) => {
      assert.ok(line.length <= fits, `"${line}" (${line.length} > ${fits})`);
    });
  });
  assert.ok(
    titles.some((text) => text.includes("<br>")),
    titles.join(" | "),
  );
  // Unmeasured, nothing wraps.
  const unsized = figure("TimeSeries", ALL_SIX);
  assert.ok(!unsized.layout.yaxis2.title.text.includes("<br>"));
});

test("a stack keeps its shared axis title", () => {
  const { layout } = figure("TimeSeries", ["TE90_01"]);
  assert.equal(layout.xaxis.title.text, "Time ( UTC )");
  assert.equal(layout.xaxis.title.font.size, LABEL_FONT_PX);
});

test("a profile titles its panels on top and its shared axis beside them", () => {
  const { layout } = figure("TimeSeriesProfile", ALL_SIX);
  assert.equal(layout.xaxis.side, "top");
  assert.ok(layout.xaxis.title.text);
  assert.ok(layout.yaxis.title.text);
});

test("labels are twice the ticks, at the size the wrap estimate assumes", () => {
  const { layout } = figure("TimeSeriesProfile", ALL_SIX);
  assert.equal(layout.font.size, TICK_FONT_PX);
  assert.equal(LABEL_FONT_PX, 2 * TICK_FONT_PX);
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
  const wide = figure("TimeSeriesProfile", ALL_SIX, {
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
      .filter((line) => !/^\( .* \)$/.test(line)) // a unit is never cut, so it alone may run over
      .forEach((line) => {
        assert.ok(line.length <= fits, `"${line}" (${line.length} > ${fits})`);
      });
  });
  // And the labels that do not fit were the reason: they wrapped.
  assert.ok(
    titles.filter((text) => text.includes("<br>")).length >= 5,
    titles.join(" | "),
  );
  // The same figure with no measured width leaves them on one line.
  const unsized = figure("TimeSeriesProfile", ALL_SIX);
  assert.ok(!unsized.layout.xaxis.title.text.includes("<br>"));
});

test("one panel is wide enough not to wrap", () => {
  const { layout } = figure("TimeSeriesProfile", ["TE90_01"], {
    size: { width: 1140, height: 620 },
  });
  assert.ok(!layout.xaxis.title.text.includes("<br>"));
});

test("the hover names the column by its capped long_name", () => {
  const { data } = figure("TimeSeriesProfile", ALL_SIX, {
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
  const { data } = figureFrom(noUnit, "TimeSeriesProfile", ["TE90_01"]);
  assert.equal(
    data[0].hovertemplate,
    "Temperature (1990 sca…: %{x}<extra></extra>",
  );
});

test("a renamed variable is renamed in the hover too", () => {
  const { data } = figure("TimeSeriesProfile", ["TE90_01"], {
    labels: { TE90_01: "  Temp  " },
  });
  assert.ok(data[0].hovertemplate.startsWith("Temp: %{x} degree_C"));
});

test("one hover answers on every panel that shares the axis", () => {
  const columns = figure("TimeSeriesProfile", ALL_SIX);
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
  const { layout } = figure("TimeSeriesProfile", ALL_SIX);
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
  const columns = figure("TimeSeriesProfile", ALL_SIX).layout;
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
  const { data } = figure("TimeSeriesProfile", ALL_SIX);
  const colors = data.map((t) => t.marker.color);
  assert.equal(new Set(colors).size, 6);
  colors.forEach((color, index) => {
    assert.equal(color, defaultColorFor(undefined, index));
    // Markers and line agree: a mode of markers+lines must not draw two colours.
    assert.equal(data[index].line.color, color);
  });
});

test("a declared colorBarPalette decides the variable's colour", () => {
  // The publisher's own intent, harvested into table_variables: the plot opens
  // reading roughly the way an ERDDAP graph of the same dataset does.
  const { data } = figureFrom(VIKING_PALETTES, "TimeSeriesProfile", [
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
  const { data } = figure("TimeSeriesProfile", ["TE90_01", "PSAL_01"], {
    colors: { PSAL_01: "#123456" },
  });
  assert.equal(data[1].marker.color, "#123456");
  assert.equal(data[1].line.color, "#123456");
  // And only that one: an override is not a theme.
  assert.equal(data[0].marker.color, defaultColorFor(undefined, 0));
});

test("no colour column means no colourbar, and no width kept for one", () => {
  const { data, layout } = figure("TimeSeriesProfile", ALL_SIX);
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
  const { data } = figure("TimeSeriesProfile", ["TE90_01"], { mode: "lines" });
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
    "station_id: PMZA-RIKI — profile: PMZA-RIKI-25/09/16-17:35:26",
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
  const variables = variablesFrom(VIKING, VIKING_DATASET);
  const box = (withTitle) =>
    plotBoxFor({
      plan: facetPlanFor(VIKING_DATASET, variables, DATA),
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

test("the title is drawn where Plotly draws a title, and not by automargin", () => {
  const { layout } = figure("TimeSeriesProfile", ALL_SIX, {
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
  const wide = figure("TimeSeriesProfile", ["TE90_01"], {
    size: { width: 1140, height: 620 },
  });
  const narrow = figure("TimeSeriesProfile", ["TE90_01"], {
    size: { width: 340, height: 620 },
  });
  assert.equal(wide.layout.margin.t, marginFor(COLUMNS, 1).t);
  assert.equal(narrow.layout.margin.t, marginFor(COLUMNS, 2).t);
  assert.ok(narrow.layout.margin.t > wide.layout.margin.t);
  // And a stack sized for one line is shorter than one sized for the worst case.
  assert.ok(plotHeightFor(ROWS, 6, 100, 1) < plotHeightFor(ROWS, 6, 100, 2));
});

test("no title means no title and no room reserved for one", () => {
  const { layout } = figure("TimeSeriesProfile", ["TE90_01"], { title: "" });
  assert.ok(!layout.title);
  assert.equal(layout.margin.t, marginFor(COLUMNS, 0).t);
  assert.equal(titleRoomFor(0), 0);
  assert.equal(titleLinesFor("", 1140), 0);
});

test("a profile spends the whole budget it is given", () => {
  const budget = heightBudgetFor(700, 685);
  assert.equal(plotHeightFor(COLUMNS, 3, budget), budget);
});

// --- the colour dimension ----------------------------------------------------

const colored = (panels, extra = {}) =>
  figureFrom(VIKING_PALETTES, "TimeSeriesProfile", panels, {
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
  const { layout } = figureFrom(
    VIKING_PALETTES,
    "TimeSeriesProfile",
    ["FLOR_01"],
    {
      colorAxis: "PSAL_01",
    },
  );
  assert.deepEqual(layout.coloraxis.colorscale, paletteFor("KT_haline"));
});

test("a rainbow colour column is drawn in viridis, and a pick beats both", () => {
  const rainbow = {
    ...VIKING,
    columnMeta: VIKING.columnMeta.map((meta) =>
      meta.name === "PSAL_01" ? { ...meta, colorBarPalette: "Rainbow" } : meta,
    ),
  };
  const auto = figureFrom(rainbow, "TimeSeriesProfile", ["FLOR_01"], {
    colorAxis: "PSAL_01",
  });
  assert.deepEqual(auto.layout.coloraxis.colorscale, colorScaleFor("Viridis"));

  const picked = figureFrom(rainbow, "TimeSeriesProfile", ["FLOR_01"], {
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
  const plain = figure("TimeSeriesProfile", ["TE90_01", "PSAL_01"], {
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
  const panels = (width - margin.l - margin.r) / panelPitch(6, 0.22);
  assert.ok(panels >= MIN_PANEL_PX, `${panels}px panels`);
  assert.deepEqual(colored(ALL_SIX).layout.margin, {
    ...figure("TimeSeriesProfile", ALL_SIX).layout.margin,
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
  assert.equal(colorLegend.ticks.length, 4);
  assert.equal(colorLegend.ticks[0].position, 0);
  assert.equal(colorLegend.ticks[3].position, 1);
  assert.equal(colorLegend.ticks[0].text, "1");
  assert.equal(colorLegend.ticks[3].text, String(DATA.length));
});

test("no colour column, no legend", () => {
  assert.equal(figure("TimeSeriesProfile", ALL_SIX).colorLegend, null);
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
  const { data } = figureFrom(
    VIKING,
    "TimeSeriesProfile",
    ["TE90_01", "DOXY_01"],
    { colorAxis: "PSAL_01" },
  );
  assert.ok(
    data[0].hovertemplate.endsWith(
      "<br>Practical Salinity: %{customdata} PSU<extra></extra>",
    ),
  );
  assert.ok(!data[1].hovertemplate.includes("%{customdata}"));
});

test("a unified box adds no colour line when a panel or the shared axis prints it", () => {
  const byPanel = figureFrom(
    VIKING,
    "TimeSeriesProfile",
    ["TE90_01", "PSAL_01"],
    { colorAxis: "PSAL_01" },
  );
  byPanel.data.forEach((trace) =>
    assert.ok(!trace.hovertemplate.includes("%{customdata}")),
  );

  const bySharedAxis = figureFrom(VIKING, "TimeSeriesProfile", ["TE90_01"], {
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
  const { data, colorLegend } = figureFrom(
    VIKING,
    "TimeSeriesProfile",
    ["TE90_01"],
    {
      colorAxis: "time",
    },
  );
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
  const plain = figure("TimeSeriesProfile", ["TE90_01"]);
  const unorderable = figureFrom(VIKING, "TimeSeriesProfile", ["TE90_01"], {
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

// --- colour plot -------------------------------------------------------------

function colorFigure(panels, extra = {}) {
  const dataset = { ...VIKING_DATASET, cdm_data_type: "TimeSeriesProfile" };
  const variables = variablesFrom(VIKING_PALETTES, dataset);
  return buildColorFigure({
    variablesByName: byColumnName(variables),
    panels,
    xAxis: "time",
    yAxis: "depth",
    data: DATA,
    mode: "markers",
    uirevision: "test",
    ...extra,
  });
}

const panelTraces = (data) => data.filter((trace) => trace.hovertemplate);

test("a colour plot stacks one panel per colour variable, all drawing Y on X", () => {
  const { data, layout } = colorFigure(["TE90_01", "PSAL_01"]);
  assert.equal(Object.keys(layout).filter((k) => /^xaxis/.test(k)).length, 1);
  assert.equal(Object.keys(layout).filter((k) => /^yaxis/.test(k)).length, 2);
  assert.deepEqual(
    data.map((trace) => trace.yaxis),
    ["y", "y2"],
  );
  data.forEach((trace) => {
    assert.equal(trace.xaxis, "x");
    assert.deepEqual(
      trace.x,
      DATA.map((row) => row.time),
    );
    assert.deepEqual(
      trace.y,
      DATA.map((row) => row.depth),
    );
  });
});

test("every colour panel titles its Y, reverses depth and zooms with the first", () => {
  const { layout } = colorFigure(["TE90_01", "PSAL_01"]);
  assert.equal(layout.yaxis.autorange, "reversed");
  assert.equal(layout.yaxis2.autorange, "reversed");
  assert.equal(layout.yaxis.title.text, "depth of observation ( m )");
  assert.equal(layout.yaxis2.title.text, "depth of observation ( m )");
  assert.equal(layout.yaxis.matches, undefined);
  assert.equal(layout.yaxis2.matches, "y");
});

test("each panel's colourbar spans exactly its panel and names its variable", () => {
  const { data, layout } = colorFigure(["TE90_01", "PSAL_01"]);
  [
    ["coloraxis", layout.yaxis, "Temperature (1990 scale) ( degree_C )"],
    ["coloraxis2", layout.yaxis2, "Practical Salinity ( PSU )"],
  ].forEach(([name, axis, label], index) => {
    const { colorbar } = layout[name];
    const [start, end] = axis.domain;
    assert.equal(colorbar.y, (start + end) / 2, name);
    assert.equal(colorbar.len, end - start, name);
    assert.equal(colorbar.lenmode, "fraction", name);
    assert.equal(colorbar.yanchor, "middle", name);
    assert.equal(colorbar.title.text, label, name);
    assert.equal(data[index].marker.coloraxis, name);
  });
});

test("each colour panel draws in its own variable's scale, or the user's", () => {
  const { layout } = colorFigure(["TE90_01", "PSAL_01"], {
    scales: { PSAL_01: "Cividis" },
  });
  assert.deepEqual(layout.coloraxis.colorscale, paletteFor("KT_thermal"));
  assert.deepEqual(layout.coloraxis2.colorscale, colorScaleFor("Cividis"));
  assert.equal(layout.coloraxis.cmin, 0);
  assert.equal(layout.coloraxis.cmax, 19);
});

test("the colour plot's right margin holds the colourbars", () => {
  const { layout } = colorFigure(["TE90_01"]);
  assert.equal(layout.margin.r, marginFor(ROWS, 0).r + COLORBAR_ROOM_PX);
  assert.equal(layout.hovermode, "closest");
});

test("a colour plot keeps the plot type: lines are binned in each panel's ramp", () => {
  const { data } = colorFigure(["TE90_01", "PSAL_01"], { mode: "lines" });
  const lines = data.filter((trace) => !trace.hovertemplate);
  assert.ok(lines.length > 0);
  assert.ok(lines.some((trace) => trace.yaxis === "y"));
  assert.ok(lines.some((trace) => trace.yaxis === "y2"));
  const panels = panelTraces(data);
  assert.equal(panels.length, 2);
  panels.forEach((trace) => {
    assert.equal(trace.mode, "markers");
    assert.equal(trace.marker.opacity, 0);
  });
});

test("a time colour variable labels its bar with dates, not epoch milliseconds", () => {
  const { layout } = colorFigure(["time"], { xAxis: "TE90_01" });
  assert.equal(layout.coloraxis.colorbar.tickmode, "array");
  assert.ok(
    layout.coloraxis.colorbar.ticktext.every((text) => !/^\d{10,}$/.test(text)),
  );
});

test("a row without a colour is a gap in its panel, not a grey point", () => {
  const data = DATA.map((row, index) =>
    index === 3 ? { ...row, TE90_01: null } : row,
  );
  const [trace] = panelTraces(colorFigure(["TE90_01"], { data }).data);
  assert.equal(trace.y[3], null);
  assert.equal(trace.y[4], DATA[4].depth);
});

test("a colour variable with no value at all draws solid and gets no bar", () => {
  const data = DATA.map((row) => ({ ...row, TE90_01: null }));
  const { data: traces, layout } = colorFigure(["TE90_01"], { data });
  assert.equal(layout.coloraxis, undefined);
  assert.equal(typeof traces[0].marker.color, "string");
});

test("the colour plot's hover names X, Y and the colour value", () => {
  const [trace] = colorFigure(["TE90_01"]).data;
  assert.match(trace.hovertemplate, /depth/i);
  assert.match(trace.hovertemplate, /%\{customdata\} degree_C/);
  assert.match(trace.hovertemplate, /%\{x\}/);
});

test("plotBoxFor sizes a colour plot as a stack, whatever the record's type", () => {
  const dataset = { ...VIKING_DATASET, cdm_data_type: "TimeSeriesProfile" };
  const variables = variablesFrom(VIKING, dataset);
  const box = plotBoxFor({
    plan: facetPlanFor(dataset, variables, DATA),
    variablesByName: byColumnName(variables),
    data: DATA,
    panelCount: 6,
    availableHeight: 400,
    measured: { width: 800, height: 400 },
    orientation: ROWS,
  });
  assert.equal(box.width, 799);
  assert.ok(box.height > 400);
});
