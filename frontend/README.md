# CDE Frontend

The frontend for the CIOOS Data Exploration (CDE) application, built with React, MapLibre GL and Vite.

**Requirements**: Node 22+ and a WebGL2-capable browser (MapLibre GL v5).

## Development

There are several ways to run the frontend for development:

### Option 1: With Docker Compose Backend (Recommended)

Run the frontend locally while using Docker Compose for all backend services:

1. From the project root, start all backend services:

   ```sh
   docker compose up -d
   ```

2. Start the frontend:

   ```sh
   cd frontend
   npm install
   npm start
   ```

3. Access the application at <http://localhost:8000>

### Option 2: With Remote API

Run only the frontend locally and connect to a remote API:

```sh
cd frontend
npm install
API_URL=https://your-remote-api.com/api npm start
```

Access the application at <http://localhost:8000>

**Note**: Environment variables use plain `API_URL` (not the `VITE_`/`REACT_APP_` prefix conventions) — they are injected at build time through `define{}` in `vite.config.js`. Local dev defaults live in `.env.development` (currently `API_URL=https://explore.cioos.ca/api`); a CLI value overrides it.

### Option 3: Full Docker Compose

Run everything in Docker including the frontend:

```sh
# From project root
docker compose up -d
```

Access the application at <http://localhost:8098>

## Production Build

Build the frontend for production deployment:

```sh
cd frontend
npm install
API_URL=https://your-api-url.com/api npm run build
```

The production build will be generated in the `dist` folder.

**Note**: The `API_URL` environment variable must be set at build time as it gets embedded into the bundle via Vite's `define` option.

**Sentry**: `SENTRY_DSN` (a build-time `define` value) both points the browser SDK at a project and switches it on — leave it empty and Sentry is inert. It is the same variable web-api uses, so one value covers both, but web-api reads it at runtime while this is embedded at build time: changing it needs a frontend rebuild, and the value is public in the shipped bundle.

**Sentry tracing**: `SENTRY_TRACES_SAMPLE_RATE` (also a build-time `define` value, `0.0`–`1.0`) controls the fraction of transactions Sentry traces. It is optional and defaults to `1.0` in development and `0.1` in production. Because it is embedded at build time, override it on the build command (e.g. `SENTRY_TRACES_SAMPLE_RATE=1.0 npm run build`) — not at runtime.

To inspect bundle composition, run `npm run build:analyze` — it writes and opens `dist/stats.html`.

## Tests

```sh
npm test            # vitest + Testing Library, jsdom
npm run test:e2e    # Playwright behaviour specs, API mocked from e2e/fixtures
npm run test:visual # screenshot baselines, 4 states x 3 viewports
npm run test:a11y   # axe, against the ratcheting e2e/a11y-baseline.json
npm run test:all    # all of the above
```

`test:visual` and `test:a11y` need Docker: they run through `e2e/in-container.sh`,
which is the same Playwright image CI uses. Both compare readings of a rendered
page, and the suite deliberately serves the webfonts empty so no screenshot
depends on a third-party asset — which leaves every family falling through to
`sans-serif`, a different physical face on each machine. A phone-width list then
holds a different number of cards, and axe, which can only judge contrast inside
the viewport, counts a different number of nodes. Recording on a host and
enforcing in CI does not work; these run where the numbers were taken.

Rewrite the baselines with `npm run test:visual:update` and
`npm run test:a11y:baseline` after reviewing what changed. The a11y file is a
to-do list of pre-existing violations: a rule missing from it fails immediately,
a baselined rule may only ever match fewer nodes, and the run says so when it
does. Refresh the API fixtures with `npm run test:e2e:record`.

## Map projections

The layer picker (top-right of the map) includes a **Globe view** toggle. The globe projection renders high latitudes — notably the Arctic — without Mercator distortion; MapLibre automatically transitions back to Mercator at high zoom levels. All data layers (hex bins, points, trajectories) work in both projections.

True polar stereographic projections (e.g. EPSG:3413) are not supported by MapLibre GL (Mercator and globe only). A dedicated polar view would require a different rendering stack (OpenLayers or Cesium) plus polar-projected tile sources.

## Technology Stack

- **React 18**: UI framework
- **MapLibre GL 5**: WebGL map rendering (globe + mercator projections)
- **Plotly.js**: Dataset preview charts (lazy-loaded)
- **Vite**: Build tool and dev server

## Project Structure

- `index.html`: Vite entry HTML (loads `src/index.jsx`)
- `src/`: Source code
  - `components/`: React components
  - `state/`: React context providers (filters, map, selection, download, UI)
  - `locales/`: Bundled EN/FR translations
- `dist/`: Production build output (generated)
- `vite.config.js`: Vite configuration (env injection, chunking)
