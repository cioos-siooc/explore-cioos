// H3 resolutions; must match create_hexes() / trajectory_build_hexes()
// (database/4_create_hexes.sql), and FINE must match OBIS_H3_RES in the OBIS
// harvester. Changing any means changing all and re-tiling.

// edgeMetres is the resolution's average GROUND edge; a cell is ~2x across.
const TIERS = [
  {
    tier: 0,
    hexesTable: "cde.hexes_zoom_0",
    pointColumn: "hex_0_pk",
    h3Resolution: 3,
    edgeMetres: 68980,
  },
  {
    tier: 1,
    hexesTable: "cde.hexes_zoom_1",
    pointColumn: "hex_1_pk",
    h3Resolution: 6,
    edgeMetres: 3725,
  },
];

// cde.trajectory_hexes holds both tiers for the same data, so anything that
// counts a trajectory once must pin this tier or double-count.
const FINE = TIERS[1];

// The coverage layer never becomes points, so the fine grid is reused
// uncapped past the zoom where the main layer switches to dots. Below 5 a
// fine cell is ~2 px wide at mid-Canadian latitudes.
const FINE_TIER_MIN_ZOOM = 5;

function tierForZoom(z) {
  return Number(z) < FINE_TIER_MIN_ZOOM ? TIERS[0] : TIERS[1];
}

module.exports = { TIERS, FINE, FINE_TIER_MIN_ZOOM, tierForZoom };
