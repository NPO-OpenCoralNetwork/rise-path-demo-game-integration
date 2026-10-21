import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { MODEL_IDS } from '../llm/models.config.js';
import {
    EMBEDDING_DIM,
    EMBEDDING_MODEL,
    embedTexts,
    extractKeywords,
    mergeByRelevance,
    isEmbeddingConfigured,
    resetEmbeddingClientForTests,
    resetLegacyEmbeddingWarningForTests,
    searchContent,
    setEmbeddingClientForTests,
} from '../../tools/core/ragSearch.js';
import { ingestMaterial, retrieveContext } from '../ragService.js';

const vector = (seed = 0) => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i + seed) / EMBEDDING_DIM);

/** Fake @google/genai client recording every embedContent call. */
const fakeEmbeddingClient = (log = []) => ({
    log,
    models: {
        async embedContent(params) {
            log.push(params);
            const contents = Array.isArray(params.contents) ? params.contents : [params.contents];
            return { embeddings: contents.map((_, i) => ({ values: vector(i) })) };
        },
    },
});

/**
 * Mock pg pool: records every query; `hasVector` toggles the pgvector type check, `coverage`
 * answers the EXISTS probes (current = chunks embedded with the configured model), `rows` answers
 * other SELECTs and `keywordRows` (default `rows`) the ILIKE keyword search.
 */
const mockPool = ({ hasVector = true, rows = [], keywordRows = rows, coverage = { current: true, legacy: false } } = {}) => {
    const queries = [];
    const run = async (sql, params) => {
        queries.push({ sql, params });
        if (/FROM pg_type/.test(sql)) return { rowCount: hasVector ? 1 : 0, rows: hasVector ? [{}] : [] };
        if (/AS has_current/.test(sql)) {
            return { rowCount: 1, rows: [{ has_current: coverage.current, has_legacy: coverage.legacy }] };
        }
        if (/ILIKE/.test(sql)) return { rowCount: keywordRows.length, rows: keywordRows };
        if (/^\s*SELECT/i.test(sql)) return { rowCount: rows.length, rows };
        return { rowCount: 1, rows: [] };
    };
    return {
        queries,
        query: run,
        async connect() {
            return { query: run, release() {} };
        },
    };
};

const savedEnv = {};
const ENV_KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'VITE_GEMINI_API_KEY'];

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
    }
    resetEmbeddingClientForTests();
    resetLegacyEmbeddingWarningForTests();
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
    resetEmbeddingClientForTests();
    resetLegacyEmbeddingWarningForTests();
    resetPoolForTests();
});

describe('RAG embeddings (shared by ragSearch + ragService)', () => {
    it('uses the embedding model from server/llm/models.config.js at the pgvector column width', () => {
        assert.equal(EMBEDDING_MODEL, MODEL_IDS.gemini.embedding);
        assert.equal(EMBEDDING_DIM, 768);
    });

    it('calls embedContent with the configured model, outputDimensionality and one input per text', async () => {
        const client = fakeEmbeddingClient();
        setEmbeddingClientForTests(client);
        const vectors = await embedTexts(['alpha', 'beta']);
        assert.equal(vectors.length, 2);
        assert.equal(vectors[0].length, EMBEDDING_DIM);
        assert.equal(client.log.length, 1);
        assert.deepEqual(client.log[0], {
            model: MODEL_IDS.gemini.embedding,
            contents: ['alpha', 'beta'],
            config: { outputDimensionality: 768 },
        });
    });

    it('batches more than 100 inputs into several requests and keeps order', async () => {
        const client = fakeEmbeddingClient();
        setEmbeddingClientForTests(client);
        const texts = Array.from({ length: 205 }, (_, i) => `chunk ${i}`);
        const vectors = await embedTexts(texts);
        assert.equal(vectors.length, 205);
        assert.deepEqual(client.log.map((call) => call.contents.length), [100, 100, 5]);
        assert.equal(client.log[2].contents[0], 'chunk 200');
    });

    it('rejects a response whose vectors do not match the column width', async () => {
        setEmbeddingClientForTests({
            models: { embedContent: async () => ({ embeddings: [{ values: [0.1, 0.2] }] }) },
        });
        await assert.rejects(() => embedTexts(['x']), /Embedding response mismatch/);
    });

    it('ignores VITE_GEMINI_API_KEY (browser-exposed) and reads only server keys', async () => {
        process.env.VITE_GEMINI_API_KEY = 'leaky';
        assert.equal(isEmbeddingConfigured(), false);
        await assert.rejects(() => embedTexts(['x']), /GEMINI_API_KEY/);
        process.env.GOOGLE_API_KEY = 'server-key';
        assert.equal(isEmbeddingConfigured(), true);
    });

    it('constructs the real SDK client with { apiKey } and hits the embedding model endpoint', async () => {
        process.env.GEMINI_API_KEY = 'test-key-123';
        const originalFetch = globalThis.fetch;
        const calls = [];
        globalThis.fetch = async (url, init) => {
            calls.push({ url: String(url), init });
            return new Response(JSON.stringify({ embeddings: [{ values: vector(1) }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        };
        try {
            const [values] = await embedTexts(['hello']);
            assert.equal(values.length, EMBEDDING_DIM);
        } finally {
            globalThis.fetch = originalFetch;
        }
        assert.equal(calls.length, 1);
        assert.match(calls[0].url, new RegExp(`models/${MODEL_IDS.gemini.embedding}:batchEmbedContents`));
        const headers = new Headers(calls[0].init?.headers);
        assert.equal(headers.get('x-goog-api-key'), 'test-key-123');
        const body = JSON.parse(calls[0].init.body);
        assert.equal(body.requests[0].outputDimensionality, 768);
        assert.equal(body.requests[0].model, `models/${MODEL_IDS.gemini.embedding}`);
    });
});

/** WHERE prefix of every searchContent query: ready materials that are the caller's own or public. */
const SEARCHABLE_SCOPE = /WHERE m\.status = 'ready' AND \(m\.user_id = \$1 OR m\.meta->>'visibility' = 'public'\)/;

describe('tools/core/ragSearch searchContent', () => {
    it('vector search embeds the query and only matches chunks from the same embedding model', async () => {
        const client = fakeEmbeddingClient();
        setEmbeddingClientForTests(client);
        const pool = mockPool({ rows: [{ content: 'Blender basics', chunk_index: 0, distance: 0.25, material_id: 'm1' }] });
        setPoolForTests(pool);

        const result = await searchContent({ query: 'blender modifiers', domain: 'blender-3d', maxResults: 2, userId: 'u1' });
        assert.equal(result.search_type, 'vector');
        assert.equal(result.results[0].relevance_score, 0.75);
        assert.deepEqual(client.log[0].contents, ['blender modifiers']);

        const search = pool.queries.find((q) => /<=>/.test(q.sql));
        assert.ok(search, 'vector query issued');
        assert.match(search.sql, SEARCHABLE_SCOPE);
        assert.match(search.sql, /c\.embedding <=> \$2::vector/);
        assert.match(search.sql, /AND c\.embedding_model = \$3/);
        assert.match(search.sql, /LIMIT \$4/);
        assert.equal(search.params[0], 'u1');
        assert.deepEqual(search.params.slice(2), [MODEL_IDS.gemini.embedding, 2]);
    });

    it('falls back to keyword search over the same scope when no embedding key is configured', async () => {
        setEmbeddingClientForTests(null);
        const pool = mockPool({ rows: [] });
        setPoolForTests(pool);
        const result = await searchContent({ query: 'blender modifiers', domain: 'blender-3d', userId: 'u1' });
        assert.equal(result.search_type, 'keyword');
        assert.ok(!pool.queries.some((q) => /<=>/.test(q.sql)));

        const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(keyword.sql, SEARCHABLE_SCOPE);
        assert.deepEqual(keyword.params, ['u1', '%blender%', '%modifiers%', 3]);
    });

    it('falls back to keyword search over the same scope without pgvector', async () => {
        const pool = mockPool({ hasVector: false, rows: [] });
        setPoolForTests(pool);
        const result = await searchContent({ query: 'blender modifiers', userId: 'u1' });
        assert.equal(result.search_type, 'keyword');

        const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(keyword.sql, SEARCHABLE_SCOPE);
        assert.equal(keyword.params[0], 'u1');
    });

    it('refuses to search without a userId and runs no query (uploaded materials are private)', async () => {
        const client = fakeEmbeddingClient();
        setEmbeddingClientForTests(client);
        const pool = mockPool();
        setPoolForTests(pool);

        for (const userId of [undefined, null, '', '   ', 42]) {
            const result = await searchContent({ query: 'blender modifiers', userId });
            assert.equal(result.error_type, 'validation');
            assert.deepEqual(result.results, []);
        }
        assert.equal(pool.queries.length, 0);
        assert.equal(client.log.length, 0);
    });

    it('falls back to keyword search over the same scope when embedding the query fails', async () => {
        setEmbeddingClientForTests({
            models: { embedContent: async () => { throw new Error('embedding service down'); } },
        });
        const pool = mockPool({ rows: [] });
        setPoolForTests(pool);

        const result = await searchContent({ query: 'blender modifiers', userId: 'u1' });
        assert.equal(result.search_type, 'keyword');
        assert.ok(!pool.queries.some((q) => /<=>/.test(q.sql)));

        const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(keyword.sql, SEARCHABLE_SCOPE);
        assert.equal(keyword.params[0], 'u1');
    });

    for (const [maxResults, limit] of [[undefined, 3], [0, 1], [-5, 1], [2.7, 2], [100, 10], [Number.NaN, 3]]) {
        it(`clamps maxResults ${maxResults} to ${limit}`, async () => {
            setEmbeddingClientForTests(null);
            const pool = mockPool({ rows: [] });
            setPoolForTests(pool);
            await searchContent({ query: 'blender modifiers', userId: 'u1', maxResults });
            const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
            assert.equal(keyword.params.at(-1), limit);
        });
    }
});

describe('server/ragService ingest + retrieve', () => {
    it('embeds all chunks before BEGIN and stores the model id and dimension per row', async () => {
        const client = fakeEmbeddingClient();
        setEmbeddingClientForTests(client);
        const pool = mockPool();
        setPoolForTests(pool);

        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ingest-'));
        const file = path.join(dir, 'notes.txt');
        await fs.writeFile(file, 'Rise Path material. '.repeat(120), 'utf8');
        const log = console.log;
        console.log = () => {};
        try {
            await ingestMaterial('mat-1', file, 'text/plain', 'user-1');
        } finally {
            console.log = log;
            await fs.rm(dir, { recursive: true, force: true });
        }

        assert.equal(client.log.length, 1, 'one batched embed call');
        // 2,400 chars at 1,000/200 overlap → 3 chunks (the tail is not re-emitted ~200 times).
        assert.equal(client.log[0].contents.length, 3);
        const inserts = pool.queries.filter((q) => /INSERT INTO material_chunks/.test(q.sql));
        assert.equal(inserts.length, 3);
        for (const insert of inserts) {
            assert.equal(insert.params[5], MODEL_IDS.gemini.embedding);
            assert.equal(insert.params[6], 768);
            assert.equal(JSON.parse(insert.params[3]).length, 768);
        }
        assert.match(pool.queries[0].sql, /^BEGIN$/);
        assert.ok(pool.queries.some((q) => q.sql === 'COMMIT'));
    });

    it('retrieveContext filters by embedding model under pgvector', async () => {
        setEmbeddingClientForTests(fakeEmbeddingClient());
        const pool = mockPool({ rows: [{ content: 'chunk A', distance: 0.1 }] });
        setPoolForTests(pool);
        const log = console.log;
        console.log = () => {};
        let chunks;
        try {
            chunks = await retrieveContext('what is a modifier', 3, 'user-1');
        } finally {
            console.log = log;
        }
        assert.deepEqual(chunks, ['chunk A']);
        const search = pool.queries.find((q) => /<=>/.test(q.sql));
        assert.match(search.sql, /c\.embedding_model = \$3/);
        assert.deepEqual(search.params.slice(1), ['user-1', MODEL_IDS.gemini.embedding, 3]);
    });
});

/** Run `fn` with console.log silenced and console.warn captured. */
const captureWarnings = async (fn) => {
    const warnings = [];
    const { log, warn } = console;
    console.log = () => {};
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        return { value: await fn(), warnings };
    } finally {
        console.log = log;
        console.warn = warn;
    }
};

describe('legacy chunks (older or no embedding model) are never compared with current vectors', () => {
    it('extractKeywords splits Japanese into kanji/katakana runs and keeps symbols and other scripts', () => {
        assert.deepEqual(extractKeywords('Blenderのモディファイアとは何ですか？'), ['Blender', 'モディファイア']);
        assert.deepEqual(extractKeywords('what is a modifier?'), ['what', 'is', 'modifier']);
        assert.deepEqual(extractKeywords('教材 教材 AI ai ゲーム開発'), ['教材', 'AI', 'ゲーム', '開発']);
        assert.deepEqual(extractKeywords('は が の'), []);
        assert.deepEqual(extractKeywords('C# と C++ の違い').slice(0, 2), ['C#', 'C++']);
        assert.deepEqual(extractKeywords('C# basics'), ['C#', 'basics']);
        assert.deepEqual(extractKeywords('Node.js の使い方')[0], 'Node.js');
        assert.deepEqual(extractKeywords('블렌더 모디파이어'), ['블렌더', '모디파이어']);
        assert.deepEqual(extractKeywords('Как работает Blender'), ['Как', 'работает', 'Blender']);
        assert.deepEqual(extractKeywords('ひらがなだけ'), ['ひらがなだけ'], 'a hiragana-only word is kept whole');
        assert.deepEqual(extractKeywords('「Unity」の物理'), ['Unity', '物理']);
    });

    it('mergeByRelevance ranks vector hits (1 - distance) and keyword hits (0.5) together', () => {
        const merged = mergeByRelevance(
            [{ content: 'close', distance: 0.2 }, { content: 'far', distance: 0.7 }],
            [{ content: 'legacy' }],
            3,
        );
        assert.deepEqual(merged.map((r) => [r.content, r.relevance, r.match]), [
            ['close', 0.8, 'vector'], ['legacy', 0.5, 'keyword'], ['far', 0.3, 'vector'],
        ]);
        assert.equal(mergeByRelevance([{ content: 'tie', distance: 0.5 }], [{ content: 'legacy' }], 1)[0].content, 'tie');
    });

    it('retrieveContext keyword-matches the user\'s chunks without embedding the query when none use the current model', async () => {
        const client = fakeEmbeddingClient();
        setEmbeddingClientForTests(client);
        const pool = mockPool({
            coverage: { current: false, legacy: true },
            rows: [{ content: 'モディファイアは形状を非破壊で変えます。', chunk_index: 2, material_id: 'm1' }],
        });
        setPoolForTests(pool);

        const { value: chunks, warnings } = await captureWarnings(async () => {
            const first = await retrieveContext('Blenderのモディファイアとは？', 3, 'user-1');
            await retrieveContext('another question about modifiers', 3, 'user-1');
            return first;
        });

        assert.deepEqual(chunks, ['モディファイアは形状を非破壊で変えます。']);
        assert.equal(client.log.length, 0, 'no query embedding: there is nothing comparable to search');
        assert.ok(!pool.queries.some((q) => /<=>/.test(q.sql)), 'no vector comparison against older-model rows');

        const coverage = pool.queries.find((q) => /AS has_current/.test(q.sql));
        assert.doesNotMatch(coverage.sql, /COUNT/, 'existence probes, not a full count');
        assert.match(coverage.sql, /EXISTS \(SELECT 1 FROM material_chunks c JOIN materials m ON c\.material_id = m\.id WHERE m\.user_id = \$1 AND c\.embedding_model = \$2\)/);
        assert.match(coverage.sql, /WHERE m\.user_id = \$1 AND \(c\.embedding_model IS NULL OR c\.embedding_model < \$2 OR c\.embedding_model > \$2\)/, 'NULL models (seeded rows) count as legacy');
        assert.deepEqual(coverage.params, ['user-1', MODEL_IDS.gemini.embedding]);

        const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(keyword.sql, /WHERE m\.user_id = \$1 AND \(c\.content ILIKE \$2 OR c\.content ILIKE \$3\)/);
        assert.match(keyword.sql, /ORDER BY \(\(c\.content ILIKE \$2\)::int \+ \(c\.content ILIKE \$3\)::int\) DESC/);
        assert.deepEqual(keyword.params, ['user-1', '%Blender%', '%モディファイア%', 3]);

        assert.equal(warnings.length, 1, 'warned once per process, not per request');
        assert.ok(warnings[0].includes(`not embedded with ${MODEL_IDS.gemini.embedding}`), warnings[0]);
        assert.match(warnings[0], /Re-embedding is required: node scripts\/rag\/reembed\.mjs --dry-run/);
    });

    it('retrieveContext with mixed chunks: vector search over current ones, keyword hits over older ones, merged', async () => {
        const client = fakeEmbeddingClient();
        setEmbeddingClientForTests(client);
        const pool = mockPool({
            coverage: { current: true, legacy: true },
            rows: [{ content: 'Godot scenes are trees of nodes.', distance: 0.7 }],
            keywordRows: [{ content: 'Blenderのモディファイアは形状を非破壊で変えます。', chunk_index: 0, material_id: 'm1' }],
        });
        setPoolForTests(pool);

        const { value: chunks, warnings } = await captureWarnings(() => retrieveContext('Blenderのモディファイアとは？', 3, 'user-1'));
        assert.deepEqual(chunks, ['Blenderのモディファイアは形状を非破壊で変えます。', 'Godot scenes are trees of nodes.'],
            'the older material does not disappear once one material uses the current model');
        assert.equal(client.log.length, 1);
        const search = pool.queries.find((q) => /<=>/.test(q.sql));
        assert.match(search.sql, /c\.embedding_model = \$3/);
        assert.equal(search.params[2], MODEL_IDS.gemini.embedding);
        assert.ok(!/ILIKE/.test(search.sql), 'vectors are never compared with older-model rows');

        const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(keyword.sql, /WHERE m\.user_id = \$1 AND \(c\.embedding_model IS NULL OR c\.embedding_model < \$2 OR c\.embedding_model > \$2\) AND \(c\.content ILIKE \$3 OR c\.content ILIKE \$4\)/);
        assert.deepEqual(keyword.params, ['user-1', MODEL_IDS.gemini.embedding, '%Blender%', '%モディファイア%', 3]);
        assert.equal(warnings.length, 1);
    });

    it('retrieveContext stays quiet and skips keyword search when every chunk already uses the current model', async () => {
        const pool = mockPool({ coverage: { current: true, legacy: false }, rows: [{ content: 'chunk C', distance: 0.1 }] });
        setEmbeddingClientForTests(fakeEmbeddingClient());
        setPoolForTests(pool);
        const { value: chunks, warnings } = await captureWarnings(() => retrieveContext('modifiers', 3, 'user-1'));
        assert.deepEqual(chunks, ['chunk C']);
        assert.deepEqual(warnings, []);
        assert.ok(!pool.queries.some((q) => /ILIKE/.test(q.sql)));
    });

    it('searchContent falls back to keyword search over the same ready/user scope when no chunk uses the current model', async () => {
        const client = fakeEmbeddingClient();
        setEmbeddingClientForTests(client);
        const pool = mockPool({
            coverage: { current: false, legacy: true },
            rows: [{ content: 'Blender modifiers stack', chunk_index: 1, material_id: 'm9' }],
        });
        setPoolForTests(pool);

        const { value: result, warnings } = await captureWarnings(() =>
            searchContent({ query: 'blender modifiers', domain: 'blender-3d', maxResults: 2, userId: 'u1' }));

        assert.equal(result.search_type, 'keyword');
        assert.equal(result.fallback_reason, 'reembed_required');
        assert.equal(result.results[0].source, 'm9');
        assert.equal(client.log.length, 0);
        assert.ok(!pool.queries.some((q) => /<=>/.test(q.sql)));

        const coverage = pool.queries.find((q) => /AS has_current/.test(q.sql));
        assert.match(coverage.sql, /WHERE m\.status = 'ready' AND \(m\.user_id = \$1 OR m\.meta->>'visibility' = 'public'\) AND c\.embedding_model = \$2/);
        assert.deepEqual(coverage.params, ['u1', MODEL_IDS.gemini.embedding]);

        const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(keyword.sql, /WHERE m\.status = 'ready' AND \(m\.user_id = \$1 OR m\.meta->>'visibility' = 'public'\) AND \(c\.content ILIKE \$2 OR c\.content ILIKE \$3\)/);
        assert.deepEqual(keyword.params, ['u1', '%blender%', '%modifiers%', 2]);
        assert.equal(warnings.length, 1);
    });

    it('searchContent with mixed chunks in the caller\'s scope: a current chunk does not hide older chunks', async () => {
        const client = fakeEmbeddingClient();
        setEmbeddingClientForTests(client);
        const pool = mockPool({
            coverage: { current: true, legacy: true },
            rows: [{ content: 'Krita brushes', chunk_index: 0, distance: 0.6, material_id: 'm-krita' }],
            keywordRows: [{ content: 'Blender modifier stack', chunk_index: 3, material_id: 'm-blender' }],
        });
        setPoolForTests(pool);

        const { value: result } = await captureWarnings(() =>
            searchContent({ query: 'Blender modifier', domain: 'blender-3d', maxResults: 3, userId: 'u1' }));

        assert.equal(result.search_type, 'vector+keyword');
        assert.equal(result.reembed_required, true);
        assert.deepEqual(result.results.map((r) => [r.source, r.relevance_score, r.match]), [
            ['m-blender', 0.5, 'keyword'],
            ['m-krita', 0.4, undefined],
        ]);
        const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(keyword.sql, /WHERE m\.status = 'ready' AND \(m\.user_id = \$1 OR m\.meta->>'visibility' = 'public'\) AND \(c\.embedding_model IS NULL OR c\.embedding_model < \$2 OR c\.embedding_model > \$2\) AND \(c\.content ILIKE \$3 OR c\.content ILIKE \$4\)/);
        assert.deepEqual(keyword.params, ['u1', MODEL_IDS.gemini.embedding, '%Blender%', '%modifier%', 3]);
        const search = pool.queries.find((q) => /<=>/.test(q.sql));
        assert.match(search.sql, SEARCHABLE_SCOPE);
        assert.equal(search.params[0], 'u1');
        assert.deepEqual(search.params.slice(2), [MODEL_IDS.gemini.embedding, 3]);
    });
});
