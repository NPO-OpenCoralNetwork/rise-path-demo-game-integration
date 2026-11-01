// @ts-check
// 削除の記録の当て直し (Phase 9, owner decision D4; design §5.4, §5.8, §5.10; Scope guard TR9a):
// scripts/replay-deletions.mjs with fake dependencies. Three kinds applied (account, progress, lesson), consent and
// grant rows stop it before anything is read or changed, the 15-minute margin, every state-dependent skip,
// account precedence, newest per key, time order, requested_by passed through, --yes, the exit codes 0/1/2/3,
// a journal error that names its line number only, and no full id ever printed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  EXIT, HEADER, MARGIN_MINUTES, STOP_CONSENT_GRANT, USAGE, isoMicros, jstLabel, parseJournal, planReplay, replayDeletions, run,
} from '../../scripts/replay-deletions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/replay-deletions.mjs');
const SINCE = '2026-11-02T03:23:00Z';
/** Sentinel ids: their full text must never be printed. */
const U = {
  a: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  b: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  c: 'cccccccc-3333-4333-8333-cccccccccccc',
  d: 'dddddddd-4444-4444-8444-dddddddddddd',
};
const CONSENT_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const CLIENT_ID = 'ffffffff-6666-4666-8666-ffffffffffff';

/** A time `min` minutes after SINCE (negative: before), with microseconds. @param {number} min @param {string} [us] */
const at = (min, us = '123456') => `${new Date(Date.parse(SINCE) + min * 60_000).toISOString().slice(0, 19)}.${us}Z`;

/** One CSV line. @param {Partial<Record<'kind'|'user_id'|'time'|'requested_by'|'reopened_at'|'course_slug'|'lesson_id'|'ref_id', string>>} f */
const line = (f) => HEADER.map((h) => f[/** @type {keyof typeof f} */ (h)] ?? '').join(',');
const journal = (/** @type {string[]} */ ...lines) => [HEADER.join(','), ...lines, ''].join('\n');
const account = (user, min, by = 'self', reopened = '') => line({ kind: 'account', user_id: user, time: at(min), requested_by: by, reopened_at: reopened });
const progress = (user, min) => line({ kind: 'progress', user_id: user, time: at(min) });
const lesson = (user, min, course = 'ai-basics', id = 'lesson-1') => line({ kind: 'lesson', user_id: user, time: at(min), course_slug: course, lesson_id: id });
const consent = (user, min) => line({ kind: 'consent', user_id: user, time: at(min), ref_id: CONSENT_ID });
const grant = (user, min) => line({ kind: 'grant', user_id: user, time: at(min), ref_id: CLIENT_ID });

/**
 * Fake dependencies over a restored state: `accounts` (stubs that exist), `tombstones` / `resets` / `lessonResets`
 * (the restored times, compared like Postgres with microseconds), `unpublished` lessons, `epochs`. Records every
 * read and write in `calls`.
 * @param {{ accounts?: string[], tombstones?: Record<string, string>, resets?: Record<string, string>, lessonResets?: Record<string, string>,
 *   unpublished?: string[], epochs?: Record<string, string>, accountResult?: (id: string) => { status: string, reason?: string },
 *   progressResult?: () => Record<string, unknown>, lessonResult?: () => Record<string, unknown>, readThrows?: boolean }} [restored]
 */
function fakeDeps(restored = {}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {string[]} */
  const lines = [];
  const atLeast = (/** @type {string | undefined} */ restoredTime, /** @type {string} */ time) => restoredTime !== undefined && /** @type {bigint} */ (isoMicros(restoredTime)) >= /** @type {bigint} */ (isoMicros(time));
  const read = (/** @type {string} */ what) => {
    calls.push(what);
    if (restored.readThrows) throw new Error(`connect ECONNREFUSED ${U.a}`);
  };
  return {
    calls,
    lines,
    deps: {
      state: {
        hasAccount: async (/** @type {string} */ id) => { read(`hasAccount ${id}`); return (restored.accounts ?? Object.values(U)).includes(id); },
        accountCovered: async (/** @type {string} */ id, /** @type {string} */ time) => { read(`accountCovered ${id} ${time}`); return atLeast(restored.tombstones?.[id], time); },
        progressCovered: async (/** @type {string} */ id, /** @type {string} */ time) => { read(`progressCovered ${id} ${time}`); return atLeast(restored.resets?.[id], time); },
        lessonCovered: async (/** @type {string} */ id, /** @type {string} */ c, /** @type {string} */ l, /** @type {string} */ time) => { read(`lessonCovered ${id} ${c}/${l} ${time}`); return atLeast(restored.lessonResets?.[`${id}|${c}/${l}`], time); },
        isPublished: (/** @type {string} */ c, /** @type {string} */ l) => !(restored.unpublished ?? []).includes(`${c}/${l}`),
        progressEpoch: async (/** @type {string} */ id) => { read(`progressEpoch ${id}`); return restored.epochs?.[id] ?? null; },
      },
      deleteAccount: async (/** @type {{ userId: string, requestedBy: string }} */ input) => {
        calls.push(`deleteAccount ${input.userId} ${input.requestedBy}`);
        return restored.accountResult?.(input.userId) ?? { status: 'deleted' };
      },
      deleteAllProgress: async (/** @type {{ userId: string }} */ input) => {
        calls.push(`deleteAllProgress ${input.userId}`);
        return restored.progressResult?.() ?? { deleted: 3, epoch: 'e' };
      },
      resetLesson: async (/** @type {{ userId: string, epoch: string | null, courseSlug: string, lessonId: string }} */ input) => {
        calls.push(`resetLesson ${input.userId} ${input.epoch} ${input.courseSlug}/${input.lessonId}`);
        return restored.lessonResult?.() ?? { lessonEpoch: 'x' };
      },
      log: (/** @type {string} */ l) => lines.push(l),
    },
  };
}

/** @param {string} text @param {ReturnType<typeof fakeDeps>} fake @param {boolean} [yes] */
const replay = (text, fake, yes = true) => replayDeletions({ text, since: SINCE, yes, deps: fake.deps });
const writes = (/** @type {string[]} */ calls) => calls.filter((c) => /^(deleteAccount|deleteAllProgress|resetLesson) /.test(c));
const noFullId = (/** @type {string[]} */ lines) => {
  const out = lines.join('\n');
  for (const id of [...Object.values(U), CONSENT_ID, CLIENT_ID]) assert.ok(!out.includes(id), `full id printed: ${id.slice(0, 8)}`);
};

describe('replay-deletions.mjs: the three kinds it applies (TR9a)', () => {
  it('account, progress and lesson rows after the dump are applied in time order, requested_by passed through', async () => {
    const fake = fakeDeps({ epochs: { [U.c]: '11111111-0000-4000-8000-000000000000' } });
    const code = await replay(journal(lesson(U.c, 30), account(U.a, 10, 'self'), progress(U.b, 20), account(U.d, 40, 'orphan')), fake);
    assert.equal(code, EXIT.ok);
    assert.deepEqual(writes(fake.calls), [
      `deleteAccount ${U.a} self`,
      `deleteAllProgress ${U.b}`,
      `resetLesson ${U.c} 11111111-0000-4000-8000-000000000000 ai-basics/lesson-1`,
      `deleteAccount ${U.d} orphan`,
    ]);
    assert.ok(fake.calls.indexOf(`progressEpoch ${U.c}`) < fake.calls.findIndex((c) => c.startsWith('resetLesson')), 'the epoch is read right before the reset');
    assert.ok(fake.lines.includes('当てた: account 2、progress 1、lesson 1'));
    noFullId(fake.lines);
  });
  it('staff is passed through too; a lesson of a learner who never deleted all progress resets with epoch null', async () => {
    const fake = fakeDeps();
    assert.equal(await replay(journal(account(U.a, 5, 'staff'), lesson(U.b, 6)), fake), EXIT.ok);
    assert.deepEqual(writes(fake.calls), [`deleteAccount ${U.a} staff`, `resetLesson ${U.b} null ai-basics/lesson-1`]);
  });
  it('without --yes it reads the restored state and changes nothing, listing what it would apply', async () => {
    const fake = fakeDeps();
    const code = await replay(journal(account(U.a, 10), progress(U.b, 20), lesson(U.c, 30)), fake, false);
    assert.equal(code, EXIT.ok);
    assert.deepEqual(writes(fake.calls), []);
    assert.ok(fake.calls.some((c) => c.startsWith('accountCovered')));
    assert.ok(fake.lines.includes('当てる: account 1、progress 1、lesson 1'));
    assert.ok(fake.lines.some((l) => l.startsWith('- account aaaaaaaa… (self) もとの時刻 ')));
    // Review round 2, finding 12: no --yes in the line (restore-db.sh asks its own yes question right after it).
    assert.ok(fake.lines.includes('これは確かめだけです（何も変えていません）。数が合っていれば、当てます。'));
    assert.ok(!fake.lines.some((l) => l.includes('--yes')), 'no line tells the owner to add --yes');
    noFullId(fake.lines);
  });
  it('the list (no --yes) and the run (--yes) agree on the same restored state', async () => {
    const text = journal(account(U.a, 10), progress(U.b, 20), lesson(U.c, 30), lesson(U.c, 31, 'ai-basics', 'gone'), progress(U.d, 5));
    const restored = { unpublished: ['ai-basics/gone'], resets: { [U.d]: at(6) } };
    const dry = fakeDeps(restored);
    const wet = fakeDeps(restored);
    await replay(text, dry, false);
    await replay(text, wet, true);
    assert.equal(dry.lines.find((l) => l.startsWith('当てる'))?.replace('当てる', ''), wet.lines.find((l) => l.startsWith('当てた'))?.replace('当てた', ''));
    assert.equal(dry.lines.find((l) => l.startsWith('とばした')), wet.lines.find((l) => l.startsWith('とばした')));
  });
});

describe('replay-deletions.mjs: consent and grant rows stop it before anything is read or changed (TR9a)', () => {
  for (const [name, row] of [['consent', consent(U.b, 20)], ['grant', grant(U.b, 20)]]) {
    it(`${name}: exit 2 with the fixed line, the count, 8-character ids; no state read, no write (with and without --yes)`, async () => {
      for (const yes of [false, true]) {
        const fake = fakeDeps();
        const code = await replay(journal(account(U.a, 10), row, progress(U.c, 30)), fake, yes);
        assert.equal(code, EXIT.refused);
        assert.deepEqual(fake.calls, [], 'nothing read or changed');
        assert.ok(fake.lines.includes(`❌ ${STOP_CONSENT_GRANT}`));
        assert.ok(fake.lines.some((l) => l.includes(`consent: ${name === 'consent' ? 1 : 0}、grant: ${name === 'grant' ? 1 : 0}`)));
        assert.ok(fake.lines.includes('   何も変えていません。'));
        noFullId(fake.lines);
      }
    });
  }
  it('the message is the design\'s text', () => {
    assert.equal(STOP_CONSENT_GRANT, '保護者の同意の取り消しか、AI アプリの切断の記録があります。この版では自動で戻せません。エージェントと手で戻します（手順書 16.2）');
  });
  it('a consent or grant row before the window, or of a user whose account row is in the window, does not stop it', async () => {
    const fake = fakeDeps();
    const code = await replay(journal(consent(U.b, -MARGIN_MINUTES - 1), grant(U.a, 20), account(U.a, 25)), fake);
    assert.equal(code, EXIT.ok);
    assert.deepEqual(writes(fake.calls), [`deleteAccount ${U.a} self`]);
  });
});

describe('replay-deletions.mjs: the window, the margin and the state-dependent skips', () => {
  it('a row 10 minutes before --since is applied when the restored state lacks it, skipped (in the dump) when it has it', async () => {
    const lacking = fakeDeps();
    assert.equal(await replay(journal(progress(U.b, -10)), lacking), EXIT.ok);
    assert.deepEqual(writes(lacking.calls), [`deleteAllProgress ${U.b}`]);
    const having = fakeDeps({ resets: { [U.b]: at(-10) } });
    assert.equal(await replay(journal(progress(U.b, -10)), having), EXIT.ok);
    assert.deepEqual(writes(having.calls), []);
    assert.ok(having.lines.some((l) => l.startsWith('とばした: 1（控えに入っていました: 1、')));
  });
  it('a row 16 minutes before --since is outside the window (never read); exactly 15 minutes before too (time > since − 15 min)', async () => {
    const fake = fakeDeps();
    const exact = line({ kind: 'progress', user_id: U.c, time: `${new Date(Date.parse(SINCE) - 15 * 60_000).toISOString().slice(0, 19)}.000000Z` });
    const justIn = line({ kind: 'progress', user_id: U.d, time: `${new Date(Date.parse(SINCE) - 15 * 60_000).toISOString().slice(0, 19)}.000001Z` });
    assert.equal(await replay(journal(progress(U.b, -16), exact, justIn), fake), EXIT.ok);
    assert.deepEqual(writes(fake.calls), [`deleteAllProgress ${U.d}`]);
    assert.ok(!fake.calls.some((c) => c.includes(U.b) || c.includes(U.c)));
    assert.ok(fake.lines.some((l) => l.includes('控えより前: 2')));
  });
  it('microseconds count: a restored time one microsecond earlier than the row does not cover it; the same time does', async () => {
    const row = line({ kind: 'progress', user_id: U.b, time: '2026-11-02T03:30:00.500001Z' });
    const earlier = fakeDeps({ resets: { [U.b]: '2026-11-02T03:30:00.500000Z' } });
    await replay(journal(row), earlier);
    assert.deepEqual(writes(earlier.calls), [`deleteAllProgress ${U.b}`]);
    const same = fakeDeps({ resets: { [U.b]: '2026-11-02T03:30:00.500001Z' } });
    await replay(journal(row), same);
    assert.deepEqual(writes(same.calls), []);
    assert.ok(earlier.calls.includes(`progressCovered ${U.b} 2026-11-02T03:30:00.500001Z`), 'the state gets the time as written (Postgres compares the microseconds)');
  });
  it('account: skipped when the restored tombstone is at or after the row (with or without a later reopen), applied when older', async () => {
    const fake = fakeDeps({ tombstones: { [U.a]: at(10), [U.b]: at(11), [U.c]: at(-60) } });
    await replay(journal(account(U.a, 10), account(U.b, 10, 'self', at(30)), account(U.c, 10)), fake);
    assert.deepEqual(writes(fake.calls), [`deleteAccount ${U.c} self`]);
    assert.ok(fake.lines.some((l) => l.startsWith('とばした: 2（控えに入っていました: 2、')));
  });
  it('progress and lesson of an account the restored database does not have are skipped (no_account) and never written', async () => {
    const fake = fakeDeps({ accounts: [U.a] });
    await replay(journal(progress(U.b, 10), lesson(U.c, 11)), fake);
    assert.deepEqual(writes(fake.calls), []);
    assert.ok(fake.lines.some((l) => l.includes('控えにないアカウント（控えのあとに作られたか、削除ずみ）: 2')));
  });
  it('lesson: skipped when the restored lesson reset is at or after it, or when the lesson is no longer published (counted)', async () => {
    const fake = fakeDeps({ lessonResets: { [`${U.b}|ai-basics/lesson-1`]: at(40) }, unpublished: ['ai-basics/old'] });
    await replay(journal(lesson(U.b, 30), lesson(U.c, 30, 'ai-basics', 'old'), lesson(U.d, 30, 'ai-basics', 'lesson-2')), fake);
    assert.deepEqual(writes(fake.calls), [`resetLesson ${U.d} null ai-basics/lesson-2`]);
    assert.ok(fake.lines.some((l) => l === 'とばした: 2（控えに入っていました: 1、控えにないアカウント（控えのあとに作られたか、削除ずみ）: 0、公開をやめたレッスン: 1）'));
  });
  it('an account row drops the same user\'s other rows (the deletion removes them); identical rows and older rows of the same key count once', async () => {
    const fake = fakeDeps();
    const text = journal(progress(U.a, 5), lesson(U.a, 6), account(U.a, 10), account(U.a, 10), progress(U.b, 11), progress(U.b, 12), lesson(U.c, 13), lesson(U.c, 14), lesson(U.c, 14, 'ai-basics', 'lesson-2'));
    await replay(text, fake);
    assert.deepEqual(writes(fake.calls), [`deleteAccount ${U.a} self`, `deleteAllProgress ${U.b}`, `resetLesson ${U.c} null ai-basics/lesson-1`, `resetLesson ${U.c} null ai-basics/lesson-2`]);
    assert.ok(fake.calls.includes(`progressCovered ${U.b} ${at(12)}`), 'the newest row of the key is the one checked');
    assert.ok(fake.lines.some((l) => l.includes('同じ行: 1、アカウントの削除に含まれる行: 2、同じものの古い行: 2')));
  });
  it('several journals joined (each with its header) read as one', () => {
    const rows = parseJournal(journal(account(U.a, 1)) + journal(account(U.a, 1), progress(U.b, 2)));
    assert.equal(rows.length, 3);
    assert.equal(planReplay(rows, /** @type {bigint} */ (isoMicros(SINCE))).apply.length, 2);
  });
});

describe('replay-deletions.mjs: exit codes and what is printed', () => {
  it('1: --since missing or not an ISO time; a journal line it cannot read names its number only', async () => {
    for (const since of ['', 'yesterday', '2026-11-02', '2026-02-30T00:00:00Z']) {
      const fake = fakeDeps();
      assert.equal(await replayDeletions({ text: journal(), since, yes: true, deps: fake.deps }), EXIT.usage, since);
      assert.deepEqual(fake.lines, [USAGE]);
    }
    const bad = [
      ['no header', `${account(U.a, 1)}\n`, 1],
      ['an unknown kind', journal(line({ kind: 'material', user_id: U.a, time: at(1) })), 2],
      ['a bad id', journal(account(U.a, 1), line({ kind: 'progress', user_id: 'not-an-id', time: at(1) })), 3],
      ['a bad time', journal(line({ kind: 'progress', user_id: U.a, time: '2026-11-02 03:30:00' })), 2],
      ['another requester', journal(account(U.a, 1, 'admin')), 2],
      ['a bad slug', journal(lesson(U.a, 1, 'AI Basics')), 2],
      ['a consent without its id', journal(line({ kind: 'consent', user_id: U.a, time: at(1) })), 2],
      ['a field too many', `${journal(account(U.a, 1))}${account(U.b, 2)},x\n`, 3],
      ['broken quoting', `${journal()}"account,${U.a}\n`, 2],
    ];
    for (const [name, text, number] of bad) {
      const fake = fakeDeps();
      assert.equal(await replay(/** @type {string} */ (text), fake), EXIT.usage, /** @type {string} */ (name));
      assert.deepEqual(fake.lines, [`削除の記録の ${number} 行目が読めません（形がちがいます）。`], /** @type {string} */ (name));
      assert.deepEqual(fake.calls, []);
    }
  });
  it('quoted fields are read (Postgres quotes a field when it must)', () => {
    const rows = parseJournal(journal(`"account","${U.a}","${at(1)}","self","","","",""`));
    assert.equal(rows[0].userId, U.a);
  });
  it('2: an account deletion refused (a renewing plan) is reported and the rest still runs', async () => {
    const fake = fakeDeps({ accountResult: (id) => (id === U.a ? { status: 'refused', reason: 'subscription_active' } : { status: 'deleted' }) });
    assert.equal(await replay(journal(account(U.a, 1), progress(U.b, 2), account(U.c, 3)), fake), EXIT.refused);
    assert.deepEqual(writes(fake.calls), [`deleteAccount ${U.a} self`, `deleteAllProgress ${U.b}`, `deleteAccount ${U.c} self`]);
    assert.ok(fake.lines.includes('❌ account aaaaaaaa…: 削除を断られました（subscription_active）。'));
    noFullId(fake.lines);
  });
  it('0: an account already deleted counts as done', async () => {
    const fake = fakeDeps({ accountResult: () => ({ status: 'already' }) });
    assert.equal(await replay(journal(account(U.a, 1)), fake), EXIT.ok);
    assert.ok(fake.lines.includes('当てた: account 0、progress 0、lesson 0（account のうち、すでに削除ずみ: 1）'));
  });
  it('3: the database or a service does not answer → stop at once (later rows untouched), what was applied so far is printed', async () => {
    for (const restored of [
      { accountResult: () => ({ status: 'failed', reason: 'deletion_unavailable' }) },
      { accountResult: () => ({ status: 'refused', reason: 'payment_provider_unavailable' }) },
    ]) {
      const fake = fakeDeps(restored);
      assert.equal(await replay(journal(progress(U.b, 1), account(U.a, 2), progress(U.c, 3)), fake), EXIT.unavailable);
      assert.deepEqual(writes(fake.calls), [`deleteAllProgress ${U.b}`, `deleteAccount ${U.a} self`]);
      assert.ok(fake.lines.includes('当てた: account 0、progress 1、lesson 0'));
    }
    const core = fakeDeps({ progressResult: () => ({ error: `connection to ${U.b} failed`, error_type: 'db_connection' }) });
    assert.equal(await replay(journal(progress(U.b, 1), lesson(U.c, 2)), core), EXIT.unavailable);
    assert.deepEqual(writes(core.calls), [`deleteAllProgress ${U.b}`]);
    assert.ok(core.lines.includes('❌ progress bbbbbbbb…: 当て直せませんでした（db_connection）。ここで止めます。'));
    const lessonCore = fakeDeps({ lessonResult: () => ({ error: 'x', error_type: 'progress_reset' }) });
    assert.equal(await replay(journal(lesson(U.c, 2)), lessonCore), EXIT.unavailable);
    const reads = fakeDeps({ readThrows: true });
    assert.equal(await replay(journal(account(U.a, 1)), reads), EXIT.unavailable);
    assert.deepEqual(writes(reads.calls), []);
    for (const f of [core, lessonCore, reads]) noFullId(f.lines);
  });
  it('run(): arguments (--since once, --yes once, nothing else) and stdin', async () => {
    const fake = fakeDeps();
    const stdin = () => Readable.from([Buffer.from(journal(progress(U.b, 1)))]);
    assert.equal(await run(['--since', SINCE, '--yes'], { stdin: stdin(), deps: fake.deps }), EXIT.ok);
    assert.deepEqual(writes(fake.calls), [`deleteAllProgress ${U.b}`]);
    for (const argv of [[], ['--yes'], ['--since'], ['--since', SINCE, '--since', SINCE], ['--since', SINCE, '--yes', '--yes'], ['--since', SINCE, '--force']]) {
      const f = fakeDeps();
      assert.equal(await run(argv, { stdin: stdin(), deps: f.deps }), EXIT.usage, JSON.stringify(argv));
      assert.deepEqual(writes(f.calls), []);
    }
  });
  it('as a process: no arguments → exit 1 and the usage; a bad line → exit 1 and its number; consent rows → exit 2, no database touched', () => {
    const env = { PATH: process.env.PATH, DATABASE_URL_PHASE1: '' };
    const r1 = spawnSync(process.execPath, [SCRIPT], { input: '', encoding: 'utf8', env });
    assert.equal(r1.status, EXIT.usage);
    assert.equal(r1.stdout, `${USAGE}\n`);
    const r2 = spawnSync(process.execPath, [SCRIPT, '--since', SINCE], { input: journal(line({ kind: 'progress', user_id: U.a, time: 'x' })), encoding: 'utf8', env });
    assert.equal(r2.status, EXIT.usage);
    assert.equal(r2.stdout, '削除の記録の 2 行目が読めません（形がちがいます）。\n');
    const r3 = spawnSync(process.execPath, [SCRIPT, '--since', SINCE, '--yes'], { input: journal(consent(U.a, 5), account(U.b, 6)), encoding: 'utf8', env });
    assert.equal(r3.status, EXIT.refused, r3.stderr);
    assert.match(r3.stdout, /❌ 保護者の同意の取り消しか/);
    for (const r of [r1, r2, r3]) for (const id of [...Object.values(U), CONSENT_ID]) assert.ok(!(r.stdout + r.stderr).includes(id));
  });
});

describe('replay-deletions.mjs: review round 3 of Stage 5', () => {
  it('finding 7: every printed time is Japan time to the minute (restore-db.sh\'s bk_jst form), with the journal\'s UTC time in brackets marked UTC', async () => {
    const list = fakeDeps();
    assert.equal(await replay(journal(account(U.a, 10), lesson(U.c, 20)), list, false), EXIT.ok);
    assert.ok(list.lines[0].startsWith('# 削除の記録の当て直し（控えの始まり 日本時間 2026-11-02 12:23（UTC: 2026-11-02T03:23:00Z）、余白 15 分）'), list.lines[0]);
    assert.ok(list.lines.includes('- account aaaaaaaa… (self) もとの時刻 日本時間 2026-11-02 12:33（UTC: 2026-11-02T03:33:00.123456Z）'), list.lines.join('\n'));
    assert.ok(list.lines.includes('- lesson cccccccc… ai-basics/lesson-1 もとの時刻 日本時間 2026-11-02 12:43（UTC: 2026-11-02T03:43:00.123456Z）'), list.lines.join('\n'));
    const yes = fakeDeps();
    assert.equal(await replay(journal(account(U.a, 10)), yes, true), EXIT.ok);
    assert.ok(yes.lines.includes('もとの時刻（日本時間。かっこの中は UTC）は、事故の記録に書きます（手順書 16.2）。'), yes.lines.join('\n'));
    const stop = fakeDeps();
    assert.equal(await replay(journal(consent(U.b, 5)), stop), EXIT.refused);
    assert.ok(stop.lines.some((l) => l.includes('consent bbbbbbbb… もとの時刻 日本時間 2026-11-02 12:28（UTC: 2026-11-02T03:28:00.123456Z）')), stop.lines.join('\n'));
    // No printed line carries a bare UTC time outside its （UTC: …） bracket.
    for (const l of [...list.lines, ...yes.lines, ...stop.lines]) assert.doesNotMatch(l.replace(/（UTC: [^）]+）/g, ''), /\d{4}-\d\d-\d\dT\d\d:\d\d/, l);
    // The day changes at 15:00 UTC; the minute part is what bash's bk_jst prints for the same time.
    assert.equal(jstLabel('2026-12-31T15:00:00Z'), '日本時間 2027-01-01 00:00（UTC: 2026-12-31T15:00:00Z）');
    const bash = spawnSync('bash', ['-c', `source "${path.join(ROOT, 'deploy/risepath-vm/scripts/backup-common.sh')}"; bk_jst 2026-12-31T15:00:59Z`], { encoding: 'utf8', env: { ...process.env, STACK_DIR: ROOT } });
    assert.ok(jstLabel('2026-12-31T15:00:59.999999Z').startsWith(`${bash.stdout}（UTC: `), bash.stdout + bash.stderr);
  });
  it('finding 1: a header-only journal (restore-db.sh\'s RS8 when no journal follows the dump) is 0 rows and exit 0; an empty input stays exit 1', async () => {
    const fake = fakeDeps();
    assert.equal(await replay(`${HEADER.join(',')}\n`, fake, false), EXIT.ok);
    assert.ok(fake.lines.includes('当てる: account 0、progress 0、lesson 0'), fake.lines.join('\n'));
    assert.equal(await replay('', fakeDeps(), false), EXIT.usage);
    const cli = spawnSync(process.execPath, [SCRIPT, '--since', SINCE], { input: '', encoding: 'utf8' });
    assert.equal(cli.status, EXIT.usage);
    assert.match(cli.stdout, /削除の記録の 1 行目が読めません/);
  });
  it('finding 14: STOP_CONSENT_GRANT and DRY_RUN_LINE each have their own JSDoc right above them', () => {
    const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');
    const above = (/** @type {string} */ name) => lines[lines.findIndex((l) => l.startsWith(`export const ${name} =`)) - 1];
    assert.match(above('STOP_CONSENT_GRANT'), /^\/\*\* TR9a: printed when consent or grant rows are in the window/);
    assert.match(above('DRY_RUN_LINE'), /^\/\*\* The last line of a run without --yes/);
  });
});
