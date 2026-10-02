// A hand-built patch of map the recorded fixtures cannot provide: markers and
// tracks at the marker tier. e2e/build-synthetic-tiles.mjs encodes it into
// z7 tiles, and mapInteraction.spec.js points the mouse at the same features,
// so both read positions from here and cannot drift apart.
//
// Positions are pixel offsets from the canvas centre at ZOOM, because that is
// what the spec clicks; the generator turns them into coordinates. Dataset pks
// are ones the recorded pointQuery holds, so the card and the dataset page can
// resolve them like real hits.

export const CENTRE = { lon: -63, lat: 43.5 };
export const ZOOM = 7.5;

const TILE_SIZE = 512;
const worldSize = TILE_SIZE * 2 ** ZOOM;
const toMercator = ({ lon, lat }) => ({
  x: ((lon + 180) / 360) * worldSize,
  y:
    ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) /
      2) *
    worldSize,
});
const centrePx = toMercator(CENTRE);

export const lngLatAt = ([dx, dy]) => {
  const x = centrePx.x + dx;
  const y = centrePx.y + dy;
  const lon = (x / worldSize) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / worldSize))) * 180) / Math.PI;
  return [lon, lat];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TRACK_END = Date.UTC(2026, 0, 10);

// One dataset, one station: a click jumps straight to its record.
export const LONE_MARKER = {
  at: [0, 0],
  properties: {
    pk: 910001,
    count: 12,
    datasets: "[11]",
    platform: "surface vessel",
  },
};
// Two datasets at one station: a click opens the card on both.
export const SHARED_MARKER = {
  at: [90, 0],
  properties: {
    pk: 910002,
    count: 40,
    datasets: "[11,29]",
    platform: "surface vessel",
  },
};
// A station with a track running through it, for hover and click precedence.
export const CROSSED_MARKER = {
  at: [0, 140],
  properties: {
    pk: 910003,
    count: 5,
    datasets: "[29]",
    platform: "surface vessel",
  },
};
export const MARKERS = [LONE_MARKER, SHARED_MARKER, CROSSED_MARKER];

const track = (trajectoryId, from, to) => ({
  from,
  to,
  properties: {
    pk_url: 29,
    trajectory_id: trajectoryId,
    dataset_title:
      "Water Property Measurements from Conductivity-Temperature-Depth Profilers, BC, Canada (Provisional)",
    time_min: TRACK_END - 5 * DAY_MS,
    time_max: TRACK_END,
  },
});

// A track on open water, alone.
// Kept right of centre: a click on it opens the dataset page, which covers the
// left of the map on a tablet.
export const OPEN_TRACK = track("ship-3", [-120, -120], [40, -120]);
// A track crossing CROSSED_MARKER.
export const CROSSING_TRACK = track("glider-7", [-120, 140], [120, 140]);
export const TRACKS = [OPEN_TRACK, CROSSING_TRACK];

// Two gridded footprints, overlapping, the second also over CROSSED_MARKER.
// Rectangles as [left, top, right, bottom] offsets. Their pks are not in the
// recorded pointQuery, like a griddap dataset the results do not list.
const grid = (pk, rect, title) => ({
  rect,
  properties: {
    pk,
    dataset_id: `synthetic_grid_${pk}`,
    title_translated: { en: title, fr: title },
  },
});
export const GRID_A = grid(920001, [-180, 180, -60, 300], "Synthetic grid A");
export const GRID_B = grid(920002, [-120, 120, 60, 260], "Synthetic grid B");
export const GRIDS = [GRID_A, GRID_B];
// Under GRID_A alone, and under both.
export const GRID_A_ONLY = [-150, 285];
export const GRID_OVERLAP = [-90, 220];
