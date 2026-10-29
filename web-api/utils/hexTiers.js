// Must match the edge lengths in create_hexes() (database/4_create_hexes.sql);
// changing either means changing both and re-tiling.

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

// cde.trajectory_hexes holds both tiers for the same data, so anything that
// counts a trajectory once must pin this tier or double-count.
const FINE = TIERS[1];

// The coverage layer never becomes points, so the fine grid is reused
// uncapped past the zoom where the main layer switches to dots.
const FINE_TIER_MIN_ZOOM = 4;

function tierForZoom(z) {
  return Number(z) < FINE_TIER_MIN_ZOOM ? TIERS[0] : TIERS[1];
}

module.exports = { TIERS, FINE, FINE_TIER_MIN_ZOOM, tierForZoom };
