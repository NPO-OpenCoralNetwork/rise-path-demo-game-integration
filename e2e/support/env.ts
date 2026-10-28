// Where the end-to-end checks find the CI stack of scripts/ci/stack.sh. One source of truth: the CI
// env template (the stand-in's port, the db user and password). No override: the specs' SQL (the time
// nudge) runs only against the template's database on 127.0.0.1:5432, in Docker mode and host mode alike.
import fs from 'node:fs';

const text = fs.readFileSync(new URL('../../deploy/risepath-vm/ci/stack.ci.env', import.meta.url), 'utf8');
const ci: Record<string, string> = Object.fromEntries(
  text.split('\n').filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const authPort = Number(new URL(ci.SUPABASE_URL).port);
const authUrl = `http://127.0.0.1:${authPort}`;

export const E2E = {
  appUrl: 'http://127.0.0.1:4173',
  apiUrl: 'http://127.0.0.1:3006',
  authUrl,
  authPort,
  distDir: '.artifacts/e2e/dist',
  databaseUrl: `postgresql://${ci.POSTGRES_USER}:${ci.POSTGRES_PASSWORD}@127.0.0.1:5432/${ci.POSTGRES_DB}`,
  /** supabase-js's storage key: sb-<first label of the auth host>-auth-token (supabase-js index.mjs:206). */
  storageKey: `sb-${new URL(authUrl).hostname.split('.')[0]}-auth-token`,
  dayBudgetS: 480,
} as const;
