// Learner end-to-end checks (Phase 7; .github/workflows/e2e.yml job "Learner end-to-end";
// doc/brushup-2026/ai-access-plan.ja.md). The runner ships inside the installed playwright package
// (playwright/test). One worker: every request comes from one IP and the api allows 200 a minute per
// IP (server.js, globalLimiter). No retries: a failure keeps its screenshot, trace and the stack logs.
// Run it with the CI stack up: npm run e2e:local (all of it), or scripts/ci/stack.sh's steps, then npm run e2e.
import { defineConfig } from 'playwright/test';
import { resolveChromium } from './scripts/lessons/preview.mjs';
import { E2E } from './e2e/support/env.ts';

const executablePath = resolveChromium();

export default defineConfig({
  testDir: 'e2e',
  testMatch: /\.spec\.ts$/,
  outputDir: '.artifacts/e2e/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  globalTimeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ...(process.env.CI ? [['github'] as const] : []),
    ['html', { outputFolder: '.artifacts/e2e/report', open: 'never' }],
  ],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: E2E.appUrl,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    // Without the build, vite preview answers 404 and Playwright would wait out its timeout: say what is missing.
    command: `test -f ${E2E.distDir}/index.html || { echo "No production build in ${E2E.distDir}: run bash scripts/ci/stack.sh build-front" >&2; exit 1; }; `
      + `npx vite preview --outDir ${E2E.distDir} --host 127.0.0.1 --port ${new URL(E2E.appUrl).port} --strictPort`,
    url: `${E2E.appUrl}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { API_PROXY_TARGET: E2E.apiUrl },
  },
});
