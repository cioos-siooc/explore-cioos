# Map layer efficiency review — high zoom on low-resource clients

Companion to `docs/frontend-performance-plan.md`, which covers request latency and
React re-renders. This one is only about what the map itself does per frame and per
pan once you are zoomed in past ~z12, which is where the layer stack is at its
heaviest and where a low-end client feels it.

All claims below were checked against the installed renderer
(`maplibre-gl@5.24.0`, `node_modules/maplibre-gl/dist/maplibre-gl-dev.js`) rather
than assumed — line references to the bundle are given where the behaviour is
non-obvious.

## The stack as it stands

At z16 with tracks on, the style holds **~46 layers over 12 sources**:

| Group | Count | Layers |
|---|---|---|
| Basemap (`basemapStyle.js`) | 14 | background, bathymetry, imagery, nonna-100, nonna-10, water-tint, coastline-casing, coastline, waterway-stream, waterway, boundary, 3 × label |
| Data (`Map.jsx`) | 18 | points, points-halo, points-highlighted, points-hovered, hexes, hexes-hovered, coverage-hexes, coverage-hexes-hovered, 4 × griddap, 3 × track, 3 × selected-track |
| Draw control | 14 | the 7 styles at `Map.jsx:187-243`, which MapboxDraw duplicates into `.cold`/`.hot` (`@mapbox/mapbox-gl-draw/src/constants.js:19-20`) over 2 GeoJSON sources |

The layer *count* is not itself the problem — MapLibre skips hidden layers cheaply.
The cost is concentrated in four specific things, ordered below by what they will
actually buy you.

---

## 1. Interaction: ~18 hit-tests per mouse move, none throttled

**This is almost certainly what "too big to handle" feels like on a slow client.**

MapLibre implements `map.on(type, layerId, handler)` by installing a delegate that
runs its own `queryRenderedFeatures` on **every** raw event
(`maplibre-gl-dev.js:72093-72145`). Critically, `mouseleave` is not free either: it
installs a `mousemove` delegate that also queries, so every enter/leave pair costs
two queries per mouse move.

Map.jsx registers 9 delegated `mousemove` and 9 delegated `mouseleave` handlers:

```
points, hexes, coverage-hexes, track-heads, track-heads-fixed,
selected-track-fixes, selected-track-fixes-nocog, track-lines,
griddap-coverage-fill
```

That is **18 `queryRenderedFeatures` calls before a single handler body runs**.
Then the bodies add more, because the layer-precedence rules are implemented as
further queries:

- `isOnAPoint` (`Map.jsx:2004`) — queries `points`; called from the two track-head
  handlers and the track-line handler
- `griddapOutranksHexes` (`Map.jsx:2275`) — queries `griddap-coverage-fill`
- `griddapFeatureIsCovered` (`Map.jsx:2264`) — queries `points`+`hexes`, then
  `trackFeatureAt` queries 3 more layers
- the `coverage-hexes` handler queries `points` (`Map.jsx:2138`)
- the `track-lines` handler queries 5 layers (`Map.jsx:2231`)

Over dense coastline at z16 that is **20–25 full hit-tests per mousemove event**,
firing at up to the mouse's polling rate with no rAF throttle. Each one walks the
feature index of every loaded tile for those layers.

There is also a bare `map.on('mousemove', () => setHoveredDataset())`
(`Map.jsx:2082`) firing a React state setter on every mouse pixel.

### Fix

Collapse to **one** `mousemove` handler on the map that does **one**
`queryRenderedFeatures` over all interactive layers and dispatches by priority.
MapLibre 5 already accepts an array of layer ids per registration, so even a partial
consolidation helps, but a single handler is both faster and simpler than the
current arrangement — the precedence logic (`isOnAPoint`, `griddapOutranksHexes`,
`trackFeatureAt`) is *already* a hand-rolled priority sort, it just re-queries for
each comparison instead of sorting one result set.

Sketch:

```js
const INTERACTIVE = [
  'points', 'hexes', 'coverage-hexes',
  'track-heads', 'track-heads-fixed', 'track-lines',
  'selected-track-fixes', 'selected-track-fixes-nocog',
  'griddap-coverage-fill'
]

let queued = null
map.current.on('mousemove', (e) => {
  if (queued) return                      // coalesce to one per frame
  queued = requestAnimationFrame(() => {
    queued = null
    const layers = INTERACTIVE.filter((id) => map.current.getLayer(id))
    const hits = map.current.queryRenderedFeatures(e.point, { layers })
    dispatchHover(e, hits)                // existing precedence rules, on one array
  })
})
```

`dispatchHover` groups `hits` by `feature.layer.id` and applies the same rules that
exist today — `isOnAPoint` becomes a distance test over `hits` filtered to `points`,
`griddapOutranksHexes` becomes a presence test on the same array, and so on. The
`mouseleave` behaviour becomes "no hit for that group this frame", which removes the
9 extra delegated queries outright.

Expected: **20–25 hit-tests per event → 1 per frame.** By far the largest single win
here, and it touches no rendering.

---

## 2. Hover/focus re-parses every loaded tile in the worker

`hoverHighlightPoints` (`Map.jsx:598-677`) greys the map by calling `setFilter` and
`setPaintProperty`. Both force a full source reload:

- `Style.setFilter` → `_updateLayer` → `_updatedSources[layer.source] = 'reload'`
  (`maplibre-gl-dev.js:60690`, `60850-60857`)
- `StyleLayer.setPaintProperty` returns `isDataDriven || wasDataDriven || …`
  (`maplibre-gl-dev.js:23694`), so setting `circle-color` from the `colors`
  expression to the constant `'lightgrey'` — or back — *also* returns
  `requiresRelayout` and takes the same path

A "reload" re-sends every loaded tile of that source to the worker and rebuilds all
its buckets. The calls coalesce to one reload per source per update cycle, so each
focus change costs **a full re-parse of every visible `cde-tiles` and `cde-cells`
tile**.

That happens on:

- hovering any dataset row in the sidebar (`Map.jsx:918-933`)
- every `sourcedata` event while a focus is active (`Map.jsx:2437-2441`)
- every `idle` while a focus is active (`Map.jsx:2443-2450`)
- `setColorStops` on zoomend and on every legend refetch (`Map.jsx:567-595`)

The `appliedFocus` signature guard (`Map.jsx:621-628`) stops the loop from running
away but does not stop the reload when the focus genuinely changes — i.e. exactly
when the user is sweeping the dataset list.

### Fix

Use **feature-state**, which is what `griddap-coverage` already does correctly
(`Map.jsx:1557-1610`): `promoteId: 'pk'` on the source, and a `['feature-state', …]`
branch in the paint expression. Feature-state changes are applied GPU-side with no
worker round trip and no re-tessellation.

The flag has to be *which features are dimmed*, not *whether a focus is active*.
MapLibre 5.24 does support **global-state** expressions, and putting the
focus-active flag there looks tempting — but it does not help: a global-state change
that touches a paint property is applied by calling `_updatePaintProperty`
(`maplibre-gl-dev.js:59919-59922`), which is the same function that reports a
relayout for data-driven properties, so it lands right back on the reload path.
Encoding the whole decision in feature-state keeps the paint expression genuinely
static:

```js
// on the sources
map.current.addSource('cde-tiles', { type: 'vector', tiles: [tileQuery], promoteId: 'pk' })
map.current.addSource('cde-cells', { type: 'vector', tiles: [cellTileQuery], promoteId: 'pk' })

// static paint, set once at addLayer and never touched for focus
const IS_DIMMED = ['boolean', ['feature-state', 'dimmed'], false]
const dimmable = (color) => ['case', IS_DIMMED, 'lightgrey', color]
'circle-color': dimmable(colors)

// focus changes become:
map.current.removeFeatureState({ source: 'cde-tiles', sourceLayer: 'internal-layer-name' })
dimmedIds.forEach((id) =>
  map.current.setFeatureState(
    { source: 'cde-tiles', sourceLayer: 'internal-layer-name', id },
    { dimmed: true }
  ))
```

Deriving the ids still needs the `queryRenderedFeatures` pass at `Map.jsx:605-611`
(the `datasets` property is a JSON *string* in the MVT, so an `['in', …]` expression
would substring-match `"1"` against `"10"` — don't). It now collects the
*complement* — the features to grey rather than the ones to keep — which is a larger
list, but it is the same O(rendered features) walk that already happens, and it
replaces a worker re-parse of every loaded tile.

**This also lets three layers be deleted**: `points-hovered`, `hexes-hovered` and
`coverage-hexes-hovered` exist only to redraw the focused subset in colour over a
greyed base, which a feature-state branch on the base layer does directly. Three
fewer draw passes over every point on screen, and three fewer `setFilter` calls.

Two knock-on simplifications come with it. `setColorStops` no longer has to bail out
early and re-apply the focus to stop a ramp refresh from un-greying the map — the
grey now lives *inside* the ramp expression, so a refresh carries it through. And
`hexes` moves off the legacy `{ property, stops }` paint function onto a real
`interpolate` expression, because the legacy form cannot be nested inside a `case`
(the same constraint `coverageHexFillColor` already works around).

Ramp changes themselves — a legend refetch, or crossing a zoom band — still cost a
reload, because a genuinely different ramp is a genuinely different expression.
That is rare, and unrelated to hover.

---

## 3. NONNA tiles are fetched far past their real resolution

`nonna100` and `nonna10` are both declared `maxzoom: 17` (`basemapStyle.js:507-519`),
so at z16–17 MapLibre requests full-resolution tiles at every level — roughly 30
tiles per source per viewport, each a proxy round trip through
`web-api/routes/nonna.js` to CHS.

But the products are 100 m and 10 m grids. Ground resolution at 45°N is
`110692 / 2^z` m/px:

| z | m/px @45°N | |
|---|---|---|
| 10 | 108 | NONNA 100 fully resolved |
| 11 | 54 | NONNA 100 at 2× oversample |
| 13 | 13.5 | NONNA 10 fully resolved |
| 14 | 6.8 | NONNA 10 at 2× oversample |
| 16 | 1.7 | |
| 17 | 0.84 | |

Everything requested above those levels is GeoServer upsampling the same cells —
**no additional information, one HTTP request and one 256×256 texture each**.
MapLibre's own overzoom produces a near-identical image for free.

### Fix

```js
nonna100: { …, maxzoom: 11 },   // 100 m data; z11 is already 2× oversampled
nonna10:  { …, maxzoom: 14 },   // 10 m data; z14 is already 2× oversampled
```

At z16 this takes the pair from ~60 tile requests per viewport to ~6, and because
the coarse tiles cover 32×/4× more ground, panning stops re-triggering them almost
entirely. It relieves the client, the proxy, redis and CHS simultaneously.

Worth a visual check before merging, since you have been tuning this look
deliberately — the difference should be imperceptible, but `maxzoom: 12`/`15` is the
conservative fallback if the upsample reads softer than you like.

---

## 4. Invisible layers still cost full geometry work

MapLibre skips *painting* a layer whose opacity is 0 (`maplibre-gl-dev.js:64090` for
lines, `64214` for fills, `64553` for rasters) — but it does **not** skip parsing.
The worker only skips a layer when `isHidden(zoom)` is true, which tests
`minzoom`/`maxzoom`/`visibility` and nothing else
(`maplibre-gl-csp-worker-dev.js:23884-23890`, used at `43691`).

Four layers fade to opacity 0 but carry no `maxzoom`, so at every zoom above the
fade they are still fully tessellated on every tile:

| Layer | Opacity 0 from | Currently parsed to |
|---|---|---|
| `coastline-casing` | z12 | z17 |
| `coastline` | z12 | z17 |
| `water-tint` | z13 | z17 |
| `bathymetry` (EMODnet) | z12 | tiles still fetched at z12 parents |

The two coastline layers are the expensive ones: they tessellate the OSM `water`
source-layer into **line** buckets, which is the most costly geometry MapLibre
builds, twice, on every tile, over a coastal area dense with ponds, harbours and
river polygons — and then draws none of it.

### Fix

Add the `maxzoom` that matches the fade each layer already has. **Zero visual
change** — the layers are fully transparent at those zooms today:

```js
{ id: 'bathymetry',       …, maxzoom: 12 },
{ id: 'water-tint',       …, maxzoom: 13 },
{ id: 'coastline-casing', …, maxzoom: 12 },
{ id: 'coastline',        …, maxzoom: 12 },
```

On `bathymetry` this additionally stops EMODnet tiles being fetched and kept in the
source cache above z12, since a hidden layer marks its source unused.

This is the safest item in the review and should probably go in regardless of the
rest.

---

## 5. Data tiles are re-queried at every zoom level to z17

Neither `cde-tiles` nor `cde-cells` declares a `maxzoom` (`Map.jsx:1371-1378`), so
the vector-source default of 22 applies and the camera cap of 17
(`Map.jsx:1303`) is what bounds it. Every level from 7 to 17 fetches a fresh set of
~30 tiles, each one a PostGIS `ST_AsMVT` query.

The server returns the *same content* for all of those: `tiles.js:106-108` selects
individual points for any `z >= 7`. So z14–z17 are ~4× ~16× ~64× ~256× the queries
of z13 for identical data.

### Fix

```js
map.current.addSource('cde-tiles', { type: 'vector', tiles: [tileQuery], maxzoom: 14 })
map.current.addSource('cde-cells', { type: 'vector', tiles: [cellTileQuery], maxzoom: 14 })
```

Geometry precision is unaffected in practice: `ST_AsMVTGeom` at extent 4096 over a
z14 tile is ~0.42 m/unit at 45°N, finer than a z17 pixel (0.84 m). Circle radii are
evaluated at the real camera zoom, so points stay the right size, and
`queryRenderedFeatures` still clips to the viewport, so the polygon-selection path
(`Map.jsx:998-1030`) is unchanged.

This matters more than the raw tile count suggests, because every filter change
calls `setTiles` (`Map.jsx:365-368`), which drops the whole tile cache and refetches
from scratch. Fewer levels = a cheaper cold start after every filter edit.

Pairs naturally with item 1.1 of `frontend-performance-plan.md` (pushing the tile
envelope into the `combined` CTE) — that makes each query cheaper, this makes far
fewer of them.

---

## Smaller items

- **`raster-fade-duration`** defaults to 300 ms, during which both the old and new
  raster tiles are drawn. With three raster sources stacked, setting it to 0 on the
  NONNA layers cuts overdraw and lets parent tiles be released sooner.
- **`maxTileCacheSize`** on the map constructor is worth capping explicitly. With 12
  sources the default per-source cache is a real memory figure on a 4 GB client.
- **The draw control's 14 always-present layers** over 2 sources cost little (the
  sources are empty until someone draws) but they are 14 more entries the painter
  walks each frame. If drawing is rare, adding/removing the control on demand is an
  option — low priority.
- **`points` + `points-halo`** share a bucket (same layout, same filter, same
  zoom range) so the halo is cheap. Leave it.

---

## Suggested order

| # | Change | Risk | Payoff |
|---|---|---|---|
| 4 | `maxzoom` on the four faded-out basemap layers | none — provably no visual change | high (worker CPU per tile) |
| 1 | One rAF-throttled `mousemove` + one hit-test | low, mechanical | highest (interaction latency) |
| 3 | NONNA source `maxzoom` 11 / 14 | low, verify visually | high (network, proxy, CHS) |
| 5 | `cde-tiles`/`cde-cells` source `maxzoom` 14 | low | high (DB load, cold start) |
| 2 | Feature-state focus; drop 3 layers | medium — real refactor | high (hover jank) |

Items 3, 4 and 5 are one-line-each and independently revertible. Item 1 is a
consolidation that should leave behaviour identical. Item 2 is the only one that
restructures anything, and it removes more code than it adds.

## Status

All five are implemented, along with `raster-fade-duration: 0` on the two NONNA
layers. Two things to watch when this is next run against real data:

- **Item 3 is the one that can change how the map looks.** Overzoomed NONNA is
  MapLibre linearly upsampling a coarser texture, where before GeoServer rendered
  each level; cell edges may read softer at z15+. `maxzoom: 12` / `15` is the
  conservative fallback if so.
- **Item 2 normalises one inconsistency.** `points-highlighted` was created with
  `circle-stroke-width: 0.75` but restored to `1` after a focus cleared, so the
  selection ring quietly thickened the first time a dataset was hovered and
  unhovered. It is now `0.75` in both states.

The remaining "smaller items" (`maxTileCacheSize`, the draw control's 14 always-on
layers) are untouched.
