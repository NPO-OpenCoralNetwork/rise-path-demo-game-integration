// Phase 6 stage 4 (design §4, §7.1 "MCP" rows): the remote MCP review tools course-review-due and
// course-review-grade (mcp-server/createMcpServer.js, tools/core/reviewQueue.js reviewDueForAgent,
// reviewGradeForAgent, REVIEW_PROTOCOL), end to end through the remote endpoint in process
// (helpers/remoteMcpEndpoint.js: fake Supabase, learner-remote profile, in-memory daily caps) with
// the AI access tables (helpers/aiAccessPool.js) and an in-memory lesson_progress / review_cards /
// review_log (helpers/lessonProgressPool.js, exact SQL, migration 020's CHECKs):
// - tools/list: the registry annotations, the schemas, the descriptions;
// - the due list: fronts only (no back, memory, learning day or history at any depth), at most 10,
//   the most at risk first, with review_protocol; it enters the cards the learner's records imply;
//   one locale per card (a lesson without the requested language stays in its own);
// - reveal: the back, recorded: false, no write; a card not due is refused;
// - rating: the learner's choice recorded with source 'mcp', the back and the next review day; once
//   a day (not_due with due_on and reviewed_today only, also after a web review); 10 a day;
// - refusals (validation, not_found, not_in_queue), the token's learner only, adults only, the
//   daily caps (a grade call, a reveal too, is charged mcp_write), no learning day, no XP;
// - review_unavailable / review_failed with fixed text.
// The same statements on PostgreSQL 16 as risepath_mcp_remote: scripts/db/verify-phase6.mjs P4.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { REVIEW_PROTOCOL, gradeReviewCard, reviewCatalog, reviewDueForAgent, reviewGradeForAgent } from '../../tools/core/reviewQueue.js';
import { resolveText } from '../../shared/lesson/text.js';
import { GOOD, AGAIN, scheduler, seededUnit } from '../../shared/review/fsrs.js';
import { LESSON_PRIORS } from '../../shared/review/queue.js';
import { createAiAccessPool } from './helpers/aiAccessPool.js';
import { addDays, createLessonProgressPool, jstDay, SQL } from './helpers/lessonProgressPool.js';
import { startFakeSupabase } from './helpers/fakeSupabase.js';
import { connectRemoteClient, startRemoteEndpoint } from './helpers/remoteMcpEndpoint.js';

const registry = createRequire(import.meta.url)('../../mcp-server/tool-registry.json');

const ALICE = 'a1a1a1a1-6666-4000-8000-0000000000a1';
const BOB = 'a2a2a2a2-6666-4000-8000-0000000000a2';
const CAPPED = 'd4d4d4d4-6666-4000-8000-0000000000d4';
const MINOR = 'b1b1b1b1-6666-4000-8000-0000000000b1';
const NO_AGE = 'c3c3c3c3-6666-4000-8000-0000000000c3';
const CLIENT = 'c1c1c1c1-0000-4000-8000-000000000001';
const REVIEW_TOOLS = ['course-review-due', 'course-review-grade'];
const VIBE = 'vibe-coding';
const CH1 = 'vibe-ch1';
const CC = 'claude-code';
const CC1 = 'cc-01-first-session';
const CC2 = 'cc-02-permissions';
const DAY_MS = 86400000;

/** Statements of the review queue, the learner lock, today and transactions go to the in-memory tables. */
const PROGRESS_SQL = /lesson_progress|review_cards|review_log|learning_days|xp_awards|^select to_char\(\(now\(\)|^begin$|^commit$|^rollback$/;
/** What an AI app's review must never write or read (Phase 5 R8, no XP). */
const NEVER = /learning_days|xp_awards|lesson_progress_lesson_resets/;
/** Keys the due list never has, at any depth: the back, the memory, the learning day, the history. */
const SECRET_KEYS = ['back', 'stability', 'difficulty', 'learned_at', 'is_new', 'reps', 'lapses', 'last_rating', 'last_review_day', 'prior_rating', 'entered_at', 'due_on', 'rating'];

/** The fake's clock: every transaction's now(). */
let at = Date.parse('2026-10-20T03:00:00.000Z');
const today = () => jstDay(new Date(at));

const catalog = reviewCatalog();
const card = (course, lesson, id) => catalog.get(`${course}/${lesson}/${id}`);
const idsOf = (course, lesson) => [...catalog.values()].filter((c) => c.courseSlug === course && c.lessonId === lesson).map((c) => c.cardId);
/** Every value of a localized text. */
const variants = (text) => (typeof text === 'string' ? [text] : Object.values(text));

/** A review_cards seed: the lesson as the first rating `daysAgo` days back (Good, or Again). */
const priorRow = (course, lesson, id, { daysAgo = 3, again = false, user = ALICE } = {}) => {
    const learnedAt = new Date(at - daysAgo * DAY_MS);
    const memory = again ? LESSON_PRIORS.again : LESSON_PRIORS.good;
    return {
        user_id: user, course_slug: course, lesson_id: lesson, card_id: id, learned_at: learnedAt, prior_rating: again ? 1 : 3,
        stability: memory.stability, difficulty: memory.difficulty, due_day: addDays(jstDay(learnedAt), memory.intervalDays),
    };
};
/** A card graded today (Good, after a prior learned five days ago). */
const reviewedTodayRow = (course, lesson, id, user = ALICE) => ({
    user_id: user, course_slug: course, lesson_id: lesson, card_id: id, learned_at: new Date(at - 5 * DAY_MS), prior_rating: 3,
    stability: 10.96, difficulty: 2.11, reps: 1, last_rating: 3, last_review_day: today(), due_day: addDays(today(), 11),
});
/** A lesson_progress row finished long ago (a record any writer left: the web, or the AI app's own course tools). */
const finishedRow = (course, lesson, user = ALICE) => ({ user_id: user, course_slug: course, lesson_id: lesson, progress: { v: 1, seen: [], answers: {}, checks: {} }, pct: 100, state: 'read' });

/** Calls fn(key, value, path) for every object member in a JSON value. */
function walk(value, fn, path = '') {
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, fn, `${path}[${i}]`));
    else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
            fn(key, item, `${path}.${key}`);
            walk(item, fn, `${path}.${key}`);
        }
    }
}

let db;
/** AI access (adults, a minor, no age) plus the in-memory tables behind one pool. */
function use(seed = {}) {
    const progress = createLessonProgressPool({ clock: () => new Date(at), ...seed });
    const pool = createAiAccessPool({
        ages: { [ALICE]: '1990-01', [BOB]: '1988-03', [CAPPED]: '1980-02', [MINOR]: '2012-05' },
        answer: (sql, params) => (PROGRESS_SQL.test(sql) ? progress.query(sql, params) : undefined),
    });
    db = { pool, progress };
    setPoolForTests(pool);
    return db;
}
const parse = (result) => JSON.parse(result.content[0].text);
/** The review statements since `from` (normalized), named by the fake's SQL keys. */
const NAMES = new Map(Object.entries(SQL).map(([name, text]) => [text, name]));
const statementNames = (from = 0) => db.progress.queries.slice(from).map((q) => NAMES.get(q.sql) ?? q.sql);

describe('MCP review tools over the remote endpoint', () => {
    let fake;
    let endpoint;
    const clients = [];
    const savedConsole = { log: console.log, warn: console.warn, error: console.error };
    const quiet = () => {};
    const logger = { log: quiet, warn: quiet, error: quiet };
    const connect = async (sub, target = endpoint) => {
        const token = fake.accessToken({ resource: target.resource, sub, clientId: CLIENT });
        const client = await connectRemoteClient(target, token);
        clients.push(client);
        return client;
    };
    /** callTool, parsed: { isError, body, text }; review results are compact JSON. */
    const call = async (client, name, args) => {
        const result = await client.callTool({ name, arguments: args });
        const text = result.content[0].text;
        if (result.isError !== true) assert.ok(!text.includes('\n'), `${name}: compact JSON`);
        return { isError: result.isError === true, body: JSON.parse(text), text };
    };
    const gradeArgs = (args) => ({ course_slug: VIBE, lesson_id: CH1, card_id: 'card-frontend', ...args });

    before(async () => {
        console.log = quiet;
        console.warn = quiet;
        console.error = quiet;
        fake = await startFakeSupabase();
        endpoint = await startRemoteEndpoint({ fake, logger });
    });

    after(async () => {
        for (const client of clients) await client.close().catch(() => {});
        await endpoint.close();
        await fake.close();
        resetPoolForTests();
        resetAiAccessForTests();
        Object.assign(console, savedConsole);
    });

    beforeEach(() => {
        at = Date.parse('2026-10-20T03:00:00.000Z');
        use();
        resetAiAccessForTests();
    });

    // Phase 5 R8 and no XP: no AI-app review statement ever names a learning day, XP or a generation.
    afterEach(() => {
        const named = [...db.pool.queries, ...db.progress.queries].filter((q) => NEVER.test(q.sql));
        assert.deepEqual(named.map((q) => q.sql), [], 'no MCP review statement names learning_days, xp_awards or the lesson generations');
    });

    it('tools/list: both tools with the registry annotations, no rp_turn or user_id, and the grade schema', async () => {
        const client = await connect(ALICE);
        const { tools } = await client.listTools();
        for (const id of REVIEW_TOOLS) {
            const tool = tools.find((t) => t.name === id);
            assert.ok(tool, id);
            assert.deepEqual(tool.annotations, registry.tools.find((t) => t.tool_id === id).annotations, id);
            const props = Object.keys(tool.inputSchema.properties ?? {});
            assert.ok(!props.includes('rp_turn') && !props.includes('user_id'), id);
        }
        const due = tools.find((t) => t.name === 'course-review-due');
        assert.deepEqual(Object.keys(due.inputSchema.properties), ['locale']);
        assert.match(due.description, /question side only, no answers/);
        assert.match(due.description, /Follow review_protocol: show one front at a time, wait for the learner's own answer, then show the answer with course-review-grade \(reveal: true\)/);
        assert.match(due.description, /問いだけ。答えは含まない/);
        const grade = tools.find((t) => t.name === 'course-review-grade');
        assert.deepEqual([...grade.inputSchema.required].sort(), ['card_id', 'course_slug', 'lesson_id']);
        assert.deepEqual(grade.inputSchema.properties.rating.enum, ['again', 'good']);
        assert.equal(grade.inputSchema.properties.reveal.type, 'boolean');
        assert.match(grade.description, /rating records the learner's own choice and cannot be undone/);
        assert.match(grade.description, /Never choose for the learner or show the answer before they tried/);
        assert.match(grade.description, /again \(もう一度: did not remember\) or good \(覚えた: remembered\)/);
        // not_due is a card due later or already recorded today, not a due card outside today's list.
        assert.match(grade.description, /期日の来ていないカードと今日すでに記録したカードは not_due/);
        assert.match(grade.description, /A card not due yet, or already recorded today, is refused \(not_due\)/);
        assert.match(grade.description, /review_limit/);
    });

    it('course-review-due: fronts only at any depth, at most 10, the most at risk first, with review_protocol; it enters the cards the records imply', async () => {
        // Two lessons finished long before (12 cards; no review row yet): the read enters them.
        use({ rows: [finishedRow(VIBE, CH1), finishedRow(CC, CC1)] });
        const client = await connect(ALICE);
        const from = db.progress.queries.length;
        const { isError, body, text } = await call(client, 'course-review-due', {});
        assert.equal(isError, false, text);
        assert.deepEqual(statementNames(from), ['begin', 'advisoryLock', 'enterReviewCards', 'selectToday', 'reviewRows', 'commit']);
        assert.deepEqual(Object.keys(body), ['today', 'time_zone', 'daily_limit', 'done_today', 'remaining_today', 'carried_over', 'next_due_on', 'cards', 'review_protocol']);
        assert.deepEqual({ ...body, cards: body.cards.length, review_protocol: undefined }, {
            today: today(), time_zone: 'Asia/Tokyo', daily_limit: 10, done_today: 0, remaining_today: 10, carried_over: 2,
            next_due_on: null, cards: 10, review_protocol: undefined,
        });
        assert.equal(body.review_protocol, REVIEW_PROTOCOL);
        assert.equal(db.progress.reviewRows(ALICE).length, 12, 'the read entered every card of both lessons');
        assert.ok(db.progress.reviewRows(ALICE).every((r) => r.stability === LESSON_PRIORS.good.stability && r.prior_rating === 3), 'the lesson as the first rating');
        for (const item of body.cards) {
            assert.deepEqual(Object.keys(item), ['course_slug', 'lesson_id', 'lesson_title', 'card_id', 'front', 'locale']);
            const source = card(item.course_slug, item.lesson_id, item.card_id);
            assert.equal(item.front, resolveText(source.front, 'jp').value);
            assert.equal(item.lesson_title, resolveText(source.lessonTitle, 'jp').value);
            assert.equal(item.locale, 'jp');
        }
        walk(body, (key, _value, where) => assert.ok(!SECRET_KEYS.includes(key), `${where}: no ${key} in the due list`));
        for (const source of [...catalog.values()].filter((c) => [CH1, CC1].includes(c.lessonId))) {
            for (const back of variants(source.back)) assert.ok(!text.includes(back), `no back of ${source.cardId}`);
        }
        const second = await call(client, 'course-review-due', {});
        assert.deepEqual(second.body.cards, body.cards, 'a second read adds nothing and keeps the order');
        assert.equal(db.progress.reviewRows(ALICE).length, 12);
    });

    it('course-review-due: the least remembered first; a lesson finished today has no card due yet (next_due_on)', async () => {
        use({
            reviewCards: [
                priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 }),
                priorRow(VIBE, CH1, 'card-api', { daysAgo: 6 }),
                priorRow(VIBE, CH1, 'card-deploy', { daysAgo: 1, again: true }),
                priorRow(CC, CC1, 'card-loop', { daysAgo: 0 }),
            ],
        });
        const client = await connect(ALICE);
        const { body } = await call(client, 'course-review-due', {});
        // R: the 「もう一度」 mark a day ago 0.77, Good six days ago 0.82, Good two days ago 0.91.
        assert.deepEqual(body.cards.map((c) => c.card_id), ['card-deploy', 'card-api', 'card-frontend'], 'lowest retrievability first');
        assert.equal(body.next_due_on, addDays(today(), 2), 'the card learned today comes back in two days');
        assert.equal(body.remaining_today, 3);
    });

    it('locale: English for a lesson that has it, Japanese for one that does not; each card says which', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend'), priorRow(CC, CC1, 'card-loop')] });
        const client = await connect(ALICE);
        const { body } = await call(client, 'course-review-due', { locale: 'en-US' });
        const vibe = body.cards.find((c) => c.lesson_id === CH1);
        const cc = body.cards.find((c) => c.lesson_id === CC1);
        assert.deepEqual([vibe.front, vibe.lesson_title, vibe.locale], [card(VIBE, CH1, 'card-frontend').front.en, card(VIBE, CH1, 'card-frontend').lessonTitle.en, 'en']);
        assert.deepEqual([cc.front, cc.locale], [card(CC, CC1, 'card-loop').front, 'jp']);
        const revealed = await call(client, 'course-review-grade', gradeArgs({ reveal: true, locale: 'en' }));
        assert.equal(revealed.body.back, card(VIBE, CH1, 'card-frontend').back.en);
        assert.equal(revealed.body.locale, 'en');
    });

    it('reveal: the back with recorded: false, nothing written; a card not due is refused without its back', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend'), priorRow(VIBE, CH1, 'card-api', { daysAgo: 0 })] });
        const client = await connect(ALICE);
        const before = db.progress.reviewRows(ALICE);
        const from = db.progress.queries.length;
        const { isError, body } = await call(client, 'course-review-grade', gradeArgs({ reveal: true }));
        assert.equal(isError, false);
        const source = card(VIBE, CH1, 'card-frontend');
        assert.deepEqual(body, { course_slug: VIBE, lesson_id: CH1, card_id: 'card-frontend', front: source.front.jp, back: source.back.jp, locale: 'jp', recorded: false });
        assert.deepEqual(statementNames(from), ['begin', 'advisoryLock', 'lockReviewCard', 'doneToday', 'rollback']);
        assert.deepEqual(db.progress.reviewRows(ALICE), before);
        assert.deepEqual(db.progress.logRows(ALICE), []);

        const early = await call(client, 'course-review-grade', gradeArgs({ card_id: 'card-api', reveal: true }));
        assert.equal(early.isError, true);
        assert.deepEqual(early.body, { error: `This card is not due today (next review: ${addDays(today(), 2)}).`, error_type: 'not_due', due_on: addDays(today(), 2), reviewed_today: false });
        for (const back of variants(card(VIBE, CH1, 'card-api').back)) assert.ok(!early.text.includes(back));
    });

    it('rating: records the learner\'s choice (source mcp), answers the back and the next review day; once a day', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 }), priorRow(VIBE, CH1, 'card-api', { daysAgo: 4 })] });
        const client = await connect(ALICE);
        const from = db.progress.queries.length;
        const { isError, body, text } = await call(client, 'course-review-grade', gradeArgs({ rating: 'good' }));
        assert.equal(isError, false, text);
        const next = scheduler.review({ stability: LESSON_PRIORS.good.stability, difficulty: LESSON_PRIORS.good.difficulty }, GOOD, 2, { fuzzUnit: seededUnit(`${VIBE}/${CH1}/card-frontend#1`) });
        const source = card(VIBE, CH1, 'card-frontend');
        assert.deepEqual(body, {
            course_slug: VIBE, lesson_id: CH1, card_id: 'card-frontend', rating: 'good', recorded: true,
            front: source.front.jp, back: source.back.jp,
            next_review_day: addDays(today(), next.intervalDays), next_review_in_days: next.intervalDays,
            done_today: 1, remaining_today: 1, daily_limit: 10, locale: 'jp',
        });
        assert.deepEqual(statementNames(from), ['begin', 'advisoryLock', 'lockReviewCard', 'doneToday', 'gradeReviewCard', 'insertReviewLog', 'selectToday', 'reviewRows', 'commit']);
        const [log] = db.progress.logRows(ALICE);
        assert.deepEqual([log.source, log.rating, log.elapsed_days, log.interval_days, log.review_day], ['mcp', 3, 2, next.intervalDays, today()]);

        // The same card again today: refused, with the next day only (not what was recorded, not the back).
        const again = await call(client, 'course-review-grade', gradeArgs({ rating: 'again' }));
        assert.equal(again.isError, true);
        assert.deepEqual(again.body, {
            error: `This card was already recorded today (next review: ${body.next_review_day}).`,
            error_type: 'not_due', due_on: body.next_review_day, reviewed_today: true,
        });
        assert.equal(db.progress.logRows(ALICE).length, 1);
        assert.equal(db.progress.reviewCard(ALICE, VIBE, CH1, 'card-frontend').last_rating, 3, 'the first rating stands');

        // 「もう一度」 on a card with a memory is a lapse.
        const lapse = await call(client, 'course-review-grade', gradeArgs({ card_id: 'card-api', rating: 'again' }));
        assert.equal(lapse.isError, false, lapse.text);
        const expected = scheduler.review({ stability: LESSON_PRIORS.good.stability, difficulty: LESSON_PRIORS.good.difficulty }, AGAIN, 4, { fuzzUnit: seededUnit(`${VIBE}/${CH1}/card-api#1`) });
        assert.equal(lapse.body.next_review_in_days, expected.intervalDays);
        const row = db.progress.reviewCard(ALICE, VIBE, CH1, 'card-api');
        assert.deepEqual([row.reps, row.lapses, row.last_rating], [1, 1, 1]);
        assert.deepEqual(db.progress.daysOf(ALICE), [], 'no learning day from an AI app');
        assert.deepEqual(db.progress.awardsOf(ALICE), [], 'no XP');
    });

    it('a card graded on the web today: not_due with due_on and reviewed_today only, for a rating and a reveal', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { daysAgo: 2 })] });
        const web = await gradeReviewCard({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, cardId: 'card-frontend', rating: 'again', source: 'web' });
        assert.ok(!('error_type' in web));
        const client = await connect(ALICE);
        for (const args of [{ rating: 'good' }, { reveal: true }]) {
            const refused = await call(client, 'course-review-grade', gradeArgs(args));
            assert.equal(refused.isError, true);
            assert.deepEqual(Object.keys(refused.body), ['error', 'error_type', 'due_on', 'reviewed_today']);
            assert.deepEqual([refused.body.error_type, refused.body.due_on, refused.body.reviewed_today], ['not_due', web.graded.dueOn, true]);
            for (const back of variants(card(VIBE, CH1, 'card-frontend').back)) assert.ok(!refused.text.includes(back));
            assert.doesNotMatch(refused.text, /again|もう一度|rating/, 'the AI app does not learn what the learner chose on the web');
        }
        assert.deepEqual(db.progress.logRows(ALICE).map((l) => l.source), ['web']);
    });

    it('10 a day: the 11th card is refused (review_limit) for a rating and a reveal; the due list is empty and carries the rest', async () => {
        const done = [...idsOf(CC, CC2).map((id) => reviewedTodayRow(CC, CC2, id)), ...idsOf(CC, CC1).slice(0, 2).map((id) => reviewedTodayRow(CC, CC1, id))];
        assert.equal(done.length, 9);
        use({ reviewCards: [...done, priorRow(VIBE, CH1, 'card-frontend'), priorRow(VIBE, CH1, 'card-api'), priorRow(VIBE, CH1, 'card-deploy')] });
        const client = await connect(ALICE);
        const tenth = await call(client, 'course-review-grade', gradeArgs({ rating: 'good' }));
        assert.equal(tenth.isError, false, tenth.text);
        assert.deepEqual([tenth.body.done_today, tenth.body.remaining_today], [10, 0]);
        for (const args of [{ card_id: 'card-api', rating: 'good' }, { card_id: 'card-deploy', reveal: true }]) {
            const refused = await call(client, 'course-review-grade', gradeArgs(args));
            assert.equal(refused.isError, true);
            assert.deepEqual(refused.body, { error: 'The learner has reviewed 10 cards today. The rest come back on later days.', error_type: 'review_limit', done_today: 10, daily_limit: 10 });
        }
        const due = await call(client, 'course-review-due', {});
        assert.deepEqual([due.body.done_today, due.body.remaining_today, due.body.carried_over, due.body.cards], [10, 0, 2, []]);
        assert.equal(db.progress.logRows(ALICE).length, 1);
    });

    it('refusals: validation, not_found and not_in_queue with fixed text; the token\'s learner only', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend')], rows: [finishedRow(VIBE, CH1, BOB)] });
        const alice = await connect(ALICE);
        const exactlyOne = 'Send rating ("again" or "good", the learner\'s own choice) or reveal: true, exactly one of them.';
        for (const args of [{ rating: 'good', reveal: true }, {}, { reveal: false }]) {
            const from = db.progress.queries.length;
            const r = await call(alice, 'course-review-grade', gradeArgs(args));
            assert.deepEqual(r.body, { error: exactlyOne, error_type: 'validation' }, JSON.stringify(args));
            assert.equal(db.progress.queries.length, from, 'nothing read');
        }
        const badId = await call(alice, 'course-review-grade', gradeArgs({ card_id: 'Card A', rating: 'good' }));
        assert.deepEqual(badId.body, { error: 'course_slug, lesson_id and card_id must name a card from course-review-due.', error_type: 'validation' });
        const schema = await alice.callTool({ name: 'course-review-grade', arguments: gradeArgs({ rating: 'hard' }) }).then((r) => r.isError === true, () => true);
        assert.equal(schema, true, 'a rating other than again or good is refused by the schema');
        const from = db.progress.queries.length;
        const missing = await call(alice, 'course-review-grade', gradeArgs({ card_id: 'card-nope', rating: 'good' }));
        assert.deepEqual(missing.body, { error: 'This card is not in a published lesson.', error_type: 'not_found' });
        assert.equal(db.progress.queries.length, from, 'not_found before any statement');
        const notEntered = await call(alice, 'course-review-grade', gradeArgs({ card_id: 'card-api', rating: 'good' }));
        assert.deepEqual(notEntered.body, { error: 'This card is not in the learner\'s reviews. course-review-due lists today\'s cards.', error_type: 'not_in_queue' });

        // Bob grades Alice's card: his own queue does not hold it; Alice's row is untouched.
        const bob = await connect(BOB);
        const before = db.progress.reviewRows(ALICE);
        const crossed = await call(bob, 'course-review-grade', gradeArgs({ rating: 'good' }));
        assert.equal(crossed.body.error_type, 'not_in_queue');
        assert.deepEqual(db.progress.reviewRows(ALICE), before);
        const bobsDue = await call(bob, 'course-review-due', {});
        assert.ok(bobsDue.body.cards.every((c) => c.lesson_id === CH1));
        assert.deepEqual(db.progress.reviewRows(BOB).map((r) => r.user_id), Array(5).fill(BOB), 'his own records entered his own cards');
        assert.deepEqual(db.progress.reviewRows(ALICE), before);
    });

    for (const [label, user, errorType] of [['a minor', MINOR, 'adults_only'], ['a learner with no age', NO_AGE, 'age_required']]) {
        it(`${label}: both tools are refused (${errorType}) before anything reads the queue`, async () => {
            use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { user })], rows: [finishedRow(VIBE, CH1, user)] });
            const client = await connect(user);
            for (const [name, args] of [['course-review-due', {}], ['course-review-grade', gradeArgs({ reveal: true })], ['course-review-grade', gradeArgs({ rating: 'good' })]]) {
                const result = await call(client, name, args);
                assert.equal(result.isError, true, name);
                assert.equal(result.body.error_type, errorType, name);
            }
            assert.deepEqual(db.progress.progressStatements(), [], 'no statement touched the review or lesson tables');
            assert.equal(db.progress.reviewRows(user).length, 1);
        });
    }

    it('daily caps: every grade call (a reveal too) is charged mcp_write; the due list is not', async () => {
        const capped = await startRemoteEndpoint({ fake, logger, capsEnv: { AI_CAP_USER_MCP_WRITE: '2' } });
        try {
            use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend', { user: CAPPED }), priorRow(VIBE, CH1, 'card-api', { user: CAPPED })] });
            const client = await connect(CAPPED, capped);
            assert.equal((await call(client, 'course-review-grade', gradeArgs({ reveal: true }))).isError, false);
            assert.equal((await call(client, 'course-review-grade', gradeArgs({ rating: 'good' }))).isError, false);
            const over = await call(client, 'course-review-grade', gradeArgs({ card_id: 'card-api', reveal: true }));
            assert.deepEqual([over.body.error_type, over.body.kind], ['daily_limit_reached', 'mcp_write']);
            const due = await call(client, 'course-review-due', {});
            assert.equal(due.isError, false, 'the due list uses mcp only');
            assert.deepEqual(due.body.cards.map((c) => c.card_id), ['card-api']);
            assert.equal(db.progress.logRows(CAPPED).length, 1);
        } finally {
            await capped.close();
        }
    });

    it('a missing table, column (migration 020 not applied) or grant is review_unavailable, any other failure review_failed: fixed text, never the driver\'s', async () => {
        use({ reviewCards: [priorRow(VIBE, CH1, 'card-frontend')] });
        const client = await connect(ALICE);
        const unavailable = { error: 'Reviews are not available on this server right now. Please try again later.', error_type: 'review_unavailable' };
        // 42703: before migration 020 PostgreSQL reports the entry's lesson_progress.progress_changed_at first.
        for (const code of ['42501', '42P01', '42703']) {
            db.progress.fail({ code, message: `driver text: relation "review_cards" secret-${code}`, when: (sql) => /review_cards/.test(sql) });
            for (const [name, args] of [['course-review-due', {}], ['course-review-grade', gradeArgs({ rating: 'good' })]]) {
                const r = await call(client, name, args);
                assert.deepEqual(r.body, unavailable, `${name} ${code}`);
            }
        }
        db.progress.fail({ code: 'XX000', message: 'driver text: secret-internal', when: (sql) => /review_cards/.test(sql) });
        assert.deepEqual((await call(client, 'course-review-due', {})).body, { error: 'The review cards could not be read.', error_type: 'review_failed' });
        assert.deepEqual((await call(client, 'course-review-grade', gradeArgs({ reveal: true }))).body, { error: 'The review could not be recorded.', error_type: 'review_failed' });
        assert.deepEqual(db.progress.logRows(ALICE), []);
    });
});

describe('the agent views without the endpoint', () => {
    afterEach(() => resetPoolForTests());

    it('no database: review_unavailable for both', async () => {
        setPoolForTests(null);
        const unavailable = { error: 'Reviews are not available on this server right now. Please try again later.', error_type: 'review_unavailable' };
        assert.deepEqual(await reviewDueForAgent({ userId: ALICE }), unavailable);
        assert.deepEqual(await reviewGradeForAgent({ userId: ALICE, courseSlug: VIBE, lessonId: CH1, cardId: 'card-frontend', rating: 'good' }), unavailable);
    });

    it('not a learner: validation, no statement', async () => {
        const progress = createLessonProgressPool();
        setPoolForTests(progress);
        for (const userId of [undefined, 'not-a-uuid']) {
            assert.equal((await reviewDueForAgent({ userId })).error_type, 'validation');
            assert.equal((await reviewGradeForAgent({ userId, courseSlug: VIBE, lessonId: CH1, cardId: 'card-frontend', reveal: true })).error_type, 'validation');
        }
        assert.deepEqual(progress.queries, []);
    });

    it('REVIEW_PROTOCOL is the design text (§4.2): show one front, wait, reveal, the learner chooses, never record an untried card', () => {
        assert.equal(REVIEW_PROTOCOL, [
            'You are running a short Rise Path review with the learner (lesson flashcards that come back when they are about to forget them).',
            '1. Show one card\'s front at a time, in the order given. Do not show or hint at the answer.',
            '2. Wait for the learner to answer from memory, in their own words. Never answer for them.',
            '3. Then call course-review-grade with reveal: true and show the answer.',
            '4. Ask which fits: "もう一度 / Again" (they did not remember it) or "覚えた / Got it" (they remembered it). Send only their choice as rating; never choose for them.',
            '5. Never record a card the learner did not try. Each result is permanent; a card can be recorded once a day, and a card that is not due is refused (not_due).',
            '6. Do not read card answers from course-lesson-get before the learner has answered.',
            '7. At most 10 cards a day. Stop when the list is done or the learner wants to stop; the rest come back on later days.',
            '8. Reply in the learner\'s language.',
        ].join('\n'));
    });
});
