import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const appBasePath = env.VITE_APP_BASE_PATH || '/';
    return {
      base: appBasePath,
      server: {
        port: 3007,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: 'http://localhost:3006',
            changeOrigin: true,
            secure: false,
          }
        },
        watch: {
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/public/uploads/**',
            '**/sample/**'
          ]
        }
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
              if (id.includes('@google/genai')) return 'genai';
              if (id.includes('lucide-react')) return 'icons';
              if (id.includes('react-router')) return 'router';
              if (id.includes('react-dom/') || id.includes('/react-dom/')) return 'react-vendor';
              if (id.includes('/react/') && !id.includes('react-router')) return 'react-vendor';
            },
          },
        },
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
