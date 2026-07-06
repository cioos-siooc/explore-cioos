# CDE Frontend

The frontend for the CIOOS Data Exploration (CDE) application, built with React and D3.

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

**Note**: This project uses a custom webpack configuration (not Create React App), so environment variables use `API_URL` instead of the `REACT_APP_API_URL` convention.

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

**Note**: The `API_URL` environment variable must be set at build time as it gets embedded into the webpack bundle via `DefinePlugin`.

**Sentry tracing**: `SENTRY_TRACES_SAMPLE_RATE` (also a build-time `DefinePlugin` value, `0.0`–`1.0`) controls the fraction of transactions Sentry traces. It is optional and defaults to `1.0` in development and `0.1` in production. Because it is embedded at build time, override it on the build command (e.g. `SENTRY_TRACES_SAMPLE_RATE=1.0 npm run build`) — not at runtime.

## Deployment to GitHub Pages

Deploy the frontend to GitHub Pages:

```sh
cd frontend
API_URL=https://explore.cioos.ca/api npm run deploy
```

## Technology Stack

- **React**: UI framework
- **D3.js**: Data visualization library
- **Webpack**: Module bundler
- **Babel**: JavaScript transpiler

## Project Structure

- `src/`: Source code
  - `components/`: React components
  - `d3/`: D3 visualization code
  - `assets/`: Static assets (data, images)
- `dist/`: Production build output (generated)
- `webpack.config.js`: Webpack configuration
- `.babelrc`: Babel configuration
