/**
 * Shared helpers for the zero-dependency CI guards in scripts/ci/ (scan-secrets.mjs,
 * check-assets.mjs): which files to check (explicit paths, files changed against a base ref, or
 * every tracked file), simple path globs, and GitHub annotation escaping. Node built-ins only.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Path segments that are never checked: dependencies and build output. */
export const SKIPPED_SEGMENTS = new Set(['node_modules', 'dist']);

/** @param {string} rel repo-relative path with forward slashes */
export const isSkippedPath = (rel) => rel.split('/').some((segment) => SKIPPED_SEGMENTS.has(segment));

/**
 * Runs git and returns stdout. Throws with git's message when it fails.
 * @param {string[]} args
 * @param {string} cwd
 */
export function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.error) throw new Error(`git ${args[0]}: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(res.stderr || '').trim()}`);
  return res.stdout;
}

/** @param {string} out NUL-separated git output */
const splitZ = (out) => out.split('\0').filter(Boolean);

/**
 * The repository root containing `cwd`, or `cwd` itself outside a git checkout.
 * @param {string} cwd
 */
export function repoRoot(cwd) {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return fs.realpathSync(res.status === 0 ? res.stdout.trim() : path.resolve(cwd));
}

/**
 * Files added, copied, modified or renamed since the merge base of `base` and HEAD, including
 * uncommitted changes and untracked (not ignored) files, so a local run also covers work that is
 * not committed yet. In CI the working tree is the checkout, so this is exactly
 * `git diff --name-only --diff-filter=ACMR <base>...HEAD`. Deleted files are left out.
 * @param {string} base a ref or commit id, e.g. origin/main
 * @param {string} root repository root
 * @returns {string[]} repo-relative paths, sorted
 */
export function changedFiles(base, root) {
  let mergeBase;
  try {
    mergeBase = git(['merge-base', base, 'HEAD'], root).trim();
  } catch (err) {
    throw new Error(`cannot diff against "${base}": no merge base with HEAD (is the ref fetched? CI needs fetch-depth: 0). ${err.message}`);
  }
  // --no-renames: a renamed file is reported as added, so no blob comparison is needed.
  const diff = splitZ(git(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACMR', mergeBase, '--'], root));
  const untracked = splitZ(git(['ls-files', '-z', '--others', '--exclude-standard'], root));
  return [...new Set([...diff, ...untracked])].sort();
}

/**
 * Every tracked file (for local audits).
 * @param {string} root
 */
export function trackedFiles(root) {
  return splitZ(git(['ls-files', '-z'], root)).sort();
}

/**
 * Turns a path glob into a RegExp over repo-relative paths: `**` matches any number of folders,
 * `*` anything but `/`, `?` one character but `/`. Everything else is literal.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[\\^$.|+(){}[\]]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Parses the options shared by the CI guards. Extra value options are declared in `valueOptions`
 * (name without dashes → default value); `--all`, `--diff <ref>` and `--format text|github` are
 * always known.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [valueOptions]
 */
export function parseArgs(argv, valueOptions = {}) {
  /** @type {{ paths: string[], diff: string | null, all: boolean, format: string, options: Record<string, string | undefined> }} */
  const out = { paths: [], diff: null, all: false, format: 'text', options: { ...valueOptions } };
  const known = new Set(['format', 'diff', ...Object.keys(valueOptions)]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      out.all = true;
      continue;
    }
    if (arg === '--') {
      out.paths.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = arg.slice(2, eq === -1 ? undefined : eq);
      if (!known.has(name)) throw new Error(`unknown option ${arg}`);
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || value === '') throw new Error(`--${name} needs a value`);
      if (name === 'format') out.format = value;
      else if (name === 'diff') out.diff = value;
      else out.options[name] = value;
      continue;
    }
    out.paths.push(arg);
  }
  if (!['text', 'github'].includes(out.format)) throw new Error(`unknown format "${out.format}" (text, github)`);
  const modes = [out.all, out.diff !== null, out.paths.length > 0].filter(Boolean).length;
  if (modes !== 1) throw new Error('give file paths, --diff <base-ref> or --all (exactly one)');
  return out;
}

/**
 * Resolves the files to check for parsed args: repo-relative, forward slashes, de-duplicated,
 * without node_modules/ and dist/. Explicit paths must exist.
 * @param {{ paths: string[], diff: string | null, all: boolean }} args
 * @param {string} cwd
 * @returns {{ root: string, files: string[] }}
 */
export function selectFiles(args, cwd) {
  const root = repoRoot(cwd);
  let files;
  if (args.all) files = trackedFiles(root);
  else if (args.diff !== null) files = changedFiles(args.diff, root);
  else {
    files = args.paths.map((p) => {
      const resolved = path.resolve(cwd, p);
      if (!fs.existsSync(resolved)) throw new Error(`no such file: ${p}`);
      // Real paths on both sides: git reports the root without symlinks (e.g. macOS /var → /private/var).
      const rel = path.relative(root, path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved)));
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`outside the repository: ${p}`);
      return rel.split(path.sep).join('/');
    });
  }
  return { root, files: [...new Set(files)].filter((f) => !isSkippedPath(f)) };
}

/** Escapes a GitHub workflow command value (`::error ...::<value>`). */
export const ghEscapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** Escapes a GitHub workflow command property (`file=`, `title=`). */
export const ghEscapeProperty = (s) => ghEscapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
