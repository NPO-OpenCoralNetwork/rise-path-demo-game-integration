// Tracked files use repo-relative paths, never a machine's absolute paths (a sandbox checkout under
// /home/user, a session temp dir, or a personal home folder or volume on macOS). AGENTS.md: no
// absolute personal paths in commits.
// Scans what git tracks (git grep), so untracked or ignored copies of the repo (for example a
// worktree under .claude/worktrees) and build output never count.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');
// A home folder or volume name must follow, so the rule text ("folders under /Users") is fine.
const PATTERN = ['/home/user/', '/tmp/claude', '/(Users|Volumes)/[A-Za-z0-9]'].join('|');

const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

describe('tracked files have no absolute local paths', () => {
  it('git grep finds none outside this test', (t) => {
    if (git(['rev-parse', '--is-inside-work-tree']).status !== 0) {
      t.skip('not a git checkout');
      return;
    }
    const tracked = git(['ls-files']).stdout.split('\n').filter(Boolean);
    assert.ok(tracked.some((f) => f.startsWith('doc/')) && tracked.some((f) => f.startsWith('scripts/')), 'doc/ and scripts/ are tracked');
    // -I skips binary files; exit 1 means no match.
    const result = git(['grep', '-nIE', PATTERN, '--', '.', `:(exclude)${SELF}`]);
    assert.notEqual(result.status, 2, result.stderr);
    const hits = result.stdout.split('\n').filter(Boolean).map((line) => line.slice(0, 160));
    assert.deepEqual(hits, []);
  });
});
