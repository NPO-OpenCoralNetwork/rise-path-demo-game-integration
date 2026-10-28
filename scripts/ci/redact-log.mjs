#!/usr/bin/env node
// @ts-check
/**
 * Masks secret-shaped text in CI logs before they become artifacts (Phase 7; scripts/ci/stack.sh logs).
 * Every CI value is a committed dummy already; this keeps the habit for whatever a log prints.
 * It masks the values of secret-named keys of the given env files (*PASSWORD, *SECRET, *TOKEN, *_KEY,
 * DATABASE_URL*), JWT-shaped strings, Bearer tokens and URL passwords. Other values stay readable:
 * container names (risepath-ci-api-1), NODE_ENV=production, database names.
 *   node scripts/ci/redact-log.mjs [--env <file>]... < in > out
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Keys whose values are masked wherever they appear. */
export const SECRET_KEY = /(PASSWORD|SECRET|TOKEN|_KEY)$|^DATABASE_URL/;

/** @param {string} text @param {string[]} [values] */
export function redact(text, values = []) {
  let out = text;
  for (const value of [...new Set(values)].filter((v) => v.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(value).join('<value>');
  return out
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '<jwt>')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<token>')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:/@\s]+):[^@\s]+@/gi, '$1:<password>@');
}

/** The values of the secret-named KEY=VALUE lines of an env file. @param {string} file */
export function secretValues(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((line) => /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line))
    .filter((m) => m !== null && SECRET_KEY.test(m[1]))
    .map((m) => /** @type {RegExpExecArray} */ (m)[2].replace(/^["']|["']$/g, ''));
}

/** True when this file is the program node runs (a symlinked checkout path included). */
const isMain = () => {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMain()) {
  /** @type {string[]} */
  const values = [];
  for (let i = 2; i < process.argv.length; i += 1) if (process.argv[i] === '--env') values.push(...secretValues(process.argv[++i]));
  process.stdout.write(redact(fs.readFileSync(0, 'utf8'), values));
}
