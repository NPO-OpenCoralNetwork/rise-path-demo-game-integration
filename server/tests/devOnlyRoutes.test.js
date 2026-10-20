// Dev-only routes: the /demo/* design samples, /preview and /dev/blocks are registered only in
// dev builds (import.meta.env.DEV), and their lazy views drop out of production bundles.
// Static checks on App.tsx and components/routes/lazyRoutes.tsx.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DEV_GUARD = '{import.meta.env.DEV &&';

/**
 * Splits JSX source into the parts inside `{import.meta.env.DEV && ...}` expressions and the rest.
 * Each guarded expression ends at the brace that balances its opening `{`.
 */
const splitDevGuarded = (src) => {
  let outside = '';
  const guarded = [];
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf(DEV_GUARD, i);
    if (start === -1) {
      outside += src.slice(i);
      break;
    }
    outside += src.slice(i, start);
    let depth = 0;
    let end = start;
    for (; end < src.length; end += 1) {
      if (src[end] === '{') depth += 1;
      else if (src[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    assert.ok(end < src.length, 'unbalanced braces after an import.meta.env.DEV guard');
    guarded.push(src.slice(start, end + 1));
    i = end + 1;
  }
  return { outside, guarded: guarded.join('\n') };
};

const routePaths = (src) => [...src.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

describe('dev-only routes', () => {
  const app = splitDevGuarded(read('App.tsx'));

  it('registers the /demo/* design samples only inside an import.meta.env.DEV guard', () => {
    const guardedDemo = routePaths(app.guarded).filter((p) => p.startsWith('/demo/'));
    assert.deepEqual(guardedDemo.sort(), ['/demo/:kind', '/demo/checklist-gen', '/demo/multi']);
    assert.deepEqual(routePaths(app.outside).filter((p) => p.startsWith('/demo')), []);
  });

  it('keeps /preview and /dev/blocks dev-only', () => {
    const outside = routePaths(app.outside);
    assert.ok(!outside.some((p) => p.startsWith('/preview')), '/preview must stay dev-only');
    assert.ok(!outside.includes('/dev/blocks'), '/dev/blocks must stay dev-only');
    const guarded = routePaths(app.guarded);
    assert.ok(guarded.includes('/preview/:courseSlug/:lessonId'));
    assert.ok(guarded.includes('/dev/blocks'));
  });

  it('still sends unknown paths (including /demo/* in production) to the catch-all redirect', () => {
    assert.ok(routePaths(app.outside).includes('*'));
  });

  it('drops the dev-only lazy views from production bundles', () => {
    const lazyRoutes = read('components/routes/lazyRoutes.tsx');
    for (const name of ['DevBlocksRoute', 'MultiFormatLessonView', 'BlenderChecklistGeneratorView']) {
      const pattern = new RegExp(`export const ${name} = lazy\\(\\s*\\(\\) => \\(import\\.meta\\.env\\.DEV \\? import\\(`);
      assert.match(lazyRoutes, pattern, `${name} must import its module only in dev builds`);
    }
  });
});
