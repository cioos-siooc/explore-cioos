const test = require("node:test");
const assert = require("node:assert/strict");

const {
  timeDimensionFrom,
  erddapTimeToIso,
} = require("../routes/griddapTimeRange");

// ERDDAP's /info/{id}/index.json, trimmed to the rows that matter.
const info = (rows) => ({
  columnNames: [
    "Row Type",
    "Variable Name",
    "Attribute Name",
    "Data Type",
    "Value",
  ],
  rows,
});

test("reads nValues, spacing and bounds off the time rows", () => {
  const time = timeDimensionFrom(
    info([
      [
        "dimension",
        "time",
        "",
        "double",
        "nValues=168, evenlySpaced=true, averageSpacing=1h",
      ],
      [
        "attribute",
        "time",
        "actual_range",
        "double",
        "1.0257408E9, 1.0263456E9",
      ],
      [
        "attribute",
        "time",
        "units",
        "String",
        "seconds since 1970-01-01T00:00:00Z",
      ],
      [
        "dimension",
        "latitude",
        "",
        "double",
        "nValues=100, evenlySpaced=true, averageSpacing=0.1",
      ],
    ]),
  );
  assert.equal(time.n_values, 168);
  assert.equal(time.even_spacing, true);
  assert.equal(time.spacing, "1h");
  assert.equal(time.min, "2002-07-04T00:00:00.000Z");
  assert.equal(time.max, "2002-07-11T00:00:00.000Z");
  assert.match(time.units, /seconds since/);
});

test("does not mistake another variable's rows for the time axis", () => {
  // Rows are filtered by Variable Name first: latitude also has an
  // actual_range, and reading it as a time would put the slider in 1970.
  const time = timeDimensionFrom(
    info([
      [
        "dimension",
        "latitude",
        "",
        "double",
        "nValues=100, evenlySpaced=true, averageSpacing=0.1",
      ],
      ["attribute", "latitude", "actual_range", "double", "40.0, 50.0"],
      [
        "dimension",
        "time",
        "",
        "double",
        "nValues=5, evenlySpaced=false, averageSpacing=1 day 3h",
      ],
      [
        "attribute",
        "time",
        "actual_range",
        "double",
        "1.0257408E9, 1.0263456E9",
      ],
    ]),
  );
  assert.equal(time.n_values, 5);
  assert.equal(time.even_spacing, false);
  assert.equal(time.min, "2002-07-04T00:00:00.000Z");
});

test("returns null when the dataset declares no time dimension", () => {
  // A static grid: the caller keeps its harvested dimensions.
  assert.equal(
    timeDimensionFrom(
      info([["dimension", "latitude", "", "double", "nValues=100"]]),
    ),
    null,
  );
});

test("returns null for an unrecognised document shape", () => {
  assert.equal(timeDimensionFrom(undefined), null);
  assert.equal(timeDimensionFrom({ columnNames: ["nope"], rows: [] }), null);
});

test("parses both of ERDDAP's time formats", () => {
  assert.equal(erddapTimeToIso("1.0257408E9"), "2002-07-04T00:00:00.000Z");
  assert.equal(
    erddapTimeToIso("2002-07-04T00:00:00Z"),
    "2002-07-04T00:00:00.000Z",
  );
  for (const empty of ["", "   ", "NaN", null, undefined]) {
    assert.equal(erddapTimeToIso(empty), null);
  }
});
