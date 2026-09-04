import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig(({ mode }) => {
  // Keep the pre-Vite deploy contract: plain API_URL / BASE_URL /
  // SENTRY_TRACES_SAMPLE_RATE env vars (Docker build args) referenced in
  // source as process.env.* — injected here like webpack's DefinePlugin did.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }

  return {
    // Absolute base so the bundle URL resolves from the document root on
    // deep routes (e.g. /harvest/server/:slug); otherwise the SPA fallback
    // serves index.html for the misresolved bundle request and the app never
    // boots on reload. Matches the router basename (BASE_URL).
    base: env.BASE_URL || '/',
    plugins: [
      react(),
      // npm run build:analyze -> treemap of bundle composition
      process.env.ANALYZE &&
        visualizer({ filename: 'dist/stats.html', open: true, gzipSize: true }),
      // Sourcemap upload + release creation — only runs when a token is
      // configured (e.g. on the deploy host). Local/dev/PR builds without it
      // build exactly as before, with no upload attempt.
      env.SENTRY_AUTH_TOKEN &&
        sentryVitePlugin({
          org: env.SENTRY_ORG,
          project: env.SENTRY_PROJECT,
          authToken: env.SENTRY_AUTH_TOKEN,
          release: { name: env.SENTRY_RELEASE },
          sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] }
        })
    ].filter(Boolean),
    define: {
      'process.env.API_URL': JSON.stringify(env.API_URL),
      'process.env.BASE_URL': JSON.stringify(env.BASE_URL || '/'),
      'process.env.SENTRY_TRACES_SAMPLE_RATE': JSON.stringify(
        env.SENTRY_TRACES_SAMPLE_RATE
      ),
      'process.env.ENVIRONMENT': JSON.stringify(env.ENVIRONMENT),
      'process.env.SENTRY_RELEASE': JSON.stringify(env.SENTRY_RELEASE)
    },
    server: {
      port: 8000
    },
    // Vitest reads this file, so the unit suite inherits the define{} above —
    // without it src/config.js throws 'API_URL is not defined' at import and the
    // whole module graph fails to load. API_URL comes from .env.test, which
    // loadEnv picks up because vitest runs in mode 'test'.
    test: {
      environment: 'jsdom',
      // A fixed origin, because renderWithProviders seeds state through
      // window.history and the providers read it back off window.location.
      environmentOptions: { jsdom: { url: 'http://localhost:8000/' } },
      globals: true,
      setupFiles: ['./src/test/setup.js'],
      include: ['src/**/*.test.{js,jsx}'],
      // Component styles are irrelevant to assertions and parsing them is the
      // single biggest cost in a jsdom run.
      css: false,
      // LegendFooter imports AttributionControl/ScaleControl from maplibre-gl at
      // module scope, which needs a WebGL canvas jsdom does not have. Anything
      // that actually depends on map behaviour is covered by the e2e suite.
      alias: {
        'maplibre-gl': new URL('./src/test/stubs/maplibre.js', import.meta.url)
          .pathname
      },
      coverage: {
        provider: 'v8',
        reportsDirectory: './coverage',
        include: ['src/**/*.{js,jsx}'],
        exclude: ['src/test/**', 'src/**/*.test.{js,jsx}', 'src/locales/**']
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            maplibre: ['maplibre-gl'],
            plotly: ['plotly.js-basic-dist-min']
          }
        }
      }
    }
  }
})
