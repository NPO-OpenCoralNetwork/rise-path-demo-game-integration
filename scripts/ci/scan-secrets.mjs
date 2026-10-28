#!/usr/bin/env node
/**
 * Scans text files for committed secrets and absolute personal paths. Zero dependencies.
 *
 * Usage:
 *   node scripts/ci/scan-secrets.mjs <file>…              # these files
 *   node scripts/ci/scan-secrets.mjs --diff origin/main   # files changed since the merge base (CI)
 *   node scripts/ci/scan-secrets.mjs --all                # every tracked file (local audit)
 *   … --format github                                     # GitHub annotations instead of text
 *   … --allow <file>                                      # allowlist (default scripts/ci/scan-secrets.allow.json)
 *
 * Rules (ids are used in the allowlist): google-api-key, anthropic-api-key, openai-api-key,
 * openrouter-api-key, github-token, slack-token, figma-token, stripe-secret-key,
 * stripe-webhook-secret, cloudflare-tunnel-token, private-key, service-role-jwt,
 * absolute-personal-path. Values that
 * are obviously placeholders (a run of 8 identical characters, "example", "your_", …) are not
 * reported. Binary files (a NUL byte in the first 8000 bytes) and node_modules/ or dist/ are skipped.
 *
 * Output: file:line, rule id and a masked value — never the full secret. Exit 0 when clean,
 * 1 when anything is found, 2 on a usage or allowlist error.
 *
 * The allowlist is for known false positives only: { "entries": [{ "path": "<glob>",
 * "rule": "<rule id or *>", "reason": "<why this is not a secret>" }] }. A real secret is never
 * allowlisted: remove it, rotate it, and rewrite the history if it was pushed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ghEscapeData, ghEscapeProperty, globToRegExp, parseArgs, selectFiles } from './common.mjs';

export const DEFAULT_ALLOWLIST = 'scripts/ci/scan-secrets.allow.json';
/** Larger text files are reported as skipped instead of scanned. */
export const MAX_TEXT_BYTES = 32 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;

const TOKEN_CHAR = 'A-Za-z0-9_-';
const DASHES = '-'.repeat(5);

/** A value made of placeholders rather than a real key. */
export function isPlaceholder(value) {
  return /(.)\1{7,}/.test(value) || /example|placeholder|dummy|replace[_-]?me|your[_-]/i.test(value);
}

/** True when the string mixes digits, lower- and upper-case letters, as generated keys do. */
const looksGenerated = (s) => /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s);

/**
 * Masks a matched value: the first `keep` characters (a public prefix such as the key type), a
 * few asterisks and the length. The secret part is never printed.
 * @param {string} value
 * @param {number} keep
 */
export function maskValue(value, keep) {
  const shown = value.slice(0, Math.max(0, Math.min(keep, value.length - 4)));
  return `${shown}${'*'.repeat(8)} (${value.length} chars)`;
}

/**
 * @typedef {{ rule: string, index: number, masked: string }} Match
 * @typedef {{ id: string, description: string, find: (text: string) => Match[] }} Rule
 */

/**
 * A rule for a single-token secret.
 * @param {string} id
 * @param {string} description
 * @param {RegExp} re global regex; the whole match is the secret
 * @param {number} keep visible prefix length when masked
 * @param {(value: string) => boolean} [accept] extra check on the value
 * @returns {Rule}
 */
function tokenRule(id, description, re, keep, accept = () => true) {
  return {
    id,
    description,
    find(text) {
      const out = [];
      for (const m of text.matchAll(re)) {
        const value = m[0];
        if (isPlaceholder(value.slice(keep)) || !accept(value)) continue;
        out.push({ rule: id, index: m.index, masked: maskValue(value, keep) });
      }
      return out;
    },
  };
}

/** Decodes a JWT payload, or null when it is not JSON. */
function jwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const PEM_HEADER = new RegExp(`${DASHES}BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY( BLOCK)?${DASHES}`, 'g');
const PEM_META = /^(?:Proc-Type|DEK-Info|Comment|Version|Hash):/;
const BASE64_LINE = /^[A-Za-z0-9+/=]{16,}$/;

/**
 * Personal paths. Everything server/tests/docPaths.test.js forbids is matched here too (a home
 * folder or volume on macOS, a session temp dir, the sandbox home); Linux home folders are
 * generalised to any user name. The masked prefix is cut from the match, so this file holds none
 * of the paths it looks for (docPaths.test.js scans it as well).
 */
const PATH_PATTERNS = [
  { re: /\/(?:Users|Volumes)\/[A-Za-z0-9][^\s/'"`)\]}>,;:]*/g, prefix: (m) => m.slice(0, m.indexOf('/', 1) + 1) },
  { re: /\/tmp\/claude[^\s'"`)\]}>,;:]*/g, prefix: (m) => m.slice(0, m.indexOf('claude') + 'claude'.length) },
  // A Linux home folder at the start of a path (so URL paths such as https://host/home/news are
  // not reported), or the sandbox home exactly as docPaths.test.js matches it, anywhere.
  { re: /(?<![A-Za-z0-9._~%+-])\/home\/[A-Za-z0-9][A-Za-z0-9._-]*(?=\/|\b)|\/home\/user\//g, prefix: (m) => m.slice(0, 6) },
];

/** @type {Rule[]} */
export const RULES = [
  tokenRule('google-api-key', 'Google API key (AIza…)', new RegExp(`(?<![${TOKEN_CHAR}])AIza[${TOKEN_CHAR}]{35}(?![${TOKEN_CHAR}])`, 'g'), 4),
  tokenRule('anthropic-api-key', 'Anthropic API key (sk-ant-…)', new RegExp(`(?<![${TOKEN_CHAR}])sk-ant-[${TOKEN_CHAR}]{32,}`, 'g'), 7),
  tokenRule('openai-api-key', 'OpenAI-style project key (sk-proj-…, sk-svcacct-…, sk-admin-…)',
    new RegExp(`(?<![${TOKEN_CHAR}])sk-(?:proj|svcacct|admin)-[${TOKEN_CHAR}]{32,}`, 'g'), 8),
  // Legacy "sk-" + a long base62 run. Prose such as "sk-learn" is far shorter and not mixed-case.
  tokenRule('openai-api-key', 'OpenAI-style secret key (sk-…)', new RegExp(`(?<![${TOKEN_CHAR}])sk-[A-Za-z0-9]{32,}(?![${TOKEN_CHAR}])`, 'g'), 3,
    (value) => looksGenerated(value.slice(3))),
  tokenRule('github-token', 'GitHub token (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)',
    /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})(?![A-Za-z0-9_])/g, 4),
  tokenRule('slack-token', 'Slack token (xoxa-, xoxb-, xoxp-, xoxr-)', /(?<![A-Za-z0-9_-])xox[abpr]-[A-Za-z0-9-]{10,}/g, 5,
    (value) => /\d/.test(value.slice(5))),
  // OpenRouter keys (Hermes on the VM, OPENROUTER_API_KEY). The legacy OpenAI rule above misses
  // them: a dash follows "sk-or".
  tokenRule('openrouter-api-key', 'OpenRouter API key (sk-or-v1-…)', new RegExp(`(?<![${TOKEN_CHAR}])sk-or-v1-[A-Za-z0-9]{32,}`, 'g'), 6),
  // Figma personal access tokens. doc/guides/security_guidelines.md lists the prefix for reviews.
  tokenRule('figma-token', 'Figma personal access token (figd_…)', new RegExp(`(?<![${TOKEN_CHAR}])figd_[${TOKEN_CHAR}]{30,}`, 'g'), 5),
  // Cloudflare Tunnel tokens (TUNNEL_TOKEN in deploy/risepath-vm/tunnel.env): base64 of a JSON
  // object that starts with {"a": (account, tunnel id and the tunnel secret). Either base64
  // alphabet; "=" may come before it (TUNNEL_TOKEN=…).
  tokenRule('cloudflare-tunnel-token', 'Cloudflare Tunnel token (base64 JSON, eyJhIjoi…)',
    /(?<![A-Za-z0-9+/_-])eyJhIjoi[A-Za-z0-9+/_-]{60,}={0,2}/g, 3),
  // Stripe secret and restricted keys (test and live) and webhook signing secrets. Publishable
  // keys (pk_) are public. At least 20 key characters, so short test fixtures are not reported.
  tokenRule('stripe-secret-key', 'Stripe secret or restricted key (sk_test_, sk_live_, rk_test_, rk_live_)',
    /(?<![A-Za-z0-9_])[sr]k_(?:test|live)_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])/g, 8),
  tokenRule('stripe-webhook-secret', 'Stripe webhook signing secret (whsec_)', /(?<![A-Za-z0-9_])whsec_[A-Za-z0-9+/=]{20,}/g, 6),
  {
    id: 'private-key',
    description: 'PEM private key block',
    find(text) {
      const out = [];
      for (const m of text.matchAll(PEM_HEADER)) {
        // The header alone (in prose) is fine; a header followed by base64 is a key. JSON strings
        // hold the key with escaped newlines.
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 600).replace(/\\n/g, '\n');
        const next = after.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !PEM_META.test(l))[0] || '';
        if (!BASE64_LINE.test(next.replace(/["',]+$/, ''))) continue;
        out.push({ rule: 'private-key', index: m.index, masked: `${m[0]} ${'*'.repeat(8)}` });
      }
      return out;
    },
  },
  {
    id: 'service-role-jwt',
    description: 'JWT whose payload has role "service_role" (Supabase service key)',
    find(text) {
      const out = [];
      for (const m of text.matchAll(/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
        const payload = jwtPayload(m[0]);
        if (!payload || payload.role !== 'service_role') continue;
        out.push({ rule: 'service-role-jwt', index: m.index, masked: `${maskValue(m[0], 3)}, role service_role` });
      }
      return out;
    },
  },
  {
    id: 'absolute-personal-path',
    description: 'Absolute personal path (a home folder, a volume, a session temp dir)',
    find(text) {
      const out = [];
      for (const { re, prefix } of PATH_PATTERNS) {
        for (const m of text.matchAll(re)) out.push({ rule: 'absolute-personal-path', index: m.index, masked: `${prefix(m[0])}${'*'.repeat(3)}…` });
      }
      return out;
    },
  },
];

export const RULE_IDS = [...new Set(RULES.map((r) => r.id))];

/**
 * Scans text and returns findings with 1-based line numbers, sorted by position.
 * @param {string} text
 * @returns {{ rule: string, line: number, masked: string }[]}
 */
export function scanText(text) {
  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const lineOf = (index) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  return RULES.flatMap((rule) => rule.find(text))
    .sort((a, b) => a.index - b.index || a.rule.localeCompare(b.rule))
    .map(({ rule, index, masked }) => ({ rule, line: lineOf(index), masked }));
}

/** True when the buffer looks binary (git's heuristic: a NUL byte near the start). */
export const isBinary = (buf) => buf.subarray(0, BINARY_SNIFF_BYTES).includes(0);

/**
 * Loads and validates the allowlist. A missing file is an empty allowlist.
 * @param {string} file absolute path
 * @returns {{ path: string, rule: string, reason: string, re: RegExp }[]}
 */
export function loadAllowlist(file) {
  if (!fs.existsSync(file)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`allowlist ${file}: not valid JSON (${err.message})`);
  }
  if (!data || !Array.isArray(data.entries)) throw new Error(`allowlist ${file}: "entries" must be an array`);
  return data.entries.map((entry, i) => {
    const where = `allowlist ${path.basename(file)} entries[${i}]`;
    if (!entry || typeof entry.path !== 'string' || !entry.path) throw new Error(`${where}: "path" (a glob) is required`);
    if (typeof entry.rule !== 'string' || !(entry.rule === '*' || RULE_IDS.includes(entry.rule))) {
      throw new Error(`${where}: "rule" must be one of ${RULE_IDS.join(', ')} or *`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 10) throw new Error(`${where}: "reason" must say why (10+ characters)`);
    return { path: entry.path, rule: entry.rule, reason: entry.reason, re: globToRegExp(entry.path) };
  });
}

/**
 * Scans files under `root`.
 * @param {string[]} files repo-relative paths
 * @param {{ root: string, allowlist?: ReturnType<typeof loadAllowlist> }} options
 */
export function scanFiles(files, { root, allowlist = [] }) {
  /** @type {{ file: string, rule: string, line: number, masked: string }[]} */
  const findings = [];
  /** @type {{ file: string, reason: string }[]} */
  const skipped = [];
  let scanned = 0;
  let allowed = 0;
  for (const file of files) {
    const abs = path.join(root, file);
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      continue; // deleted since it was listed
    }
    if (!stat.isFile()) continue; // symlinks, submodules
    if (stat.size > MAX_TEXT_BYTES) {
      skipped.push({ file, reason: `larger than ${MAX_TEXT_BYTES} bytes` });
      continue;
    }
    const buf = fs.readFileSync(abs);
    if (isBinary(buf)) continue;
    scanned += 1;
    for (const f of scanText(buf.toString('utf8'))) {
      if (allowlist.some((a) => (a.rule === '*' || a.rule === f.rule) && a.re.test(file))) {
        allowed += 1;
        continue;
      }
      findings.push({ file, ...f });
    }
  }
  return { findings, skipped, scanned, allowed };
}

/** Counts findings per rule id. */
export const countByRule = (findings) =>
  findings.reduce((acc, f) => ({ ...acc, [f.rule]: (acc[f.rule] || 0) + 1 }), /** @type {Record<string, number>} */ ({}));

/**
 * CLI entry. Returns the exit code.
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [io]
 */
export function main(argv, { cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  let args;
  let selection;
  let allowlist;
  try {
    args = parseArgs(argv, { allow: undefined });
    selection = selectFiles(args, cwd);
    const allowFile = args.options.allow ? path.resolve(cwd, args.options.allow) : path.join(selection.root, DEFAULT_ALLOWLIST);
    allowlist = loadAllowlist(allowFile);
  } catch (err) {
    stderr(`scan-secrets: ${err.message}`);
    return 2;
  }
  const { findings, skipped, scanned, allowed } = scanFiles(selection.files, { root: selection.root, allowlist });
  for (const s of skipped) stderr(`scan-secrets: skipped ${s.file} (${s.reason})`);
  for (const f of findings) {
    if (args.format === 'github') {
      stdout(`::error file=${ghEscapeProperty(f.file)},line=${f.line},title=${ghEscapeProperty(`scan-secrets ${f.rule}`)}::${ghEscapeData(`${f.rule}: ${f.masked}`)}`);
    } else {
      stdout(`${f.file}:${f.line}: [${f.rule}] ${f.masked}`);
    }
  }
  const counts = Object.entries(countByRule(findings)).map(([rule, n]) => `${rule} ${n}`).join(', ');
  const allowedNote = allowed ? `, ${allowed} allowlisted` : '';
  if (findings.length) {
    stdout(`scan-secrets: ${findings.length} finding(s) in ${new Set(findings.map((f) => f.file)).size} file(s) (${counts}); ${scanned} text file(s) scanned${allowedNote}.`);
    stdout('Remove the value (rotate a real key), use a repo-relative path, or allowlist a proven false positive in ' + DEFAULT_ALLOWLIST + '.');
    return 1;
  }
  stdout(`scan-secrets: no findings in ${scanned} text file(s)${allowedNote}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
