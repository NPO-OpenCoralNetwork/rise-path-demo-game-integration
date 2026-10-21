// vercel.json: the front runs on Vercel, the API stays on the VM behind https://api.<domain>.
// One `routes` entry proxies /api/*, cached TTS audio and generated images to ${API_ORIGIN} and
// sets x-origin-secret from ORIGIN_SECRET (Vercel docs, "Restricting your origin to Vercel
// traffic"); the API's origin gate rejects edge requests without it. Vercel places `routes` ahead
// of `headers`, and a matched route without `continue` ends routing, so the /api rewrite-caching
// flag is a `continue` route in front of the proxy route. The SPA fallback stays disjoint from the
// proxy route, and no VITE_ name or /uploads path may appear in the file.
// Static checks on vercel.json.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
const config = JSON.parse(raw);

const SHA = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);
const routes = config.routes || [];
// Vercel matches routes `src` case-insensitively.
const routeMatches = (route, p) => typeof route?.src === 'string' && new RegExp(route.src, 'i').test(p);

describe('vercel.json', () => {
  it('keeps the Vite build settings', () => {
    assert.equal(config.buildCommand, 'npm run build:prod');
    assert.equal(config.outputDirectory, 'dist');
    assert.equal(config.framework, 'vite');
  });

  describe('API proxy route', () => {
    const proxies = routes.filter((r) => 'dest' in r);
    const route = proxies[0] || {};
    const matches = (p) => routeMatches(route, p);

    it('is the one route with a dest, comes last, and no route uses the deprecated handle', () => {
      assert.equal(proxies.length, 1);
      assert.equal(routes.at(-1), route);
      assert.ok(routes.every((r) => !('handle' in r)));
      assert.ok(routes.slice(0, -1).every((r) => r.continue === true), 'only the proxy route may end routing');
    });

    it('proxies to ${API_ORIGIN} and sets x-origin-secret from ORIGIN_SECRET', () => {
      assert.equal(route.dest, '${API_ORIGIN}/$1');
      assert.deepEqual(route.env, ['API_ORIGIN']);
      assert.deepEqual(route.transforms, [
        {
          type: 'request.headers',
          op: 'set',
          target: { key: 'x-origin-secret' },
          args: '$ORIGIN_SECRET',
          env: ['ORIGIN_SECRET'],
        },
      ]);
    });

    it('matches the API and the media files the API writes', () => {
      for (const p of [
        '/api/v2/llm/tutor',
        '/api/learning-portals',
        `/audio/cache/${SHA}.mp3`,
        `/audio/cache/${SHA}.wav`,
        `/generated/img_${SHA}.jpg`,
        `/generated/img_${SHA}.png`,
        `/generated/img_${SHA}.webp`,
      ]) {
        assert.ok(matches(p), `${p} should go to the API`);
      }
    });

    it('does not proxy uploads, sidecars, other files or the app shell', () => {
      for (const p of [
        '/uploads/x.html',
        `/audio/cache/${SHA}.mp3.meta.json`,
        '/audio/cache/x.mp3',
        '/generated/other.png',
        `/generated/img_${SHA}.html`,
        '/assets/index.js',
        '/',
      ]) {
        assert.ok(!matches(p), `${p} should not go to the API`);
      }
    });
  });

  it('turns rewrite caching off for /api only, ahead of the proxy route', () => {
    const flagged = routes.filter((r) => r.headers?.['x-vercel-enable-rewrite-caching'] === '0');
    assert.equal(flagged.length, 1);
    const [flag] = flagged;
    assert.equal(flag.continue, true);
    assert.ok(routes.indexOf(flag) < routes.findIndex((r) => 'dest' in r));
    assert.ok(routeMatches(flag, '/api/v2/llm/tutor'));
    assert.ok(!routeMatches(flag, `/audio/cache/${SHA}.mp3`));
    assert.ok(!routeMatches(flag, `/generated/img_${SHA}.jpg`));
  });

  describe('SPA fallback rewrite', () => {
    const spa = (config.rewrites || []).filter((r) => r.destination === '/index.html');
    // Rewrites `source` is case-sensitive.
    const matches = (p) => new RegExp(`^${spa[0]?.source}$`).test(p);

    it('is a single rewrite to /index.html', () => {
      assert.equal(spa.length, 1);
      assert.equal(typeof spa[0].source, 'string');
    });

    it('matches deep links', () => {
      for (const p of ['/', '/claude-code', '/learn/vibe/ch1', '/generated-course/abc']) {
        assert.ok(matches(p), `${p} should get index.html`);
      }
    });

    it('leaves the API, build chunks and media to the route or a 404', () => {
      for (const p of ['/api/x', '/assets/x.js', '/audio/cache/x', '/generated/x']) {
        assert.ok(!matches(p), `${p} should not get index.html`);
      }
    });
  });

  it('keeps the frame and sniffing headers on every path', () => {
    const all = (config.headers || []).find((h) => h.source === '/(.*)');
    const value = (key) => all?.headers.find((h) => h.key === key)?.value;
    assert.equal(value('X-Frame-Options'), 'SAMEORIGIN');
    assert.equal(value('X-Content-Type-Options'), 'nosniff');
  });

  it('names no VITE_ variable and no uploads path', () => {
    assert.ok(!raw.includes('VITE_'), 'API_ORIGIN and ORIGIN_SECRET are server-side, never VITE_');
    assert.ok(!raw.includes('uploads'), 'user uploads are not served through the app origin');
  });
});
