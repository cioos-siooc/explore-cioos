const test = require("node:test");
const assert = require("node:assert/strict");

const { TIERS, FINE, FINE_TIER_MIN_ZOOM, tierForZoom } = require("./hexTiers");

test("each tier names the same grid consistently across the schema", () => {
  // Out of step, hexes of one size silently join cells assigned to the other.
  for (const t of TIERS) {
    assert.equal(t.hexesTable, `cde.hexes_zoom_${t.tier}`);
    assert.equal(t.pointColumn, `hex_${t.tier}_pk`);
  }
});

test("the fine tier is the smaller grid", () => {
  assert.equal(FINE, TIERS[1]);
  assert.ok(FINE.edgeMetres < TIERS[0].edgeMetres);
});

test("the zoom cutoff picks the coarse grid below it and the fine one above", () => {
  assert.equal(tierForZoom(FINE_TIER_MIN_ZOOM - 1).tier, 0);
  assert.equal(tierForZoom(FINE_TIER_MIN_ZOOM).tier, 1);
  assert.equal(tierForZoom(0).tier, 0);
  assert.equal(tierForZoom(22).tier, 1);
});

test("a zoom arriving as a path-parameter string picks the same tier", () => {
  // req.params.z arrives as a string.
  for (const z of [0, 4, 5, 12]) {
    assert.deepEqual(tierForZoom(String(z)), tierForZoom(z));
  }
});
