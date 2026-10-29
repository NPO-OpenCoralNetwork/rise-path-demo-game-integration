// The VM runbooks (deploy/risepath-vm/README.md, doc/guides/risepath_vm_deployment.md and the new-VM
// order of deploy/vercel/README.md) name the migration range a fresh VM applies ("000–NNN") and the
// steps of each release's first deploy. A new migration without a runbook update fails here (Phase 5
// final review, findings 11 and 17; deploy/vercel/README.md since Phase 7). The
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
const RUNBOOKS = ['deploy/risepath-vm/README.md', 'doc/guides/risepath_vm_deployment.md', 'deploy/vercel/README.md'];

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
    it('§10 is Phase 6, §11 Phase 7 and §12 Phase 8, before やらないこと (13) and まだ分からないこと (14); its owner steps start with the deploy order of 020', () => {
        const plan = read('doc/brushup-2026/ai-access-plan.ja.md');
        const headings = plan.split('\n').filter((line) => /^## \d+\. /.test(line)).map((line) => line.replace(/^## /, '').slice(0, 12));
        assert.deepEqual(headings.slice(-6).map((h) => h.split(' ')[0]), ['9.', '10.', '11.', '12.', '13.', '14.']);
        assert.match(plan, /^## 10\. Phase 6: /m);
        assert.match(plan, /^## 11\. Phase 7: /m);
        assert.match(plan, /^## 12\. Phase 8: /m);
        assert.match(plan, /^## 13\. やらないこと$/m);
        assert.match(plan, /^## 14\. まだ分からないこと$/m);
        const order = plan.split('\n').find((line) => line.startsWith('1. **デプロイの順番**: migration 020 を'));
        assert.ok(order, '10.2 item 1');
        assert.match(order, /`api`・`mcp`・`mcp-public` を起動する前に/);
    });

    it('§10 says what the code does: not_due, reveal and grading cover due cards (not only today\'s list), the FSRS figures the app reaches, the signed-out screen', () => {
        const plan = read('doc/brushup-2026/ai-access-plan.ja.md');
        const end = plan.indexOf('## 11. Phase 7: ');
        assert.ok(end > plan.indexOf('## 10. Phase 6: '), 'the chapter ends where Phase 7 starts');
        const chapter = plan.slice(plan.indexOf('## 10. Phase 6: '), end);
        // tools/core/reviewQueue.js gradeReviewCard refuses a card due later or recorded today (not_due)
        // and the 11th card (review_limit); nothing checks membership in pickToday's list.
        assert.doesNotMatch(chapter, /今日の分でない|今日の分だけ/u);
        assert.equal(chapter.split('期日の来ていないカードと、今日すでに記録したカードは `not_due`').length - 1, 2, '10.1 API and MCP');
        // A reveal records nothing and counts no cards: any due card not recorded today, until 10 are
        // recorded today (reviewQueueCore.test.js 'reveal counts no cards'), each call one mcp_write.
        assert.match(chapter, /`reveal: true`（何も記録せず、期日が来ていて今日まだ記録していないカードだけ。今日 10 枚を記録するまで使えます。見せた枚数は数えませんが、呼び出しは書き込みの上限（1 日 50 回）に数えます）/u);
        assert.match(chapter, /答えを見るだけの呼び出しは、今日 10 枚を記録するまで枚数を数えません/u, '10.3 の 4');
        assert.doesNotMatch(chapter, /期日の来たカードだけ（1 日 10 枚まで）/u);
        // One word per meaning (docs #14): 「答え」 a card's back, 「応答」 a server reply, 「評価」 an FSRS rating.
        assert.doesNotMatch(chapter, /最初の答え|答えには `learnerId`|ほかの学習者あての答え|答えを返したあとで|答えのあとに書きます|記録の答えで|進み具合の(次の)?答え/u);
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

describe('the plan: Phase 8 chapter', () => {
    const plan = read('doc/brushup-2026/ai-access-plan.ja.md');
    const start = plan.indexOf('## 12. Phase 8: ');
    const end = plan.indexOf('## 13. やらないこと');
    const chapter = plan.slice(start, end);

    it('§12 holds 12.1–12.4 in order and ends where やらないこと starts', () => {
        assert.ok(start > plan.indexOf('## 11. Phase 7: ') && end > start, 'Phase 8 after Phase 7, before やらないこと');
        const subsections = chapter.split('\n').filter((line) => line.startsWith('### ')).map((line) => line.split(' ')[1]);
        assert.deepEqual(subsections, ['12.1', '12.2', '12.3', '12.4']);
    });

    it('the earlier chapters no longer list what Phase 8 fixed as open (§8.3/§8.4, §9.4, §10.3/§10.4, §11.4)', () => {
        const before = plan.slice(0, start);
        assert.doesNotMatch(before, /同意のない方を API とリモート MCP でも止めるか/u, '§8.4');
        assert.doesNotMatch(before, /API とリモートの MCP は、同意のない方を止めません/u, '§8.3');
        assert.doesNotMatch(before, /まだ `streak: 0` を返します/u, '§9.4');
        assert.doesNotMatch(before, /レッスンの終わりに「\+40 XP」のように、もらった XP を見せること/u, '§9.4');
        assert.doesNotMatch(before, /メニューのボタンに枚数を出す案は|スマートフォンのメニューのボタンの枚数、/u, '§10.3 の 17, §10.4');
        assert.doesNotMatch(before, /前のカードの答えが 1〜2 フレームだけ見えます/u, '§10.4');
        assert.doesNotMatch(before, /`index\.tsx` が、部品を読めなかったときに 1 回読み直すためです/u, '§11.4');
    });

    it('AGENTS.md and the chapter name the terms switch and its exempt list where the code keeps them', () => {
        assert.match(read('tools/core/legalAcceptance.js'), /^export const TERMS_SWITCH = 'LEGAL_TERMS_REQUIRED';$/m);
        assert.match(read('server/middleware/termsGate.js'), /^export const TERMS_EXEMPT = /m);
        const lines = read('AGENTS.md').split('\n');
        const at = lines.findIndex((line) => line.startsWith('- Legal texts: '));
        assert.ok(at >= 0, 'the Legal texts bullet');
        const next = lines.findIndex((line, i) => i > at && !line.startsWith('  '));
        const bullet = lines.slice(at, next).join('\n');
        for (const must of ['`LEGAL_TERMS_REQUIRED=true`', 'off by default', 'ignored in production while texts are drafts', '`terms_required`', '`TERMS_EXEMPT`', '`server/middleware/termsGate.js`']) {
            assert.ok(bullet.includes(must), `AGENTS.md Legal texts bullet: ${must}`);
        }
        for (const must of ['`LEGAL_TERMS_REQUIRED`', '`terms_required`', '`TERMS_EXEMPT`', '`server/middleware/termsGate.js`', '**はじめは止まっています。**']) {
            assert.ok(chapter.includes(must), `§12: ${must}`);
        }
    });

    it('AGENTS.md states the exemption rule with both conditions termsGate.js gives (the UI page, the app shell)', () => {
        const rule = /Exempt a route only when (.+?)\.$/m.exec(read('server/middleware/termsGate.js'))?.[1];
        assert.equal(rule, 'the UI exempts its page or the app shell calls it there');
        assert.ok(read('AGENTS.md').includes(`exempt a new route there only when ${rule}`), 'AGENTS.md Legal texts bullet: the full rule');
    });

    it('§12 points to 10.3 の 17 only for what item 17 says (Phase 6 deferred the menu count, and why)', () => {
        const item17 = plan.slice(0, start).split('\n').find((line) => line.startsWith('17. 390 px の画面では'));
        assert.ok(item17, '10.3 item 17');
        assert.match(item17, /すべての画面の上の部分が変わるので Phase 6 では見送り、Phase 8 で出すようにしました（12 章）/u);
        assert.match(chapter, /Phase 6 で見送ったものです。10\.3 の 17/u, '12.1 S3');
        assert.match(chapter, /すべての画面の上の部分が、枚数の分だけ変わります（10\.3 の 17）/u, '12.3 item 4');
    });

    it('S1 never gives the browser\'s own error page the app screen\'s title, and 12.2 item 3 says when 「読み込み直す」 shows', () => {
        const title = /offlineTitle: '([^']+)'/.exec(read('components/common/offlineReloadCopy.ts').split('jp: {')[1])?.[1];
        assert.equal(title, 'インターネットにつながっていません');
        assert.doesNotMatch(chapter, /ブラウザの「(インターネットに)?つながっていません」/u);
        assert.ok(chapter.includes(`Rise Path の中で「${title}」の画面`), 'S1 names the app screen as Rise Path\'s');
        assert.match(chapter, /Rise Path の外の、ブラウザ自身のエラーの画面/u);
        const check = chapter.split('\n').find((line) => line.startsWith('3. **確かめます**: '));
        assert.ok(check, '12.2 item 3');
        assert.match(check, /図とコードのあるレッスン（たとえば Claude Code の「第1回｜最初のタスクを任せる」）/u);
        assert.match(check, /図やコードを読めなかったときだけ、上のバーにお知らせが出て、つなぐと「読み込み直す」が出ること/u);
        const lesson = JSON.parse(read('content/courses/claude-code/lessons/cc-01-first-session.lesson.json'));
        assert.equal(lesson.title, '第1回｜最初のタスクを任せる');
        const types = JSON.stringify(lesson);
        assert.match(types, /"type":"diagram"/);
        assert.match(types, /"type":"code"/);
    });
});

describe('PLAN.ja.md: the review queue row (docs #15)', () => {
    it('says the lesson flashcards part was built in Phase 6 (no present-tense "does not exist"), and what is still missing', () => {
        const row = read('doc/brushup-2026/PLAN.ja.md').split('\n').find((l) => l.startsWith('| FSRS による復習キュー'));
        assert.ok(row);
        assert.doesNotMatch(row, /現状は存在しない/u);
        assert.match(row, /Phase 6 で、レッスンの暗記カードの分を作りました（\[ai-access-plan\.ja\.md\]\(ai-access-plan\.ja\.md\) の 10 章）/u);
        assert.match(row, /確認問題と AI チューターのカードは、まだ入りません/u);
    });
});

describe('the BYOA guide: what the remote role cannot read (docs #13)', () => {
    it('only the prior_rating copy and the last result are hidden; the in-lesson marks stay readable in lesson_progress', () => {
        const guide = read('doc/guides/byoa-setup.ja.md');
        const line = guide.split('\n').find((l) => l.includes('復習（`review_cards`、`review_log`、Phase 6）'));
        assert.ok(line, 'Phase 6 role bullet');
        assert.doesNotMatch(line, /レッスンで付けた印（`prior_rating`）は読めません/u);
        assert.match(line, /最初の目安に使った印の写し（`prior_rating`）と、最後の結果（`last_rating`）は読めません/u);
        assert.match(line, /レッスンで付けた印そのものは、`lesson_progress` の一部として読めます/u);
        // The grants that make this true.
        const role = read('deploy/risepath-vm/sql/mcp_remote_role.sql');
        assert.match(role, /^GRANT SELECT, INSERT, UPDATE ON lesson_progress TO risepath_mcp_remote;$/m);
        const select = /^GRANT SELECT \(([^)]*)\) ON review_cards TO risepath_mcp_remote;$/m.exec(role)?.[1].split(', ') ?? [];
        for (const column of ['entered_at', 'prior_rating', 'last_rating']) assert.ok(!select.includes(column), column);
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
