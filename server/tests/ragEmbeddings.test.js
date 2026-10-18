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
    isEmbeddingConfigured,
    resetEmbeddingClientForTests,
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

/** Mock pg pool: records every query; `vector` toggles the pgvector type check. */
const mockPool = ({ hasVector = true, rows = [] } = {}) => {
    const queries = [];
    const run = async (sql, params) => {
        queries.push({ sql, params });
        if (/FROM pg_type/.test(sql)) return { rowCount: hasVector ? 1 : 0, rows: hasVector ? [{}] : [] };
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
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
    resetEmbeddingClientForTests();
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
        assert.match(search.sql, /c\.embedding_model = \$2/);
        assert.equal(search.params[1], MODEL_IDS.gemini.embedding);
        assert.equal(search.params[2], 'u1');
        assert.equal(search.params[3], 2);
    });

    it('falls back to keyword search when no embedding key is configured', async () => {
        setEmbeddingClientForTests(null);
        const pool = mockPool({ rows: [] });
        setPoolForTests(pool);
        const result = await searchContent({ query: 'blender modifiers', domain: 'blender-3d' });
        assert.equal(result.search_type, 'keyword');
        assert.ok(!pool.queries.some((q) => /<=>/.test(q.sql)));
    });
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
