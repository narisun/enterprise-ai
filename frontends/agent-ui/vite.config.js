import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const rmPrepUrl        = env.VITE_AGENT_URL            || 'http://localhost:8003'
  const portfolioWatchUrl = env.VITE_PORTFOLIO_WATCH_URL || 'http://localhost:8004'

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        // More-specific routes must be declared BEFORE the general /api catch-all.

        // Portfolio Watch Agent (Morgan) — port 8004
        '/api/portfolio-watch': {
          target: portfolioWatchUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },

        // RM Prep Agent (Alex) — port 8003 — catch-all for remaining /api/* paths
        '/api': {
          target: rmPrepUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
    test: {
      // Use happy-dom for a lightweight browser-like environment.
      // All globals (describe, it, expect, vi, beforeEach, afterEach) are
      // injected automatically so test files need no explicit imports.
      environment: 'happy-dom',
      globals: true,
      // Only discover test files inside src/ — keeps test co-located with code
      include: ['src/**/*.test.{js,jsx}'],
    },
  }
})
