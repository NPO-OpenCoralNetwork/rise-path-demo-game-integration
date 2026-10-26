// The VM runbooks (deploy/risepath-vm/README.md, doc/guides/risepath_vm_deployment.md) name the
// migration range a fresh VM applies ("000–NNN") and the steps of each release's first deploy. A new
// migration without a runbook update fails here (Phase 5 final review, findings 11 and 17). The
// plan's Phase 5 deploy order and its R12 agree on which order narrows R12 (finding 14).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROLL_FORWARD } from '../../scripts/db/verify-phase6.mjs';
import { AGAIN, GOOD, scheduler } from '../../shared/review/fsrs.js';
import { LESSON_PRIORS } from '../../shared/review/queue.js';

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

    it('the VM README has a Phase 6 block: 020 before the services, the role SQL re-run, and the roll-forward listings and repairs exactly as verify-phase6 P10 proves them', () => {
        const readme = read('deploy/risepath-vm/README.md');
        const start = readme.indexOf('## 復習（Phase 6）');
        assert.ok(start > 0, 'the Phase 6 section');
        const section = readme.slice(start, readme.indexOf('\n## ', start + 1));
        assert.match(section, /\*\*この版の最初のデプロイ\*\*/);
        assert.match(section, /migration 020 を当てる前に、この版の `api`・`mcp`・`mcp-public` を起動しません/);
        assert.match(section, /`byoa` を使っているときは、020 を当てたあとに `sql\/mcp_remote_role\.sql` を流し直します/);
        assert.match(section, /流すまで、AI アプリの復習の 2 つのツール（`course-review-due`、`course-review-grade`）は使えません/);
        assert.match(section, /デッドロック（40P01）にはなりません/);
        assert.match(section, /\*\*前の版に戻したあと、この版に戻すとき\*\*/);
        assert.match(section, /この版の `api`・`mcp`・`mcp-public` を起動する前に、次の 2 つの確認と 2 つの削除を流します/);
        // The old services stop before the SQL and the new ones start after it (deploy-stack.sh).
        const stop = section.indexOf('stop api mcp mcp-public');
        assert.ok(stop > 0, 'stops the previous version first');
        for (const [name, sql] of Object.entries(ROLL_FORWARD)) {
            const at = section.indexOf(`${sql};`);
            assert.ok(at > stop, `${name}: in the README, verbatim, after the stop (scripts/db/verify-phase6.mjs ROLL_FORWARD)`);
        }
        const at = (/** @type {keyof typeof ROLL_FORWARD} */ name) => section.indexOf(`${ROLL_FORWARD[name]};`);
        assert.ok(Math.max(at('listAccount'), at('listLessons')) < Math.min(at('repairAccount'), at('repairLessons')), 'both listings before both repairs');
        assert.match(section, /scripts\/db\/verify-phase6\.mjs/);
        const guide = read('doc/guides/risepath_vm_deployment.md').split('\n').find((line) => line.startsWith('- **020（Phase 6、復習）**'));
        assert.match(guide, /\[`deploy\/risepath-vm\/README\.md`\]\(\.\.\/\.\.\/deploy\/risepath-vm\/README\.md\) の「復習（Phase 6）」/, 'the guide links the block');
    });
});

describe('the plan: Phase 6 chapter', () => {
    it('§10 is Phase 6, inserted before やらないこと (11) and まだ分からないこと (12); its owner steps start with the deploy order of 020', () => {
        const plan = read('doc/brushup-2026/ai-access-plan.ja.md');
        const headings = plan.split('\n').filter((line) => /^## \d+\. /.test(line)).map((line) => line.replace(/^## /, '').slice(0, 12));
        assert.deepEqual(headings.slice(-4).map((h) => h.split(' ')[0]), ['9.', '10.', '11.', '12.']);
        assert.match(plan, /^## 10\. Phase 6: /m);
        assert.match(plan, /^## 11\. やらないこと$/m);
        assert.match(plan, /^## 12\. まだ分からないこと$/m);
        const order = plan.split('\n').find((line) => line.startsWith('1. **デプロイの順番**: migration 020 を'));
        assert.ok(order, '10.2 item 1');
        assert.match(order, /`api`・`mcp`・`mcp-public` を起動する前に/);
    });

    it('§10 says what the code does: not_due, reveal and grading cover due cards (not only today\'s list), the FSRS figures the app reaches, the signed-out screen', () => {
        const plan = read('doc/brushup-2026/ai-access-plan.ja.md');
        const chapter = plan.slice(plan.indexOf('## 10. Phase 6: '), plan.indexOf('## 11. やらないこと'));
        // tools/core/reviewQueue.js gradeReviewCard refuses a card due later or recorded today (not_due)
        // and the 11th card (review_limit); nothing checks membership in pickToday's list.
        assert.doesNotMatch(chapter, /今日の分でない|今日の分だけ/u);
        assert.equal(chapter.split('期日の来ていないカードと、今日すでに記録したカードは `not_due`').length - 1, 2, '10.1 API and MCP');
        assert.match(chapter, /`reveal: true`（何も記録せず、期日の来たカードだけ（1 日 10 枚まで）/u);
        assert.match(chapter, /出す順（R2）は今日の一覧の決まりで、AI アプリは、一覧にない期日の来たカード/u);
        assert.doesNotMatch(read('doc/guides/byoa-setup.ja.md'), /今日の分でない/u);
        assert.doesNotMatch(read('doc/guides/usage_guide.md'), /今日の分でない/u);
        // 10.3 #2: a 「もう一度」 lesson mark at 23:50, then 「覚えた」 at 0:10 (vector L2) vs the same day.
        const fixed = (n, digits) => n.toFixed(digits);
        const nextDay = scheduler.review(LESSON_PRIORS.again, GOOD, 1).stability;
        const sameDay = scheduler.review(LESSON_PRIORS.again, GOOD, 0).stability;
        assert.match(chapter, new RegExp(`同じ日と数えたときの約 ${fixed(sameDay, 2)} 日ではなく、約 ${fixed(nextDay, 1)} 日です`, 'u'));
        // 10.3 #18: 「もう一度」 at the first scheduled review of a Good-prior card (its interval after the lesson).
        const first = scheduler.review(LESSON_PRIORS.good, AGAIN, LESSON_PRIORS.good.intervalDays);
        assert.match(chapter, new RegExp(`（${LESSON_PRIORS.good.intervalDays} 日あとに出ます）。そこで「もう一度」なら忘れたものとして数え（安定度 約 ${fixed(first.stability, 1)} 日、${first.intervalDays} 日あと）`, 'u'));
        // 10.1 画面: a sign-out or expiry swaps the whole app for the signed-out page (AuthContext setUser(null)).
        assert.match(chapter, /ログインが切れたときは、ページごとログインの前の画面に戻り、何も記録しません（Nexloom のログインが残っているときは、その復習をそこで止めて 1 行で知らせます）/u);
        assert.doesNotMatch(chapter, /ログインが切れたときは、その復習をそこで止めて/u);
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
