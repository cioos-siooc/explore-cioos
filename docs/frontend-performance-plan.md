# Frontend response-time improvement plan

Goal: faster perceived and actual response of the frontend while keeping client-side load minimal. The architecture is already right in the big strokes — observation layers are server-rendered MVT tiles (the client never downloads the point cloud), Plotly is lazy-loaded, filters are debounced. The remaining cost is concentrated in a handful of places, mostly server-side.

## Where the time goes today

**Server (dominant):**

1. **Every tile request aggregates the whole filtered database, then clips.** `web-api/routes/tiles.js:89-131` builds the `combined` CTE (profiles ∪ trajectory_cells ∪ obis_cells, joined to `datasets`, grouped) with **no tile-envelope predicate**; the `&& tile_envelope` test only happens in the final `mvtgeom` CTE (`tiles.js:151`). A map view fires 10–30 of these at once, so one pan ≈ 10–30 full-set aggregations. The trajectories endpoint was already rewritten to filter hexes by envelope *before* aggregating (`tiles.js:245-269`) — the main endpoint never got that fix.
2. **`/legend` runs two full-table aggregations with no spatial bound** (`web-api/routes/legend.js:141-194`) and it gates first map paint. Recomputed on every filter change.
3. **Catalog endpoints are recomputed every 5 minutes** although they only change on harvest (`/datasets`, `/platforms`, `/oceanVariables`, `/organizations`, `/obisNodes`, `/erddapServers` — default TTL in `web-api/utils/cache.js:30`). No `apicache.clear()` anywhere; no harvest-triggered invalidation. `/datasetRecordsList` is not cached at all.
4. **DB pool is the knex default (max 10), no statement timeout** (`web-api/db.js:12-21`). A tile burst exhausts it; a slow scan pins a connection indefinitely.
5. **No nginx `proxy_cache`** on the API path (`nginx/nginx.conf` only proxies), and redis `maxmemory` is 100 MB with `allkeys-lfu` (`redis-config/redis.conf`) — too small if tiles are cached.
6. **Incremental harvest takes the site down** — full derived-table rebuild under `AccessExclusiveLock`, every catalog route 504s for minutes. Full analysis and fix plan already in `docs/incremental-update-performance.md` (items A–E).

**Client:**

7. **Every map pan re-renders the entire app tree, including all ~60 dataset cards.** None of the five context provider `value` objects are memoized (`FilterProvider.jsx:608-655`, `MapStateProvider.jsx:133-158`, `SelectionProvider.jsx:315-347`); `moveend` → `setMapView` → new `MapStateProvider` value → everything below re-renders. `DatasetCard` is not `React.memo`-wrapped. `UrlSync` also rewrites the URL on every pan (`useUrlSync.js:30-46`).
8. **No request cancellation on the two big fetches.** `/pointQuery` (`SelectionProvider.jsx:224`) and `/legend` (`MapStateProvider.jsx:68`) use plain fetch with no `AbortController` — rapid filter edits race, last-to-resolve wins. `/griddapCoverage` (`MapStateProvider.jsx:102`) and `/scientificNames` already do it right; copy that pattern.
9. **`/pointQuery` payload is wide**: one row per dataset (~1.8k) including two bbox GeoJSON columns and columns the client never reads (`web-api/utils/shapeQuery.js:78-133`).
10. ~60 KB of static JSON (`platforms.json` 35 KB, `eovs.json` 23 KB) is bundled into the main chunk as lookup metadata; Google Fonts CSS is render-blocking.

## Implementation plan

### Phase 1 — Server hot path (biggest wins, no client change)

| # | Change | Files | Effort |
|---|--------|-------|--------|
| 1.1 | Push `ST_TileEnvelope(:z,:x,:y)` into the `combined` CTE: at hex zoom select envelope-intersecting hexes first and join cells to them (mirror `tiles.js:245-269`); at point zoom add `geom && envelope` to each UNION branch | `web-api/routes/tiles.js` | S–M |
| 1.2 | Add explicit knex `pool` (max ≈ 20–30, matched to PG `max_connections`), `statement_timeout` (~15 s), `acquireConnectionTimeout` | `web-api/db.js` | S |
| 1.3 | Legend: cache the **unfiltered** legend long-term (it's the first-paint one) and invalidate on harvest; keep the 5-min TTL only for filtered variants. Optionally bound the scan or precompute per-hex counts at harvest time | `web-api/routes/legend.js`, `utils/cache.js` | M |

Verify 1.1 with `EXPLAIN (ANALYZE, BUFFERS)` on a mid-zoom tile before/after, and by timing a cold pan in the network tab.

### Phase 2 — Caching with harvest invalidation (TODO: "Test redis caching refresh")

| # | Change | Files | Effort |
|---|--------|-------|--------|
| 2.1 | Long/indefinite TTL for the six catalog endpoints + `apicache.clear()` called at harvest completion (hook into the existing redis-refresh flow, `harvester/cde_harvester/redisFunctions.py`) | `web-api/utils/cache.js`, routes, harvester | M |
| 2.2 | Cache `/datasetRecordsList` (currently uncached) | `web-api/routes/datasetRecordsList.js` | S |
| 2.3 | Normalize cache keys (apicache `appendKey` with sorted query params) so param order doesn't fragment the tile cache | `web-api/utils/cache.js` | S |
| 2.4 | Raise redis `maxmemory` (≥ 512 MB) if tiles stay in redis; consider nginx `proxy_cache` for `/api/tiles/*` and catalog GETs as a cheaper edge layer | `redis-config/redis.conf`, `nginx/nginx.conf` | S–M |
| 2.5 | Proper HTTP caching: `ETag`/304 on catalog JSON, longer `Cache-Control` on tiles keyed to a harvest-version query param | `web-api` routes | M |

### Phase 3 — Client render pipeline (perceived speed; reduces client CPU)

| # | Change | Files | Effort |
|---|--------|-------|--------|
| 3.1 | `useMemo` all five provider `value` objects, `useCallback` their handlers | `src/state/*/**Provider.jsx` | M |
| 3.2 | Split map-camera state (`mapView`) out of `MapStateProvider` into its own context (or a ref + subscription) so panning doesn't re-render the sidebar/list | `src/state/map/MapStateProvider.jsx`, `useUrlSync.js` | M |
| 3.3 | `React.memo` on `DatasetCard`; keep the grow-on-scroll list, consider virtualization only if profiling still shows cost | `DatasetCard.jsx`, `DatasetsTable.jsx` | S |
| 3.4 | `AbortController` on `/pointQuery` and `/legend` (copy the `griddapCoverage` pattern at `MapStateProvider.jsx:100-114`) | `SelectionProvider.jsx`, `MapStateProvider.jsx` | S |
| 3.5 | Debounce/throttle the `UrlSync` `navigate(replace)` on map moves | `src/state/useUrlSync.js` | S |

Verify with React DevTools Profiler: a map pan should re-render ~0 sidebar components afterwards.

### Phase 4 — TODO-list bugs that live in this same code

| # | TODO item | Fix |
|---|-----------|-----|
| 4.1 | "Fix spinners and hide dataset count on load" | Gate the `Sidebar.jsx:133-141` count on `initialPointsQueryComplete`; count flashes 0/undefined because `totalNumberOfDatasets` comes from `/datasets` while `filteredCount` comes from `/pointQuery` |
| 4.2 | "Remove duplicated rows in dataset table" | Dedupe by `pk` where `pointsData` is set (`SelectionProvider.jsx:227-228`) — no dedup exists anywhere today; also worth checking whether `shapeQuery`'s GROUP BY can emit dataset dupes across source branches |
| 4.3 | "Review DB partial load … efficiency and stability" | This *is* `docs/incremental-update-performance.md` — treat items A–E there as their own workstream; item E (pool config, lock/statement timeouts) overlaps Phase 1.2 |

### Phase 5 — Payload & bundle trims (smaller, later)

- Trim the `shapeQuery.js` projection to columns the client actually reads (`grid_variables`, `wms_url` etc. only where needed).
- Move `platforms.json` / `eovs.json` out of the main chunk (dynamic `import()` or serve as static assets with long cache).
- Self-host or `preload` fonts; evaluate brotli at the edge.

## Suggested order

1. **1.1 + 1.2** — one PR, immediately measurable, no client risk.
2. **4.1 + 4.2** — quick release-blocker fixes, independent.
3. **3.1–3.5** — one client PR; profile before/after.
4. **Phase 2** — caching + harvest invalidation as one coherent PR (touches harvester flow).
5. **`docs/incremental-update-performance.md` A–E** — separate workstream; it fixes availability (504s during harvest), which no amount of caching can mask once the TTL expires mid-outage.
