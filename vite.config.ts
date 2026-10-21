import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Model-provider keys and service-role keys must never reach the browser. VITE_* values are
// public by design, and any whole-object `import.meta.env` read inlines all of them, so these
// are forced to `undefined` in the client even if someone sets them. Keys belong on the server
// (GEMINI_API_KEY / ANTHROPIC_API_KEY, read by server/llm).
const CLIENT_SECRET_ENV = /^VITE_(?:GEMINI|GOOGLE|ANTHROPIC|CLAUDE|OPENAI)_\w*KEY$|^VITE_\w*SERVICE_ROLE\w*$/;

export default defineConfig(({ mode }) => {
    // Only VITE_* values are read here; never `define` server secrets into the bundle.
    const env = loadEnv(mode, '.', 'VITE_');
    const appBasePath = env.VITE_APP_BASE_PATH || '/';
    const secretEnvKeys = Object.keys(env).filter((key) => CLIENT_SECRET_ENV.test(key));
    if (secretEnvKeys.length) {
        console.warn(`[vite] Not exposing ${secretEnvKeys.join(', ')} to the client; model keys belong on the server.`);
    }
    return {
      base: appBasePath,
      server: {
        port: 3007,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            // Dev only: API_PROXY_TARGET points a second dev server at another API instance.
            target: process.env.API_PROXY_TARGET || 'http://localhost:3006',
            changeOrigin: true,
            secure: false,
          }
        },
        watch: {
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/uploads/**',
            '**/sample/**'
          ]
        },
        fs: {
          // Uploaded materials (server/uploads.js; public/uploads in older versions) sit inside the
          // project, which this server exposes on the network: never serve them. Vite's defaults
          // are kept, since setting the list replaces them.
          deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/uploads/**'],
        },
      },
      plugins: [react(), tailwindcss()],
      build: {
        chunkSizeWarningLimit: 600,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) return undefined;
              // Keep shared framework/icons on the critical path only.
              // Do NOT bucket lazy-only deps (mermaid, phaser, scratch-blocks, react-pdf):
              // forcing them into shared vendor chunks hoists them into the entry preload graph.
              if (id.includes('recharts') || id.includes('d3-')) return 'recharts';
              if (id.includes('lucide-react')) return 'icons';
              if (id.includes('react-router')) return 'router';
              if (id.includes('react-dom/') || id.includes('/react-dom/')) return 'react-vendor';
              if (id.includes('/react/') && !id.includes('react-router')) return 'react-vendor';
            },
          },
        },
      },
      define: Object.fromEntries(secretEnvKeys.map((key) => [`import.meta.env.${key}`, 'undefined'])),
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
