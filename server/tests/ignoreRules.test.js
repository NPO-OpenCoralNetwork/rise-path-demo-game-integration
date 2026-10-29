/**
 * The root .gitignore and .vercelignore keep local env files, secrets carried between hosts and
 * learner data (exports, database dumps) out of git and out of `npm run vercel:deploy` uploads
 * (SECURITY.md, deploy/vercel/README.md). Templates and migrations stay committable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** git check-ignore by the ignore files alone (tracked or not): 0 ignored, 1 not ignored. */
const ignoreStatus = (file) => spawnSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: ROOT }).status;

describe('root ignore rules keep keys and learner data out', () => {
  it('git ignores local env files, secrets carried between hosts, exports and database dumps', () => {
    const out = ['.env', '.env.production', '.env.development', 'secrets.prod.env', 'secrets.prod.env.gpg',
      'exports/learners.csv', 'backups/db.tar', 'risepath.dump', 'risepath.sql', 'risepath.sql.gz', 'risepath.sql.zst'];
    for (const file of out) assert.equal(ignoreStatus(file), 0, `${file} is ignored`);
  });

  it('templates, migrations and the CI env template stay committable', () => {
    const kept = ['.env.example', 'ai-learning-diagnosis/.env.example', 'deploy/risepath-vm/stack.env.example',
      'deploy/risepath-vm/ci/stack.ci.env', 'server/migrations/021_example.sql', 'secrets.inventory.template'];
    for (const file of kept) assert.equal(ignoreStatus(file), 1, `${file} is not ignored`);
  });

  it('.vercelignore leaves the same files out of a CLI deploy (git status does not show them)', () => {
    const lines = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split(/\r?\n/).map((line) => line.trim());
    for (const pattern of ['.env', '.env.*', '*.env', '*.env.gpg', 'exports/', 'backups/', '*.dump', '*.sql.*', '/*.sql']) {
      assert.ok(lines.includes(pattern), `.vercelignore lists ${pattern}`);
    }
  });
});
