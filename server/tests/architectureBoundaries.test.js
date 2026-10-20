/**
 * Architecture boundaries (`npm run lint:arch`, also part of `npm test`). Code in a lower layer
 * must not import a higher one:
 *   shared/**                         ↛ server/**, tools/**, services/**, components/**
 *   tools/core/**, server/services/** ↛ server/routes/**, mcp-server/**
 *   components/**                     ↛ server/**
 * tools/core → server/services is allowed (the MCP tools reuse the server's domain services).
 *
 * Every import form counts: static import, `export … from`, dynamic import() with a string and
 * require(). Specifiers are found with TypeScript's preProcessFile (already a dev dependency),
 * which ignores comments and strings. Relative specifiers and the `@/` alias (repo root, see
 * tsconfig.json and vite.config.ts) are resolved; packages are not layers.
 *
 * Existing violations live in ALLOWED below, each with a TODO; remove an entry when its import
 * goes away (a stale entry fails the test).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist']);

/** @type {{ from: string, forbidden: string[] }[]} */
export const RULES = [
  { from: 'shared', forbidden: ['server', 'tools', 'services', 'components'] },
  { from: 'tools/core', forbidden: ['server/routes', 'mcp-server'] },
  { from: 'server/services', forbidden: ['server/routes', 'mcp-server'] },
  { from: 'components', forbidden: ['server'] },
];

/**
 * Known violations, as `<importing file> -> <imported path>` (repo-relative, as reported).
 * Each needs a TODO saying how it goes away. Empty: trunk has none.
 * @type {Record<string, string>}
 */
const ALLOWED = {};

/** @param {string} p repo-relative path @param {string} dir */
const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);

/** @param {string} dir repo-relative @returns {string[]} */
function sourceFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...sourceFiles(rel));
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Import specifiers of a source text with 1-based line numbers.
 * @param {string} text
 * @returns {{ specifier: string, line: number }[]}
 */
export function importsOf(text) {
  const { importedFiles } = ts.preProcessFile(text, true, true);
  return importedFiles.map((f) => ({ specifier: f.fileName, line: text.slice(0, f.pos).split('\n').length }));
}

/**
 * Resolves a specifier from `file` to a repo-relative path, or null for a package.
 * @param {string} file repo-relative importing file
 * @param {string} specifier
 */
export function resolveSpecifier(file, specifier) {
  let target = null;
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..') {
    target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  } else if (specifier.startsWith('@/')) {
    target = path.posix.normalize(specifier.slice(2));
  }
  return target === null ? null : target.replace(/\/$/, '');
}

/**
 * Boundary violations in one file's text.
 * @param {string} file repo-relative path
 * @param {string} text
 */
export function violationsIn(file, text) {
  const rules = RULES.filter((r) => under(file, r.from));
  if (!rules.length) return [];
  const out = [];
  for (const { specifier, line } of importsOf(text)) {
    const target = resolveSpecifier(file, specifier);
    if (target === null) continue;
    for (const rule of rules) {
      const layer = rule.forbidden.find((dir) => under(target, dir));
      if (layer) out.push({ file, line, specifier, target, rule: `${rule.from}/** must not import ${layer}/**` });
    }
  }
  return out;
}

const scanned = RULES.map((r) => r.from).flatMap(sourceFiles);
const violations = [...new Set(scanned)].flatMap((file) => violationsIn(file, fs.readFileSync(path.join(ROOT, file), 'utf8')));
const keyOf = (v) => `${v.file} -> ${v.target}`;

describe('architecture boundaries (lint:arch)', () => {
  it('scans the layers it guards', () => {
    for (const dir of ['shared', 'tools/core', 'server/services', 'components']) {
      assert.ok(scanned.some((f) => under(f, dir)), `found source files under ${dir}/`);
    }
  });

  it('no layer imports a layer above it (except the allowlisted TODOs)', () => {
    const unexpected = violations.filter((v) => !Object.hasOwn(ALLOWED, keyOf(v)))
      .map((v) => `${v.file}:${v.line} imports "${v.specifier}" (${v.rule})`);
    assert.deepEqual(unexpected, [], 'Move the shared logic down a layer (e.g. into shared/ or tools/core/) instead of importing upward.');
  });

  it('every allowlisted violation still exists and has a TODO', () => {
    const present = new Set(violations.map(keyOf));
    for (const [key, todo] of Object.entries(ALLOWED)) {
      assert.ok(present.has(key), `stale ALLOWED entry "${key}": the import is gone, remove the entry`);
      assert.match(todo, /^TODO\b/, `ALLOWED["${key}"] starts with TODO`);
    }
  });
});

describe('architecture boundary detection', () => {
  it('finds static, re-export, dynamic and require imports; ignores comments and strings', () => {
    const text = [
      "import a from '../../server/routes/x.js';",
      "export { b } from '../../mcp-server/y.js';",
      "const c = await import('../../server/routes/z.js');",
      "const d = require('../../mcp-server/w.cjs');",
      "// import e from '../../server/routes/comment.js';",
      "const f = \"import g from '../../server/routes/string.js'\";",
      "import h from '../../server/services/allowed.js';",
      "import i from 'express';",
    ].join('\n');
    const found = violationsIn('tools/core/example.js', text).map((v) => `${v.line}:${v.target}`);
    assert.deepEqual(found, ['1:server/routes/x.js', '2:mcp-server/y.js', '3:server/routes/z.js', '4:mcp-server/w.cjs']);
  });

  it('resolves the @/ alias and folder imports, and applies only the importing layer\'s rules', () => {
    assert.deepEqual(violationsIn('shared/lesson/x.js', "import s from '@/services/llmApi';").map((v) => v.target), ['services/llmApi']);
    assert.deepEqual(violationsIn('components/ui/X.tsx', "import s from '../../server';").map((v) => v.target), ['server']);
    assert.deepEqual(violationsIn('components/ui/X.tsx', "import s from '../../services/llmApi';"), []);
    assert.deepEqual(violationsIn('server/routes/x.js', "import s from '../../mcp-server/index.js';"), []);
    // "server-utils" is not under "server/".
    assert.deepEqual(violationsIn('shared/x.js', "import s from '../server-utils/a.js';"), []);
  });
});
