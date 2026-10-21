// Front-end calls to the API go through apiFetch (services/apiClient.ts), which adds the Supabase
// Bearer token (strict auth rejects calls without it) and the API base. A raw fetch to /api/v2
// skips both. Static scan of the .ts/.tsx files under services/, components/, context/ and hooks/
// (P-School and apiClient.ts itself excluded). Flagged:
//   - fetch( with a string or template that starts with /api/v2
//   - fetch(`${API_BASE}…`, or through a variable assigned exactly '/api/v2'
//   - a variable assigned exactly '/api/v2' that no such fetch uses (reported at the assignment)
// Other paths, such as the public GET /api/learning-portals, and external URLs are fine.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCAN_DIRS = ['services', 'components', 'context', 'hooks'];
const SKIP = new Set(['services/apiClient.ts', 'components/features/PSchool']);
const SOURCE_EXT = /\.tsx?$/;

const RAW_PATH = /\bfetch\(\s*(['"`])\/api\/v2(?![\w-])/g;
const BASE_VAR = /(?:\b(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(['"`])\/api\/v2\/?\2/g;
const VIA_VAR = /\bfetch\(\s*`\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;

/** @param {string} dir repo-relative @returns {string[]} */
function sourceFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (SKIP.has(dir) || !fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (entry.isFile() && SOURCE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts') && !SKIP.has(rel)) out.push(rel);
  }
  return out;
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;
// A match on a line that starts as a comment (`//`, `/*` or a JSDoc `*`) is prose, not a call.
const inComment = (text, index) => /^\s*(?:\/\/|\/\*|\*)/.test(text.slice(text.lastIndexOf('\n', index - 1) + 1, index));
const matchesOf = (re, text) => [...text.matchAll(re)].filter((m) => !inComment(text, m.index));

/**
 * Raw API calls in one file's text, with 1-based line numbers, in source order.
 * @param {string} text
 * @returns {{ line: number, rule: string }[]}
 */
export function rawApiCallsIn(text) {
  const out = matchesOf(RAW_PATH, text).map((m) => ({ index: m.index, rule: 'fetch to /api/v2' }));
  const baseVars = new Map(matchesOf(BASE_VAR, text).map((m) => [m[1], m.index]));
  const usedVars = new Set();
  for (const m of matchesOf(VIA_VAR, text)) {
    if (m[1] !== 'API_BASE' && !baseVars.has(m[1])) continue;
    usedVars.add(m[1]);
    out.push({ index: m.index, rule: `fetch through \${${m[1]}}` });
  }
  for (const [name, index] of baseVars) {
    if (!usedVars.has(name)) out.push({ index, rule: `${name} = '/api/v2'` });
  }
  return out.sort((a, b) => a.index - b.index).map(({ index, rule }) => ({ line: lineAt(text, index), rule }));
}

const scanned = SCAN_DIRS.flatMap(sourceFiles);

describe('front API calls go through apiFetch', () => {
  it('scans the front folders, without P-School and apiClient.ts', () => {
    for (const file of ['services/curriculumApi.ts', 'services/learningPortalApi.ts']) assert.ok(scanned.includes(file), file);
    for (const dir of ['components', 'context', 'hooks']) assert.ok(scanned.some((f) => f.startsWith(`${dir}/`)), `found files under ${dir}/`);
    assert.ok(!scanned.includes('services/apiClient.ts'));
    assert.ok(!scanned.some((f) => f.startsWith('components/features/PSchool/')));
  });

  it('no raw fetch to /api/v2 outside services/apiClient.ts', () => {
    const found = scanned.flatMap((file) =>
      rawApiCallsIn(fs.readFileSync(path.join(ROOT, file), 'utf8')).map((c) => `${file}:${c.line} ${c.rule}`));
    assert.deepEqual(found, [], "Call apiFetch('/…') from services/apiClient instead, so the request carries the Bearer token.");
  });
});

describe('raw API call detection', () => {
  it('finds string, template, API_BASE and base-variable calls; ignores comments', () => {
    const text = [
      "fetch('/api/v2/learner-profiles/latest');",
      'fetch(`/api/v2/curricula/${id}/resume`).then((r) => r.json());',
      'const res = await fetch(`${API_BASE}/curricula`);',
      "const base = '/api/v2';",
      'fetch(`${base}/curricula/${id}/weekly-digest`);',
      'fetch(\n  "/api/v2/upload", { method: "POST" });',
      "// fetch('/api/v2/comment')",
      ' * fetch(`${API_BASE}/jsdoc`)',
    ].join('\n');
    assert.deepEqual(rawApiCallsIn(text), [
      { line: 1, rule: 'fetch to /api/v2' },
      { line: 2, rule: 'fetch to /api/v2' },
      { line: 3, rule: 'fetch through ${API_BASE}' },
      { line: 5, rule: 'fetch through ${base}' },
      { line: 6, rule: 'fetch to /api/v2' },
    ]);
  });

  it('reports a /api/v2 variable that no fetch template uses', () => {
    assert.deepEqual(rawApiCallsIn("let root: string = '/api/v2/';\nfetch(root + '/x');"), [{ line: 1, rule: "root = '/api/v2'" }]);
  });

  it('allows apiFetch, other API paths, external URLs and the apiClient-style fallback', () => {
    const text = [
      "apiFetch('/curricula');",
      'apiFetch(`/curricula/${id}/encyclopedia`);',
      'fetch(`/api/learning-portals${query}`);',
      "fetch('https://example.com/api/v2/x');",
      'fetch(`${other}/x`);',
      "const API_ROOT = import.meta.env.VITE_API_BASE_URL || '/api/v2';",
      "if (path === '/api/v2') {}",
    ].join('\n');
    assert.deepEqual(rawApiCallsIn(text), []);
  });
});
