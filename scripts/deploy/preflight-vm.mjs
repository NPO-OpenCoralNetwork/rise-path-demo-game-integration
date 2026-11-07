#!/usr/bin/env node
// @ts-check
/**
 * 事前チェック（preflight）の CLI (Phase 9, owner decision D2; doc/guides/first-launch.ja.md 13 章).
 * deploy/risepath-vm/scripts/preflight.sh runs it in the api's base image (node:22-slim) with no
 * network, a read-only file system, every capability dropped and the caller's uid, with the stack
 * folder mounted read-only at --stack and the host facts as one JSON object on stdin.
 *
 *   node preflight-vm.mjs --stack <dir> --mode prod|ci
 *
 * Reads stack.env, tunnel.env, mcp-public.env, billing.env, launch-record.env, ci/stack.ci.env (CI mode
 * only) and .deploy/last-green.json from <dir>, the env files' mode and owner, and the SHA-256 of
 * stack.env. A file that exists but cannot be read (root-owned after `sudo cp`) is A7 as an error, by
 * its name; a deploy record that cannot be read (the file or its `.deploy` folder) is A15 and still counts
 * as a green deploy (A13). Prints names, codes and Japanese fixes only, never a value.
 *
 * Exit: 0 no error (warnings allowed), 1 at least one error, 2 could not check (X3 CI mode with a file
 * that is not the CI template or lacks its dummy markers, X4 bad arguments or facts), 3 an exception
 * inside the check (X0, printed
 * without its message). Imports only node: built-ins and its two siblings (the container mounts
 * scripts/deploy alone).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPLOY_RECORD, ENV_FILES, INTERNAL_CODES, RECORD_FILE, checkStack, formatFindings, isCiDummyStack, resolveStage, validateFacts } from './preflight-rules.mjs';

/**
 * The lines of an internal code (the same shape as a finding's).
 * @param {string} code
 */
function internalLines(code) {
  const text = INTERNAL_CODES.find((x) => x.code === code);
  if (!text) return [];
  return [`❌ [${code}] ${text.title}`, `   直し方: ${text.fix}`, `   くわしく: 手順書 13 章の「${code}」`];
}

/**
 * --stack <dir> --mode prod|ci, each exactly once; anything else is null.
 * @param {string[]} argv
 * @returns {{ stack: string, mode: 'prod' | 'ci' } | null}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const seen = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag !== '--stack' && flag !== '--mode') || value === undefined || flag in seen) return null;
    seen[flag] = value;
  }
  const mode = seen['--mode'];
  if (!seen['--stack'] || (mode !== 'prod' && mode !== 'ci')) return null;
  return { stack: seen['--stack'], mode };
}

/** @param {unknown} error */
const errorCode = (error) => /** @type {{ code?: unknown }} */ (error)?.code;

/**
 * Reads one file of the stack folder: `absent` when there is no such file (ENOENT, or a path part that is
 * not a folder), `unreadable` when it, or a folder on its way, cannot be read by this user (EACCES, EPERM:
 * root-owned after `sudo`); never `fs.existsSync`, which answers false for a folder it may not search.
 * Anything else (a folder in its place …) throws (X0).
 * @param {string} file
 * @returns {{ state: 'absent' } | { state: 'unreadable' } | { state: 'read', text: string, mode: number, uid: number }}
 */
function readStackFile(file) {
  try {
    const st = fs.statSync(file);
    const text = fs.readFileSync(file, 'utf8');
    return { state: 'read', text, mode: st.mode, uid: st.uid };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'absent' };
    if (code === 'EACCES' || code === 'EPERM') return { state: 'unreadable' };
    throw error;
  }
}

/**
 * Runs the check and returns the exit code.
 * @param {{ argv: string[], stdinText: string, write: (line: string) => void }} io
 * @returns {number}
 */
export function runCli({ argv, stdinText, write }) {
  const args = parseArgs(argv);
  if (!args) {
    internalLines('X4').forEach(write);
    return 2;
  }
  /** @type {unknown} */
  let rawFacts;
  try {
    rawFacts = JSON.parse(stdinText);
  } catch {
    rawFacts = null;
  }
  const facts = validateFacts(rawFacts);
  if (!facts) {
    internalLines('X4').forEach(write);
    return 2;
  }
  try {
    const dir = args.stack;
    if (args.mode === 'ci') {
      // check-mode.sh compared the files already; the check repeats it from its own mount, and also
      // needs the template's own dummy markers (a template edited in the checkout opens nothing).
      const template = path.join(dir, 'ci', 'stack.ci.env');
      const stackEnv = path.join(dir, 'stack.env');
      if (!fs.existsSync(template) || !fs.existsSync(stackEnv) || !fs.readFileSync(template).equals(fs.readFileSync(stackEnv))
        || !isCiDummyStack(fs.readFileSync(stackEnv, 'utf8'))) {
        internalLines('X3').forEach(write);
        return 2;
      }
    }
    /** @type {Partial<Record<string, string>>} */
    const files = {};
    /** @type {Partial<Record<string, { mode: number, uid: number }>>} */
    const stats = {};
    /** @type {string[]} */
    const unreadable = [];
    for (const name of [...ENV_FILES, RECORD_FILE]) {
      const got = readStackFile(path.join(dir, name));
      if (got.state === 'unreadable') unreadable.push(name);
      if (got.state !== 'read') continue;
      stats[name] = { mode: got.mode, uid: got.uid };
      files[name] = got.text;
    }
    const green = readStackFile(path.join(dir, DEPLOY_RECORD));
    if (green.state === 'unreadable') unreadable.push(DEPLOY_RECORD);
    /** @type {{ stackEnvSha256?: string } | null} */
    let lastGreen = null;
    if (green.state === 'read') {
      lastGreen = {};
      try {
        const parsed = JSON.parse(green.text);
        if (parsed && typeof parsed.stackEnvSha256 === 'string' && /^[0-9a-f]{64}$/.test(parsed.stackEnvSha256)) {
          lastGreen = { stackEnvSha256: parsed.stackEnvSha256 };
        }
      } catch {
        // A damaged record still counts as "a green deploy happened" (A13).
      }
    }
    const stackEnvSha256 = files['stack.env'] === undefined
      ? undefined
      : crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'stack.env'))).digest('hex');
    const findings = checkStack({ mode: args.mode, files, stats, unreadable, facts, lastGreen, stackEnvSha256, now: new Date() });
    // A record the deploy user cannot read is said as such in the header (A7 follows), never as missing.
    const { stage, source } = resolveStage(files[RECORD_FILE], unreadable.includes(RECORD_FILE));
    formatFindings(findings, { mode: args.mode, stage, source }).forEach(write);
    return findings.some((f) => f.level === 'E') ? 1 : 0;
  } catch {
    // Never the message: it may quote a file's content.
    internalLines('X0').forEach(write);
    return 3;
  }
}

const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  /** @type {string} */
  let stdinText = '';
  try {
    stdinText = fs.readFileSync(0, 'utf8');
  } catch {
    stdinText = '';
  }
  process.exitCode = runCli({ argv: process.argv.slice(2), stdinText, write: (line) => process.stdout.write(`${line}\n`) });
}
