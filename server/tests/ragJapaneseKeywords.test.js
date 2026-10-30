// Japanese keyword search over a learner's materials (出典と検索, PR 1). Production runs without
// embeddings (GEMINI_ALLOWED off), so every search of uploaded materials is this keyword search
// (tools/core/ragSearch.js), for MCP rag-search and for the course generator's retrieveContext.
// - keywordPlan / extractKeywords read full-width and half-width forms alike (NFKC). Katakana runs
//   stay whole (the dictionary does not know most loanwords); kanji-and-hiragana runs are split
//   into words by Intl.Segmenter (ICU, built into Node), so okurigana words (押し出し) and a single
//   kanji (面) stay while particles go. Generic words (使い方, 方法, 少し…) only rank, and subject
//   words come first, so a long message keeps its subjects within the limit of 8.
// - keywordSearchChunks matches the chunk text in the same NFKC form (Postgres normalize, once per
//   row), selects chunks by the subject words and ranks them by weight.
// The splits come from Node's bundled ICU: an ICU update that changes them shows up here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeywords, keywordPlan, keywordSearchChunks } from '../../tools/core/ragSearch.js';

describe('extractKeywords: Japanese', () => {
    it('keeps the words of a Japanese question: okurigana words whole, a single kanji, subjects first', () => {
        assert.deepEqual(extractKeywords('押し出しツールの使い方'), ['押し出し', 'ツール', '使い方']);
        assert.deepEqual(extractKeywords('Blenderで面を選択'), ['Blender', '選択', '面']);
        assert.deepEqual(extractKeywords('自然言語処理技術'), ['自然', '言語', '処理', '技術']);
        assert.deepEqual(extractKeywords('UVマップの展開'), ['UV', 'マップ', '展開']);
    });

    it('reads full-width and half-width forms as the same characters', () => {
        assert.deepEqual(extractKeywords('ＢＬＥＮＤＥＲのﾓﾃﾞｨﾌｧｲｱ'), ['BLENDER', 'モディファイア']);
    });

    it('keeps katakana words whole, dropping a final long-vowel mark after 3 characters', () => {
        for (const [query, keyword] of [['リグ', 'リグ'], ['ボーン', 'ボーン'], ['レイヤー', 'レイヤ'], ['ビルド', 'ビルド'], ['リベース', 'リベース'],
            ['クエリ', 'クエリ'], ['トークン', 'トークン'], ['デリゲート', 'デリゲート'], ['ミラー', 'ミラー'], ['ミラーモディファイアー', 'ミラーモディファイア'],
            ['サブディビジョンサーフェス', 'サブディビジョンサーフェス']]) {
            assert.deepEqual(extractKeywords(query), [keyword], query);
        }
        assert.deepEqual(extractKeywords('リグ ボーン 設定'), ['リグ', 'ボーン', '設定']);
    });

    it('never makes an empty keyword from long-vowel marks', () => {
        assert.deepEqual(extractKeywords('ーーーー'), []);
        assert.deepEqual(extractKeywords('ｰｰｰｰ'), []);
        assert.ok(!extractKeywords('Blender ーーーー 初心者').includes(''));
    });

    it('drops particles after a Latin word, question words and request endings', () => {
        for (const [query, keyword] of [['Prefabとは', 'Prefab'], ['Unityでは', 'Unity'], ['Pythonには', 'Python'], ['Reactって', 'React'], ['Dockerから', 'Docker'], ['APIまで', 'API']]) {
            assert.deepEqual(extractKeywords(query), [keyword], query);
        }
        assert.deepEqual(extractKeywords('何ですか'), []);
        assert.deepEqual(extractKeywords('サーバーについて教えてください'), ['サーバ', '教え']);
    });

    it('keeps hiragana nouns and hiragana words the dictionary does not know', () => {
        assert.ok(extractKeywords('だしの取り方').includes('だし'));
        assert.deepEqual(extractKeywords('ひらがなだけ'), ['ひらがなだけ']);
        assert.ok(extractKeywords('教え方').length > 0, 'a generic word alone is still searched');
    });

    it('keeps the symbols of a Latin run inside a Japanese phrase, and at most 8 keywords', () => {
        assert.deepEqual(extractKeywords('C#の違い'), ['C#', '違い']);
        assert.deepEqual(extractKeywords('Node.jsの使い方'), ['Node.js', '使い方']);
        assert.equal(extractKeywords('一 二 三 四 五 六 七 八 九 十').length, 8);
    });

    it('keeps the subjects of a long message within the limit, before generic words', () => {
        const keywords = extractKeywords('Unityで2Dのアクションゲームを作りたい。C#は少しわかる。プレイヤーの移動、ジャンプ、当たり判定を作りたい。');
        for (const subject of ['Unity', 'アクションゲーム', 'C#', 'プレイヤ', 'ジャンプ']) assert.ok(keywords.includes(subject), `${subject}: ${keywords}`);
        for (const filler of ['少し', 'わかる', '作り']) assert.ok(!keywords.includes(filler), `${filler}: ${keywords}`);
    });

    it('reads a huge query without throwing, and only its first 10,000 characters', () => {
        assert.ok(extractKeywords('あ'.repeat(600_000)).length <= 8);
        assert.ok(extractKeywords('テスト'.repeat(200_000)).length <= 8);
        assert.deepEqual(extractKeywords(`${'あ '.repeat(4_900)}Blender`), ['Blender'], 'within the first 10,000 characters');
        assert.deepEqual(extractKeywords(`${'あ '.repeat(5_100)}Blender`), [], 'past them');
    });
});

describe('keywordPlan', () => {
    it('weighs subjects 2 and other words 1, and lets a single kanji and generic words only rank', () => {
        assert.deepEqual(keywordPlan('Rigidbodyの使い方'), [
            { word: 'Rigidbody', weight: 2, selects: true },
            { word: '使い方', weight: 1, selects: false },
        ]);
        assert.deepEqual(keywordPlan('Blenderで面'), [
            { word: 'Blender', weight: 2, selects: true },
            { word: '面', weight: 1, selects: false },
        ]);
        assert.deepEqual(keywordPlan('だしの取り方'), [
            { word: 'だし', weight: 1, selects: true },
            { word: '取り', weight: 1, selects: false },
        ]);
    });
});

describe('keywordSearchChunks', () => {
    const recordingPool = () => {
        const queries = [];
        return { queries, query: async (sql, params) => (queries.push({ sql, params }), { rows: [] }) };
    };
    const SCOPE = { conditions: ['m.user_id = $1'], params: ['u'] };

    it('matches the chunk text in NFKC form, normalized once per row, and ranks with a single kanji without selecting by it', async () => {
        const pool = recordingPool();
        await keywordSearchChunks(pool, { query: 'ＢＬＥＮＤＥＲで面', scope: SCOPE, limit: 3 });
        const [query] = pool.queries;
        assert.match(query.sql, /CROSS JOIN LATERAL \(SELECT normalize\(c\.content, NFKC\) AS text OFFSET 0\) n/);
        assert.match(query.sql, /WHERE m\.user_id = \$1 AND \(n\.text ILIKE \$2\)\s/);
        assert.match(query.sql, /ORDER BY \(\(n\.text ILIKE \$2\)::int \* 2 \+ \(n\.text ILIKE \$3\)::int \* 1\) DESC, c\.created_at DESC/);
        assert.deepEqual(query.params, ['u', '%BLENDER%', '%面%', 3]);
    });

    it('selects by a single kanji when the query has nothing else', async () => {
        const pool = recordingPool();
        await keywordSearchChunks(pool, { query: '面', scope: SCOPE, limit: 3 });
        assert.match(pool.queries[0].sql, /WHERE m\.user_id = \$1 AND \(n\.text ILIKE \$2\)\s/);
        assert.deepEqual(pool.queries[0].params, ['u', '%面%', 3]);
    });

    it('selects by the subject only, with the generic word ranking', async () => {
        const pool = recordingPool();
        await keywordSearchChunks(pool, { query: 'Rigidbodyの使い方', scope: SCOPE, limit: 3 });
        const [query] = pool.queries;
        assert.match(query.sql, /WHERE m\.user_id = \$1 AND \(n\.text ILIKE \$2\)\s/);
        assert.match(query.sql, /ORDER BY \(\(n\.text ILIKE \$2\)::int \* 2 \+ \(n\.text ILIKE \$3\)::int \* 1\) DESC/);
        assert.deepEqual(query.params, ['u', '%Rigidbody%', '%使い方%', 3]);
    });

    it('selects by a generic word when the query has nothing else', async () => {
        const pool = recordingPool();
        await keywordSearchChunks(pool, { query: '使い方', scope: SCOPE, limit: 3 });
        assert.match(pool.queries[0].sql, /WHERE m\.user_id = \$1 AND \(n\.text ILIKE \$2\)\s/);
    });

    it('escapes LIKE wildcards after NFKC', async () => {
        const pool = recordingPool();
        await keywordSearchChunks(pool, { query: 'snake＿case 50％off', scope: SCOPE, limit: 3 });
        assert.deepEqual(pool.queries[0].params.slice(1, 3), ['%snake\\_case%', '%50\\%off%']);
    });

    it('asks the database nothing for a query without keywords', async () => {
        const pool = recordingPool();
        assert.deepEqual(await keywordSearchChunks(pool, { query: 'の は を', scope: { conditions: [], params: [] }, limit: 3 }), []);
        assert.deepEqual(await keywordSearchChunks(pool, { query: 'ーーーー', scope: SCOPE, limit: 3 }), []);
        assert.equal(pool.queries.length, 0);
    });
});
