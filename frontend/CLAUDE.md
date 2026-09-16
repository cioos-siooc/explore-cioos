# frontend/

(JS, ESM) — Vite + React 18 SPA with MapLibre GL 5; Context state composed in a load-bearing provider order in `src/state/AppProviders.jsx`; `API_URL`/`SENTRY_DSN` are build-time `define{}`s in `vite.config.mjs`, not runtime env.

## Requirements

**Every filter and UI-window element must be parametrizable via the URL** — a link reproduces the view. `src/state/useUrlSync.js` owns the format and is its only writer; each provider seeds back from the address on load; `useUrlSeededPersistentState` for state that is also a stored preference (the param beats localStorage); serialize only non-default values. `useUrlSync` rebuilds the whole search string on every map pan, so a param it neither derives nor names in `PRESERVED_PARAMS` is dropped. The modal and sidebar flags in `src/state/ui/UIProvider.jsx` don't meet this yet.

**Never build from scratch what a dependency already does.** Reach for what is installed before writing custom code — geometry from `@turf/*`, collections from `lodash-es`, scales from `d3-scale`, map and draw from `maplibre-gl` / `@mapbox/mapbox-gl-draw`, tables from `react-data-table-component`, plots from `react-plotly.js`, icons from `react-bootstrap-icons`, i18n from `react-i18next`, routing from `react-router-dom`. A well-scoped new dependency beats a hand-rolled equivalent; prefer both to a fourth variant of something the repo already solves.

## Frontend-only dev

Another instance/machine already has the backend stack running — don't spin up a second one, point at theirs:

```sh
cd frontend && npm ci && API_URL=http://<their-host>:8098/api npm start
```
