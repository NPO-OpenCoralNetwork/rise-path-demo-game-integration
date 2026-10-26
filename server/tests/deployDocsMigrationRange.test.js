// The VM runbooks (deploy/risepath-vm/README.md, doc/guides/risepath_vm_deployment.md) name the
// migration range a fresh VM applies ("000–NNN") and the steps of each release's first deploy. A new
// migration without a runbook update fails here (Phase 5 final review, findings 11 and 17). The
// plan's Phase 5 deploy order and its R12 agree on which order narrows R12 (finding 14).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const migrations = fs.readdirSync(new URL('../migrations/', import.meta.url)).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
const latest = migrations.at(-1).slice(0, 3);
const RUNBOOKS = ['deploy/risepath-vm/README.md', 'doc/guides/risepath_vm_deployment.md'];

describe('the VM runbooks follow server/migrations', () => {
    it(`every "000–NNN" range names the latest migration (${latest})`, () => {
        for (const doc of RUNBOOKS) {
            const ranges = [...read(doc).matchAll(/000–(\d{3})/g)].map((m) => m[1]);
            assert.ok(ranges.length > 0, `${doc}: names the range`);
            assert.deepEqual([...new Set(ranges)], [latest], `${doc}: ${ranges.join(', ')}`);
        }
    });

    it('the VM README has a Phase 5 "first deploy of this release" block: 019 before the services, no role re-run, no deletions while it runs (40P01)', () => {
        const readme = read('deploy/risepath-vm/README.md');
        const start = readme.indexOf('## 保存の様子・レッスンのやり直し・XP（Phase 5）');
        assert.ok(start > 0, 'the Phase 5 section');
        const section = readme.slice(start, readme.indexOf('\n## ', start + 1));
        assert.match(section, /\*\*この版の最初のデプロイ\*\*/);
        assert.match(section, /migration 019 を当てる前に、この版の `api`・`mcp`・`mcp-public` を起動しません/);
        assert.match(section, /`sql\/mcp_remote_role\.sql` は流し直さなくてかまいません/);
        assert.match(section, /デッドロック（40P01）/);
        assert.match(section, /`ACCOUNT_DELETION_ENABLED=true`/, 'self-service deletion too');
        assert.match(section, /scripts\/db\/verify-phase5\.mjs/);
        const guide = read('doc/guides/account-deletion-operations.ja.md');
        assert.match(guide, /`deploy-stack\.sh` の実行中）は、`--yes` を実行しません/, 'the staff guide says it too');
    });
});

describe('the plan: Phase 5 deploy order and R12', () => {
    it('Vercel first, then the VM at once; R12 says which tabs remain (no claim that the VM-first order shortens it)', () => {
        const plan = read('doc/brushup-2026/ai-access-plan.ja.md');
        const order = plan.split('\n').find((line) => line.startsWith('1. **デプロイの順番**: migration 019'));
        assert.ok(order, '9.2 item 1');
        assert.match(order, /マージで Vercel が新しい画面を出したあと、すぐに VM で `deploy-stack\.sh`/);
        assert.match(order, /VM を先にしても壊れませんが、そのあいだに開いた画面はすべて古い画面になり、9\.3 の R12 が広がります/);
        const r12 = plan.split('\n').find((line) => line.startsWith('- **R12**:'));
        assert.doesNotMatch(r12, /9\.2 の 1 の順番で、この間を短くします/);
        assert.match(r12, /Vercel を先に出せば、そのタブは Vercel の更新より前に開いたものだけになります/);
    });
});
