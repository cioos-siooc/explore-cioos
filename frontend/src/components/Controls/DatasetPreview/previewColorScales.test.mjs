import { test } from "node:test";
import assert from "node:assert/strict";

import {
  autoScaleNameFor,
  COLOR_SCALES,
  DEFAULT_COLOR_SCALE,
  colorDimensionFor,
  colorScaleFor,
  colorScaleForVariable,
  normalizeColorScale,
  swatchStopsFor,
  timeTicksFor,
} from "./previewColorScales.js";
import { paletteFor, paletteColorFor } from "./erddapPalettes.js";
import { variablesFrom, byColumnName } from "./previewVariables.js";

const variable = (columnName, extra = {}) => ({
  columnName,
  isNumeric: true,
  ...extra,
});

// --- which scale a colour column is drawn in ---------------------------------

test("the publisher's own colorBarPalette is what a column opens in", () => {
  assert.deepEqual(
    colorScaleForVariable(variable("TE90_01", { palette: "KT_thermal" })),
    paletteFor("KT_thermal"),
  );
});

test("a column declaring no palette is drawn in viridis", () => {
  assert.equal(colorScaleForVariable(variable("depth")), DEFAULT_COLOR_SCALE);
  assert.equal(colorScaleForVariable(undefined), DEFAULT_COLOR_SCALE);
});

test("a palette this build does not map falls back to viridis", () => {
  assert.equal(
    colorScaleForVariable(variable("x", { palette: "BlueWhiteRed" })),
    DEFAULT_COLOR_SCALE,
  );
});

test("every rainbow is drawn in viridis instead, however it was asked for", () => {
  for (const rainbow of ["Rainbow", "LightRainbow", "ReverseRainbow", "Jet"]) {
    // Declared by the dataset...
    assert.equal(
      colorScaleForVariable(variable("x", { palette: rainbow })),
      DEFAULT_COLOR_SCALE,
      rainbow,
    );
    // ...or asked for by a hand-edited link.
    assert.equal(normalizeColorScale(rainbow), null, rainbow);
  }
  assert.ok(!COLOR_SCALES.some((name) => name.includes("ainbow")));
});

test("the rainbow ban does not reach the solid colour a variable draws in", () => {
  // Deliberately asymmetric: no ramp is rendered there, only one stop of it, so
  // there is no banding to object to and a link's colours stay what they were.
  assert.equal(paletteColorFor("Rainbow"), "#0000ff");
});

test("the user's pick beats the variable's own palette", () => {
  assert.deepEqual(
    colorScaleForVariable(
      variable("x", { palette: "KT_thermal" }),
      "KT_haline",
    ),
    paletteFor("KT_haline"),
  );
});

test("a scale name this build does not offer is ignored, not passed on", () => {
  assert.equal(normalizeColorScale("Inferno"), null);
  assert.equal(normalizeColorScale(""), null);
  assert.equal(normalizeColorScale(undefined), null);
  assert.equal(normalizeColorScale(" Cividis "), "Cividis");
});

test("plotly's own scales go by name; ours go as stops", () => {
  assert.equal(colorScaleFor("Viridis"), "Viridis");
  assert.equal(colorScaleFor("Cividis"), "Cividis");
  assert.deepEqual(colorScaleFor("KT_haline"), paletteFor("KT_haline"));
});

test("every offered scale has stops to paint its swatch with", () => {
  COLOR_SCALES.forEach((name) => {
    const stops = swatchStopsFor(name);
    assert.ok(stops.length >= 2, name);
    assert.equal(stops[0][0], 0, name);
    assert.equal(stops[stops.length - 1][0], 1, name);
  });
});

// --- what the colour column contributes --------------------------------------

test("a numeric column becomes numbers, with the gaps kept as gaps", () => {
  const dimension = colorDimensionFor(variable("depth"), [
    { depth: "1.5" },
    { depth: "NaN" },
    { depth: 3 },
  ]);
  assert.deepEqual(dimension.values, [1.5, null, 3]);
  assert.deepEqual(dimension.hoverValues, dimension.values);
  assert.equal(dimension.ticks, null);
});

test("a time column becomes epoch milliseconds, keeping the timestamps for hover", () => {
  const time = variable("time", { isNumeric: false, unit: "UTC" });
  const dimension = colorDimensionFor(time, [
    { time: "2025-09-16T17:35:26Z" },
    { time: "2025-09-16T18:35:26Z" },
  ]);
  assert.deepEqual(dimension.values, [
    Date.parse("2025-09-16T17:35:26Z"),
    Date.parse("2025-09-16T18:35:26Z"),
  ]);
  assert.deepEqual(dimension.hoverValues, [
    "2025-09-16T17:35:26Z",
    "2025-09-16T18:35:26Z",
  ]);
});

test("a colourbar over time is ticked in timestamps, not in milliseconds", () => {
  const hour = timeTicksFor([
    Date.parse("2025-09-16T17:00:00Z"),
    Date.parse("2025-09-16T20:00:00Z"),
  ]);
  assert.equal(hour.tickmode, "array");
  assert.deepEqual(hour.ticktext, ["17:00", "18:00", "19:00", "20:00"]);

  const season = timeTicksFor([
    Date.parse("2025-06-01T00:00:00Z"),
    Date.parse("2025-09-01T00:00:00Z"),
  ]);
  assert.deepEqual(season.ticktext, [
    "2025-06-01",
    "2025-07-01",
    "2025-08-01",
    "2025-09-01",
  ]);
});

test("one instant in time is no range, so it takes no ticks", () => {
  assert.equal(timeTicksFor([1, 1, 1]), null);
  assert.equal(timeTicksFor([]), null);
});

test("a string column carries no colour dimension at all", () => {
  const station = variable("station_id", { isNumeric: false });
  assert.equal(colorDimensionFor(station, [{ station_id: "PMZA-RIKI" }]), null);
});

test("a column that is all gaps carries none either", () => {
  assert.equal(
    colorDimensionFor(variable("depth"), [
      { depth: "" },
      { depth: null },
      { depth: "NaN" },
      {},
    ]),
    null,
  );
  assert.equal(colorDimensionFor(variable("depth"), []), null);
  assert.equal(colorDimensionFor(undefined, [{ depth: 1 }]), null);
});

test("a Log colourBarScale is still drawn linearly", () => {
  // Recorded rather than implemented: see the comment in previewColorScales.js.
  const table = {
    columnNames: ["chlorophyll"],
    columnTypes: ["float"],
    columnUnits: ["mg/m^3"],
    columnMeta: [
      {
        name: "chlorophyll",
        colorBarScale: "Log",
        colorBarPalette: "KT_algae",
      },
    ],
  };
  const chlorophyll = byColumnName(variablesFrom(table, {})).get("chlorophyll");
  assert.equal(chlorophyll.colorBarScale, "Log");
  assert.deepEqual(colorScaleForVariable(chlorophyll), paletteFor("KT_algae"));
  assert.deepEqual(
    colorDimensionFor(chlorophyll, [{ chlorophyll: 1 }, { chlorophyll: 100 }])
      .values,
    [1, 100],
  );
});

test("the automatic choice is a name the picker can show, and agrees with the scale", () => {
  const thermal = variable("TE90_01", { palette: "KT_thermal" });
  assert.equal(autoScaleNameFor(thermal), "KT_thermal");
  assert.equal(autoScaleNameFor(variable("depth")), DEFAULT_COLOR_SCALE);
  assert.equal(
    autoScaleNameFor(variable("x", { palette: "Rainbow" })),
    DEFAULT_COLOR_SCALE,
  );
  COLOR_SCALES.forEach((name) => {
    assert.deepEqual(
      colorScaleForVariable(variable("x", { palette: name })),
      colorScaleFor(autoScaleNameFor(variable("x", { palette: name }))),
      name,
    );
  });
});
