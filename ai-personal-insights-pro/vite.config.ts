import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone AI Studio prototype (not part of the Rise Path build). It must not ship a model key:
// every `define` value is inlined into the browser bundle. The key slots are pinned to `undefined`
// so a GEMINI_API_KEY in the shell or .env.local can never be bundled. Model calls belong on the
// Rise Path server's gateway (/api/v2/llm); see README.md.
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  define: {
    'process.env.API_KEY': 'undefined',
    'process.env.GEMINI_API_KEY': 'undefined',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
