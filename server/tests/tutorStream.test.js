// Inline AI tutor state (WP-11): mode choice, request body, history, error mapping and the
// "make a card" helpers in components/lesson/useTutorStream.ts. Pure helpers only.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CHECK_BLOCK_TYPES,
    TUTOR_CARDS_KEY,
    TUTOR_HISTORY_MAX,
    TUTOR_MESSAGE_MAX,
    buildTutorRequest,
    classifyTutorError,
    draftTutorCard,
    excerptLead,
    plainAnswer,
    readTutorCards,
    resolveClientMode,
    saveTutorCard,
    threadHistory,
    threadKey,
} from '../../components/lesson/useTutorStream.ts';
import { ASSESSMENT_BLOCK_TYPES, TutorRequest, resolveTutorMode } from '../llm/schemas.js';

const lesson = { courseId: 'vibe-coding', lessonId: 'vibe-ch1', title: '人間が理解すべき最低ライン', objectives: ['役割の違いを説明できる'] };
const anchor = { sectionId: 's1', blockId: 's1-b1', blockType: 'markdown', excerpt: 'Webアプリは3つの要素が連携して動いています。' };

let seq = 0;
const turn = (role, text, extra = {}) => ({ id: `t${(seq += 1)}`, role, text, status: 'done', ...extra });

const memoryStorage = (initial = {}) => {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        data,
    };
};

describe('tutor stream: mode', () => {
    it('is socratic on a check until the learner has tried twice (PLAN §5.7)', () => {
        const quiz = { blockType: 'quiz' };
        assert.equal(resolveClientMode({ anchor: quiz, learner: { attemptsOnBlock: 0 } }), 'socratic');
        assert.equal(resolveClientMode({ anchor: quiz, learner: { attemptsOnBlock: 1 } }), 'socratic');
        assert.equal(resolveClientMode({ anchor: quiz, learner: { attemptsOnBlock: 2 } }), 'explain');
        // The quiz's "why?" button asks with mode socratic; the attempt count still decides.
        assert.equal(resolveClientMode({ mode: 'socratic', anchor: quiz, learner: { attemptsOnBlock: 3 } }), 'explain');
    });

    it('is socratic on a check without learner state, and follows the request on prose', () => {
        assert.equal(resolveClientMode({ anchor: { blockType: 'Exercise' } }), 'socratic');
        assert.equal(resolveClientMode({ anchor: { blockType: 'markdown' } }), 'explain');
        assert.equal(resolveClientMode({ mode: 'socratic', anchor: { blockType: 'markdown' } }), 'socratic');
        assert.equal(resolveClientMode({}), 'explain');
    });

    it('treats the same block types as checks as the server does', () => {
        assert.deepEqual([...CHECK_BLOCK_TYPES].sort(), [...ASSESSMENT_BLOCK_TYPES].sort());
    });

    it('sends a mode the server keeps: the client decision survives resolveTutorMode', () => {
        for (const attempts of [0, 1, 2, 3]) {
            const detail = { mode: 'socratic', anchor: { ...anchor, blockType: 'quiz' }, learner: { attemptsOnBlock: attempts } };
            const thread = { key: 'k', lesson, anchor: detail.anchor, learner: detail.learner, mode: resolveClientMode(detail), turns: [] };
            const body = TutorRequest.parse(buildTutorRequest(thread, 'なぜ？', 'ja'));
            assert.equal(resolveTutorMode(body), attempts < 2 ? 'socratic' : 'explain', `attempts ${attempts}`);
        }
    });
});

describe('tutor stream: threads and requests', () => {
    it('keys a thread by lesson and block', () => {
        assert.equal(threadKey('vibe-ch1', { blockId: 'b2' }), 'vibe-ch1::b2');
        assert.equal(threadKey(undefined, undefined), 'lesson::general');
    });

    it('sends only finished question/answer pairs as history, newest last and capped', () => {
        const turns = [
            turn('user', 'q1'), turn('assistant', 'a1'),
            turn('user', 'q2'), turn('assistant', 'partial', { status: 'error', error: 'network' }),
            turn('user', 'q3'), turn('assistant', 'stopped', { status: 'stopped' }),
            turn('user', 'q4'), turn('assistant', '   '),
            turn('user', 'q5'), turn('assistant', 'a5'),
            turn('user', 'q6'), turn('assistant', '', { status: 'streaming' }),
        ];
        assert.deepEqual(threadHistory(turns), [
            { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q5' }, { role: 'assistant', content: 'a5' },
        ]);

        const many = Array.from({ length: 10 }, (_, i) => [turn('user', `q${i}`), turn('assistant', `a${i}`)]).flat();
        const capped = threadHistory(many);
        assert.equal(capped.length, TUTOR_HISTORY_MAX);
        assert.equal(capped[0].role, 'user');
        assert.equal(capped.at(-1).content, 'a9');
    });

    it('builds a body the gateway accepts: anchor every turn, trimmed message, locale', () => {
        const thread = { key: 'k', lesson, anchor, mode: 'explain', turns: [turn('user', 'q1'), turn('assistant', 'a1')] };
        const body = buildTutorRequest(thread, `  ${'あ'.repeat(TUTOR_MESSAGE_MAX + 50)}  `, 'ja');
        assert.equal(body.message.length, TUTOR_MESSAGE_MAX);
        assert.equal(body.anchor, anchor);
        assert.equal(body.lesson, lesson);
        assert.equal(body.locale, 'ja');
        assert.equal(body.history.length, 2);
        assert.equal(body.context, undefined);
        assert.ok(TutorRequest.safeParse(body).success);
    });

    it('uses legacy glossary context only without an anchor, and omits empty history', () => {
        const withContext = buildTutorRequest({ key: 'k', context: 'API: 窓口', mode: 'explain', turns: [] }, 'API とは？', 'en');
        assert.equal(withContext.context, 'API: 窓口');
        assert.equal('history' in withContext, false);
        const both = buildTutorRequest({ key: 'k', anchor, context: 'ignored', mode: 'explain', turns: [] }, 'q', 'en');
        assert.equal('context' in both, false);
    });
});

describe('tutor stream: errors', () => {
    it('maps gateway errors, HTTP status and fetch failures to a message kind', () => {
        const cases = [
            [{ status: 503, errorType: 'no_provider' }, 'unavailable'],
            [{ status: 401 }, 'unavailable'],
            [{ status: 429 }, 'rate_limited'],
            [{ status: 502, errorType: 'rate_limited' }, 'rate_limited'],
            [{ status: 504 }, 'timeout'],
            [{ status: 502, errorType: 'refusal' }, 'refused'],
            [{ status: 502, errorType: 'incomplete_stream' }, 'interrupted'],
            [{ status: 400, errorType: 'invalid_body' }, 'rejected'],
            [{ status: 413 }, 'rejected'],
            [new TypeError('Failed to fetch'), 'network'],
            [new SyntaxError('Unexpected token'), 'failed'],
            [undefined, 'failed'],
        ];
        for (const [error, kind] of cases) assert.equal(classifyTutorError(error), kind, JSON.stringify(error));
    });
});

describe('tutor stream: cards', () => {
    it('turns a Markdown answer into card text', () => {
        const md = '**API** は `窓口` です。\n\n- [仕様](https://example.com) を見る\n\n```js\nfetch(url)\n```\n（デモ用の応答です。キーを設定すると実際の回答になります。）';
        assert.equal(plainAnswer(md), 'API は 窓口 です。\n仕様 を見る');
    });

    it('takes the first sentence of the excerpt as the card lead', () => {
        assert.equal(excerptLead('Webアプリは3つの要素で動きます。フロントは客席です。'), 'Webアプリは3つの要素で動きます');
        assert.equal(excerptLead('A web app has three parts. The frontend is the dining room.'), 'A web app has three parts');
        assert.equal(excerptLead('あ'.repeat(60), 10), `${'あ'.repeat(9)}…`);
    });

    it('drafts the front from the typed question, else from the excerpt, and the back from the last answer', () => {
        const front = (lead) => `「${lead}」のポイントは？`;
        const preset = { key: 'k', anchor, mode: 'explain', turns: [turn('user', 'この段落を説明して'), turn('assistant', '**3つ**です。')] };
        assert.deepEqual(draftTutorCard(preset, { frontFromExcerpt: front }), { front: '「Webアプリは3つの要素が連携して動いています」のポイントは？', back: '3つです。' });

        const typed = { ...preset, turns: [...preset.turns, turn('user', 'DB は何をする？', { typed: true }), turn('assistant', 'データを残します。'), turn('user', '別の例'), turn('assistant', '', { status: 'error' })] };
        assert.deepEqual(draftTutorCard(typed, { frontFromExcerpt: front }), { front: 'DB は何をする？', back: 'データを残します。' });

        assert.equal(draftTutorCard({ ...preset, turns: [turn('user', 'q'), turn('assistant', '', { status: 'streaming' })] }, { frontFromExcerpt: front }), null);
    });

    it('saves cards per lesson in localStorage and survives bad data', () => {
        const storage = memoryStorage({ [TUTOR_CARDS_KEY]: '{"not":"an array"}' });
        assert.deepEqual(readTutorCards(storage), []);
        assert.equal(saveTutorCard({ courseId: 'vibe-coding', lessonId: 'vibe-ch1', front: ' Q ', back: ' A ' }, storage), 1);
        assert.equal(saveTutorCard({ courseId: 'vibe-coding', lessonId: 'vibe-ch2', front: 'Q', back: 'A' }, storage), 1);
        assert.equal(saveTutorCard({ courseId: 'vibe-coding', lessonId: 'vibe-ch1', blockId: 's1-b1', front: 'Q2', back: 'A2' }, storage), 2);
        const cards = readTutorCards(storage);
        assert.equal(cards.length, 3);
        assert.equal(cards[0].front, 'Q');
        assert.match(cards[0].id, /^tc-/);
        assert.ok(!Number.isNaN(Date.parse(cards[0].createdAt)));
        assert.equal(cards[2].blockId, 's1-b1');
    });

    it('refuses empty cards and reports storage failures as null', () => {
        const storage = memoryStorage();
        assert.equal(saveTutorCard({ courseId: 'c', lessonId: 'l', front: '  ', back: 'A' }, storage), null);
        assert.equal(storage.data.size, 0);
        assert.equal(saveTutorCard({ courseId: 'c', lessonId: 'l', front: 'Q', back: 'A' }, null), null);
        const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
        assert.equal(saveTutorCard({ courseId: 'c', lessonId: 'l', front: 'Q', back: 'A' }, full), null);
    });
});
