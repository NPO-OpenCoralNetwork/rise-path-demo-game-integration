#!/usr/bin/env node
/**
 * Report which secret *names* from secrets.inventory.template are SET / MISSING / PLACEHOLDER
 * in an env file. Never prints secret values.
 *
 * Usage:
 *   node scripts/verify-env-inventory.mjs
 *   node scripts/verify-env-inventory.mjs --scope rise-path
 *   node scripts/verify-env-inventory.mjs --scope nexloom --path /path/to/stack.env
 *   node scripts/verify-env-inventory.mjs --scope stack --path stack.env
 *   node scripts/verify-env-inventory.mjs --scope all
 *
 * Scopes (default: rise-path):
 *   rise-path — Mac .env.local (Rise Path + planned GCS keys)
 *   nexloom   — VM backend / Nexloom keys only
 *   stack     — Docker stack.env (DB_PASSWORD, AG_*, Nexloom, ASSET_*)
 *   all       — every key in inventory (expect many MISSING on .env.local)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV = path.join(ROOT, '.env.local');
const INVENTORY = path.join(ROOT, 'secrets.inventory.template');

const PLACEHOLDER_PATTERNS = [
  /^YOUR_/i,
  /your-project/i,
  /your-anon-key/i,
  /your-service-role-key/i,
  /your-gemini-api-key/i,
  /CHANGE_ME/i,
  /^\*\*\*$/,
  /placeholder/i,
];

/** Section title substring → scopes that include keys from this section */
const SECTION_SCOPES = [
  { match: 'Rise Path (.env.local)', scopes: ['rise-path', 'all'] },
  { match: 'Rise Path GCS', scopes: ['all'] },
  { match: 'Nexloom backend', scopes: ['nexloom', 'stack', 'all'] },
  { match: 'Docker stack', scopes: ['stack', 'all'] },
];

function parseArgs(argv) {
  let envPath = DEFAULT_ENV;
  let scope = 'rise-path';
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--path' && argv[i + 1]) {
      envPath = path.resolve(argv[++i]);
    } else if (argv[i] === '--scope' && argv[i + 1]) {
      scope = argv[++i];
    }
  }
  const valid = new Set(['rise-path', 'nexloom', 'stack', 'all']);
  if (!valid.has(scope)) {
    console.error(`Invalid --scope ${scope}. Use: rise-path | nexloom | stack | all`);
    process.exit(1);
  }
  return { envPath, scope };
}

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    out[key] = val;
  }
  return out;
}

function scopesForSection(line) {
  for (const { match, scopes } of SECTION_SCOPES) {
    if (line.includes(match)) return scopes;
  }
  return null;
}

function extractInventoryKeys(text, scope) {
  const keys = new Set();
  let activeScopes = null;

  for (const line of text.split('\n')) {
    const sectionScopes = scopesForSection(line);
    if (sectionScopes) {
      activeScopes = sectionScopes;
      continue;
    }
    if (!activeScopes) continue;
    if (!activeScopes.includes(scope)) continue;

    const m = line.match(/^#\s*([A-Z][A-Z0-9_]+)(?:=.*)?$/);
    if (m) keys.add(m[1]);
  }
  return [...keys].sort();
}

function classify(value) {
  if (value === undefined || value === '') return 'MISSING';
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(value))) return 'PLACEHOLDER';
  return 'SET';
}

async function main() {
  const { envPath, scope } = parseArgs(process.argv);

  let inventoryText;
  try {
    inventoryText = await fs.readFile(INVENTORY, 'utf8');
  } catch {
    console.error(`Cannot read ${INVENTORY}`);
    process.exit(1);
  }

  let envText = '';
  try {
    envText = await fs.readFile(envPath, 'utf8');
  } catch {
    console.error(`Env file not found: ${envPath}`);
    process.exit(1);
  }

  const keys = extractInventoryKeys(inventoryText, scope);
  const env = parseEnvFile(envText);

  console.log(`# Env inventory (no values) — scope=${scope}`);
  console.log(`# File: ${envPath}`);
  console.log(`# Keys in scope: ${keys.length}\n`);

  if (keys.length === 0) {
    console.error('No keys for this scope — check secrets.inventory.template sections');
    process.exit(1);
  }

  let missing = 0;
  let placeholder = 0;
  let set = 0;

  for (const key of keys) {
    const status = classify(env[key]);
    if (status === 'MISSING') missing++;
    else if (status === 'PLACEHOLDER') placeholder++;
    else set++;
    console.log(`${status.padEnd(12)} ${key}`);
  }

  console.log(`\nSummary: SET=${set} PLACEHOLDER=${placeholder} MISSING=${missing}`);
  if (missing > 0 || placeholder > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});