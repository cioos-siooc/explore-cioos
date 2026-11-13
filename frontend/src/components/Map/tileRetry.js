// MapLibre never re-requests an errored tile, and counts it as having data, so
// nothing stands in for it: one failed cold query left a hole until the tile
// was panned out of the cache. Bounded so a tile that always fails stops.
const TILE_RETRY_DELAYS_MS = [1000, 3000, 8000];

// `onChange` fires whenever a source gains or loses its last given-up tile,
// so the map can say a hole is a failure rather than empty water.
export function createTileRetry({
  refresh,
  onChange = () => {},
  delays = TILE_RETRY_DELAYS_MS,
}) {
  // Per source, so a tracks scrub doesn't cancel the hexes' pending retries.
  const bySource = new Map();
  const stateOf = (sourceId) => {
    if (!bySource.has(sourceId)) {
      bySource.set(sourceId, {
        attempts: new Map(),
        timers: new Set(),
        exhausted: new Map(),
      });
    }
    return bySource.get(sourceId);
  };
  const keyOf = ({ z, x, y }) => `${z}/${x}/${y}`;

  function onError(sourceId, tile) {
    const { attempts, timers, exhausted } = stateOf(sourceId);
    const key = keyOf(tile);
    const attempt = attempts.get(key) ?? 0;
    if (attempt >= delays.length) {
      if (!exhausted.has(key)) {
        exhausted.set(key, tile);
        onChange();
      }
      return;
    }
    attempts.set(key, attempt + 1);
    const timer = setTimeout(() => {
      timers.delete(timer);
      refresh(sourceId, tile);
    }, delays[attempt]);
    timers.add(timer);
  }

  // A tile that loads after all (panned back to, or retried by hand) is no
  // longer a hole.
  function onLoad(sourceId, tile) {
    const state = bySource.get(sourceId);
    if (!state) return;
    const key = keyOf(tile);
    state.attempts.delete(key);
    if (state.exhausted.delete(key)) onChange();
  }

  // The user's Retry: every given-up tile gets a fresh set of attempts.
  function retryExhausted() {
    let any = false;
    bySource.forEach((state, sourceId) => {
      state.exhausted.forEach((tile, key) => {
        any = true;
        state.attempts.delete(key);
        refresh(sourceId, tile);
      });
      state.exhausted.clear();
    });
    if (any) onChange();
  }

  function hasExhausted(sourceIds) {
    return sourceIds.some((id) => bySource.get(id)?.exhausted.size > 0);
  }

  // For a new tile URL: the old failures say nothing about it.
  function reset(sourceId) {
    const state = bySource.get(sourceId);
    if (!state) return;
    state.timers.forEach(clearTimeout);
    bySource.delete(sourceId);
    if (state.exhausted.size) onChange();
  }

  return { onError, onLoad, retryExhausted, hasExhausted, reset };
}
