# frontend/

(JS, ESM) — Vite + React 18 SPA with MapLibre GL 5; Context state composed in a load-bearing provider order in `src/state/AppProviders.jsx`; `API_URL`/`SENTRY_DSN` are build-time `define{}`s in `vite.config.mjs`, not runtime env.

## Requirements

**Every filter and UI-window element must be parametrizable via the URL** — a link reproduces the view; `src/state/useUrlSync.js` owns and writes the format (rebuilt on every map pan, so a param it doesn't derive must be named in `PRESERVED_PARAMS` to survive one), each provider seeds back from the address on load, and the modal and sidebar flags in `src/state/ui/UIProvider.jsx` don't meet this yet.

**Never build from scratch what a dependency already does** — reach for what is installed (`@turf/*`, `lodash-es`, `d3-scale`, `maplibre-gl`, `@mapbox/mapbox-gl-draw`, `react-data-table-component`, `react-plotly.js`, `react-bootstrap-icons`, `react-i18next`, `react-router-dom`), or a well-scoped new dependency, before writing custom code.

## Design work

UI design, critique and polish go through the `impeccable` skill. It isn't vendored here; install it user-level (`~/.claude/skills/impeccable`). Its committed context is `DESIGN.md`, `PRODUCT.md` and `.impeccable/design.json` at the repo root — keep them in sync with `src/components/theme.css`; per-machine state under `.impeccable/` stays untracked.

## Frontend-only dev

Another instance/machine already has the backend stack running — don't spin up a second one, point at theirs:

```sh
cd frontend && npm ci && API_URL=http://<their-host>:8098/api npm start
```
