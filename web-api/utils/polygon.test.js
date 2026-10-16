const test = require("node:test");
const assert = require("node:assert/strict");

const { polygonJSONToWKT } = require("./polygon");

// A transposition would silently move every selection. Longitudes near -130
// and latitudes near 50 can't be confused (lat 130 is impossible).
test("emits lon-first WKT from a [lon, lat] ring", () => {
  const ring = [
    [-130, 48],
    [-125, 48],
    [-125, 52],
    [-130, 52],
    [-130, 48],
  ];
  assert.equal(
    polygonJSONToWKT(JSON.stringify(ring)),
    "POLYGON((-130 48,-125 48,-125 52,-130 52,-130 48))",
  );
});

test("rejects rings and payloads that cannot make a polygon", () => {
  // Callers bind the result straight into ST_GeomFromText.
  assert.equal(polygonJSONToWKT("not json"), false);
  assert.equal(polygonJSONToWKT("{}"), false);
  // A triangle needs its closing point: 3 coordinates is not a ring.
  assert.equal(
    polygonJSONToWKT(
      JSON.stringify([
        [-130, 48],
        [-125, 48],
        [-125, 52],
      ]),
    ),
    false,
  );
});
