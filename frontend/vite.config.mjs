import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

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
        visualizer({ filename: 'dist/stats.html', open: true, gzipSize: true })
    ].filter(Boolean),
    define: {
      'process.env.API_URL': JSON.stringify(env.API_URL),
      'process.env.BASE_URL': JSON.stringify(env.BASE_URL || '/'),
      'process.env.SENTRY_TRACES_SAMPLE_RATE': JSON.stringify(
        env.SENTRY_TRACES_SAMPLE_RATE
      )
    },
    server: {
      port: 8000
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
