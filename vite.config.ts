import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Model-provider keys and service-role keys must never reach the browser. VITE_* values are
// public by design, and any whole-object `import.meta.env` read inlines all of them, so these
// are forced to `undefined` in the client even if someone sets them. Keys belong on the server
// (GEMINI_API_KEY / ANTHROPIC_API_KEY, read by server/llm). No Stripe value at all: the client
// only calls /api/v2/billing (Stripe keys live in billing.env on the server).
const CLIENT_SECRET_ENV = /^VITE_(?:GEMINI|GOOGLE|ANTHROPIC|CLAUDE|OPENAI)_\w*KEY$|^VITE_\w*SERVICE_ROLE\w*$|^VITE_STRIPE_\w*$/;

export default defineConfig(({ mode }) => {
    // Only VITE_* values are read here; never `define` server secrets into the bundle.
    const env = loadEnv(mode, '.', 'VITE_');
    const appBasePath = env.VITE_APP_BASE_PATH || '/';
    const secretEnvKeys = Object.keys(env).filter((key) => CLIENT_SECRET_ENV.test(key));
    if (secretEnvKeys.length) {
        console.warn(`[vite] Not exposing ${secretEnvKeys.join(', ')} to the client; model keys belong on the server.`);
    }
    // Set by the legal-release-guard plugin once Vite has resolved the config (null until then).
    const legalGuard: { clientIsDev: boolean | null } = { clientIsDev: null };
    return {
      base: appBasePath,
      server: {
        port: 3007,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            // Dev, and vite preview in the end-to-end checks (preview inherits server.proxy; playwright.config.ts).
            // API_PROXY_TARGET points a second dev server, or that preview, at another API instance.
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
            '**/public/uploads/**',
            '**/sample/**'
          ]
        }
      },
      plugins: [
        react(),
        tailwindcss(),
        // Phase 4: a build that publishes the legal pages (VITE_FEATURE_LEGAL_PAGES=true, from a .env
        // file or the host's env, e.g. Vercel) stops while the text is a draft or not archived. The
        // problem list comes from scripts/legal/check-legal-release.mjs. Dev servers are not affected.
        // A build whose client gets import.meta.env.DEV = true (NODE_ENV=development, or a .env file
        // with NODE_ENV=development) would ship the draft text through the DEV branch of
        // components/routes/lazyRoutes.tsx, so it stops too, unless LEGAL_DRAFT_PREVIEW_BUILD=true
        // says it is a local draft preview that is never deployed.
        {
          name: 'legal-release-guard',
          apply: 'build',
          configResolved(config) {
            legalGuard.clientIsDev = !config.isProduction;
          },
          async buildStart() {
            if (legalGuard.clientIsDev !== false && process.env.LEGAL_DRAFT_PREVIEW_BUILD !== 'true') {
              this.error(
                `This build gives the client import.meta.env.DEV = true (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}), so /terms and /privacy would ship the draft legal text. ` +
                  'Build with NODE_ENV=production (npm run build:prod), or set LEGAL_DRAFT_PREVIEW_BUILD=true for a local draft preview that is never deployed.',
              );
            }
            if (env.VITE_FEATURE_LEGAL_PAGES !== 'true') return;
            const { legalReleaseProblems } = await import('./scripts/legal/check-legal-release.mjs');
            const problems = await legalReleaseProblems({ root: path.resolve(__dirname) });
            if (problems.length) this.error(`VITE_FEATURE_LEGAL_PAGES=true but the legal text is not publishable:\n- ${problems.join('\n- ')}`);
          },
        },
      ],
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
