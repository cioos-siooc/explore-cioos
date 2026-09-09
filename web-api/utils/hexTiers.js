/*
 * The two hex grids the map aggregates on.
 *
 * There is one concept here — a cell tier — and the stack spells it four
 * different ways: cde.points carries a hex_0_pk / hex_1_pk FK per tier, the
 * polygons live in cde.hexes_zoom_0 / cde.hexes_zoom_1, cde.trajectory_hexes
 * carries one row per tier under hex_tier, and the tile routes pick a tier
 * from the request's zoom. Every one of those mappings used to be written out
 * at the call site — seven times across five files — so this is the one place
 * that knows which name belongs to which grid.
 *
 * The grids themselves are built by create_hexes() in
 * database/4_create_hexes.sql, which spells the same two edge lengths. JS
 * cannot share a constant with it, so `edgeMetres` here is the JS-side
 * authority only: changing either number means changing both and re-tiling.
 */

// ST_HexagonGrid takes the EDGE length, so a cell's diameter is 2x this.
const TIERS = [
  {
    tier: 0,
    hexesTable: "cde.hexes_zoom_0",
    pointColumn: "hex_0_pk",
    edgeMetres: 100000,
  },
  {
    tier: 1,
    hexesTable: "cde.hexes_zoom_1",
    pointColumn: "hex_1_pk",
    edgeMetres: 10000,
  },
];

/*
 * The fine tier.
 *
 * cde.trajectory_hexes holds coverage at BOTH tiers describing the same data
 * (each tier's day count is aggregated independently, so they cannot share a
 * row), which means anything that counts a trajectory once has to pin a tier
 * or double-count it. The fine one is the pin: it is the grain at which a
 * drawn selection smaller than a coarse cell still selects what the track left
 * inside it.
 */
const FINE = TIERS[1];

// Zoom at which the tile routes switch grids. Below it a tile spans less than
// a coarse cell; at and above it the fine grid is used, and reused uncapped
// past the point where the main layer switches to individual dots (the
// coverage layer never becomes points).
const FINE_TIER_MIN_ZOOM = 5;

// `z` arrives as a path-parameter string; Number() rather than a bare
// comparison so a tier is chosen the same way wherever it is called from.
function tierForZoom(z) {
  return Number(z) < FINE_TIER_MIN_ZOOM ? TIERS[0] : TIERS[1];
}

module.exports = { TIERS, FINE, FINE_TIER_MIN_ZOOM, tierForZoom };
