#!/usr/bin/env node
/**
 * Requires a credit for every large binary asset: an image, audio, video, font, model, PDF or
 * archive larger than the limit (default 1 MiB) must have an entry in assets/credits.json with
 * where it came from and its license. Zero dependencies.
 *
 * Usage:
 *   node scripts/ci/check-assets.mjs <file>…              # these files
 *   node scripts/ci/check-assets.mjs --diff origin/main   # files changed since the merge base (CI)
 *   node scripts/ci/check-assets.mjs --all                # every tracked file (local audit)
 *   … --max-size 1MiB                                     # limit: bytes, or a number with KiB/MiB
 *   … --credits assets/credits.json                       # credits file (default shown)
 *   … --format github                                     # GitHub annotations instead of text
 *
 * assets/credits.json: { "version": 1, "assets": [{ "path": "<repo-relative path or glob>",
 * "source": "<URL or how it was made>", "license": "<SPDX id or license name>",
 * "author": "<optional>", "notes": "<optional>" }] }.
 * Exit 0 when every large asset is credited, 1 when one is not, 2 on a usage or credits-file error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ghEscapeData, ghEscapeProperty, globToRegExp, parseArgs, selectFiles } from './common.mjs';

export const DEFAULT_CREDITS = 'assets/credits.json';
export const DEFAULT_MAX_BYTES = 1024 * 1024;

/** Binary asset types that need a credit when large. SVG is text and reviewed as code. */
export const ASSET_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif',
  'mp4', 'webm', 'mov', 'wav', 'mp3', 'ogg',
  'pdf', 'zip',
  'ttf', 'otf', 'woff', 'woff2',
  'glb', 'gltf', 'fbx',
]);

const ENTRY_KEYS = new Set(['path', 'source', 'license', 'author', 'notes']);

/** @param {string} file */
export const isAsset = (file) => ASSET_EXTENSIONS.has(path.extname(file).slice(1).toLowerCase());

/**
 * Parses a size: plain bytes, or a number with KiB / MiB (also KB / MB, read as binary units).
 * @param {string} value
 */
export function parseSize(value) {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kib|kb|k|mib|mb|m)?$/i.exec(String(value).trim());
  if (!m) throw new Error(`invalid size "${value}" (bytes, or a number with KiB or MiB)`);
  const unit = (m[2] || 'b').toLowerCase();
  const factor = unit.startsWith('m') ? 1024 * 1024 : unit.startsWith('k') ? 1024 : 1;
  const bytes = Math.round(Number(m[1]) * factor);
  if (bytes <= 0) throw new Error(`size must be positive: "${value}"`);
  return bytes;
}

/**
 * Loads and validates the credits file. A missing file means no credits.
 * @param {string} file absolute path
 * @returns {{ path: string, source: string, license: string, author?: string, re: RegExp }[]}
 */
export function loadCredits(file) {
  if (!fs.existsSync(file)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${path.basename(file)}: not valid JSON (${err.message})`);
  }
  if (!data || data.version !== 1 || !Array.isArray(data.assets)) throw new Error(`${path.basename(file)}: expected { "version": 1, "assets": [] }`);
  return data.assets.map((entry, i) => {
    const where = `${path.basename(file)} assets[${i}]`;
    if (!entry || typeof entry !== 'object') throw new Error(`${where}: must be an object`);
    for (const key of Object.keys(entry)) if (!ENTRY_KEYS.has(key)) throw new Error(`${where}: unknown field "${key}"`);
    for (const key of ['path', 'source', 'license']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim()) throw new Error(`${where}: "${key}" is required`);
    }
    for (const key of ['author', 'notes']) {
      if (entry[key] !== undefined && typeof entry[key] !== 'string') throw new Error(`${where}: "${key}" must be a string`);
    }
    return { ...entry, re: globToRegExp(entry.path) };
  });
}

/**
 * Checks files under `root`. Returns the large assets without a credit.
 * @param {string[]} files repo-relative paths
 * @param {{ root: string, credits: ReturnType<typeof loadCredits>, maxBytes?: number }} options
 */
export function checkAssets(files, { root, credits, maxBytes = DEFAULT_MAX_BYTES }) {
  /** @type {{ file: string, size: number }[]} */
  const missing = [];
  let large = 0;
  for (const file of files) {
    if (!isAsset(file)) continue;
    let stat;
    try {
      stat = fs.lstatSync(path.join(root, file));
    } catch {
      continue; // deleted since it was listed
    }
    if (!stat.isFile() || stat.size <= maxBytes) continue;
    large += 1;
    if (!credits.some((c) => c.re.test(file))) missing.push({ file, size: stat.size });
  }
  return { missing, large };
}

const mib = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

/**
 * CLI entry. Returns the exit code.
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 */
export function main(argv, { cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  let args;
  let selection;
  let credits;
  let maxBytes;
  let creditsRel;
  try {
    args = parseArgs(argv, { 'max-size': undefined, credits: undefined });
    maxBytes = args.options['max-size'] ? parseSize(args.options['max-size']) : DEFAULT_MAX_BYTES;
    selection = selectFiles(args, cwd);
    const creditsFile = args.options.credits ? path.resolve(cwd, args.options.credits) : path.join(selection.root, DEFAULT_CREDITS);
    creditsRel = path.relative(selection.root, creditsFile).split(path.sep).join('/');
    credits = loadCredits(creditsFile);
  } catch (err) {
    stderr(`check-assets: ${err.message}`);
    return 2;
  }
  const { missing, large } = checkAssets(selection.files, { root: selection.root, credits, maxBytes });
  for (const m of missing) {
    const message = `${mib(m.size)} asset without a credit: add { "path", "source", "license" } for it to ${creditsRel}`;
    if (args.format === 'github') stdout(`::error file=${ghEscapeProperty(m.file)},title=${ghEscapeProperty('check-assets')}::${ghEscapeData(message)}`);
    else stdout(`${m.file}: ${message}`);
  }
  if (missing.length) {
    stdout(`check-assets: ${missing.length} of ${large} asset(s) over ${mib(maxBytes)} have no credit in ${creditsRel}.`);
    return 1;
  }
  stdout(`check-assets: ${large} asset(s) over ${mib(maxBytes)}, all credited.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
