// vercel.json: the front runs on Vercel, the API stays on the VM behind https://api.<domain>.
// Everything is one `routes` list (no top-level `rewrites` or `headers`), in this order:
// continue routes for the /api rewrite-caching flag and the site headers, the /api proxy, then
// `handle: filesystem`, the media proxy and the SPA fallback. Both proxies send to ${API_ORIGIN}
// and set x-origin-secret from ORIGIN_SECRET (Vercel docs, "Restricting your origin to Vercel
// traffic"); the API's origin gate rejects edge requests without it. /api never touches the
// filesystem, while the media proxy runs after it, so the images committed in public/generated
// stay static. The docs list `handle` as deprecated, but it is still accepted, and `rewrites`
// cannot carry `env` or `transforms`. No VITE_ name or /uploads path may appear in the file.
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

const fsIndex = routes.findIndex((r) => r.handle === 'filesystem');
const isProxy = (r) => typeof r.dest === 'string' && r.dest.startsWith('${API_ORIGIN}/');
const apiProxy = routes.find((r, i) => isProxy(r) && i < fsIndex) || {};
const mediaProxy = routes.find((r, i) => isProxy(r) && i > fsIndex) || {};
const spa = routes.find((r) => r.dest === '/index.html') || {};

const ORIGIN_SECRET_TRANSFORM = {
  type: 'request.headers',
  op: 'set',
  target: { key: 'x-origin-secret' },
  args: '$ORIGIN_SECRET',
  env: ['ORIGIN_SECRET'],
};

describe('vercel.json', () => {
  it('keeps the Vite build settings', () => {
    assert.equal(config.buildCommand, 'npm run build:prod');
    assert.equal(config.outputDirectory, 'dist');
    assert.equal(config.framework, 'vite');
  });

  describe('route order', () => {
    it('uses routes only, with no top-level rewrites, headers or redirects', () => {
      for (const key of ['rewrites', 'headers', 'redirects', 'cleanUrls', 'trailingSlash']) {
        assert.ok(!(key in config), `${key} would be merged around the routes`);
      }
    });

    it('has one filesystem handle between the /api proxy and the media proxy', () => {
      assert.deepEqual(
        routes.filter((r) => 'handle' in r),
        [{ handle: 'filesystem' }],
      );
      assert.equal(routes.filter(isProxy).length, 2);
      assert.ok(routes.indexOf(apiProxy) >= 0 && routes.indexOf(apiProxy) < fsIndex);
      assert.equal(routes.indexOf(mediaProxy), fsIndex + 1);
      assert.equal(routes.at(-1), spa);
    });

    it('ends routing before the filesystem only at the /api proxy', () => {
      const beforeFs = routes.slice(0, fsIndex);
      assert.equal(beforeFs.at(-1), apiProxy);
      assert.ok(beforeFs.slice(0, -1).every((r) => r.continue === true && !('dest' in r)));
      assert.ok(routes.slice(fsIndex + 1).every((r) => !r.continue));
    });

    it('lets the committed public/generated images reach the filesystem', () => {
      const dir = path.join(ROOT, 'public/generated');
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('img_')) : [];
      for (const f of files) {
        const p = `/generated/${f}`;
        assert.ok(!routes.slice(0, fsIndex).some((r) => !r.continue && routeMatches(r, p)), `${p} ends routing before the filesystem`);
      }
    });
  });

  describe('proxy routes', () => {
    it('both proxy to ${API_ORIGIN} and set x-origin-secret from ORIGIN_SECRET', () => {
      for (const route of [apiProxy, mediaProxy]) {
        assert.equal(route.dest, '${API_ORIGIN}/$1');
        assert.deepEqual(route.env, ['API_ORIGIN']);
        assert.deepEqual(route.transforms, [ORIGIN_SECRET_TRANSFORM]);
      }
    });

    it('send the API to the /api proxy and the media files the API writes to the media proxy', () => {
      for (const p of ['/api/v2/llm/tutor', '/api/learning-portals']) {
        assert.ok(routeMatches(apiProxy, p), `${p} should go to the API`);
        assert.ok(!routeMatches(mediaProxy, p), `${p} should not reach the media proxy`);
      }
      for (const p of [
        `/audio/cache/${SHA}.mp3`,
        `/audio/cache/${SHA}.wav`,
        `/generated/img_${SHA}.jpg`,
        `/generated/img_${SHA}.png`,
        `/generated/img_${SHA}.webp`,
      ]) {
        assert.ok(routeMatches(mediaProxy, p), `${p} should go to the API after the filesystem`);
        assert.ok(!routeMatches(apiProxy, p), `${p} should not skip the filesystem`);
      }
    });

    it('do not proxy uploads, sidecars, other files or the app shell', () => {
      for (const p of [
        '/uploads/x.html',
        `/audio/cache/${SHA}.mp3.meta.json`,
        '/audio/cache/x.mp3',
        '/generated/other.png',
        `/generated/img_${SHA}.html`,
        '/assets/index.js',
        '/',
      ]) {
        assert.ok(!routeMatches(apiProxy, p) && !routeMatches(mediaProxy, p), `${p} should not go to the API`);
      }
    });
  });

  it('turns rewrite caching off for /api only, ahead of the /api proxy', () => {
    const flagged = routes.filter((r) => r.headers?.['x-vercel-enable-rewrite-caching'] === '0');
    assert.equal(flagged.length, 1);
    const [flag] = flagged;
    assert.equal(flag.continue, true);
    assert.ok(routes.indexOf(flag) < routes.indexOf(apiProxy));
    assert.ok(routeMatches(flag, '/api/v2/llm/tutor'));
    assert.ok(!routeMatches(flag, `/audio/cache/${SHA}.mp3`));
    assert.ok(!routeMatches(flag, `/generated/img_${SHA}.jpg`));
  });

  describe('SPA fallback route', () => {
    const matches = (p) => routeMatches(spa, p);

    it('is a single route to /index.html after the filesystem', () => {
      assert.equal(routes.filter((r) => r.dest === '/index.html').length, 1);
      assert.equal(typeof spa.src, 'string');
      assert.ok(routes.indexOf(spa) > fsIndex);
    });

    it('matches deep links', () => {
      for (const p of [
        '/',
        '/claude-code',
        '/learn/vibe/ch1',
        '/learn/claude-code/cc-01-first-session',
        '/p-school',
        '/auth/callback',
        '/generated-course/abc',
      ]) {
        assert.ok(matches(p), `${p} should get index.html`);
      }
    });

    it('leaves the API, build chunks and media to the proxies or a 404', () => {
      for (const p of ['/api/x', '/API/x', '/assets/x.js', '/audio/cache/x', '/generated/x']) {
        assert.ok(!matches(p), `${p} should not get index.html`);
      }
    });
  });

  it('keeps the frame and sniffing headers on every path', () => {
    const all = routes.find((r) => r.src === '^/(.*)$' && r.headers);
    assert.equal(all?.continue, true);
    assert.equal(all.headers['X-Frame-Options'], 'SAMEORIGIN');
    assert.equal(all.headers['X-Content-Type-Options'], 'nosniff');
    assert.ok(routes.indexOf(all) < routes.indexOf(apiProxy), 'set before any route ends routing');
  });

  it('names no VITE_ variable and no uploads path', () => {
    assert.ok(!raw.includes('VITE_'), 'API_ORIGIN and ORIGIN_SECRET are server-side, never VITE_');
    assert.ok(!raw.includes('uploads'), 'user uploads are not served through the app origin');
  });
});
