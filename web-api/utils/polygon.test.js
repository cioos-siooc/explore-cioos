const test = require("node:test");
const assert = require("node:assert/strict");

const { polygonJSONToWKT } = require("./polygon");

// Pins the coordinate order end to end. The frontend serializes its selection
// ring verbatim as GeoJSON-order [lon, lat] pairs (utilities.jsx
// createSelectionQueryString / polygonToWkt), and ST_GeomFromText reads WKT as
// "X Y" — lon first. A silent transposition here would move every spatial
// selection to the wrong place on Earth without erroring, so assert on a ring
// whose two axes cannot be confused: longitudes near -130, latitudes near 50,
// which is off the BC coast one way and unreachable (lat 130) the other.
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
  // Callers bind the result straight into ST_GeomFromText, so every one of
  // these must be falsy rather than a string.
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
