// Job training, the study time screen (doc/brushup-2026/training-plan.ja.md §4.9 画面):
// - services/trainingApi.ts: GET …/time and POST …/time/signals, the answers read and refused
//   (Retry-After), a signal's six keys, keepalive with the caller's token.
// - trainingModel.ts: the study time page's state of an answer and of a refusal; the unit page's
//   first numbers.
// - studyTimeCore.ts: the signals' state machine, case by case, and invariants over random event
//   sequences (while the page keeps a chain, exactly one of a signal on its way and a timer).
// - studyTimeText.ts: the same keys in en and jp, every reason and cause worded, the Japanese
//   rules, durations and days; design tokens and no rule value in the section.
// - The pages (CohortTimeView, UnitTimeView, StudyTimeStatus) and the hook (useStudyTime), rendered
//   with a small runtime that keeps each component's hooks, against a fake clock (Date.now,
//   setTimeout, crypto.randomUUID are replaced in the bundle; it can also jump, as a sleep), a fake
//   DOM, a fake fetch and a Supabase client whose getSession can be held: stops and the signals
//   waiting for their token, a seq 0 overtaken by its stop, focus after a button leaves.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getEventListeners } from 'node:events';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SECTION = 'components/features/training';
const U1 = 'aaaaaaaa-2121-4000-8000-0000000000a1';
const U2 = 'aaaaaaaa-2121-4000-8000-0000000000b2';
const C1 = 'cccccccc-2121-4000-8000-0000000000c1';
const C2 = 'cccccccc-2121-4000-8000-0000000000c2';
const START = Date.UTC(2026, 10, 2, 1, 0, 0);

const importBundle = async (result) => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

/** getSupabaseClient(): the client a test sets (globalThis.__supabase), or none. */
const supabaseStub = {
  name: 'supabase-stub',
  setup(b) {
    b.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'supabase', namespace: 'supabase-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'supabase-stub' }, () => ({
      contents: 'export const getSupabaseClient = () => globalThis.__supabase ?? null; export const isSupabaseConfigured = () => Boolean(globalThis.__supabase);',
      loader: 'js',
    }));
  },
};

// ---------------------------------------------------------------------------------------------
// Test data (made-up values: no rule value of a school).

const UNIT = (unitKey, countedMs, setMs, capReached = false) => ({ unitKey, countedMs, setMs, capReached });
const TIME = (over = {}) => ({
  ok: true,
  learnerId: U1.toUpperCase(),
  cohortId: C1.toUpperCase(),
  today: '2026-11-02',
  timeZone: 'Asia/Tokyo',
  status: 'ready',
  beatMs: 30_000,
  units: [
    { unitKey: 'u1', title: { jp: 'HTML の基本', en: 'HTML basics' }, setMs: 3_600_000, countedMs: 1_500_000, capReached: false },
    { unitKey: 'u 2/x', title: { jp: 'CSS の基本', en: 'CSS basics' }, setMs: 1_800_000, countedMs: 1_800_000, capReached: true },
  ],
  days: [{ day: '2026-11-02', countedMs: 3_900_000, final: false }, { day: '2026-11-01', countedMs: 600_000, final: true }],
  totalMs: 4_500_000,
  asOf: '2026-11-02T01:00:00.000Z',
  ...over,
});
const STATE = (counting, reason, todayMs, unit) => ({ counting, reason, todayMs, unit });
/** A signal's 200 bodies, as the server sends them. */
const ACCEPT = (nextInMs, state = null) => ({ ok: true, accepted: true, nextInMs, state });
const IGNORE = (reason, nextInMs = null) => ({ ok: true, accepted: false, reason, nextInMs });

// ---------------------------------------------------------------------------------------------
// A fake fetch: every call is recorded, and answered by net.auto at once or later by call.reply.

function createNet() {
  const calls = [];
  const net = {
    calls,
    /** (call) => [status, body, headers] to answer at once, or undefined to wait for call.reply. */
    auto: null,
    posts: () => calls.filter((c) => c.method === 'POST'),
  };
  globalThis.fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const call = {
      url: String(url),
      method: init.method ?? 'GET',
      rawBody: init.body,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      keepalive: init.keepalive === true,
      headers: { ...(init.headers ?? {}) },
      signal: init.signal,
      reply: (status, body, headers = {}) => resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })),
      fail: () => reject(new TypeError('Failed to fetch')),
    };
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    calls.push(call);
    const answer = net.auto?.(call);
    if (answer) call.reply(...answer);
  });
  return net;
}
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  for (const key of ['__supabase', '__hooks', '__clock', '__language', '__params', 'window', 'document']) delete globalThis[key];
});

/** Lets promises, fetch answers and their bodies run. */
const settle = async () => {
  for (let n = 0; n < 20; n += 1) await new Promise((resolve) => setImmediate(resolve));
};

// ---------------------------------------------------------------------------------------------

describe('services/trainingApi.ts (study time) and trainingModel.ts', () => {
  let mod = null;
  let net = null;
  before(async () => {
    mod = await importBundle(await build({
      stdin: { contents: `export * from './services/trainingApi'; export * from './${SECTION}/trainingModel';`, resolveDir: ROOT, loader: 'ts' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { 'import.meta.env': '{"PROD":true}' },
      plugins: [supabaseStub],
      logLevel: 'silent',
    }));
  });
  beforeEach(() => {
    delete globalThis.__supabase;
    net = createNet();
  });

  it('GET …/time: the path with the class id encoded; the answer with lower-case ids; beatMs only while ready', async () => {
    net.auto = () => [200, TIME()];
    const time = await mod.getStudyTime(`${C1}/x`);
    assert.equal(net.calls[0].url, `/api/v2/training/cohorts/${encodeURIComponent(`${C1}/x`)}/time`);
    assert.equal(net.calls[0].method, 'GET');
    const { ok, timeZone, ...rest } = TIME();
    assert.deepEqual(time, { ...rest, learnerId: U1, cohortId: C1 });
    for (const status of ['not_configured', 'not_in_session']) {
      net.auto = () => [200, TIME({ status, beatMs: undefined })];
      const other = await mod.getStudyTime(C1);
      assert.equal(other.status, status);
      assert.equal(other.beatMs, null);
    }
  });

  it('a 200 that is not the documented shape is bad_response', async () => {
    const unit = (over) => TIME({ units: [{ unitKey: 'u1', title: { jp: 'a', en: 'a' }, setMs: 1, countedMs: 0, capReached: false, ...over }] });
    const day = (over) => TIME({ days: [{ day: '2026-11-02', countedMs: 0, final: true, ...over }] });
    const bad = [
      TIME({ learnerId: '' }), TIME({ cohortId: 7 }), TIME({ today: '2026-11-2' }), TIME({ status: 'open' }),
      TIME({ beatMs: undefined }), TIME({ beatMs: 0 }), TIME({ beatMs: 1.5 }), TIME({ beatMs: '30000' }), TIME({ status: 'not_configured' }),
      TIME({ units: {} }), TIME({ days: null }), TIME({ totalMs: -1 }), TIME({ totalMs: undefined }), TIME({ asOf: 1 }),
      unit({ title: { jp: 'a' } }), unit({ unitKey: '' }), unit({ countedMs: 0.5 }), unit({ setMs: -1 }), unit({ capReached: 'no' }),
      day({ final: 1 }), day({ day: 'today' }), day({ countedMs: null }),
      [], 'not json', null,
    ];
    for (const body of bad) {
      net.auto = () => [200, body];
      await assert.rejects(mod.getStudyTime(C1), (err) => err instanceof mod.TrainingApiError && err.status === 200 && err.errorType === 'bad_response', JSON.stringify(body));
    }
  });

  it('refusals carry status and error_type; Retry-After (whole seconds) is read on a 429 and a 503 only; the network is 0; an abort stays an abort', async () => {
    const cases = [
      [404, { error_type: 'cohort_not_found' }, {}, 'cohort_not_found', undefined],
      [403, { error_type: 'not_a_learner' }, {}, 'not_a_learner', undefined],
      [401, { error_type: 'account_deleted' }, {}, 'account_deleted', undefined],
      [409, { error_type: 'not_in_session' }, { 'Retry-After': '30' }, 'not_in_session', undefined],
      [429, { error_type: 'rate_limited' }, { 'Retry-After': '30' }, 'rate_limited', 30_000],
      [503, { error_type: 'training_unavailable' }, { 'Retry-After': '60' }, 'training_unavailable', 60_000],
      [429, {}, {}, undefined, undefined],
      [503, {}, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }, undefined, undefined],
      [503, {}, { 'Retry-After': '-5' }, undefined, undefined],
      [500, { error_type: 'training_failed' }, { 'Retry-After': '30' }, 'training_failed', undefined],
    ];
    for (const [status, body, headers, errorType, retryAfterMs] of cases) {
      net.auto = () => [status, body, headers];
      for (const call of [() => mod.getStudyTime(C1), () => mod.postStudySignal(C1, { unitKey: 'u1', chainId: 'a', seq: 0, stop: false, focus: true, input: true })]) {
        await assert.rejects(call(), (err) => err instanceof mod.TrainingApiError && err.status === status && err.errorType === errorType && err.retryAfterMs === retryAfterMs, `${status} ${JSON.stringify(headers)}`);
      }
    }
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(mod.getStudyTime(C1), (err) => err.status === 0 && err.errorType === 'network');
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = async () => {
      throw new DOMException('aborted', 'AbortError');
    };
    await assert.rejects(mod.getStudyTime(C1, controller.signal), (err) => err.name === 'AbortError');
  });

  it('POST …/time/signals: exactly the six keys (anything else dropped), keepalive only when asked, the caller\'s token as Bearer, started before any await', async () => {
    net.auto = () => [200, ACCEPT(30_000, STATE(true, null, 1_000, UNIT('u1', 1_000, 3_600_000)))];
    const body = { unitKey: 'u1', chainId: 'a', seq: 3, stop: false, focus: true, input: false, at: 5, durationMs: 1 };
    const answer = await mod.postStudySignal(`${C1}/x`, body);
    const [first] = net.calls;
    assert.equal(first.url, `/api/v2/training/cohorts/${encodeURIComponent(`${C1}/x`)}/time/signals`);
    assert.equal(first.method, 'POST');
    assert.equal(first.rawBody, '{"unitKey":"u1","chainId":"a","seq":3,"stop":false,"focus":true,"input":false}');
    assert.equal(first.keepalive, false);
    assert.equal(first.headers.Authorization, undefined);
    assert.deepEqual(answer, { accepted: true, nextInMs: 30_000, state: STATE(true, null, 1_000, UNIT('u1', 1_000, 3_600_000)) });
    let asked = 0;
    globalThis.__supabase = { auth: { getSession: async () => { asked += 1; return { data: { session: { access_token: 'someone-else' } } }; } } };
    const pending = mod.postStudySignal(C1, { ...body, stop: true }, { keepalive: true, token: 'tok-9' });
    assert.equal(net.calls.length, 2, 'the request started before any await');
    await pending;
    assert.equal(asked, 0, 'the caller\'s token: no getSession');
    assert.equal(net.calls[1].keepalive, true);
    assert.equal(net.calls[1].headers.Authorization, 'Bearer tok-9');
    assert.equal(net.calls[1].body.stop, true);
    await mod.postStudySignal(C1, body);
    assert.equal(net.calls[2].headers.Authorization, 'Bearer someone-else', 'without a token, apiFetch\'s own session');
  });

  it('a signal\'s answer: stored (a state, or null), not stored with its reason; a reason the page does not know is "unknown"; anything else is bad_response', async () => {
    const state = (over) => ({ ...STATE(false, 'idle', 0, UNIT('u1', 0, 60_000)), ...over });
    const good = [
      [ACCEPT(30_000, state()), { accepted: true, nextInMs: 30_000, state: state() }],
      [ACCEPT(30_000, state({ counting: true, reason: null })), { accepted: true, nextInMs: 30_000, state: state({ counting: true, reason: null }) }],
      [ACCEPT(null, null), { accepted: true, nextInMs: null, state: null }],
      [ACCEPT(30_000, state({ reason: 'sleepy' })), { accepted: true, nextInMs: 30_000, state: state({ reason: 'unknown' }) }],
      [IGNORE('too_soon', 30_000), { accepted: false, reason: 'too_soon', nextInMs: 30_000 }],
      [IGNORE('brand_new'), { accepted: false, reason: 'brand_new', nextInMs: null }],
    ];
    for (const [body, want] of good) {
      net.auto = () => [200, body];
      assert.deepEqual(await mod.postStudySignal(C1, { unitKey: 'u1', chainId: 'a', seq: 0, stop: false, focus: true, input: true }), want, JSON.stringify(body));
    }
    const bad = [
      { ok: true, accepted: true, state: null }, ACCEPT(0), ACCEPT(-1), ACCEPT(1.5), ACCEPT('30000'), { ok: true, nextInMs: 30_000, state: null },
      IGNORE('', 30_000), { ok: true, accepted: false, nextInMs: 30_000 }, { ...IGNORE('too_soon'), nextInMs: undefined },
      ACCEPT(30_000, state({ counting: 'yes' })), ACCEPT(30_000, state({ reason: 5 })), ACCEPT(30_000, state({ todayMs: -1 })),
      ACCEPT(30_000, state({ unit: { unitKey: 'u1', countedMs: 0, setMs: 1 } })), ACCEPT(30_000, state({ unit: UNIT('', 0, 1) })),
      ACCEPT(30_000, { counting: true, reason: null, todayMs: 0 }), ACCEPT(30_000, 'state'), [],
    ];
    for (const body of bad) {
      net.auto = () => [200, body];
      await assert.rejects(mod.postStudySignal(C1, { unitKey: 'u1', chainId: 'a', seq: 0, stop: false, focus: true, input: true }), (err) => err.errorType === 'bad_response', JSON.stringify(body));
    }
  });

  it('the page state: a 200 for this learner and this class only; each refusal', () => {
    const time = mod.parseStudyTime(TIME());
    assert.deepEqual(mod.studyTimeForAnswer(time, U1.toUpperCase(), C1.toUpperCase()), { kind: 'ready', time });
    assert.deepEqual(mod.studyTimeForAnswer(time, U2, C1), { kind: 'error' }, 'never another learner\'s answer');
    assert.deepEqual(mod.studyTimeForAnswer(time, U1, C2), { kind: 'error' }, 'never another class\'s answer');
    const E = mod.TrainingApiError;
    const cases = [
      [401, 'sign_in_required', 'account'], [401, 'account_deleted', 'deleted'], [401, undefined, 'signin'], [401, 'session_changed', 'signin'],
      [403, 'not_a_learner', 'not_learner'], [403, 'terms_required', 'error'], [403, undefined, 'error'], [404, 'cohort_not_found', 'not_found'], [404, 'training_off', 'off'], [404, undefined, 'off'],
      [409, 'not_in_session', 'error'], [429, 'rate_limited', 'error'], [503, 'training_unavailable', 'error'], [500, 'training_failed', 'error'],
      [0, 'network', 'error'], [200, 'bad_response', 'error'],
    ];
    for (const [status, errorType, kind] of cases) assert.deepEqual(mod.studyTimeForFailure(new E('x', status, errorType)), { kind }, `${status} ${errorType}`);
    assert.deepEqual(mod.studyTimeForFailure(new Error('x')), { kind: 'error' });
  });

  it('the unit page\'s first numbers: today\'s time (0 without a row for today) and the unit\'s; null for a unit not listed', () => {
    const time = mod.parseStudyTime(TIME());
    assert.deepEqual(mod.initialNumbers(time, 'u 2/x'), { todayMs: 3_900_000, unit: UNIT('u 2/x', 1_800_000, 1_800_000, true) });
    assert.equal(mod.initialNumbers({ ...time, days: [time.days[1]] }, 'u1').todayMs, 0);
    assert.equal(mod.initialNumbers(time, 'u3'), null);
  });
});

// ---------------------------------------------------------------------------------------------

describe('studyTimeCore.ts', () => {
  let core = null;
  before(async () => {
    core = await importBundle(await build({
      stdin: { contents: `export * from './${SECTION}/studyTimeCore';`, resolveDir: ROOT, loader: 'ts' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      logLevel: 'silent',
    }));
  });

  const NUMS = { todayMs: 100, unit: UNIT('u1', 50, 3_600_000) };
  const accepted = (nextInMs, state = null) => ({ accepted: true, nextInMs, state });
  const ignored = (reason, nextInMs = null) => ({ accepted: false, reason, nextInMs });
  const ok = (answer) => ({ ok: true, answer });
  const fail = (status, errorType, retryAfterMs) => ({ ok: false, status, errorType, retryAfterMs });
  const sig = (chainId, seq, { stop = false, focus = true, input = false } = {}) => ({ unitKey: 'u1', chainId, seq, stop, focus, input });
  const sentOf = ({ body }) => ({ chainId: body.chainId, seq: body.seq, stop: body.stop, focus: body.focus, input: body.input });
  const one = (sends) => {
    assert.equal(sends.length, 1, JSON.stringify(sends));
    return sends[0];
  };
  const drive = (beatMs = 30_000) => {
    const d = { core: core.createStudyCore('u1', beatMs, NUMS) };
    d.step = (ev) => {
      const step = core.studyStep(d.core, ev);
      d.core = step.core;
      return step.sends;
    };
    d.open = (now, id, focused = true) => d.step({ type: 'open', now, id, focused });
    d.beat = (now, id = 'late', focused = true) => d.step({ type: 'beat', now, id, focused });
    d.answer = (now, send, result, id = 'next', focused = true) => d.step({ type: 'answer', now, sent: sentOf(send), result, id, focused });
    d.end = (keepalive = true, focused = true) => d.step({ type: 'end', focused, keepalive });
    return d;
  };
  /** A chain A whose seq 0 was stored at 100 (next signal at 25 100). */
  const running = () => {
    const d = drive();
    d.answer(100, one(d.open(0, 'A')), ok(accepted(25_000)));
    return d;
  };

  it('opening: a chain the learner started, its seq 0 with input; one signal at a time; the answer\'s state, and the next signal nextInMs after the answer with the flags since the last one', () => {
    const d = drive();
    const s0 = one(d.open(1_000, 'A'));
    assert.deepEqual(s0, { body: sig('A', 0, { input: true }), keepalive: false });
    assert.deepEqual(d.core.view, { kind: 'starting' });
    assert.deepEqual(d.core.numbers, NUMS, 'GET …/time\'s numbers until an answer');
    assert.equal(d.core.wakeAt, null);
    assert.deepEqual(d.beat(500_000), [], 'nothing while a signal is on its way');
    d.step({ type: 'input' });
    assert.deepEqual(d.answer(1_200, s0, ok(accepted(25_000, STATE(false, 'starting', 100, UNIT('u1', 50, 3_600_000))))), []);
    assert.deepEqual(d.core.view, { kind: 'not_counting', reason: 'starting' });
    assert.deepEqual(d.core.numbers, { todayMs: 100, unit: UNIT('u1', 50, 3_600_000) });
    assert.equal(d.core.wakeAt, 26_200);
    assert.equal(d.core.beatMs, 25_000);
    assert.deepEqual(d.beat(26_199), []);
    const s1 = one(d.beat(26_200));
    assert.deepEqual(s1.body, sig('A', 1, { input: true }), 'the input while seq 0 was on its way');
    d.answer(26_300, s1, ok(accepted(25_000, STATE(true, null, 25_100, UNIT('u1', 25_050, 3_600_000)))));
    assert.deepEqual(d.core.view, { kind: 'counting' });
    const s2 = one(d.beat(51_300));
    assert.deepEqual(s2.body, sig('A', 2), 'no input since');
    d.answer(51_400, s2, ok(accepted(25_000)));
    assert.deepEqual(d.core.view, { kind: 'counting' }, 'a null state keeps the view and the numbers');
    assert.deepEqual(d.core.numbers, { todayMs: 25_100, unit: UNIT('u1', 25_050, 3_600_000) });
    d.step({ type: 'blur' });
    const s3 = one(d.beat(76_400, 'x', true));
    assert.deepEqual(s3.body, sig('A', 3, { focus: false }), 'a blur since the last signal');
    d.answer(76_500, s3, ok(accepted(25_000)));
    assert.equal(one(d.beat(101_500, 'x', true)).body.focus, true, 'the blur was the last signal\'s');
  });

  it('a state of another unit is not this page\'s; stored without nextInMs (after the class\'s last day): the state shows, then the page stops, not in session', () => {
    const d = running();
    const s1 = one(d.beat(25_100));
    d.answer(25_200, s1, ok(accepted(25_000, STATE(true, null, 9, UNIT('u9', 9, 9)))));
    assert.deepEqual(d.core.view, { kind: 'starting' });
    assert.deepEqual(d.core.numbers, NUMS);
    assert.equal(d.core.wakeAt, 50_200, 'the chain goes on');
    const s2 = one(d.beat(50_200));
    d.answer(50_300, s2, ok(accepted(null, STATE(false, 'not_in_session', 7, UNIT('u1', 5, 3_600_000)))));
    assert.deepEqual(d.core.view, { kind: 'stopped', cause: 'not_in_session' });
    assert.deepEqual(d.core.numbers, { todayMs: 7, unit: UNIT('u1', 5, 3_600_000) });
    assert.equal(d.core.chain, null);
    assert.deepEqual(d.end(), [], 'no stop after nextInMs null');
    const s = d.open(90_000, 'B');
    assert.deepEqual(s.map((x) => x.body), [sig('B', 0, { input: true })], 'the learner may try again (another day)');
    assert.deepEqual(d.core.view, { kind: 'starting' });
  });

  it('a timer far too late (more than LATE_BEATS beats): a stop for the chain, with the input since its last signal, and a new chain without input; at the limit, the next signal', () => {
    for (const [late, restarted] of [[core.LATE_BEATS * 25_000, false], [core.LATE_BEATS * 25_000 + 1, true]]) {
      const d = running();
      d.step({ type: 'input' });
      const sends = d.beat(25_100 + late, 'B');
      if (!restarted) {
        assert.deepEqual(sends.map((s) => s.body), [sig('A', 1, { input: true })]);
        continue;
      }
      assert.deepEqual(sends, [{ body: sig('A', 1, { stop: true, input: true }), keepalive: false }, { body: sig('B', 0), keepalive: false }]);
      assert.deepEqual(d.core.view, { kind: 'starting' });
    }
  });

  it('hidden, page hide or leaving: a stop for the chain the page keeps (keepalive as asked), the view paused; answers after it change nothing; no stop without a chain, or before its first signal went', () => {
    const d = drive();
    assert.deepEqual(d.end(), [], 'no chain');
    assert.deepEqual(d.core.view, { kind: 'paused' });
    d.answer(100, one(d.open(0, 'A')), ok(accepted(25_000)));
    const s1 = one(d.beat(25_100));
    d.step({ type: 'input' });
    const stop = one(d.end(true, false));
    assert.deepEqual(stop, { body: sig('A', 2, { stop: true, focus: false, input: true }), keepalive: true });
    assert.deepEqual(d.core.view, { kind: 'paused' });
    assert.equal(d.core.chain, null);
    assert.equal(d.core.wakeAt, null);
    const before = d.core;
    d.answer(25_200, s1, ok(accepted(25_000, STATE(true, null, 1, UNIT('u1', 1, 2)))));
    d.answer(25_200, stop, ok(accepted(null)));
    assert.equal(d.core, before, 'the answers after the stop change nothing');
    assert.deepEqual(d.beat(1e9), []);
    assert.deepEqual(d.end(false), [], 'no chain after its stop');
    // A restart waiting for its timer has sent nothing of its chain: no stop.
    const e = drive();
    e.answer(10, one(e.open(0, 'A')), ok(ignored('restart')), 'B');
    assert.deepEqual(e.end(), []);
    // A stop while a signal is on its way: the next seq, at once.
    const f = running();
    one(f.beat(25_100));
    assert.deepEqual(one(f.end(false)).body, sig('A', 2, { stop: true }));
  });

  it('starting again while a chain runs: a stop for it first, then the new chain\'s seq 0 with input', () => {
    const d = running();
    assert.deepEqual(d.open(1_000, 'B'), [{ body: sig('A', 1, { stop: true }), keepalive: false }, { body: sig('B', 0, { input: true }), keepalive: false }]);
  });

  it('other_place: the page stops sending and offers to record here; hiding keeps the offer; the learner\'s start begins a new chain (no stop: the chain is over)', () => {
    const d = running();
    const s1 = one(d.beat(25_100));
    d.answer(25_200, s1, ok(ignored('other_place')));
    assert.deepEqual(d.core.view, { kind: 'other_place' });
    assert.equal(d.core.chain, null);
    assert.equal(d.core.wakeAt, null);
    assert.deepEqual(d.beat(1e9), []);
    assert.deepEqual(d.end(), []);
    assert.deepEqual(d.core.view, { kind: 'other_place' });
    assert.deepEqual(d.open(30_000, 'B').map((s) => s.body), [sig('B', 0, { input: true })]);
  });

  it('restart, not_open, chain_ended, a 409 chain_mismatch, and an answer not stored without nextInMs: a new chain one beat later, without input of its own', () => {
    const results = [ok(ignored('restart')), ok(ignored('not_open')), ok(ignored('chain_ended')), fail(409, 'chain_mismatch'), ok(ignored('duplicate')), ok(ignored('too_soon')), ok(ignored('brand_new'))];
    for (const result of results) {
      const d = running();
      const s1 = one(d.beat(25_100));
      assert.deepEqual(d.answer(25_200, s1, result, 'B'), [], JSON.stringify(result));
      assert.equal(d.core.wakeAt, 50_200);
      assert.deepEqual(d.beat(50_199), []);
      assert.deepEqual(one(d.beat(50_200)).body, sig('B', 0), JSON.stringify(result));
    }
    // A user start lost this way: its input goes on to the new chain.
    const d = drive();
    d.answer(10, one(d.open(0, 'A')), ok(ignored('restart')), 'B');
    assert.deepEqual(one(d.beat(30_010)).body, sig('B', 0, { input: true }));
  });

  it('MAX_RESTARTS restarts in a row, then the page stops for good (a reload starts it again); a stored signal in between starts the count again', () => {
    const d = drive();
    let s = one(d.open(0, 'A'));
    let now = 0;
    for (let n = 1; n <= core.MAX_RESTARTS; n += 1) {
      d.answer((now += 10), s, ok(ignored('restart')), `R${n}`);
      s = one(d.beat((now += 30_000)));
      assert.equal(s.body.chainId, `R${n}`);
    }
    assert.deepEqual(d.answer((now += 10), s, ok(ignored('restart')), 'X'), []);
    assert.deepEqual(d.core.view, { kind: 'stopped', cause: 'invalid' });
    assert.deepEqual(d.beat(1e9), []);
    assert.deepEqual(d.open(1e9, 'Y'), []);
    const e = drive();
    s = one(e.open(0, 'A'));
    now = 0;
    for (let n = 1; n <= 2 * core.MAX_RESTARTS; n += 1) {
      e.answer((now += 10), s, ok(ignored('restart')), `R${n}`);
      s = one(e.beat((now += 30_000)));
      if (n === core.MAX_RESTARTS) {
        e.answer((now += 10), s, ok(accepted(30_000)));
        s = one(e.beat((now += 30_000)));
      }
    }
    assert.notEqual(e.core.view.kind, 'stopped');
  });

  it('duplicate, too_soon and a reason the page does not know, with nextInMs: the chain goes on with the next seq; a lost signal\'s input and blur stay for it, a duplicate\'s do not (the server has it)', () => {
    for (const [reason, kept] of [['too_soon', true], ['brand_new', true], ['duplicate', false]]) {
      const d = drive();
      const s0 = one(d.open(0, 'A', false));
      assert.deepEqual(s0.body, sig('A', 0, { input: true, focus: false }));
      d.answer(100, s0, ok(ignored(reason, 20_000)));
      assert.equal(d.core.wakeAt, 20_100);
      assert.equal(d.core.beatMs, 20_000);
      assert.deepEqual(one(d.beat(20_100, 'x', true)).body, sig('A', 1, kept ? { input: true, focus: false } : {}), reason);
    }
  });

  it('the network, a 500, a 403 that is not not_a_learner (the terms check) and a malformed answer: the same signal again after the beat, its input and blur kept; 429 and 503 after Retry-After, at least the beat (60 s without one)', () => {
    const rate = { kind: 'retrying', cause: 'rate_limited' };
    const down = { kind: 'retrying', cause: 'unavailable' };
    const failed = { kind: 'retrying', cause: 'failed' };
    const cases = [
      [fail(0, 'network'), { kind: 'retrying', cause: 'network' }, 25_000],
      [fail(0, 'no_session'), { kind: 'retrying', cause: 'network' }, 25_000],
      [fail(500, 'training_failed'), failed, 25_000],
      [fail(403, 'terms_required'), failed, 25_000],
      [fail(200, 'bad_response'), failed, 25_000],
      [fail(502), failed, 25_000],
      [fail(429, 'rate_limited', 5_000), rate, 25_000],
      [fail(429, 'rate_limited', 90_000), rate, 90_000],
      [fail(429, 'rate_limited'), rate, core.RETRY_FALLBACK_MS],
      [fail(503, 'training_unavailable', 120_000), down, 120_000],
      [fail(503, 'training_unavailable'), down, core.RETRY_FALLBACK_MS],
    ];
    for (const [result, view, wait] of cases) {
      const d = running();
      d.step({ type: 'input' });
      d.step({ type: 'blur' });
      const s1 = one(d.beat(25_100));
      assert.deepEqual(s1.body, sig('A', 1, { input: true, focus: false }));
      assert.deepEqual(d.answer(25_200, s1, result), []);
      assert.deepEqual(d.core.view, view, JSON.stringify(result));
      assert.equal(d.core.wakeAt, 25_200 + wait, JSON.stringify(result));
      assert.deepEqual(d.beat(25_200 + wait - 1), []);
      const again = one(d.beat(25_200 + wait, 'x', true));
      assert.deepEqual(again.body, sig('A', 1, { input: true, focus: false }), 'the same signal again');
      d.answer(25_300 + wait, again, ok(accepted(25_000, STATE(true, null, 1, UNIT('u1', 1, 2)))));
      assert.deepEqual(d.core.view, { kind: 'counting' });
      assert.deepEqual(one(d.beat(50_300 + wait)).body, sig('A', 2));
    }
  });

  it('a retry answered duplicate: the failed signal\'s own flags are the server\'s, and what the retry took on since goes on to the next signal', () => {
    const d = running();
    const s1 = one(d.beat(25_100));
    assert.deepEqual(s1.body, sig('A', 1));
    d.answer(25_200, s1, fail(0, 'network'));
    d.step({ type: 'blur' });
    d.step({ type: 'input' });
    const again = one(d.beat(50_200));
    assert.deepEqual(again.body, sig('A', 1, { focus: false, input: true }));
    d.answer(50_300, again, ok(ignored('duplicate', 25_000)));
    assert.deepEqual(one(d.beat(75_300)).body, sig('A', 2, { focus: false, input: true }), 'the blur and input since the failed signal');
    const e = running();
    e.step({ type: 'input' });
    const t1 = one(e.beat(25_100));
    assert.deepEqual(t1.body, sig('A', 1, { input: true }));
    e.answer(25_200, t1, fail(0, 'network'));
    const t1again = one(e.beat(50_200));
    assert.deepEqual(t1again.body, sig('A', 1, { input: true }));
    e.answer(50_300, t1again, ok(ignored('duplicate', 25_000)));
    assert.deepEqual(one(e.beat(75_300)).body, sig('A', 2), 'the failed signal\'s own input is the server\'s');
  });

  it('a stop, or a timer far too late, while a failed signal waits to go again: the stop carries that signal\'s input and blur (the server never had them)', () => {
    for (const late of [false, true]) {
      const d = running();
      d.step({ type: 'blur' });
      d.step({ type: 'input' });
      const s1 = one(d.beat(25_100));
      assert.deepEqual(s1.body, sig('A', 1, { focus: false, input: true }));
      d.answer(25_200, s1, fail(500, 'training_failed'));
      const sends = late ? d.beat(50_200 + core.LATE_BEATS * 25_000 + 1, 'B', true) : d.end(true, true);
      assert.deepEqual(sends[0], { body: sig('A', 2, { stop: true, focus: false, input: true }), keepalive: !late }, late ? 'a late timer' : 'an end');
      if (late) assert.deepEqual(sends[1].body, sig('B', 0));
    }
  });

  it('a timer far too late for a restart still waiting (nothing of its chain sent): its first signal goes, with the input carried to it, and the restart count holds', () => {
    const d = drive();
    d.answer(10, one(d.open(0, 'A')), ok(ignored('restart')), 'B');
    assert.equal(d.core.chain.restarts, 1);
    assert.deepEqual(d.beat(30_010 + 10 * 30_000, 'C').map((s) => s.body), [sig('B', 0, { input: true })]);
    assert.equal(d.core.chain.restarts, 1);
  });

  it('refusals stop the page: 401, 403 not_a_learner, 404, 400 and a 409 other than chain_mismatch; only the 409s a later day can lift let the learner start again', () => {
    const cases = [
      [fail(401, 'account_deleted'), 'deleted', false], [fail(401, 'session_changed'), 'signin', false], [fail(401), 'signin', false],
      [fail(403, 'not_a_learner'), 'not_a_learner', false],
      [fail(404, 'cohort_not_found'), 'not_found', false], [fail(404, 'training_off'), 'off', false], [fail(404), 'off', false],
      [fail(400, 'validation'), 'invalid', false], [fail(409, 'brand_new'), 'invalid', false],
      [fail(409, 'time_not_configured'), 'time_not_configured', true], [fail(409, 'not_in_session'), 'not_in_session', true], [fail(409, 'unit_unknown'), 'unit_unknown', true],
    ];
    for (const [result, cause, again] of cases) {
      const d = drive();
      assert.deepEqual(d.answer(100, one(d.open(0, 'A')), result), []);
      assert.deepEqual(d.core.view, { kind: 'stopped', cause }, JSON.stringify(result));
      assert.equal(d.core.chain, null);
      assert.equal(d.core.wakeAt, null);
      assert.deepEqual(d.beat(1e9), []);
      assert.deepEqual(d.end(), []);
      assert.deepEqual(d.core.view, { kind: 'stopped', cause }, 'hiding keeps the reason');
      assert.deepEqual(d.open(200_000, 'B').map((s) => s.body), again ? [sig('B', 0, { input: true })] : [], cause);
    }
  });

  it('invariants over random event sequences: while the page keeps a chain, exactly one of a signal on its way and a timer; one signal at a time; seqs only go up in a chain (a retry repeats one); nothing after a chain\'s stop; nothing after a stop for good', () => {
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const results = [
      () => ok(accepted(pick([10_000, 25_000]), pick([null, STATE(true, null, 1, UNIT('u1', 1, 2)), STATE(false, 'idle', 1, UNIT('u2', 1, 2))]))),
      () => ok(accepted(null)),
      () => ok(ignored(pick(['duplicate', 'too_soon', 'other_place', 'restart', 'not_open', 'chain_ended', 'brand_new']), pick([null, 25_000]))),
      () => fail(pick([0, 500, 429, 503]), undefined, pick([undefined, 1_000, 90_000])),
      () => fail(409, pick(['chain_mismatch', 'not_in_session', 'unit_unknown', 'time_not_configured'])),
      () => fail(pick([401, 403, 404, 400])),
    ];
    const FOR_GOOD = ['not_a_learner', 'not_found', 'off', 'signin', 'deleted', 'invalid'];
    let stepsChecked = 0;
    for (let run = 0; run < 400; run += 1) {
      const d = drive(pick([10_000, 30_000]));
      const sentLog = [];
      const chains = new Map();
      let now = 0;
      let ids = 0;
      let gone = false;
      for (let n = 0; n < 60; n += 1) {
        const r = rand();
        const id = `c${(ids += 1)}`;
        let sends;
        if (r < 0.12) sends = d.open((now += 1), id, rand() < 0.8);
        else if (r < 0.4) sends = d.beat((now = Math.max(now + 1, d.core.wakeAt ?? now + 1) + (rand() < 0.1 ? 500_000 : 0)), id, rand() < 0.8);
        else if (r < 0.75 && d.core.inFlight) sends = d.step({ type: 'answer', now: (now += 50), sent: d.core.inFlight, result: pick(results)(), id, focused: true });
        else if (r < 0.8 && sentLog.length) sends = d.step({ type: 'answer', now: (now += 50), sent: pick(sentLog), result: pick(results)(), id, focused: true });
        else if (r < 0.88) sends = d.end(rand() < 0.5);
        else sends = d.step({ type: pick(['input', 'blur']) });
        const where = `run ${run}, step ${n}`;
        const c = d.core;
        if (gone) assert.deepEqual(sends, [], `${where}: nothing after a stop for good`);
        assert.equal(c.chain !== null && c.inFlight === null, c.wakeAt !== null, `${where}: a timer exactly while a chain waits`);
        if (c.inFlight) assert.equal(c.inFlight.chainId, c.chain?.id, where);
        const signals = sends.filter((s) => !s.body.stop);
        assert.ok(signals.length <= 1, `${where}: one signal at a time`);
        if (signals.length) assert.deepEqual(c.inFlight, sentOf(signals[0]), where);
        for (const s of sends) {
          assert.deepEqual(Object.keys(s.body), ['unitKey', 'chainId', 'seq', 'stop', 'focus', 'input'], where);
          const seen = chains.get(s.body.chainId);
          if (s.body.stop) {
            assert.ok(seen && !seen.stopped && s.body.seq === seen.seq + 1, `${where}: a stop right after the chain's last seq`);
            seen.stopped = true;
          } else if (!seen) {
            assert.equal(s.body.seq, 0, `${where}: a chain starts at 0`);
            chains.set(s.body.chainId, { seq: 0, stopped: false });
          } else {
            assert.ok(!seen.stopped, `${where}: nothing after a chain's stop`);
            assert.ok(s.body.seq === seen.seq || s.body.seq === seen.seq + 1, `${where}: the same seq again, or the next`);
            seen.seq = s.body.seq;
          }
          sentLog.push(sentOf(s));
        }
        if (c.view.kind === 'stopped' && FOR_GOOD.includes(c.view.cause)) gone = true;
        stepsChecked += 1;
      }
    }
    assert.equal(stepsChecked, 400 * 60);
  });
});

// ---------------------------------------------------------------------------------------------

describe('studyTimeText.ts and the section\'s files', () => {
  let text = null;
  before(async () => {
    text = await importBundle(await build({
      stdin: { contents: `export * from './${SECTION}/studyTimeText';`, resolveDir: ROOT, loader: 'ts' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      logLevel: 'silent',
    }));
  });
  /** The members of a string-literal union type in a source file. */
  const union = (file, name) => [...new RegExp(`export type ${name} = ([^;]+);`).exec(read(file))[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  const shape = (value) => (typeof value === 'string' ? 'string' : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])));
  const strings = (value) => (typeof value === 'string' ? [value] : Object.values(value).flatMap(strings));

  it('the same keys in en and jp at every level, every string worded; the Japanese rules', () => {
    assert.deepEqual(shape(text.studyCopy.en), shape(text.studyCopy.jp));
    for (const language of ['en', 'jp']) for (const s of strings(text.studyCopy[language])) assert.ok(s.trim().length > 0, language);
    const jp = strings(text.studyCopy.jp).join('\n');
    assert.doesNotMatch(jp, /簡単です|誰でも/);
    for (const s of strings(text.studyCopy.jp)) assert.ok(s.length <= 60 || /[。]/.test(s), s);
  });

  it('every reason, retry cause, stop cause and plain recording view is worded (the types in studyTimeCore.ts and trainingApi.ts)', () => {
    const core = `${SECTION}/studyTimeCore.ts`;
    const kinds = [...read(core).slice(read(core).indexOf('export type RecordingView')).split('\n\n')[0].matchAll(/kind: '(\w+)'/g)].map((m) => m[1]);
    for (const language of ['en', 'jp']) {
      const t = text.studyCopy[language];
      assert.deepEqual(Object.keys(t.reasons).sort(), union('services/trainingApi.ts', 'StudyReason').sort(), language);
      assert.deepEqual(Object.keys(t.retrying).sort(), union(core, 'RetryCause').sort(), language);
      assert.deepEqual(Object.keys(t.stopped).sort(), union(core, 'StopCause').sort(), language);
      assert.deepEqual(Object.keys(t.recording).sort(), kinds.filter((k) => !['not_counting', 'retrying', 'stopped'].includes(k)).sort(), language);
    }
  });

  it('durations in whole minutes (seconds dropped), hours from 60 minutes; days as 11月2日 and Nov 2', () => {
    const cases = [[0, '0 分', '0 min'], [59_999, '0 分', '0 min'], [60_000, '1 分', '1 min'], [-5, '0 分', '0 min'], [3_600_000, '1 時間', '1 h'], [3_900_000, '1 時間 5 分', '1 h 5 min'], [90_000_000, '25 時間', '25 h']];
    for (const [ms, jp, en] of cases) {
      assert.equal(text.formatDuration(ms, 'jp'), jp);
      assert.equal(text.formatDuration(ms, 'en'), en);
    }
    assert.equal(text.formatDay('2026-11-02', 'jp'), '11月2日');
    assert.equal(text.formatDay('2026-11-02', 'en'), 'Nov 2');
    assert.equal(text.formatDay('2027-01-09', 'jp'), '1月9日');
    assert.equal(text.formatDay('2027-01-09', 'en'), 'Jan 9');
  });

  it('design tokens only in every file of the section; no AI tutor on the study pages (D6); no counting rule in the page code (only beatMs and nextInMs come from the server)', () => {
    const files = fs.readdirSync(path.join(ROOT, SECTION)).map((f) => `${SECTION}/${f}`).concat(['services/trainingApi.ts']);
    assert.ok(files.length >= 10, files.join(', '));
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(source, /\[#[0-9a-fA-F]{3,8}\]|rounded-\[|text-\[(9|10|11)px\]|text-slate-400/, file);
      assert.doesNotMatch(source, /from '[^']*(?:Tutor|LessonReader|llmApi|agentChat)[^']*'|askTutor/, file);
      assert.doesNotMatch(source, /\b(?:gapMs|creditCapMs|idleMs|minSpacingMs|maxPlaces|requireFocus)\b/, file);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The pages and the hook: a hook runtime that keeps each component's hooks (by its place, type and
// key) and runs effects after a render, children first; components gone from the tree are
// unmounted (their effects cleaned up). A fake clock replaces Date.now, setTimeout, clearTimeout
// and crypto.randomUUID in the bundle; window and document are EventTargets.

const PAGE_STUBS = {
  react: `
    export const useState = (initial) => globalThis.__hooks.state(initial);
    export const useRef = (value) => globalThis.__hooks.ref(value);
    export const useEffect = (fn, deps) => globalThis.__hooks.effect(fn, deps);
    export default { useState, useRef, useEffect };
  `,
  'react/jsx-runtime': "export const jsx = (type, props, key) => ({ type, props, key: key ?? null }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'lucide-react': "export const CloudOff = 'CloudOff'; export const LogIn = 'LogIn'; export const GraduationCap = 'GraduationCap';",
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp' });",
  header: "export default function PageHeader(props) { if (props.titleRef) props.titleRef.current = globalThis.__title ?? null; return { type: 'header', props: { children: [{ type: 'h1', props: { children: props.title } }, props.description ? { type: 'p', props: { children: props.description } } : null] } }; }",
  empty: "export default function EmptyState(props) { return { type: 'EmptyState', props: { children: [props.title, props.action ?? null] } }; }",
  button: "export const Button = (props) => ({ type: 'button', props });",
  router: `
    export const Link = (props) => ({ type: 'a', props: { href: props.to, className: props.className, 'aria-label': props['aria-label'], children: props.children } });
    export const useParams = () => globalThis.__params ?? {};
  `,
};

function createRuntime() {
  const instances = new Map();
  let current = null;
  let dirty = false;
  let seen = new Set();
  let order = [];
  const api = {
    state(initial) {
      const inst = current;
      const k = inst.i++;
      if (!(k in inst.slots)) inst.slots[k] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = inst.slots[k];
      return [slot.value, (v) => {
        if (inst.gone) return;
        const next = typeof v === 'function' ? v(slot.value) : v;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          dirty = true;
        }
      }];
    },
    ref(value) {
      const inst = current;
      const k = inst.i++;
      if (!(k in inst.slots)) inst.slots[k] = { current: value ?? null };
      return inst.slots[k];
    },
    effect(fn, deps) {
      const inst = current;
      const k = inst.e++;
      const prev = inst.effects[k];
      if (!prev || !deps || deps.some((d, j) => !Object.is(d, prev.deps[j]))) inst.pending.push({ k, fn, deps });
    },
  };
  const expand = (node, at) => {
    if (Array.isArray(node)) return node.map((child, n) => expand(child, `${at}[${child?.key ?? n}]`));
    if (!node || typeof node !== 'object' || !('type' in node)) return node;
    if (typeof node.type !== 'function') return { type: node.type, props: { ...node.props, children: expand(node.props?.children, `${at}>${node.type}`) } };
    const id = `${at}>${node.type.name}${node.key == null ? '' : `#${node.key}`}`;
    let inst = instances.get(id);
    if (!inst) instances.set(id, (inst = { slots: [], effects: [], pending: [] }));
    seen.add(id);
    const outer = current;
    current = inst;
    inst.i = 0;
    inst.e = 0;
    inst.pending = [];
    let out;
    try {
      out = node.type(node.props ?? {});
    } finally {
      current = outer;
    }
    const tree = expand(out, id);
    order.push(inst);
    return tree;
  };
  const drop = (inst) => {
    inst.gone = true;
    for (const effect of inst.effects) effect?.cleanup?.();
  };
  return {
    render(element) {
      seen = new Set();
      order = [];
      globalThis.__hooks = api;
      const tree = expand(element, '');
      for (const [id, inst] of instances) {
        if (!seen.has(id)) {
          drop(inst);
          instances.delete(id);
        }
      }
      for (const inst of order) {
        for (const { k, fn, deps } of inst.pending) {
          inst.effects[k]?.cleanup?.();
          const cleanup = fn();
          inst.effects[k] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : null };
        }
      }
      return tree;
    },
    takeDirty() {
      const was = dirty;
      dirty = false;
      return was;
    },
    unmount() {
      for (const inst of instances.values()) drop(inst);
      instances.clear();
    },
  };
}

/** Renders until no state changes, then returns the tree. */
const renderer = (rt, element) => async () => {
  for (let round = 0; round < 30; round += 1) {
    const tree = rt.render(element());
    await settle();
    if (!rt.takeDirty()) return tree;
  }
  throw new Error('the page did not settle');
};

function createClock() {
  let now = START;
  let ids = 0;
  let uuids = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms = 0) => {
      ids += 1;
      timers.set(ids, { at: now + Math.max(0, Number(ms) || 0), fn });
      return ids;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    uuid: () => `00000000-0000-4000-8000-${String((uuids += 1)).padStart(12, '0')}`,
    pending: () => [...timers.values()].map((t) => t.at).sort((a, b) => a - b),
    /** Moves the clock without firing anything (a sleep): the timers due fire late on the next advance. */
    jump(ms) {
      now += ms;
    },
    /** Moves the clock, firing the timers due on the way (each after the work of the one before). */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].at);
        next[1].fn();
        await settle();
      }
      now = end;
    },
  };
}

function createDom() {
  const win = new EventTarget();
  const doc = new EventTarget();
  const main = new EventTarget();
  const dom = { win, doc, main, focused: true };
  doc.visibilityState = 'visible';
  doc.hasFocus = () => dom.focused;
  doc.getElementById = (id) => (id === 'main-content' ? main : null);
  doc.body = { tag: 'body' };
  doc.activeElement = doc.body;
  dom.hide = () => {
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  dom.show = () => {
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  dom.pageshow = (persisted) => {
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: persisted });
    win.dispatchEvent(event);
  };
  dom.fire = (type, target = win) => target.dispatchEvent(new Event(type));
  globalThis.window = win;
  globalThis.document = doc;
  return dom;
}

/** A Supabase client whose getSession answers the session of `user` (null: none), or waits (hold). */
function createSession() {
  const s = { user: U1, token: 'tok-1', calls: 0, held: null };
  const answer = ({ user, token }) => ({ data: { session: user ? { access_token: token, user: { id: user } } : null } });
  s.client = {
    auth: {
      getSession: () => {
        s.calls += 1;
        return s.held ? s.held.promise : Promise.resolve(answer(s));
      },
    },
  };
  s.hold = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    s.held = { promise, release: (over = {}) => { s.held = null; resolve(answer({ ...s, ...over })); } };
    return s.held;
  };
  globalThis.__supabase = s.client;
  return s;
}

function walk(node, out = []) {
  if (Array.isArray(node)) for (const child of node) walk(child, out);
  else if (node && typeof node === 'object' && 'type' in node) {
    out.push({ el: node });
    walk(node.props?.children, out);
  } else if (typeof node === 'string' || typeof node === 'number') out.push({ text: String(node) });
  return out;
}
const textOf = (node) => walk(node).filter((t) => 'text' in t).map((t) => t.text).join('|');
const elementsOf = (node) => walk(node).filter((t) => 'el' in t).map((t) => t.el);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('the study time pages and the hook', () => {
  let pages = null;
  let net = null;
  let clock = null;
  let dom = null;
  let session = null;
  before(async () => {
    pages = await importBundle(await build({
      stdin: {
        contents: [
          `export { default as CohortTimeView } from './${SECTION}/CohortTimeView';`,
          `export { default as UnitTimeView } from './${SECTION}/UnitTimeView';`,
          `export { default as StudyTimeStatus, recordingText } from './${SECTION}/StudyTimeStatus';`,
          `export { useStudyTime } from './${SECTION}/useStudyTime';`,
        ].join('\n'),
        resolveDir: ROOT,
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      jsx: 'automatic',
      define: {
        'import.meta.env': '{"PROD":true}',
        'Date.now': 'globalThis.__clock.now',
        setTimeout: 'globalThis.__clock.setTimeout',
        clearTimeout: 'globalThis.__clock.clearTimeout',
        'crypto.randomUUID': 'globalThis.__clock.uuid',
      },
      plugins: [supabaseStub, {
        name: 'page-stubs',
        setup(b) {
          const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'page-stub' }));
          stub(/^react$/, 'react');
          stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
          stub(/^lucide-react$/, 'lucide-react');
          stub(/context\/LanguageContext$/, 'language');
          stub(/ui\/PageHeader$/, 'header');
          stub(/ui\/EmptyState$/, 'empty');
          stub(/ui\/Button$/, 'button');
          stub(/^react-router-dom$/, 'router');
          b.onLoad({ filter: /.*/, namespace: 'page-stub' }, (args) => ({ contents: PAGE_STUBS[args.path], loader: 'js' }));
        },
      }],
      logLevel: 'silent',
    }));
  });
  beforeEach(() => {
    net = createNet();
    clock = createClock();
    globalThis.__clock = clock;
    dom = createDom();
    session = createSession();
    globalThis.__language = 'jp';
    globalThis.__params = {};
  });

  const NUMBERS = { todayMs: 3_900_000, unit: UNIT('u1', 1_500_000, 3_600_000) };
  const PROPS = (over = {}) => ({ cohortId: C1, unitKey: 'u1', learnerId: U1, beatMs: 30_000, numbers: NUMBERS, ...over });
  const POST_OK = (state = null) => (call) => (call.method === 'POST' ? [200, call.body.stop ? ACCEPT(null) : ACCEPT(30_000, state)] : undefined);
  const GET = (body) => (call) => (call.method === 'GET' ? [200, body] : undefined);
  const mountHook = (props) => {
    const rt = createRuntime();
    const h = { props, last: null };
    const Harness = (p) => {
      h.last = pages.useStudyTime(p);
      return null;
    };
    h.render = renderer(rt, () => ({ type: Harness, props: h.props, key: null }));
    h.unmount = () => rt.unmount();
    return h;
  };
  const mountPage = (name, props) => {
    const rt = createRuntime();
    const p = { props };
    p.render = renderer(rt, () => ({ type: pages[name], props: p.props, key: null }));
    p.unmount = () => rt.unmount();
    return p;
  };
  /** The one status region's text. */
  const statusText = (tree) => {
    const regions = elementsOf(tree).filter((el) => el.props?.role === 'status');
    assert.equal(regions.length, 1, 'one status region');
    return textOf(regions[0]);
  };
  const button = (tree, label) => elementsOf(tree).find((el) => el.type === 'button' && textOf(el) === label);
  const posted = (call) => ({ ...call.body, keepalive: call.keepalive, auth: call.headers.Authorization });

  // --- the hook ------------------------------------------------------------------------------

  it('mount (visible): seq 0 of a chain the learner started, with the session\'s token; the answer\'s state; the next signal nextInMs after the answer; nothing moves the numbers in between', async () => {
    const h = mountHook(PROPS());
    await h.render();
    const [p0] = net.posts();
    assert.equal(p0.url, `/api/v2/training/cohorts/${C1}/time/signals`);
    assert.deepEqual(posted(p0), { unitKey: 'u1', chainId: uuid(1), seq: 0, stop: false, focus: true, input: true, keepalive: false, auth: 'Bearer tok-1' });
    assert.deepEqual(h.last.view, { kind: 'starting' });
    assert.deepEqual(h.last.numbers, NUMBERS);
    assert.deepEqual(clock.pending(), [], 'no timer while the signal is on its way');
    p0.reply(200, ACCEPT(30_000, STATE(true, null, 3_960_000, UNIT('u1', 1_560_000, 3_600_000))));
    await h.render();
    assert.deepEqual(h.last.view, { kind: 'counting' });
    const numbers = { todayMs: 3_960_000, unit: UNIT('u1', 1_560_000, 3_600_000) };
    assert.deepEqual(h.last.numbers, numbers);
    assert.deepEqual(clock.pending(), [START + 30_000]);
    await clock.advance(29_999);
    await h.render();
    assert.equal(net.posts().length, 1);
    assert.deepEqual(h.last.numbers, numbers, 'the numbers wait for the server');
    await clock.advance(1);
    await h.render();
    const p1 = net.posts()[1];
    assert.deepEqual(posted(p1), { unitKey: 'u1', chainId: uuid(1), seq: 1, stop: false, focus: true, input: false, keepalive: false, auth: 'Bearer tok-1' });
    p1.reply(200, ACCEPT(30_000, STATE(true, null, 3_990_000, UNIT('u1', 1_590_000, 3_600_000))));
    await h.render();
    assert.deepEqual(h.last.view, { kind: 'counting' });
    assert.deepEqual(h.last.numbers, { todayMs: 3_990_000, unit: UNIT('u1', 1_590_000, 3_600_000) }, 'a second answer\'s numbers under the same view');
    h.unmount();
  });

  it('mounted while hidden (a link opened in a background tab): nothing goes and no timer runs, not even on a pageshow, until the page is visible', async () => {
    net.auto = POST_OK();
    dom.doc.visibilityState = 'hidden';
    const h = mountHook(PROPS());
    await h.render();
    dom.pageshow(true);
    await h.render();
    assert.equal(net.calls.length, 0);
    assert.deepEqual(clock.pending(), []);
    assert.deepEqual(h.last.view, { kind: 'idle' });
    dom.show();
    await h.render();
    assert.deepEqual(net.posts().map((c) => [c.body.seq, c.body.stop, c.body.input]), [[0, false, true]]);
    h.unmount();
  });

  it('inputs since the last signal: keydown, pointerdown, wheel, touchstart, focusin, pointermove, a scroll of main#main-content; focus: a blur since the last signal, or the page not focused now', async () => {
    net.auto = POST_OK();
    const h = mountHook(PROPS());
    await h.render();
    const beat = async () => {
      await clock.advance(clock.pending()[0] - clock.now());
      await h.render();
      return net.posts().at(-1).body;
    };
    for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart', 'focusin']) {
      dom.fire(type);
      assert.equal((await beat()).input, true, type);
      assert.equal((await beat()).input, false, `${type}: only since the last signal`);
    }
    await clock.advance(clock.pending()[0] - clock.now() - 500);
    dom.fire('pointermove');
    assert.equal((await beat()).input, true, 'a pointermove');
    await clock.advance(400);
    dom.fire('scroll', dom.main);
    assert.equal((await beat()).input, true, 'a scroll of the main element, right after the last signal\'s pointermove');
    assert.equal((await beat()).input, false);
    dom.fire('scroll', dom.win);
    assert.equal((await beat()).input, false, 'a scroll elsewhere is not the page\'s');
    dom.fire('blur');
    assert.equal((await beat()).focus, false, 'a blur since the last signal');
    assert.equal((await beat()).focus, true);
    dom.focused = false;
    assert.equal((await beat()).focus, false, 'not focused now');
    h.unmount();
  });

  it('hidden: a stop with keepalive at once, with the last signal\'s token (no getSession); no timer while hidden; visible again: a new chain the learner started', async () => {
    net.auto = POST_OK();
    const h = mountHook(PROPS());
    await h.render();
    await clock.advance(30_000);
    await h.render();
    const asked = session.calls;
    dom.fire('keydown');
    dom.hide();
    const stop = net.posts().at(-1);
    assert.deepEqual(posted(stop), { unitKey: 'u1', chainId: uuid(1), seq: 2, stop: true, focus: true, input: true, keepalive: true, auth: 'Bearer tok-1' });
    assert.equal(session.calls, asked, 'sent at once');
    await h.render();
    assert.deepEqual(h.last.view, { kind: 'paused' });
    assert.deepEqual(clock.pending(), []);
    await clock.advance(600_000);
    const count = net.posts().length;
    dom.show();
    await h.render();
    const next = net.posts()[count];
    assert.notEqual(next.body.chainId, uuid(1));
    assert.deepEqual({ ...posted(next), chainId: 'new' }, { unitKey: 'u1', chainId: 'new', seq: 0, stop: false, focus: true, input: true, keepalive: false, auth: 'Bearer tok-1' });
    h.unmount();
  });

  it('page hide: a stop with keepalive; shown again from the back-forward cache with no chain: a new chain; a pageshow that is no restore, or with a chain, does nothing', async () => {
    net.auto = POST_OK();
    const h = mountHook(PROPS());
    await h.render();
    dom.fire('pagehide');
    assert.deepEqual(posted(net.posts().at(-1)), { unitKey: 'u1', chainId: uuid(1), seq: 1, stop: true, focus: true, input: false, keepalive: true, auth: 'Bearer tok-1' });
    const count = net.posts().length;
    dom.pageshow(false);
    await h.render();
    assert.equal(net.posts().length, count, 'not a restore');
    dom.pageshow(true);
    await h.render();
    assert.equal(net.posts().length, count + 1);
    assert.deepEqual([net.posts().at(-1).body.seq, net.posts().at(-1).body.input], [0, true]);
    dom.pageshow(true);
    dom.show();
    await h.render();
    assert.equal(net.posts().length, count + 1, 'the chain goes on: no second start');
    h.unmount();
  });

  it('a stop while its chain\'s first signal waits for its token: neither goes (the server knows nothing of the chain; nothing goes before any token); another account\'s session by then: nothing goes', async () => {
    const held = session.hold();
    const h = mountHook(PROPS());
    await h.render();
    assert.equal(net.posts().length, 0, 'seq 0 waits for getSession');
    dom.hide();
    held.release({ token: 'tok-2' });
    await h.render();
    assert.equal(net.calls.length, 0, 'neither seq 0 nor its stop');
    assert.deepEqual(h.last.view, { kind: 'paused' });
    net.auto = POST_OK();
    dom.show();
    await h.render();
    assert.deepEqual(net.posts().map(posted), [{ unitKey: 'u1', chainId: uuid(2), seq: 0, stop: false, focus: true, input: true, keepalive: false, auth: 'Bearer tok-1' }]);
    // With a token from an earlier chain: a chain none of whose signals went out still gets no stop.
    dom.hide();
    const held3 = session.hold();
    dom.show();
    await h.render();
    dom.hide();
    held3.release();
    await h.render();
    assert.deepEqual(net.posts().map((c) => [c.body.chainId, c.body.seq, c.body.stop]), [[uuid(2), 0, false], [uuid(2), 1, true]]);
    h.unmount();

    net = createNet();
    dom = createDom();
    const held2 = session.hold();
    const g = mountHook(PROPS());
    await g.render();
    dom.hide();
    session.user = U2;
    session.token = 'tok-u2';
    held2.release();
    await g.render();
    assert.equal(net.calls.length, 0, 'nothing for another account');
    dom.show();
    await g.render();
    assert.equal(net.calls.length, 0);
    assert.deepEqual(g.last.view, { kind: 'stopped', cause: 'signin' }, 'the next start hears the account changed');
    g.unmount();
  });

  it('React\'s development double effect (setup, cleanup, setup) while the token is awaited: only the second chain\'s seq 0 goes', async () => {
    net.auto = POST_OK();
    const held = session.hold();
    const first = mountHook(PROPS());
    await first.render();
    first.unmount();
    const second = mountHook(PROPS());
    await second.render();
    held.release();
    await second.render();
    assert.deepEqual(net.posts().map((c) => [c.body.chainId, c.body.seq, c.body.stop]), [[uuid(2), 0, false]]);
    second.unmount();
  });

  it('a stop while a later signal waits for its token: the stop goes at once with the last token and takes that signal\'s input and blur; that signal never goes, whatever its lookup then finds', async () => {
    for (const over of [{ token: 'tok-2' }, { user: null }, { user: U2, token: 'tok-u2' }]) {
      net = createNet();
      net.auto = POST_OK();
      dom = createDom();
      const h = mountHook(PROPS());
      await h.render();
      const chainId = net.posts()[0].body.chainId;
      dom.fire('keydown');
      dom.fire('blur');
      const held = session.hold();
      await clock.advance(clock.pending()[0] - clock.now());
      await h.render();
      assert.equal(net.posts().length, 1, 'seq 1 waits for getSession');
      dom.hide();
      assert.deepEqual(posted(net.posts()[1]), { unitKey: 'u1', chainId, seq: 2, stop: true, focus: false, input: true, keepalive: true, auth: 'Bearer tok-1' });
      held.release(over);
      await h.render();
      assert.equal(net.posts().length, 2, `${JSON.stringify(over)}: seq 1 never goes`);
      assert.deepEqual(h.last.view, { kind: 'paused' });
      h.unmount();
      assert.equal(net.posts().length, 2, 'no second stop');
    }
  });

  it('a stop sent while its chain\'s seq 0 is on its way may reach the server first (not_open): when that seq 0 is stored with the chain going on, the stop goes again, also after the page left; not after another answer, nor for a later seq', async () => {
    const h = mountHook(PROPS());
    await h.render();
    const [p0] = net.posts();
    dom.hide();
    const stop = net.posts()[1];
    assert.deepEqual(posted(stop), { unitKey: 'u1', chainId: p0.body.chainId, seq: 1, stop: true, focus: true, input: false, keepalive: true, auth: 'Bearer tok-1' });
    stop.reply(200, IGNORE('not_open'));
    p0.reply(200, ACCEPT(30_000, STATE(true, null, 1, UNIT('u1', 1, 2))));
    await h.render();
    assert.deepEqual(net.posts().slice(2).map(posted), [posted(stop)], 'the same stop again');
    assert.deepEqual(h.last.view, { kind: 'paused' });
    h.unmount();

    for (const [label, reply, again] of [
      ['stored, the chain going on', (c) => c.reply(200, ACCEPT(30_000)), true],
      ['stored, the chain over', (c) => c.reply(200, ACCEPT(null)), false],
      ['not stored', (c) => c.reply(200, IGNORE('other_place')), false],
      ['failed', (c) => c.fail(), false],
    ]) {
      net = createNet();
      dom = createDom();
      const g = mountHook(PROPS());
      await g.render();
      const [q0] = net.posts();
      g.unmount();
      const left = net.posts()[1];
      assert.deepEqual([left.body.chainId, left.body.seq, left.body.stop, left.keepalive], [q0.body.chainId, 1, true, true]);
      reply(q0);
      await settle();
      assert.deepEqual(net.posts().slice(2).map(posted), again ? [posted(left)] : [], label);
    }

    net = createNet();
    net.auto = (call) => (call.body.seq === 0 ? [200, ACCEPT(30_000)] : undefined);
    dom = createDom();
    const k = mountHook(PROPS());
    await k.render();
    await clock.advance(clock.pending()[0] - clock.now());
    await k.render();
    const k1 = net.posts()[1];
    assert.equal(k1.body.seq, 1);
    dom.hide();
    k1.reply(200, ACCEPT(30_000));
    await k.render();
    assert.deepEqual(net.posts().map((c) => [c.body.seq, c.body.stop]), [[0, false], [1, false], [2, true]], 'a later seq: the server knew the chain');
    k.unmount();
  });

  it('a stop after a failed signal carries its input and blur; after a blur, or with the window not focused, a stop says not focused', async () => {
    net.auto = POST_OK();
    const h = mountHook(PROPS());
    await h.render();
    net.auto = null;
    dom.fire('blur');
    dom.fire('keydown');
    await clock.advance(clock.pending()[0] - clock.now());
    await h.render();
    const s1 = net.posts().at(-1);
    assert.deepEqual([s1.body.seq, s1.body.focus, s1.body.input], [1, false, true]);
    s1.fail();
    await h.render();
    assert.deepEqual(h.last.view, { kind: 'retrying', cause: 'network' });
    h.unmount();
    assert.deepEqual(posted(net.posts().at(-1)), { unitKey: 'u1', chainId: s1.body.chainId, seq: 2, stop: true, focus: false, input: true, keepalive: true, auth: 'Bearer tok-1' }, 'leaving while focused');

    for (const [label, act] of [['a blur, then leaving', (d, g) => { d.fire('blur'); g.unmount(); }], ['not focused, then hidden', (d) => { d.focused = false; d.hide(); }]]) {
      net = createNet();
      net.auto = POST_OK();
      dom = createDom();
      const g = mountHook(PROPS());
      await g.render();
      act(dom, g);
      assert.deepEqual([net.posts().at(-1).body.stop, net.posts().at(-1).body.focus], [true, false], label);
      g.unmount();
    }
  });

  it('a timer that fires far too late (a sleep): a stop for the chain, then a new chain without input', async () => {
    net.auto = POST_OK();
    const h = mountHook(PROPS());
    await h.render();
    dom.fire('keydown');
    clock.jump(10 * 30_000);
    await clock.advance(0);
    await h.render();
    const [first, stop, next] = net.posts();
    assert.deepEqual([stop.body.chainId, stop.body.seq, stop.body.stop, stop.body.input, stop.keepalive], [first.body.chainId, 1, true, true, false]);
    assert.notEqual(next.body.chainId, first.body.chainId);
    assert.deepEqual([next.body.seq, next.body.stop, next.body.input], [0, false, false]);
    h.unmount();

    // A chain whose only signal never went out (no session then): no stop for it, only the new chain.
    net = createNet();
    net.auto = POST_OK();
    dom = createDom();
    session.user = null;
    const g = mountHook(PROPS());
    await g.render();
    assert.equal(net.calls.length, 0);
    session.user = U1;
    clock.jump(10 * 30_000);
    await clock.advance(0);
    await g.render();
    assert.deepEqual(net.posts().map((c) => [c.body.seq, c.body.stop, c.body.input]), [[0, false, false]]);
    g.unmount();
  });

  it('no session right now: the same signal again after the beat; the session is another account\'s: the page stops (sign in again) and sends nothing', async () => {
    net.auto = POST_OK();
    session.user = null;
    const h = mountHook(PROPS());
    await h.render();
    assert.equal(net.posts().length, 0);
    assert.deepEqual(h.last.view, { kind: 'retrying', cause: 'network' });
    assert.deepEqual(clock.pending(), [START + 30_000]);
    session.user = U1;
    await clock.advance(30_000);
    await h.render();
    assert.deepEqual(posted(net.posts()[0]), { unitKey: 'u1', chainId: uuid(1), seq: 0, stop: false, focus: true, input: true, keepalive: false, auth: 'Bearer tok-1' });
    h.unmount();
    assert.deepEqual(posted(net.posts().at(-1)), { unitKey: 'u1', chainId: uuid(1), seq: 1, stop: true, focus: true, input: false, keepalive: true, auth: 'Bearer tok-1' }, 'the stop after the lookup found a session again');

    net = createNet();
    session.user = U2;
    const g = mountHook(PROPS());
    await g.render();
    assert.equal(net.calls.length, 0);
    assert.deepEqual(g.last.view, { kind: 'stopped', cause: 'signin' });
    g.unmount();
    assert.equal(net.calls.length, 0, 'the page stopped: no stop either');

    net = createNet();
    session.user = U1;
    session.client.auth.getSession = () => Promise.reject(new Error('lock lost'));
    const f = mountHook(PROPS());
    await f.render();
    assert.equal(net.calls.length, 0);
    assert.deepEqual(f.last.view, { kind: 'retrying', cause: 'network' }, 'getSession failing: tried again later');
    f.unmount();
  });

  it('a 503 with Retry-After: the same signal again after it, the view saying why meanwhile', async () => {
    const h = mountHook(PROPS());
    await h.render();
    net.posts()[0].reply(503, { error_type: 'training_unavailable' }, { 'Retry-After': '120' });
    await h.render();
    assert.deepEqual(h.last.view, { kind: 'retrying', cause: 'unavailable' });
    assert.deepEqual(clock.pending(), [START + 120_000]);
    net.auto = POST_OK(STATE(false, 'starting', 1, UNIT('u1', 1, 2)));
    await clock.advance(120_000);
    await h.render();
    assert.deepEqual(net.posts().map((c) => [c.body.chainId, c.body.seq, c.body.input]), [[uuid(1), 0, true], [uuid(1), 0, true]]);
    assert.deepEqual(h.last.view, { kind: 'not_counting', reason: 'starting' });
    h.unmount();
  });

  it('other_place: recordHere (「この画面で記録する」) starts a chain the learner started, without a stop for the old one', async () => {
    const h = mountHook(PROPS());
    await h.render();
    net.posts()[0].reply(200, IGNORE('other_place'));
    await h.render();
    assert.deepEqual(h.last.view, { kind: 'other_place' });
    assert.deepEqual(clock.pending(), []);
    net.auto = POST_OK();
    h.last.recordHere();
    await h.render();
    assert.equal(net.posts().length, 2);
    assert.notEqual(net.posts()[1].body.chainId, uuid(1));
    assert.deepEqual([net.posts()[1].body.seq, net.posts()[1].body.stop, net.posts()[1].body.input], [0, false, true]);
    h.unmount();
  });

  it('leaving the page (unmount): a stop with keepalive; then no listener is left and no timer sends anything', async () => {
    net.auto = POST_OK();
    const h = mountHook(PROPS());
    await h.render();
    assert.deepEqual(clock.pending(), [START + 30_000]);
    h.unmount();
    assert.deepEqual(posted(net.posts().at(-1)), { unitKey: 'u1', chainId: uuid(1), seq: 1, stop: true, focus: true, input: false, keepalive: true, auth: 'Bearer tok-1' });
    assert.deepEqual(clock.pending(), []);
    for (const [target, types] of [[dom.win, ['pagehide', 'pageshow', 'blur', 'keydown', 'pointerdown', 'wheel', 'touchstart', 'focusin', 'pointermove']], [dom.doc, ['visibilitychange']], [dom.main, ['scroll']]]) {
      for (const type of types) assert.equal(getEventListeners(target, type).length, 0, type);
    }
    const count = net.calls.length;
    dom.hide();
    dom.show();
    dom.pageshow(true);
    await clock.advance(600_000);
    await settle();
    assert.equal(net.calls.length, count);
  });

  it('no Supabase client (demo and mock modes): signals and the stop go without a token', async () => {
    delete globalThis.__supabase;
    net.auto = POST_OK();
    const h = mountHook(PROPS());
    await h.render();
    dom.hide();
    assert.deepEqual(net.posts().map((c) => [c.body.seq, c.body.stop, c.keepalive, c.headers.Authorization]), [[0, false, false, undefined], [1, true, true, undefined]]);
    h.unmount();
  });

  // --- the pages -----------------------------------------------------------------------------

  it('a class\'s page: today\'s time in the status region; each unit against its set time with a link to study it; the newest days, final or not; the total', async () => {
    globalThis.__params = { cohortId: C1 };
    net.auto = GET(TIME());
    const signIns = [];
    const p = mountPage('CohortTimeView', { learnerId: U1, cohorts: [{ cohortId: C1, name: '2026年11月 Web', role: 'learner' }], onSignIn: () => signIns.push(1) });
    const tree = await p.render();
    assert.equal(net.calls[0].url, `/api/v2/training/cohorts/${C1}/time`);
    assert.equal(statusText(tree), '今日: 1 時間 5 分');
    assert.equal(textOf(elementsOf(tree).find((el) => el.type === 'header')), '2026年11月 Web|受講時間');
    assert.deepEqual(elementsOf(tree).filter((el) => el.type === 'a').map((a) => [a.props.href, textOf(a), a.props['aria-label']]), [
      ['/training', '職業訓練の一覧へ', undefined],
      ['units/u1', '学習する', '学習する: HTML の基本'],
      [`units/${encodeURIComponent('u 2/x')}`, '学習する', '学習する: CSS の基本'],
    ]);
    const items = elementsOf(tree).filter((el) => el.type === 'li').map(textOf);
    assert.deepEqual(items, [
      'HTML の基本|25 分| / |1 時間|学習する',
      'CSS の基本|30 分| / |30 分|設定時間に達しました|学習する',
      '11月2日|1 時間 5 分|まだ確定していません',
      '11月1日|10 分|確定',
    ]);
    assert.ok(textOf(tree).includes('この期の合計|: |1 時間 15 分'));
    const sections = elementsOf(tree).filter((el) => el.type === 'section');
    assert.equal(sections.length, 2);
    assert.ok(sections.every((s) => !textOf(s).includes('この期の合計')), 'the total (every day) is outside the newest days\' list');
    p.unmount();
  });

  it('「もう一度読み込む」 on a class\'s or a unit\'s page: once the new state shows, focus that the button\'s leaving dropped goes to the title; focus elsewhere stays', async () => {
    for (const [name, params, line] of [['CohortTimeView', { cohortId: C1 }, '今日: 1 時間 5 分'], ['UnitTimeView', { cohortId: C1, unitKey: 'u1' }, '記録を始めています…']]) {
      for (const moved of [true, false]) {
        net = createNet();
        dom = createDom();
        globalThis.__params = params;
        net.auto = () => [503, { error_type: 'training_unavailable' }];
        const focused = [];
        globalThis.__title = { focus: (options) => focused.push(options) };
        const p = mountPage(name, { learnerId: U1, cohorts: null, onSignIn: () => {} });
        const failed = await p.render();
        assert.deepEqual(focused, [], 'no focus move on arrival');
        net.auto = null;
        if (!moved) dom.doc.activeElement = { tag: 'a' };
        button(failed, 'もう一度読み込む').props.onClick();
        assert.equal(statusText(await p.render()), '読み込んでいます…');
        assert.deepEqual(focused, [], 'not while loading');
        net.calls.at(-1).reply(200, TIME());
        assert.equal(statusText(await p.render()), line);
        assert.deepEqual(focused, moved ? [{ preventScroll: true }] : [], `${name}, focus ${moved ? 'on the body' : 'elsewhere'}`);
        p.unmount();
      }
    }
    delete globalThis.__title;
  });

  it('a class\'s page: not set up, or outside the dates (no study links); a guest sends nothing; loading; refusals with sign-in and retry; another learner\'s or class\'s answer never shows; English', async () => {
    globalThis.__params = { cohortId: C1 };
    for (const [status, line] of [['not_configured', 'この期の受講時間は、まだ設定されていません。'], ['not_in_session', '今日は期間の外です。受講時間は、期の最初の日から最後の日まで記録します。']]) {
      net = createNet();
      net.auto = GET(TIME({ status, beatMs: undefined }));
      const p = mountPage('CohortTimeView', { learnerId: U1, cohorts: null, onSignIn: () => {} });
      const tree = await p.render();
      assert.equal(statusText(tree), line);
      assert.deepEqual(elementsOf(tree).filter((el) => el.type === 'a').map((a) => a.props.href), ['/training'], 'no study links');
      assert.equal(textOf(elementsOf(tree).find((el) => el.type === 'header')), '受講時間', 'no class name yet');
      p.unmount();
    }
    net = createNet();
    const guest = mountPage('CohortTimeView', { learnerId: null, cohorts: null, onSignIn: () => {} });
    assert.equal(statusText(await guest.render()), 'Rise Path のアカウントでログインすると、受講時間が表示されます。');
    assert.equal(net.calls.length, 0);
    guest.unmount();

    const cases = [
      [401, { error_type: 'sign_in_required' }, 'Rise Path のアカウントでログインすると、受講時間が表示されます。'],
      [401, { error: 'Invalid or expired token' }, 'ログインを確認できませんでした。ログインし直すと、受講時間が表示されます。|ログインし直す'],
      [401, { error_type: 'account_deleted' }, 'この Rise Path のアカウントは削除されています。'],
      [403, { error_type: 'not_a_learner' }, '受講時間があるのは、受講者だけです。'],
      [403, { error_type: 'terms_required' }, '受講時間を読み込めませんでした。|もう一度読み込む'],
      [404, { error_type: 'cohort_not_found' }, 'この期が見つかりません。'],
      [404, { error_type: 'training_off' }, 'ここでは、職業訓練を提供していません。'],
      [503, { error_type: 'training_unavailable' }, '受講時間を読み込めませんでした。|もう一度読み込む'],
      [200, TIME({ learnerId: U2 }), '受講時間を読み込めませんでした。|もう一度読み込む'],
      [200, TIME({ cohortId: C2 }), '受講時間を読み込めませんでした。|もう一度読み込む'],
    ];
    for (const [status, body, want] of cases) {
      net = createNet();
      net.auto = () => [status, body];
      const signIns = [];
      const p = mountPage('CohortTimeView', { learnerId: U1, cohorts: null, onSignIn: () => signIns.push(1) });
      const tree = await p.render();
      assert.equal(statusText(tree), want, `${status} ${JSON.stringify(body).slice(0, 60)}`);
      if (want.endsWith('ログインし直す')) {
        button(tree, 'ログインし直す').props.onClick();
        assert.equal(signIns.length, 1);
      }
      if (want.endsWith('もう一度読み込む')) {
        let release;
        net.auto = null;
        globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify(TIME()), { status: 200 })); });
        button(tree, 'もう一度読み込む').props.onClick();
        assert.equal(statusText(await p.render()), '読み込んでいます…');
        release();
        assert.equal(statusText(await p.render()), '今日: 1 時間 5 分');
      }
      p.unmount();
    }

    globalThis.__language = 'en';
    net = createNet();
    net.auto = GET(TIME());
    const en = mountPage('CohortTimeView', { learnerId: U1, cohorts: null, onSignIn: () => {} });
    const tree = await en.render();
    assert.equal(statusText(tree), 'Today: 1 h 5 min');
    assert.ok(textOf(tree).includes('Total in this class|: |1 h 15 min'));
    assert.deepEqual(elementsOf(tree).filter((el) => el.type === 'li').map(textOf).slice(1), ['CSS basics|30 min| / |30 min|Set time reached|Study', 'Nov 2|1 h 5 min|Not final yet', 'Nov 1|10 min|Final']);
    en.unmount();
  });

  it('a class\'s page: another class (the route changes) aborts the request in flight; its answer never shows', async () => {
    globalThis.__params = { cohortId: C1 };
    const p = mountPage('CohortTimeView', { learnerId: U1, cohorts: null, onSignIn: () => {} });
    assert.equal(statusText(await p.render()), '読み込んでいます…');
    globalThis.__params = { cohortId: C2 };
    assert.equal(statusText(await p.render()), '読み込んでいます…');
    assert.equal(net.calls.length, 2);
    assert.equal(net.calls[0].signal.aborted, true);
    net.calls[0].reply(200, TIME());
    net.calls[1].reply(200, TIME({ cohortId: C2, days: [] }));
    const tree = await p.render();
    assert.equal(statusText(tree), '今日: 0 分');
    p.unmount();
    assert.equal(net.calls[1].signal.aborted, true, 'unmounting aborts');
  });

  it('a unit\'s page: its title and a link back; while the class is in session and the unit is listed, it records: the numbers outside the status region, the line inside', async () => {
    globalThis.__params = { cohortId: C1, unitKey: 'u 2/x' };
    net.auto = GET(TIME());
    const p = mountPage('UnitTimeView', { learnerId: U1, onSignIn: () => {} });
    let tree = await p.render();
    assert.equal(textOf(elementsOf(tree).find((el) => el.type === 'header')), 'CSS の基本');
    assert.deepEqual(elementsOf(tree).filter((el) => el.type === 'a').map((a) => [a.props.href, textOf(a)]), [[`/training/${C1}`, '単元の一覧へ']]);
    assert.equal(statusText(tree), '記録を始めています…');
    assert.equal(textOf(elementsOf(tree).find((el) => el.type === 'dl')), '今日|1 時間 5 分|この単元|30 分| / |30 分|設定時間に達しました');
    const [p0] = net.posts();
    assert.deepEqual(posted(p0), { unitKey: 'u 2/x', chainId: uuid(1), seq: 0, stop: false, focus: true, input: true, keepalive: false, auth: 'Bearer tok-1' });
    p0.reply(200, ACCEPT(30_000, STATE(false, 'cap_reached', 3_930_000, UNIT('u 2/x', 1_800_000, 1_800_000, true))));
    tree = await p.render();
    assert.equal(statusText(tree), 'この単元は設定時間に達しました。これより先は数えません。');
    assert.equal(textOf(elementsOf(tree).find((el) => el.type === 'dl')), '今日|1 時間 5 分|この単元|30 分| / |30 分|設定時間に達しました');
    p.unmount();
    assert.deepEqual([net.posts().at(-1).body.stop, net.posts().at(-1).keepalive], [true, true], 'leaving stops the chain');
  });

  it('a unit\'s page: another unit (the route changes) stops the chain, then starts one the learner started on the new unit; a unit not listed, or a class not in session: a line, and no signal', async () => {
    globalThis.__params = { cohortId: C1, unitKey: 'u1' };
    net.auto = (call) => (call.method === 'GET' ? [200, TIME()] : POST_OK()(call));
    const p = mountPage('UnitTimeView', { learnerId: U1, onSignIn: () => {} });
    await p.render();
    globalThis.__params = { cohortId: C1, unitKey: 'u 2/x' };
    const tree = await p.render();
    assert.equal(net.calls.filter((c) => c.method === 'GET').length, 1, 'the class\'s time is not read again');
    assert.deepEqual(net.posts().map((c) => [c.body.unitKey, c.body.seq, c.body.stop, c.body.input, c.keepalive]), [['u1', 0, false, true, false], ['u1', 1, true, false, true], ['u 2/x', 0, false, true, false]]);
    assert.notEqual(net.posts()[2].body.chainId, net.posts()[0].body.chainId);
    assert.equal(textOf(elementsOf(tree).find((el) => el.type === 'header')), 'CSS の基本');
    p.unmount();

    for (const [unitKey, over, line] of [
      ['u3', {}, 'この単元は、今日の単元表にありません。'],
      ['u1', { status: 'not_in_session', beatMs: undefined }, '今日は期間の外です。受講時間は、期の最初の日から最後の日まで記録します。'],
      ['u1', { status: 'not_configured', beatMs: undefined }, 'この期の受講時間は、まだ設定されていません。'],
    ]) {
      net = createNet();
      net.auto = GET(TIME(over));
      globalThis.__params = { cohortId: C1, unitKey };
      const q = mountPage('UnitTimeView', { learnerId: U1, onSignIn: () => {} });
      assert.equal(statusText(await q.render()), line);
      q.unmount();
      assert.equal(net.posts().length, 0, line);
    }
  });

  it('StudyTimeStatus: a line for every view in both languages; 「この画面で記録する」 only for other_place, 「ログインし直す」 only for a refused sign-in; no numbers before any', () => {
    const reasons = ['not_in_session', 'cap_reached', 'starting', 'gap', 'focus', 'idle', 'other_tab', 'unknown'];
    const views = [
      { kind: 'idle' }, { kind: 'starting' }, { kind: 'counting' }, { kind: 'paused' }, { kind: 'other_place' },
      ...reasons.map((reason) => ({ kind: 'not_counting', reason })),
      ...['network', 'unavailable', 'rate_limited', 'failed'].map((cause) => ({ kind: 'retrying', cause })),
      ...['time_not_configured', 'not_in_session', 'unit_unknown', 'not_a_learner', 'not_found', 'off', 'signin', 'deleted', 'invalid'].map((cause) => ({ kind: 'stopped', cause })),
    ];
    for (const language of ['jp', 'en']) {
      const lines = new Set();
      for (const view of views) {
        const calls = [];
        const rt = createRuntime();
        const tree = rt.render({ type: pages.StudyTimeStatus, props: { view, numbers: null, language, onRecordHere: () => calls.push('here'), onSignIn: () => calls.push('signin') }, key: null });
        const line = pages.recordingText(view, language);
        assert.ok(line, JSON.stringify(view));
        lines.add(line);
        const buttons = elementsOf(tree).filter((el) => el.type === 'button');
        const status = statusText(tree);
        assert.equal(elementsOf(tree).filter((el) => el.type === 'dl').length, 0);
        if (view.kind === 'other_place') {
          assert.equal(buttons.length, 1);
          buttons[0].props.onClick();
          assert.deepEqual(calls, ['here']);
        } else if (view.kind === 'stopped' && view.cause === 'signin') {
          assert.equal(buttons.length, 1);
          buttons[0].props.onClick();
          assert.deepEqual(calls, ['signin']);
        } else assert.equal(buttons.length, 0, JSON.stringify(view));
        assert.equal(status.split('|')[0], line);
      }
      assert.ok(lines.size >= views.length - 4, `${language}: the lines tell the views apart`);
    }
  });

  it('「この画面で記録する」 leaves once recording starts here: focus it had that fell to the page body goes to the section\'s heading; focus elsewhere, or a button never focused, moves nothing', () => {
    for (const [hadFocus, onBody, moved] of [[true, true, true], [true, false, false], [false, true, false]]) {
      const rt = createRuntime();
      const focused = [];
      const render = (view) => rt.render({ type: pages.StudyTimeStatus, props: { view, numbers: null, language: 'jp', onRecordHere: () => {}, onSignIn: () => {} }, key: null });
      const tree = render({ kind: 'other_place' });
      const heading = elementsOf(tree).find((el) => el.type === 'h2');
      assert.equal(heading.props.tabIndex, -1);
      heading.props.ref.current = { focus: (options) => focused.push(options) };
      if (hadFocus) button(tree, 'この画面で記録する').props.onFocus();
      dom.doc.activeElement = onBody ? dom.doc.body : { tag: 'a' };
      render({ kind: 'starting' });
      assert.deepEqual(focused, moved ? [{ preventScroll: true }] : [], `focused ${hadFocus}, on the body ${onBody}`);
      rt.unmount();
    }
  });
});
