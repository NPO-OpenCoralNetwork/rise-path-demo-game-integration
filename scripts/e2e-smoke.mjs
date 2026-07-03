#!/usr/bin/env node
/**
 * Quick browser smoke test (Playwright CLI — not MCP).
 * Usage: node scripts/e2e-smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3007';
const API = process.env.E2E_API_URL || 'http://localhost:3006';

const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  let browser;
  try {
    const apiRes = await fetch(`${API}/api/v2/curricula`);
    const apiBody = await apiRes.json();
    record('API /api/v2/curricula', apiRes.status === 200 && apiBody?.ok === true, `status=${apiRes.status} count=${apiBody?.curricula?.length ?? '?'}`);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const response = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    record('Frontend GET /', response?.ok() ?? false, `status=${response?.status()}`);

    await page.waitForTimeout(2000);
    const title = await page.title();
    record('Page title', Boolean(title), title || '(empty)');

    const bodySnippet = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 120);
    record('Body rendered', bodySnippet.length > 20, bodySnippet || '(empty)');

    record('No fatal page errors', consoleErrors.length === 0, consoleErrors[0] || '');

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      process.exit(1);
    }
    console.log('\nAll smoke checks passed.');
  } catch (err) {
    console.error('❌ Smoke test failed:', err.message);
    process.exit(1);
  } finally {
    await browser?.close().catch(() => {});
  }
}

main();