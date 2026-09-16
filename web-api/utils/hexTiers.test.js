const test = require("node:test");
const assert = require("node:assert/strict");

const { TIERS, FINE, FINE_TIER_MIN_ZOOM, tierForZoom } = require("./hexTiers");

test("each tier names the same grid consistently across the schema", () => {
  // A tier number, a polygon table and a cde.points FK column are three names
  // for one grid; getting them out of step silently joins hexes of one size to
  // cells assigned to the other.
  for (const t of TIERS) {
    assert.equal(t.hexesTable, `cde.hexes_zoom_${t.tier}`);
    assert.equal(t.pointColumn, `hex_${t.tier}_pk`);
  }
});

test("the fine tier is the smaller grid", () => {
  // Everything that must count trajectory coverage exactly once pins FINE, so
  // it has to be the tier whose cells a drawn selection can resolve.
  assert.equal(FINE, TIERS[1]);
  assert.ok(FINE.edgeMetres < TIERS[0].edgeMetres);
});

test("the zoom cutoff picks the coarse grid below it and the fine one above", () => {
  assert.equal(tierForZoom(FINE_TIER_MIN_ZOOM - 1).tier, 0);
  assert.equal(tierForZoom(FINE_TIER_MIN_ZOOM).tier, 1);
  assert.equal(tierForZoom(0).tier, 0);
  // No upper cutoff: the fine grid is reused uncapped, which is what keeps
  // coverage cells hexagonal at every zoom.
  assert.equal(tierForZoom(22).tier, 1);
});

test("a zoom arriving as a path-parameter string picks the same tier", () => {
  // req.params.z is a string; a bare `z < 5` happened to coerce, but only
  // because the other operand was a number.
  for (const z of [0, 4, 5, 12]) {
    assert.deepEqual(tierForZoom(String(z)), tierForZoom(z));
  }
});
