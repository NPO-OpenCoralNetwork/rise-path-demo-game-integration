// Japanese keyword search over a learner's materials (出典と検索, PR 1). Production runs without
// embeddings (GEMINI_ALLOWED off), so every search of uploaded materials is this keyword search
// (tools/core/ragSearch.js), for MCP rag-search and for the course generator's retrieveContext:
// - extractKeywords reads full-width and half-width forms alike (NFKC) and splits Japanese into
//   words with Intl.Segmenter (ICU, built into Node): okurigana words stay whole (押し出し,
//   使い方), a single-kanji word stays (面), particles, endings and question words go, and a final
//   long-vowel mark is dropped so that モディファイアー also finds モディファイア. Latin runs keep
//   their symbols (C#, Node.js).
// - keywordSearchChunks matches the chunk text in the same NFKC form (Postgres normalize) and
//   ranks a single kanji below a longer word.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeywords, keywordSearchChunks } from '../../tools/core/ragSearch.js';

describe('extractKeywords: Japanese', () => {
    it('keeps the words of a Japanese question, okurigana words whole and a single kanji', () => {
        assert.deepEqual(extractKeywords('押し出しツールの使い方'), ['押し出し', 'ツール', '使い方']);
        assert.deepEqual(extractKeywords('Blenderで面を選択'), ['Blender', '面', '選択']);
        assert.deepEqual(extractKeywords('自然言語処理技術'), ['自然', '言語', '処理', '技術']);
        assert.deepEqual(extractKeywords('UVマップの展開'), ['UV', 'マップ', '展開']);
    });

    it('reads full-width and half-width forms as the same characters', () => {
        assert.deepEqual(extractKeywords('ＢＬＥＮＤＥＲのﾓﾃﾞｨﾌｧｲｱ'), ['BLENDER', 'モディファイア']);
    });

    it('drops particles, endings, question words and a final long-vowel mark', () => {
        assert.deepEqual(extractKeywords('モディファイアーを適用する方法'), ['モディファイア', '適用', '方法']);
        assert.deepEqual(extractKeywords('サーバーについて教えてください'), ['サーバ']);
        assert.deepEqual(extractKeywords('何ですか'), []);
    });

    it('keeps the symbols of a Latin run inside a Japanese phrase, and at most 8 keywords', () => {
        assert.deepEqual(extractKeywords('C#の違い'), ['C#', '違い']);
        assert.deepEqual(extractKeywords('Node.jsの使い方'), ['Node.js', '使い方']);
        assert.equal(extractKeywords('一 二 三 四 五 六 七 八 九 十').length, 8);
    });
});

describe('keywordSearchChunks', () => {
    const recordingPool = () => {
        const queries = [];
        return { queries, query: async (sql, params) => (queries.push({ sql, params }), { rows: [] }) };
    };

    it('matches the chunk text in NFKC form and ranks a single kanji below a longer word', async () => {
        const pool = recordingPool();
        await keywordSearchChunks(pool, { query: 'ＢＬＥＮＤＥＲで面', scope: { conditions: ['m.user_id = $1'], params: ['u'] }, limit: 3 });
        const [query] = pool.queries;
        assert.match(query.sql, /CROSS JOIN LATERAL \(SELECT normalize\(c\.content, NFKC\) AS text\) n/);
        assert.match(query.sql, /WHERE m\.user_id = \$1 AND \(n\.text ILIKE \$2 OR n\.text ILIKE \$3\)/);
        assert.match(query.sql, /ORDER BY \(\(n\.text ILIKE \$2\)::int \* 2 \+ \(n\.text ILIKE \$3\)::int \* 1\) DESC, c\.created_at DESC/);
        assert.deepEqual(query.params, ['u', '%BLENDER%', '%面%', 3]);
    });

    it('asks the database nothing for a query without keywords', async () => {
        const pool = recordingPool();
        assert.deepEqual(await keywordSearchChunks(pool, { query: 'の は を', scope: { conditions: [], params: [] }, limit: 3 }), []);
        assert.equal(pool.queries.length, 0);
    });
});
