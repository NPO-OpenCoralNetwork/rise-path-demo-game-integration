// The review API client (services/reviewApi.ts) against the real review routes (server/routes/review.js):
// a contract test. The bundled client's own getReviewQueue and gradeReviewCard talk to the real
// server.js stack (in-memory tables of helpers/lessonProgressPool.js), so a field the router renames
// or retypes fails here, not only on a learner's screen ('unavailable' for every answer). Checked:
// the GET 200 parses (learnerId, the counts, the cards as written); the grade 200 parses
// (learnerId, graded, summary); the 409 refusals keep what the page acts on (learnerId, summary,
// reviewedToday, dueOn) and map to the page's session actions (reviewModel.ts gradeFailureAction):
// not_due today / later, not_in_queue, review_limit; a 404 not_found keeps its error_type (a skip,
// not an older server).
// The fixtures follow server/tests/reviewRoutes.test.js; the bundle follows reviewClient.test.js.
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { setSupabaseForTests } from '../middleware/auth.js';
import { decodeTokenClaims } from '../../tools/core/oauthToken.js';
import { clearCatalogCacheForTests, getPublishedLesson } from '../../tools/core/courseCatalog.js';
import { lessonReviewCards } from '../../shared/review/cards.js';
import { LESSON_PRIORS } from '../../shared/review/queue.js';
import { addDays, createLessonProgressPool, jstDay } from './helpers/lessonProgressPool.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ALICE = 'aaaaaaaa-6464-4000-8000-000000000001';
const VIBE = 'vibe-coding';
const CH1 = 'vibe-ch1';
const CC = 'claude-code';
const CC4 = 'cc-04-verify';
const DAY_MS = 86400000;

delete process.env.RP_CONTENT_DIR;
clearCatalogCacheForTests();
const cardsOf = (course, lesson) => lessonReviewCards(getPublishedLesson(course, lesson).lesson);
const CH1_CARDS = cardsOf(VIBE, CH1);

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64({ role: 'authenticated', exp: 4_000_000_000, ...payload })}.c2ln`;
const supabase = {
  auth: {
    getUser: async (token) => {
      const id = decodeTokenClaims(token)?.sub;
      if (typeof id !== 'string') return { data: { user: null }, error: { message: 'bad token' } };
      return { data: { user: { id, is_anonymous: false } }, error: null };
    },
  },
};

let at = Date.parse('2026-10-20T03:00:00.000Z');
const today = () => jstDay(new Date(at));
const priorRow = (course, lesson, card, { daysAgo = 2 } = {}) => {
  const learnedAt = new Date(at - daysAgo * DAY_MS);
  const { stability, difficulty, intervalDays } = LESSON_PRIORS.good;
  return { user_id: ALICE, course_slug: course, lesson_id: lesson, card_id: card, learned_at: learnedAt, prior_rating: 3, stability, difficulty, due_day: addDays(jstDay(learnedAt), intervalDays) };
};
const reviewedTodayRow = (course, lesson, card) => ({
  user_id: ALICE, course_slug: course, lesson_id: lesson, card_id: card, learned_at: new Date(at - 5 * DAY_MS), prior_rating: 3,
  stability: 10.96, difficulty: 2.11, reps: 1, last_rating: 3, last_review_day: today(), due_day: addDays(today(), 11),
});

async function bundleClient() {
  const result = await build({
    stdin: {
      contents: "export * from './services/reviewApi';\nexport { gradeFailureAction } from './components/review/reviewModel';",
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    define: { 'import.meta.env': '{"PROD":true}' },
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const getSupabaseClient = () => null; export const getNexloomSupabaseClient = () => null; export const isSupabaseConfigured = () => false;',
          loader: 'js',
        }));
      },
    }],
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'TRUST_PROXY'];
const realFetch = globalThis.fetch;

describe('services/reviewApi.ts against the real review routes (contract)', () => {
  let api = null;
  const saved = {};
  before(async () => {
    api = await bundleClient();
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = 'production';
    at = Date.parse('2026-10-20T03:00:00.000Z');
    resetPoolForTests();
    setSupabaseForTests(supabase);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    setSupabaseForTests(null);
    resetPoolForTests();
  });

  /** Runs `handler` with the client's fetch pointed at a real server for ALICE; returns the raw bodies it saw. */
  const withServer = async (reviewCards, handler) => {
    setPoolForTests(createLessonProgressPool({ clock: () => new Date(at), reviewCards }));
    const app = await createApp({ serveStatic: false, lessonProgress: { afterSave: () => {} }, review: { afterGrade: () => {} } });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const raw = [];
    globalThis.fetch = async (url, init = {}) => {
      assert.ok(String(url).startsWith('/api/v2/user/review'), String(url));
      const res = await realFetch(`http://127.0.0.1:${server.address().port}${url}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${jwt({ sub: ALICE, aud: 'authenticated' })}` },
      });
      const text = await res.text();
      raw.push({ status: res.status, body: JSON.parse(text) });
      return new Response(text, { status: res.status, headers: res.headers });
    };
    try {
      await handler(raw);
    } finally {
      globalThis.fetch = realFetch;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
  const grade = (cardId, rating = 'good', course = VIBE, lesson = CH1) => api.gradeReviewCard({ courseSlug: course, lessonId: lesson, cardId, rating });
  const refusal = async (promise) => {
    try {
      await promise;
    } catch (err) {
      return err;
    }
    assert.fail('expected a refusal');
  };
  const SUMMARY_KEYS = ['today', 'dailyLimit', 'doneToday', 'remainingToday', 'dueTotal', 'carriedOver', 'inQueue', 'nextDueOn'];
  const summaryOf = (body) => Object.fromEntries(SUMMARY_KEYS.map((k) => [k, body[k]]));

  it('GET 200 and the grade 200: the client parses the router\'s answers; nothing is lost', async () => {
    await withServer([priorRow(VIBE, CH1, 'card-frontend'), priorRow(VIBE, CH1, 'card-backend')], async (raw) => {
      const queue = await api.getReviewQueue();
      assert.ok(queue, 'parsed');
      const body = raw.at(-1).body;
      assert.equal(raw.at(-1).status, 200);
      assert.equal(queue.learnerId, ALICE);
      assert.deepEqual(summaryOf(queue), summaryOf(body));
      assert.equal(queue.timeZone, body.timeZone);
      assert.equal(queue.cards.length, 2);
      assert.deepEqual(queue.cards, body.cards, 'the cards as the router wrote them (texts as in the lesson)');
      const byId = Object.fromEntries(CH1_CARDS.map((c) => [c.cardId, c]));
      for (const card of queue.cards) assert.deepEqual([card.front, card.back], [byId[card.cardId].front, byId[card.cardId].back]);

      const result = await grade('card-frontend');
      const graded = raw.at(-1).body;
      assert.equal(raw.at(-1).status, 200);
      assert.equal(result.learnerId, ALICE);
      assert.deepEqual(result.graded, graded.graded);
      assert.deepEqual(result.summary, graded.summary);
      assert.deepEqual([result.summary.today, result.summary.doneToday, result.summary.remainingToday], [today(), 1, 1]);
    });
  });

  it('409 not_due (today and later) and not_in_queue keep learnerId, summary, reviewedToday and dueOn, and the page skips the card; 404 not_found keeps its error_type', async () => {
    await withServer([priorRow(VIBE, CH1, 'card-frontend'), priorRow(VIBE, CH1, 'card-backend', { daysAgo: 0 })], async (raw) => {
      const later = await refusal(grade('card-backend'));
      assert.equal(raw.at(-1).status, 409);
      assert.deepEqual([later.status, later.errorType, later.learnerId, later.reviewedToday, later.dueOn], [409, 'not_due', ALICE, false, addDays(today(), 2)]);
      assert.deepEqual(later.summary, raw.at(-1).body.summary);
      assert.deepEqual(api.gradeFailureAction(later, 'good', ALICE), { type: 'skipped', kind: 'not_due_later', summary: later.summary });

      const first = await grade('card-frontend');
      const repeat = await refusal(grade('card-frontend', 'again'));
      assert.deepEqual([repeat.errorType, repeat.learnerId, repeat.reviewedToday, repeat.dueOn], ['not_due', ALICE, true, first.graded.dueOn]);
      assert.deepEqual(repeat.summary, first.summary);
      assert.deepEqual(api.gradeFailureAction(repeat, 'again', ALICE), { type: 'skipped', kind: 'not_due_today', summary: repeat.summary });

      const gone = await refusal(grade(CH1_CARDS.find((c) => !['card-frontend', 'card-backend'].includes(c.cardId)).cardId));
      assert.deepEqual([gone.status, gone.errorType, gone.learnerId], [409, 'not_in_queue', ALICE]);
      assert.deepEqual(gone.summary, raw.at(-1).body.summary);
      assert.equal(api.gradeFailureAction(gone, 'good', ALICE).type, 'skipped');

      const missing = await refusal(grade('card-nope'));
      assert.deepEqual([missing.status, missing.errorType], [404, 'not_found']);
      assert.deepEqual(api.gradeFailureAction(missing, 'good', ALICE), { type: 'skipped', kind: 'not_found', summary: undefined }, 'a removed card, not an older server');
    });
  });

  it('409 review_limit keeps learnerId and the summary (carried-over cards), and ends the page\'s session', async () => {
    const done = cardsOf(CC, CC4).slice(0, 7).map((c) => reviewedTodayRow(CC, CC4, c.cardId));
    await withServer([...done, ...CH1_CARDS.slice(1, 4).map((c) => reviewedTodayRow(VIBE, CH1, c.cardId)), priorRow(VIBE, CH1, 'card-frontend')], async (raw) => {
      const limit = await refusal(grade('card-frontend'));
      assert.deepEqual([limit.status, limit.errorType, limit.learnerId], [409, 'review_limit', ALICE]);
      assert.deepEqual(limit.summary, raw.at(-1).body.summary);
      assert.deepEqual([limit.summary.doneToday, limit.summary.remainingToday, limit.summary.carriedOver], [10, 0, 1]);
      assert.deepEqual(api.gradeFailureAction(limit, 'good', ALICE), { type: 'limit', summary: limit.summary });
    });
  });
});
