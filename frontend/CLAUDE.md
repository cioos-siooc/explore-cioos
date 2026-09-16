# frontend/

(JS, ESM) — Vite + React 18 SPA with MapLibre GL 5; Context state composed in a load-bearing provider order in `src/state/AppProviders.jsx`; `API_URL`/`SENTRY_DSN` are build-time `define{}`s in `vite.config.mjs`, not runtime env.

**Frontend-only dev** (another instance/machine already has the backend stack running — don't spin up a second one, point at theirs):

```sh
cd frontend && npm ci && API_URL=http://<their-host>:8098/api npm start
```
