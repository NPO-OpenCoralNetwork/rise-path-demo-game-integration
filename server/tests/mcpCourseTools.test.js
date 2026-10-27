// The MCP course-* tools (mcp-server/createMcpServer.js, tools/core/courseLessons.js and
// lessonProgress.js), mostly end to end through the remote endpoint in process
// (helpers/remoteMcpEndpoint.js: fake Supabase, learner-remote profile, in-memory daily caps) with
// the AI access tables (helpers/aiAccessPool.js) and an in-memory lesson_progress
// (helpers/lessonProgressPool.js, exact SQL):
// - tools/list and the registry entries (design §3 table), learner-state-* pointing at course-*;
// - course-lesson-get never carries an answer, checked against the full lesson of every published
//   lesson; the first read starts at the first section the learner has not finished;
// - course-quiz-check: incorrect (feedback + hint, no answer), correct, revealed on the 2nd miss,
//   locked, predicted, reveal, lesson_changed, invalid choices; always the token's learner;
// - minors and learners without an age are refused; course-progress-update is charged mcp_write,
//   course-quiz-check is not; sections with open check questions are skipped;
// - the local learner profile (in process): the same tools with rp_turn, the learner from the turn.
// Phase 6: the review tools' registry entries, charging, adults-only refusal and their absence from
// every stdio profile; their behaviour is server/tests/mcpReviewTools.test.js.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { createMcpServer } from '../../mcp-server/createMcpServer.js';
import { REMOTE_WRITE_TOOLS, createRemotePolicy } from '../../mcp-server/remotePolicy.js';
import { hasCallLimit } from '../../mcp-server/policy.js';
import { getPublishedLesson, listPublishedLessons } from '../../tools/core/courseCatalog.js';
import { clearMcpUserScopeForTests, registerAgentTurn } from '../../tools/core/mcpUserScope.js';
import { TUTOR_PROTOCOL, availableLocales } from '../../shared/lesson/learnerView.js';
import { createAiAccessPool } from './helpers/aiAccessPool.js';
import { createLessonProgressPool, PHASE5_TABLES } from './helpers/lessonProgressPool.js';
import { startFakeSupabase } from './helpers/fakeSupabase.js';
import { connectRemoteClient, startRemoteEndpoint } from './helpers/remoteMcpEndpoint.js';

const registry = createRequire(import.meta.url)('../../mcp-server/tool-registry.json');

const ADULT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const READER = 'a3a3a3a3-0000-4000-8000-0000000000a3';
const CAPPED = 'd4d4d4d4-0000-4000-8000-0000000000d4';
const MINOR = 'b1b1b1b1-0000-4000-8000-0000000000b1';
const NO_AGE = 'c3c3c3c3-0000-4000-8000-0000000000c3';
const CLIENT = 'c1c1c1c1-0000-4000-8000-000000000001';
const COURSE_TOOLS = ['course-list', 'course-lesson-get', 'course-quiz-check', 'course-progress-get', 'course-progress-update'];
/** Phase 6: the review tools, learner-remote only (server/tests/mcpReviewTools.test.js). */
const REVIEW_TOOLS = ['course-review-due', 'course-review-grade'];
const VIBE = 'vibe-coding';
const CH1 = 'vibe-ch1';

const ch1 = getPublishedLesson(VIBE, CH1);
const question = (entry, id) => [...entry.index.questions.values()].find((q) => q.question.id === id);
const labelOf = (entry, questionId, optionId) => String(question(entry, questionId).question.options.findIndex((o) => o.id === optionId) + 1);
const rightLabels = (entry, questionId) => question(entry, questionId).question.options
    .filter((o) => question(entry, questionId).question.answer.includes(o.id))
    .map((o) => labelOf(entry, questionId, o.id));
const wrongOptions = (entry, questionId) => question(entry, questionId).question.options.filter((o) => !question(entry, questionId).question.answer.includes(o.id));

/** Every value of a localized text (a plain string is its own only value). */
const variants = (text) => (text === undefined ? [] : typeof text === 'string' ? [text] : Object.values(text));

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

const PROGRESS_SQL = /lesson_progress|^begin$|^commit$|^rollback$/;

/** AI access (adult, minor, no age) plus an in-memory lesson_progress behind one pool. */
function coursePool() {
    const progress = createLessonProgressPool();
    const pool = createAiAccessPool({
        ages: { [ADULT]: '1990-01', [READER]: '1988-03', [CAPPED]: '1980-02', [MINOR]: '2012-05' },
        answer: (sql, params) => (PROGRESS_SQL.test(sql) ? progress.query(sql, params) : undefined),
    });
    return { pool, progress };
}

const parse = (result) => JSON.parse(result.content[0].text);

describe('MCP course tools over the remote endpoint', () => {
    let fake;
    let endpoint;
    let db;
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
    /** callTool, parsed: { isError, body }; every course tool result is compact JSON (design §3, K25). */
    const call = async (client, name, args) => {
        const result = await client.callTool({ name, arguments: args });
        const text = result.content[0].text;
        if (result.isError !== true) assert.ok(!text.includes('\n'), `${name}: compact JSON`);
        return { isError: result.isError === true, body: parse(result), text };
    };
    const ch1Args = (args) => ({ course_slug: VIBE, lesson_id: CH1, ...args });
    const stored = (user = ADULT) => db.progress.row(user, VIBE, CH1)?.progress;

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
        db = coursePool();
        setPoolForTests(db.pool);
        resetAiAccessForTests();
    });

    // G9 (Phase 5): the remote role has no grant on the lesson generations, the XP ledger or the
    // learning days, so no course tool may ever name them.
    afterEach(() => {
        const named = [...db.pool.queries, ...db.progress.queries].filter((q) => PHASE5_TABLES.test(q.sql));
        assert.deepEqual(named.map((q) => q.sql), [], 'no MCP statement names a Phase 5 table');
    });

    it('tools/list: the five course tools with the registry annotations; learner-state-* send agents to them', async () => {
        const client = await connect(ADULT);
        const { tools } = await client.listTools();
        for (const id of COURSE_TOOLS) {
            const tool = tools.find((t) => t.name === id);
            assert.ok(tool, id);
            assert.deepEqual(tool.annotations, registry.tools.find((t) => t.tool_id === id).annotations, id);
            const props = Object.keys(tool.inputSchema.properties ?? {});
            assert.ok(!props.includes('rp_turn') && !props.includes('user_id'), id);
        }
        const quiz = tools.find((t) => t.name === 'course-quiz-check');
        assert.deepEqual(quiz.inputSchema.required.sort(), ['course_slug', 'lesson_id', 'question_id']);
        assert.match(quiz.description, /permanently records the learner's own attempt/);
        assert.match(quiz.description, /never pick or probe options/);
        assert.match(quiz.description, /reveal only when the learner asks for the answer after a miss/);
        assert.match(tools.find((t) => t.name === 'learner-state-get').description, /course-progress-get/);
        assert.match(tools.find((t) => t.name === 'learner-state-update').description, /course-progress-update/);
        assert.match(tools.find((t) => t.name === 'learner-state-update').annotations.title, /旧形式/);
    });

    it('course-list: the published courses and lessons, compact, without answers', async () => {
        const client = await connect(ADULT);
        const { isError, body, text } = await call(client, 'course-list', { locale: 'en' });
        assert.equal(isError, false);
        assert.ok(!text.includes('\n'), 'compact JSON');
        assert.deepEqual(body.courses.map((c) => c.course_slug), ['claude-code', 'vibe-coding']);
        const vibe = body.courses.find((c) => c.course_slug === VIBE);
        assert.equal(vibe.locale, 'en');
        const lesson = vibe.modules.flatMap((m) => m.lessons).find((l) => l.id === CH1);
        assert.deepEqual(lesson, { id: CH1, title: lesson.title, estMinutes: lesson.estMinutes, questions: 6, hasExam: true });
        assert.equal(body.courses.flatMap((c) => c.modules.flatMap((m) => m.lessons)).length, listPublishedLessons().length);
        walk(body, (key, _value, where) => assert.ok(!['answer', 'explanation', 'feedback', 'hint'].includes(key), where));
    });

    it('course-lesson-get never returns an answer, checked against the full lesson of every published lesson', async () => {
        const client = await connect(READER);
        for (const { lesson, courseSlug } of listPublishedLessons()) {
            const secrets = lesson.sections.flatMap((s) => s.blocks).filter((b) => b.type === 'quiz')
                .flatMap((b) => b.questions.flatMap((q) => [...variants(q.explanation), ...variants(q.hint), ...q.options.flatMap((o) => variants(o.feedback))]));
            for (const args of [
                ...availableLocales(lesson).map((locale) => ({ section_id: 'all', locale })),
                {},
            ]) {
                const where = `${courseSlug}/${lesson.id} ${JSON.stringify(args)}`;
                const { isError, body, text } = await call(client, 'course-lesson-get', { course_slug: courseSlug, lesson_id: lesson.id, ...args });
                assert.equal(isError, false, where);
                walk(body, (key, value, path) => {
                    // (Steps keep their practice hints; quiz questions are checked member by member.)
                    assert.ok(!['answer', 'explanation', 'feedback', 'provenance', 'narration', 'slide'].includes(key), `${where}: ${path}`);
                    if (key === 'questions') {
                        for (const q of value) {
                            assert.deepEqual(Object.keys(q).filter((k) => !['id', 'kind', 'multiple', 'prompt', 'objectiveId', 'options'].includes(k)), [], `${where}: ${path}`);
                        }
                    }
                    if (key === 'options') {
                        assert.deepEqual(value.map((o) => Object.keys(o).sort().join()), value.map(() => 'label,md'), `${where}: ${path}`);
                        assert.deepEqual(value.map((o) => o.label), value.map((_o, i) => String(i + 1)), `${where}: ${path}`);
                    }
                });
                for (const secret of secrets) {
                    assert.ok(!text.includes(JSON.stringify(secret).slice(1, -1)), `${where}: an explanation, hint or feedback leaked`);
                }
                assert.equal(body.tutor_protocol, TUTOR_PROTOCOL);
                assert.equal(body.content_hash, getPublishedLesson(courseSlug, lesson.id).hash);
            }
        }
    });

    it('course-lesson-get: outline + first unfinished section, a section by id, the whole lesson, errors', async () => {
        const client = await connect(ADULT);
        const first = await call(client, 'course-lesson-get', ch1Args({ locale: 'en' }));
        assert.equal(first.isError, false);
        assert.equal(first.body.section_reason, 'not_started');
        assert.equal(first.body.section.id, 'hook');
        assert.equal(first.body.next_section_id, '1-1');
        assert.equal(first.body.locale, 'en');
        assert.deepEqual(first.body.available_locales, ['jp', 'en']);
        assert.deepEqual(first.body.outline.sections.map((s) => s.id), ch1.lesson.sections.map((s) => s.id));
        assert.deepEqual(first.body.outline.sections.find((s) => s.id === 'check').question_ids, ['q4', 'q3', 'q5']);
        assert.match(first.body.how_to_answer, /course-quiz-check/);
        assert.equal(first.body.lesson, undefined, 'the first read is not the whole lesson');

        // The learner answers the hook's prediction and 1-1's check, and works through both.
        await call(client, 'course-quiz-check', ch1Args({ question_id: 'q0', choices: ['1'] }));
        await call(client, 'course-quiz-check', ch1Args({ question_id: 'q1', choices: rightLabels(ch1, 'q1') }));
        const marked = await call(client, 'course-progress-update', ch1Args({ read_section_ids: ['hook', '1-1'] }));
        assert.deepEqual(marked.body.marked_section_ids, ['hook', '1-1']);
        const next = await call(client, 'course-lesson-get', ch1Args({}));
        assert.equal(next.body.section_reason, 'first_unfinished');
        assert.equal(next.body.section.id, '1-2');
        assert.equal(next.body.locale, 'jp');
        assert.deepEqual(next.body.section.blocks.filter((b) => b.type === 'prompt').map((b) => b.for), ['learner', 'learner']);

        const section = await call(client, 'course-lesson-get', ch1Args({ section_id: '1-3', locale: 'fr' }));
        assert.equal(section.body.section.id, '1-3');
        assert.equal(section.body.locale, 'jp', 'a locale the lesson lacks falls back to its source locale');
        assert.equal(section.body.next_section_id, '1-4');
        assert.equal(section.body.outline, undefined);
        assert.equal(section.body.tutor_protocol, TUTOR_PROTOCOL, 'every read carries the tutoring protocol');
        assert.match(section.body.how_to_answer, /course-quiz-check/);
        assert.equal(section.body.content_hash, ch1.hash);

        const all = await call(client, 'course-lesson-get', ch1Args({ section_id: 'all' }));
        assert.deepEqual(all.body.lesson.sections.map((s) => s.id), ch1.lesson.sections.map((s) => s.id));

        const unknownSection = await call(client, 'course-lesson-get', ch1Args({ section_id: 'nope' }));
        assert.equal(unknownSection.isError, true);
        assert.equal(unknownSection.body.error_type, 'validation');
        const unknownLesson = await call(client, 'course-lesson-get', { course_slug: VIBE, lesson_id: 'vibe-ch99' });
        assert.equal(unknownLesson.body.error_type, 'not_found');
        assert.doesNotMatch(unknownLesson.text, /drafts|content\//, 'no draft ids or paths');
    });

    it('course-quiz-check: a first miss returns the chosen option\'s feedback and the hint, never the answer', async () => {
        const client = await connect(ADULT);
        const wrong = wrongOptions(ch1, 'q1')[0];
        const { isError, body } = await call(client, 'course-quiz-check', ch1Args({ question_id: 'q1', choices: [labelOf(ch1, 'q1', wrong.id)], locale: 'en', content_hash: ch1.hash }));
        assert.equal(isError, false, 'a wrong answer is a normal result');
        assert.equal(body.outcome, 'incorrect');
        assert.equal(body.block_id, 's1-check');
        assert.equal(body.attempts, 1);
        assert.equal(body.attempts_left, 1);
        assert.deepEqual(body.feedback, [{ label: labelOf(ch1, 'q1', wrong.id), md: wrong.feedback.en }]);
        assert.equal(body.hint, question(ch1, 'q1').question.hint.en);
        assert.equal(body.correct_labels, undefined);
        assert.equal(body.explanation, undefined);
        assert.deepEqual(stored().answers['s1-check/q1'], { attempts: 1, correct: false, chosen: [wrong.id], firstTry: false });
        assert.equal(db.progress.rows().every((row) => row.user_id === ADULT), true, 'only the token user\'s row');
    });

    it('course-quiz-check: the second miss reveals the answer, then the question is locked and nothing more is recorded', async () => {
        const client = await connect(ADULT);
        const [w1, w2] = wrongOptions(ch1, 'q1');
        await call(client, 'course-quiz-check', ch1Args({ question_id: 'q1', choices: [labelOf(ch1, 'q1', w1.id)] }));
        const second = await call(client, 'course-quiz-check', ch1Args({ question_id: 'q1', choices: [Number(labelOf(ch1, 'q1', w2.id))] }));
        assert.equal(second.body.outcome, 'revealed');
        assert.deepEqual(second.body.correct_labels, rightLabels(ch1, 'q1'));
        assert.equal(second.body.explanation, question(ch1, 'q1').question.explanation.jp);
        assert.equal(second.body.attempts_left, 0);
        const before = structuredClone(stored());
        const locked = await call(client, 'course-quiz-check', ch1Args({ question_id: 'q1', choices: rightLabels(ch1, 'q1') }));
        assert.equal(locked.isError, false);
        assert.equal(locked.body.outcome, 'locked');
        assert.equal(locked.body.this_choice_correct, true);
        assert.deepEqual(locked.body.correct_labels, rightLabels(ch1, 'q1'));
        assert.match(locked.body.note, /Nothing recorded/);
        assert.deepEqual(stored(), before, 'a locked question records nothing');
        assert.equal(stored().answers['s1-check/q1'].revealed, true);
    });

    it('course-quiz-check: a correct first answer fixes firstTry; a prediction shows the answer once, then locks', async () => {
        const client = await connect(ADULT);
        const correct = await call(client, 'course-quiz-check', ch1Args({ question_id: 'q4', choices: rightLabels(ch1, 'q4') }));
        assert.equal(correct.body.outcome, 'correct');
        assert.equal(correct.body.mode, 'exam');
        assert.deepEqual(correct.body.correct_labels, rightLabels(ch1, 'q4'));
        assert.equal(correct.body.explanation, question(ch1, 'q4').question.explanation.jp);
        assert.equal(typeof correct.body.pct, 'number');
        assert.equal(stored().answers['check-quiz/q4'].firstTry, true);

        const predicted = await call(client, 'course-quiz-check', ch1Args({ question_id: 'q0', choices: ['1'] }));
        assert.equal(predicted.body.outcome, 'predicted');
        assert.equal(predicted.body.mode, 'predict');
        assert.equal(predicted.body.attempts_left, undefined);
        assert.deepEqual(predicted.body.correct_labels, rightLabels(ch1, 'q0'));
        assert.ok(predicted.body.explanation);
        const again = await call(client, 'course-quiz-check', ch1Args({ question_id: 'q0', choices: ['2'] }));
        assert.equal(again.body.outcome, 'locked');
        assert.equal(stored().answers['hook-predict/q0'].attempts, 1);
    });

    it('course-quiz-check reveal: only after a miss, without an attempt', async () => {
        const client = await connect(ADULT);
        const early = await call(client, 'course-quiz-check', ch1Args({ question_id: 'q2', reveal: true }));
        assert.equal(early.isError, false);
        assert.equal(early.body.outcome, 'not_allowed');
        assert.equal(early.body.correct_labels, undefined);
        assert.equal(stored()?.answers['s2-check/q2'], undefined, 'nothing recorded');

        await call(client, 'course-quiz-check', ch1Args({ question_id: 'q2', choices: [labelOf(ch1, 'q2', wrongOptions(ch1, 'q2')[0].id)] }));
        const shown = await call(client, 'course-quiz-check', ch1Args({ question_id: 'q2', reveal: true }));
        assert.equal(shown.body.outcome, 'revealed');
        assert.equal(shown.body.attempts, 1, 'no attempt added');
        assert.deepEqual(shown.body.correct_labels, rightLabels(ch1, 'q2'));
        assert.deepEqual(stored().answers['s2-check/q2'], { ...stored().answers['s2-check/q2'], attempts: 1, revealed: true, firstTry: false });
    });

    it('course-quiz-check refusals record nothing: lesson_changed, invalid choices, choices with reveal, unknown question', async () => {
        const client = await connect(ADULT);
        const changed = await call(client, 'course-quiz-check', ch1Args({ question_id: 'q4', choices: rightLabels(ch1, 'q4'), content_hash: 'sha256:0000000000000000' }));
        assert.equal(changed.isError, true);
        assert.equal(changed.body.error_type, 'lesson_changed');
        assert.equal(changed.body.content_hash, ch1.hash);
        for (const [args, errorType] of [
            [{ question_id: 'q4', choices: ['9'] }, 'invalid_choice'],
            [{ question_id: 'q4', choices: ['1', '2'] }, 'invalid_choice'],
            [{ question_id: 'q4', choices: [] }, 'invalid_choice'],
            [{ question_id: 'q4', choices: ['abc'] }, 'invalid_choice'],
            [{ question_id: 'q4' }, 'validation'],
            [{ question_id: 'q4', choices: ['1'], reveal: true }, 'validation'],
            [{ question_id: 'q4', block_id: 's1-check', choices: ['1'] }, 'not_found'],
            [{ question_id: 'zz', choices: ['1'] }, 'not_found'],
        ]) {
            const result = await call(client, 'course-quiz-check', ch1Args(args));
            assert.equal(result.isError, true, JSON.stringify(args));
            assert.equal(result.body.error_type, errorType, JSON.stringify(args));
        }
        assert.equal(db.progress.rows().length, 0, 'no row written or left behind');
    });

    it('course-progress-update skips a section with an open check question; course-progress-get shows status, no answers', async () => {
        const client = await connect(ADULT);
        const update = await call(client, 'course-progress-update', ch1Args({ read_section_ids: ['1-1', '1-3'], last_block_id: 's3-b2' }));
        assert.equal(update.isError, false);
        assert.deepEqual(update.body.marked_section_ids, ['1-3']);
        assert.deepEqual(update.body.skipped, [{ section_id: '1-1', reason: 'answer_check_first', question_ids: ['q1'] }]);
        assert.equal(update.body.last_block_id, 's3-b2');
        assert.equal(update.body.state, 'in_progress');

        const unknown = await call(client, 'course-progress-update', ch1Args({ read_section_ids: ['nope'] }));
        assert.equal(unknown.body.error_type, 'validation');

        await call(client, 'course-quiz-check', ch1Args({ question_id: 'q4', choices: [labelOf(ch1, 'q4', wrongOptions(ch1, 'q4')[0].id)] }));
        const detail = await call(client, 'course-progress-get', ch1Args({ locale: 'en' }));
        assert.equal(detail.isError, false);
        const { body } = detail;
        assert.equal(body.state, 'in_progress');
        assert.ok(body.pct > 0);
        assert.ok(body.updated_at);
        assert.deepEqual(body.sections.find((s) => s.id === '1-3'), { id: '1-3', title: body.sections.find((s) => s.id === '1-3').title, done: 2, total: 2 });
        assert.deepEqual(body.sections.find((s) => s.id === '1-1').done, 0);
        assert.deepEqual(body.questions.find((q) => q.question_id === 'q4'), { question_id: 'q4', block_id: 'check-quiz', mode: 'exam', answered: true, correct: false, attempts: 1, revealed: false });
        assert.deepEqual(body.questions.find((q) => q.question_id === 'q1'), { question_id: 'q1', block_id: 's1-check', mode: 'inline', answered: false, correct: null, attempts: 0, revealed: false });
        assert.deepEqual(body.resume, { section_id: '1-3', block_id: 's3-b2' });
        assert.deepEqual(body.exam_first_try, { correct: 0, total: 3, needed: 0.8 });
        assert.equal(body.content_hash, ch1.hash);
        walk(body, (key, _value, where) => assert.ok(!['chosen', 'correct_labels', 'label', 'answer', 'explanation'].includes(key), where));

        const all = await call(client, 'course-progress-get', {});
        assert.equal(all.body.lessons.length, listPublishedLessons().length);
        const mine = all.body.lessons.find((l) => l.lesson_id === CH1);
        assert.equal(mine.state, 'in_progress');
        const untouched = all.body.lessons.find((l) => l.lesson_id === 'cc-04-verify');
        assert.deepEqual({ pct: untouched.pct, state: untouched.state, updated_at: untouched.updated_at }, { pct: 0, state: 'not_started', updated_at: null });
        const course = await call(client, 'course-progress-get', { course_slug: 'claude-code' });
        assert.ok(course.body.lessons.every((l) => l.course_slug === 'claude-code'));

        assert.equal((await call(client, 'course-progress-get', { course_slug: 'nope' })).body.error_type, 'not_found');
        assert.equal((await call(client, 'course-progress-get', { lesson_id: CH1 })).body.error_type, 'validation');
    });

    it('content://domains names the course of vibe-coding and claude-code; socratic-tutor teaches a lesson with the protocol', async () => {
        const client = await connect(ADULT);
        const { domains } = JSON.parse((await client.readResource({ uri: 'content://domains' })).contents[0].text);
        assert.deepEqual(domains.filter((d) => d.course_slug).map((d) => [d.id, d.course_slug]), [[VIBE, VIBE], ['claude-code', 'claude-code']]);

        const plain = await client.getPrompt({ name: 'socratic-tutor', arguments: { topic: 'loops' } });
        assert.doesNotMatch(plain.messages[0].content.text, /course-quiz-check/);
        const prompt = await client.getPrompt({ name: 'socratic-tutor', arguments: { topic: 'web apps', course_slug: VIBE, lesson_id: CH1 } });
        const text = prompt.messages[0].content.text;
        assert.ok(text.includes(TUTOR_PROTOCOL));
        assert.ok(text.includes(ch1.lesson.title.jp));
        for (const tool of ['course-lesson-get', 'course-quiz-check', 'course-progress-get', 'course-progress-update']) assert.ok(text.includes(tool), tool);
        await assert.rejects(
            client.getPrompt({ name: 'socratic-tutor', arguments: { topic: 't', course_slug: VIBE, lesson_id: 'vibe-ch99' } }),
            (error) => error.code === -32602 && error.data?.error_type === 'not_found',
        );
    });

    for (const [label, user, errorType] of [['a minor', MINOR, 'adults_only'], ['a learner with no age', NO_AGE, 'age_required']]) {
        it(`${label}: every course tool is refused (${errorType}) and nothing touches lesson_progress`, async () => {
            const client = await connect(user);
            for (const [name, args] of [
                ['course-list', {}],
                ['course-lesson-get', ch1Args({})],
                ['course-quiz-check', ch1Args({ question_id: 'q4', choices: ['1'] })],
                ['course-progress-get', {}],
                ['course-progress-update', ch1Args({ read_section_ids: ['1-3'] })],
                ['course-review-due', {}],
                ['course-review-grade', ch1Args({ card_id: 'card-frontend', reveal: true })],
                ['course-review-grade', ch1Args({ card_id: 'card-frontend', rating: 'good' })],
            ]) {
                const result = await call(client, name, args);
                assert.equal(result.isError, true, name);
                assert.equal(result.body.error_type, errorType, name);
            }
            assert.deepEqual(db.progress.progressStatements(), []);
        });
    }

    it('daily caps: course-progress-update is charged mcp_write, course-quiz-check only mcp', async () => {
        const capped = await startRemoteEndpoint({ fake, logger, capsEnv: { AI_CAP_USER_MCP_WRITE: '1' } });
        try {
            const client = await connect(CAPPED, capped);
            const [w1, w2] = wrongOptions(ch1, 'q1');
            for (const id of [w1.id, w2.id]) {
                const check = await call(client, 'course-quiz-check', ch1Args({ question_id: 'q1', choices: [labelOf(ch1, 'q1', id)] }));
                assert.equal(check.isError, false, check.text);
            }
            assert.equal((await call(client, 'course-progress-update', ch1Args({ read_section_ids: ['1-1'] }))).isError, false, 'the quiz checks used no mcp_write');
            const over = await call(client, 'course-progress-update', ch1Args({ read_section_ids: ['1-3'] }));
            assert.equal(over.body.error_type, 'daily_limit_reached');
            assert.equal(over.body.kind, 'mcp_write');
            assert.equal((await call(client, 'course-quiz-check', ch1Args({ question_id: 'q4', choices: ['1'] }))).isError, false);
        } finally {
            await capped.close();
        }

        assert.ok(REMOTE_WRITE_TOOLS.includes('course-progress-update'));
        assert.ok(!REMOTE_WRITE_TOOLS.includes('course-quiz-check'));
        const kinds = [];
        const policy = createRemotePolicy({ env: {}, reserveCap: async ({ kind }) => { kinds.push(kind); return { handle: { refund: async () => {} } }; } });
        for (const tool of COURSE_TOOLS) await policy.charge(ADULT, tool);
        assert.deepEqual(kinds, ['mcp', 'mcp', 'mcp', 'mcp', 'mcp', 'mcp_write']);
        // Phase 6: the due list is charged mcp only; every grade call (a reveal too) mcp_write as well.
        kinds.length = 0;
        for (const tool of REVIEW_TOOLS) await policy.charge(ADULT, tool);
        assert.deepEqual(kinds, ['mcp', 'mcp', 'mcp_write']);
        assert.ok(REMOTE_WRITE_TOOLS.includes('course-review-grade'));
        assert.ok(!REMOTE_WRITE_TOOLS.includes('course-review-due'));
    });
});

describe('tool-registry.json course entries (design §3)', () => {
    const entry = (id) => registry.tools.find((t) => t.tool_id === id);
    const shape = entry('save-curriculum-draft');
    const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    const EXPECTED = {
        'course-list': ['content_read', 'read', 'public', false, null, ['learner', 'coach', 'admin', 'learner-remote'], RO],
        'course-lesson-get': ['content_read', 'read', 'learner_data', false, null, ['learner', 'coach', 'admin', 'learner-remote'], RO],
        'course-quiz-check': ['progress_write', 'write', 'learner_data', true, null, ['learner', 'admin', 'learner-remote'],
            { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }],
        'course-progress-get': ['progress_read', 'read', 'learner_data', false, null, ['learner', 'coach', 'admin', 'learner-remote'], RO],
        'course-progress-update': ['progress_write', 'write', 'learner_data', true, 50, ['learner', 'admin', 'learner-remote'],
            { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }],
        // Phase 6 (design §4.3): learner-remote only, the one profile with the adults-only gate.
        'course-review-due': ['progress_read', 'read', 'learner_data', false, null, ['learner-remote'], RO],
        'course-review-grade': ['progress_write', 'write', 'learner_data', true, null, ['learner-remote'],
            { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }],
    };

    for (const [id, [category, risk, dataClass, audit, maxCalls, profiles, hints]] of Object.entries(EXPECTED)) {
        it(id, () => {
            const e = entry(id);
            assert.ok(e, id);
            assert.deepEqual(Object.keys(e), Object.keys(shape));
            assert.deepEqual(
                { category: e.category, risk: e.risk, data_class: e.data_class, requires_approval: e.requires_approval, audit: e.audit, max_calls_per_session: e.max_calls_per_session, exposure_profiles: e.exposure_profiles },
                { category, risk, data_class: dataClass, requires_approval: false, audit, max_calls_per_session: maxCalls, exposure_profiles: profiles },
            );
            const { title, ...rest } = e.annotations;
            assert.ok(title && /[ぁ-んァ-ン一-龯]/.test(title), 'a Japanese title');
            assert.deepEqual(rest, hints);
        });
    }

    it('no course tool is named lesson-* (those are the authoring tools); the stdio limit is on progress-update only', () => {
        assert.ok([...COURSE_TOOLS, ...REVIEW_TOOLS].every((id) => !id.startsWith('lesson-')));
        assert.equal(hasCallLimit('course-progress-update'), true);
        assert.equal(hasCallLimit('course-quiz-check'), false);
        for (const id of REVIEW_TOOLS) assert.equal(hasCallLimit(id), false, id);
    });

    it('the review tools are exposed to learner-remote only: no stdio or SSE profile (none has the adults-only gate) lists them', () => {
        for (const id of REVIEW_TOOLS) assert.deepEqual(entry(id).exposure_profiles, ['learner-remote'], id);
        assert.equal(registry.version, '2026-10-26');
    });
});

describe('MCP course tools on the local learner profile (in process, rp_turn)', () => {
    let progress;
    const servers = [];
    const savedConsole = { log: console.log, warn: console.warn, error: console.error };
    const open = async (profile) => {
        const server = createMcpServer({ profile });
        const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'course-local-test', version: '1.0.0' });
        await client.connect(clientSide);
        servers.push(client);
        return client;
    };

    beforeEach(() => {
        console.error = () => {};
        console.warn = () => {};
        progress = createLessonProgressPool();
        setPoolForTests(progress);
        clearMcpUserScopeForTests();
    });

    afterEach(async () => {
        for (const client of servers.splice(0)) await client.close().catch(() => {});
        resetPoolForTests();
        clearMcpUserScopeForTests();
        Object.assign(console, savedConsole);
    });

    it('lists the five course tools, each with an optional rp_turn; coach gets only the reads', async () => {
        const learner = await open('learner');
        const { tools } = await learner.listTools();
        for (const id of COURSE_TOOLS) {
            const tool = tools.find((t) => t.name === id);
            assert.ok(tool, id);
            assert.equal(tool.inputSchema.properties.rp_turn?.type, 'string', id);
            assert.ok(!(tool.inputSchema.required ?? []).includes('rp_turn'), id);
        }
        const coach = await open('coach');
        const coachTools = (await coach.listTools()).tools.map((t) => t.name);
        assert.deepEqual(COURSE_TOOLS.filter((id) => coachTools.includes(id)), ['course-list', 'course-lesson-get', 'course-progress-get']);
        const builder = await open('curriculum-builder');
        assert.deepEqual((await builder.listTools()).tools.map((t) => t.name).filter((n) => n.startsWith('course-')), []);
        // Phase 6: the review tools are for the remote endpoint (adults only) alone.
        const admin = await open('admin');
        for (const [profile, client] of [['learner', learner], ['coach', coach], ['admin', admin], ['curriculum-builder', builder]]) {
            const names = (await client.listTools()).tools.map((t) => t.name);
            assert.deepEqual(names.filter((n) => n.startsWith('course-review-')), [], profile);
        }
    });

    it('stdio or SSE started with the learner-remote profile (no remote policy, so no adults-only gate) never registers the review tools', async () => {
        const client = await open('learner-remote');
        const names = (await client.listTools()).tools.map((t) => t.name);
        assert.ok(COURSE_TOOLS.every((id) => names.includes(id)), 'the profile itself is served');
        assert.deepEqual(names.filter((n) => n.startsWith('course-review-')), []);
        const turn = await registerAgentTurn(ADULT);
        for (const name of REVIEW_TOOLS) {
            const answer = await client.callTool({ name, arguments: { rp_turn: turn } }).then(
                (result) => ({ isError: result.isError === true, text: result.content?.[0]?.text ?? '' }),
                (error) => ({ isError: true, text: String(error?.message ?? error) }),
            );
            assert.equal(answer.isError, true, name);
            assert.match(answer.text, /not found/i, name);
        }
        assert.deepEqual(progress.queries.filter((q) => /review_cards|review_log/.test(q.sql)), [], 'no review statement');
    });

    it('the learner comes from rp_turn; an unknown turn token records nothing, while reading still works', async () => {
        const client = await open('learner');
        const turn = await registerAgentTurn(ADULT);
        const graded = await client.callTool({ name: 'course-quiz-check', arguments: { course_slug: VIBE, lesson_id: CH1, question_id: 'q4', choices: rightLabels(ch1, 'q4'), rp_turn: turn } });
        assert.ok(!graded.isError, graded.content[0].text);
        assert.equal(parse(graded).outcome, 'correct');
        assert.equal(progress.row(ADULT, VIBE, CH1).progress.answers['check-quiz/q4'].firstTry, true);

        const forged = 'Zm9yZ2VkLXR1cm4tdG9rZW4tMTIzNDU2';
        const refused = await client.callTool({ name: 'course-quiz-check', arguments: { course_slug: VIBE, lesson_id: CH1, question_id: 'q5', choices: ['1'], rp_turn: forged } });
        assert.equal(refused.isError, true);
        assert.equal(parse(refused).error_type, 'session_binding_required');
        assert.equal(progress.rows().length, 1);

        const read = await client.callTool({ name: 'course-lesson-get', arguments: { course_slug: VIBE, lesson_id: CH1, rp_turn: forged } });
        assert.ok(!read.isError);
        assert.equal(parse(read).section_reason, 'progress_unavailable');
        assert.equal(parse(read).section.id, 'hook');
        const mine = await client.callTool({ name: 'course-lesson-get', arguments: { course_slug: VIBE, lesson_id: CH1, rp_turn: turn } });
        assert.equal(parse(mine).section_reason, 'first_unfinished');
    });
});
