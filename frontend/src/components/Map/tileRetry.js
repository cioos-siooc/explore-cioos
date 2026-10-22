// MapLibre never re-requests an errored tile, and counts it as having data, so
// nothing stands in for it: one failed cold query left a hole until the tile
// was panned out of the cache. Bounded so a tile that always fails stops.
const TILE_RETRY_DELAYS_MS = [1000, 3000, 8000];

export function createTileRetry({ refresh, delays = TILE_RETRY_DELAYS_MS }) {
  // Per source, so a tracks scrub doesn't cancel the hexes' pending retries.
  const bySource = new Map();
  const stateOf = (sourceId) => {
    if (!bySource.has(sourceId)) {
      bySource.set(sourceId, { attempts: new Map(), timers: new Set() });
    }
    return bySource.get(sourceId);
  };

  function onError(sourceId, { z, x, y }) {
    const { attempts, timers } = stateOf(sourceId);
    const key = `${z}/${x}/${y}`;
    const attempt = attempts.get(key) ?? 0;
    if (attempt >= delays.length) return;
    attempts.set(key, attempt + 1);
    const timer = setTimeout(() => {
      timers.delete(timer);
      refresh(sourceId, { z, x, y });
    }, delays[attempt]);
    timers.add(timer);
  }

  // For a new tile URL: the old failures say nothing about it.
  function reset(sourceId) {
    const state = bySource.get(sourceId);
    if (!state) return;
    state.timers.forEach(clearTimeout);
    bySource.delete(sourceId);
  }

  return { onError, reset };
}
