import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { fileURLToPath } from "node:url";

// The frontend image builds from the repo root to reach these.
const harvestDocs = fileURLToPath(
  new URL("../docs/harvesting", import.meta.url),
);

// Plotly's source registry requires its own (older) maplibre-gl CSS for map
// traces we never register. Bundled from source, that require becomes a global
// stylesheet on chunk load, and its `.maplibregl-map { position: relative }`
// collapses the app's map to zero height.
const dropPlotlyMaplibreCss = {
  name: "drop-plotly-maplibre-css",
  enforce: "pre",
  load(id) {
    return /\/plotly\.js\/node_modules\/maplibre-gl\/.*\.css$/.test(id)
      ? ""
      : null;
  },
};

export default defineConfig(({ mode }) => {
  // Deploy contract: plain env vars (Docker build args) read as process.env.*.
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };

  return {
    // Absolute, or on deep routes the SPA fallback serves index.html for the
    // misresolved bundle and the app never boots on reload.
    base: env.BASE_URL || "/",
    plugins: [
      react(),
      dropPlotlyMaplibreCss,
      process.env.ANALYZE &&
        visualizer({ filename: "dist/stats.html", open: true, gzipSize: true }),
      env.SENTRY_AUTH_TOKEN &&
        sentryVitePlugin({
          org: env.SENTRY_ORG,
          project: env.SENTRY_PROJECT,
          authToken: env.SENTRY_AUTH_TOKEN,
          release: { name: env.SENTRY_RELEASE },
          sourcemaps: { filesToDeleteAfterUpload: ["dist/**/*.map"] },
        }),
    ].filter(Boolean),
    resolve: { alias: { "@harvest-docs": harvestDocs } },
    define: {
      "process.env.API_URL": JSON.stringify(env.API_URL),
      "process.env.BASE_URL": JSON.stringify(env.BASE_URL || "/"),
      "process.env.SENTRY_DSN": JSON.stringify(env.SENTRY_DSN),
      "process.env.SENTRY_TRACES_SAMPLE_RATE": JSON.stringify(
        env.SENTRY_TRACES_SAMPLE_RATE,
      ),
      "process.env.ENVIRONMENT": JSON.stringify(env.ENVIRONMENT),
      "process.env.SENTRY_RELEASE": JSON.stringify(env.SENTRY_RELEASE),
    },
    server: {
      port: 8000,
      fs: { allow: [".", harvestDocs] },
      // The docker-compose nginx (NGINX_PORT), keeping dev same-origin on the
      // production /api path.
      proxy: {
        "/api": {
          target: env.DEV_API_PROXY_TARGET || "http://localhost:8098",
          changeOrigin: true,
        },
      },
    },
    // Inherits define{} above (API_URL from .env.test); without it src/config.js
    // throws at import.
    test: {
      environment: "jsdom",
      // renderWithProviders seeds state through window.history.
      environmentOptions: { jsdom: { url: "http://localhost:8000/" } },
      globals: true,
      setupFiles: ["./src/test/setup.js"],
      include: ["src/**/*.test.{js,jsx}"],
      // Parsing CSS is the single biggest cost in a jsdom run.
      css: false,
      // maplibre-gl needs WebGL, which jsdom lacks; map behaviour is e2e-tested.
      // Anchored: a bare key also rewrites maplibre-gl/dist/*.css, and the
      // failed transform silently drops Map.jsx from coverage.
      alias: [
        {
          find: /^maplibre-gl$/,
          replacement: new URL("./src/test/stubs/maplibre.js", import.meta.url)
            .pathname,
        },
      ],
      coverage: {
        provider: "v8",
        reportsDirectory: "./coverage",
        include: ["src/**/*.{js,jsx}"],
        exclude: ["src/test/**", "src/**/*.test.{js,jsx}", "src/locales/**"],
      },
    },
    build: {
      outDir: "dist",
      // Only Sentry consumes (then deletes) maps; otherwise they'd ship publicly
      // and cost ~0.8 GB of build memory.
      sourcemap: !!env.SENTRY_AUTH_TOKEN,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: "maplibre", test: /\/node_modules\/maplibre-gl\// },
              {
                name: "plotly",
                test: /\/node_modules\/plotly\.js-basic-dist-min\//,
              },
            ],
          },
        },
      },
    },
  };
});
