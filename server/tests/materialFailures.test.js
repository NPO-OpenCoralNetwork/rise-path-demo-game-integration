// 「出典と検索」 step 2: when something goes wrong with a learner's material, the learner and the
// records can tell.
// - An upload whose embedding fails is stored without vectors (keyword search finds it) and marked
//   meta.embedding 'failed' until scripts/rag/reembed.mjs embeds it.
// - A file with no readable text (a scanned PDF) is status 'error' with meta.error, and the course
//   generator says so instead of sending the message with a file nothing can be read from.
// - A search that matched by keyword instead of by vector says why (fallback_reason), and a failed
//   query embedding is logged.
// - The course generator's retrieval reads only ready materials, the attached ones first.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { MODEL_IDS } from '../llm/models.config.js';
import {
    EMBEDDING_DIM,
    resetEmbeddingClientForTests,
    resetLegacyEmbeddingWarningForTests,
    searchContent,
    setEmbeddingClientForTests,
} from '../../tools/core/ragSearch.js';
import { MAX_CHUNKS_PER_MATERIAL, ingestMaterial, retrieveContext, unreadableReason } from '../ragService.js';
import { jobErrorCode } from '../jobWorker.js';
import { invalidGenerateBody } from '../routes/ai.js';
import { reembedChunks } from '../../scripts/rag/reembed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEARNER = 'a1a1a1a1-0000-4000-8000-000000000001';
const ATTACHED = 'b2b2b2b2-0000-4000-8000-000000000002';
const MATERIAL = 'c3c3c3c3-0000-4000-8000-000000000003';
const CURRENT = MODEL_IDS.gemini.embedding;

const vector = (seed = 0) => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i + seed) / EMBEDDING_DIM);

/** A @google/genai stand-in whose embedContent fails like a quota refusal, or answers vectors. */
const embeddingClient = ({ fails = false } = {}) => {
    const calls = [];
    return {
        calls,
        models: {
            async embedContent(params) {
                calls.push(params);
                if (fails) throw Object.assign(new Error('Resource has been exhausted (quota)'), { status: 429 });
                const contents = Array.isArray(params.contents) ? params.contents : [params.contents];
                return { embeddings: contents.map((_, i) => ({ values: vector(i) })) };
            },
        },
    };
};

/**
 * Mock pg pool recording every query. `keywordRows` answers the ILIKE search (a function gets the
 * SQL), `vectorRows` the vector search, `openingRows` the first chunks of attached materials,
 * `embedded` the count of a material's embedded chunks (ingestion with embeddings off).
 */
const mockPool = ({ hasVector = true, coverage = { current: true, legacy: false }, keywordRows = [], vectorRows = [], openingRows = [], embedded = 0 } = {}) => {
    const queries = [];
    const run = async (sql, params = []) => {
        queries.push({ sql, params });
        const rows = (value) => {
            const list = typeof value === 'function' ? value(sql, params) : value;
            return { rowCount: list.length, rows: list };
        };
        if (/FROM pg_type/.test(sql)) return { rowCount: hasVector ? 1 : 0, rows: hasVector ? [{}] : [] };
        if (/AS has_current/.test(sql)) return { rowCount: 1, rows: [{ has_current: coverage.current, has_legacy: coverage.legacy }] };
        if (/embedding IS NOT NULL/.test(sql)) return { rowCount: 1, rows: [{ embedded }] };
        if (/ILIKE/.test(sql)) return rows(keywordRows);
        if (/<=>/.test(sql)) return rows(vectorRows);
        if (/ORDER BY c\.chunk_index/.test(sql)) return rows(openingRows);
        return { rowCount: 1, rows: [] };
    };
    return { queries, query: run, async connect() { return { query: run, release() {} }; } };
};

/** The statement that set a material's status, with its parameters. */
const statusUpdate = (pool) => pool.queries.find((q) => /UPDATE materials SET status/.test(q.sql));

/**
 * A one-page PDF of a few hundred bytes. `content` is the page's content stream (null: an empty
 * page, as a scan's text layer is). Small on purpose: pdf.js misread PDFs under 4 KB that it was
 * handed as a Node Buffer.
 */
const tinyPdf = (content) => {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        content === null
            ? '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>'
            : '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    ];
    if (content !== null) {
        objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
        objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    }
    let pdf = '%PDF-1.4\n';
    const offsets = objects.map((body, i) => {
        const offset = pdf.length;
        pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
        return offset;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, 'latin1');
};

/**
 * Write `bytes` to a temp file, run `fn(file)` with the console captured, then clean up.
 * @returns {Promise<{ value?: any, error?: any, logs: string[] }>} `error`: what fn threw
 */
const withFile = async (name, bytes, fn) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-material-'));
    const file = path.join(dir, name);
    await fs.writeFile(file, bytes);
    const logs = [];
    const saved = { log: console.log, warn: console.warn, error: console.error };
    for (const level of ['log', 'warn', 'error']) console[level] = (...args) => logs.push(`${level}: ${args.join(' ')}`);
    try {
        return { value: await fn(file), logs };
    } catch (error) {
        return { error, logs };
    } finally {
        Object.assign(console, saved);
        await fs.rm(dir, { recursive: true, force: true });
    }
};

/** Run `fn` with the console captured. */
const capture = async (fn) => {
    const logs = [];
    const saved = { log: console.log, warn: console.warn, error: console.error };
    for (const level of ['log', 'warn', 'error']) console[level] = (...args) => logs.push(`${level}: ${args.join(' ')}`);
    try {
        return { value: await fn(), logs };
    } finally {
        Object.assign(console, saved);
    }
};

const ENV_KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_ALLOWED'];
const savedEnv = {};

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
    }
    process.env.GEMINI_ALLOWED = 'true';
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

const TEXT = 'Rise Path material. '.repeat(120);

describe('ingestMaterial: a failed embedding still leaves the material searchable', () => {
    it('stores the chunks without vectors, marks the material ready with meta.embedding failed, and logs why', async () => {
        const client = embeddingClient({ fails: true });
        setEmbeddingClientForTests(client);
        const pool = mockPool();
        setPoolForTests(pool);

        const { value, error, logs } = await withFile('notes.txt', TEXT, (file) => ingestMaterial(MATERIAL, file, 'text/plain', LEARNER));

        assert.equal(error, undefined, String(error));
        assert.deepEqual(value, { chunks: 3, embedded: 0, embedding: 'failed' });
        assert.equal(client.calls.length, 1, 'one embedding call was tried');
        const inserts = pool.queries.filter((q) => /INSERT INTO material_chunks/.test(q.sql));
        assert.equal(inserts.length, 3);
        for (const insert of inserts) assert.match(insert.sql, /VALUES \(\$1, \$2, \$3, NULL, \$4, NULL, NULL\)/, 'no vector, no model: reembed.mjs picks them up');
        const ready = statusUpdate(pool);
        assert.deepEqual(ready.params, ['ready', MATERIAL, '{"embedding":"failed"}']);
        assert.match(ready.sql, /meta = \(COALESCE\(meta, '\{\}'::jsonb\) - '\{error,embedding,truncated\}'::text\[\]\) \|\| \$3::jsonb/);
        const warning = logs.find((line) => line.includes('embedding failed'));
        assert.ok(warning, logs.join('\n'));
        assert.match(warning, new RegExp(`${MATERIAL}.*Resource has been exhausted.*node scripts/rag/reembed\\.mjs`));
        assert.ok(!logs.some((line) => line.includes('Rise Path material.')), 'never the material text');
    });

    it('a re-index whose embedding fails keeps the vectors already stored, and fails like before (embed_failed)', async () => {
        setEmbeddingClientForTests(embeddingClient({ fails: true }));
        const pool = mockPool({ embedded: 4 });
        setPoolForTests(pool);

        const { error, logs } = await withFile('notes.txt', TEXT, (file) => ingestMaterial(MATERIAL, file, 'text/plain', LEARNER));

        assert.match(String(error?.message), /Resource has been exhausted/);
        assert.equal(error.ingestStage, 'embed');
        assert.equal(jobErrorCode(error), 'embed_failed');
        assert.ok(!pool.queries.some((q) => /DELETE FROM material_chunks|INSERT INTO material_chunks|UPDATE materials/.test(q.sql)), 'stored chunks and status untouched');
        assert.ok(logs.some((line) => line.includes(`${MATERIAL}: embedding failed; keeping its 4 embedded chunks`)), logs.join('\n'));
    });

    it('a successful ingest clears the marks of an earlier run (meta keys error, embedding, truncated)', async () => {
        setEmbeddingClientForTests(embeddingClient());
        const pool = mockPool();
        setPoolForTests(pool);
        const { value } = await withFile('notes.txt', TEXT, (file) => ingestMaterial(MATERIAL, file, 'text/plain', LEARNER));
        assert.deepEqual(value, { chunks: 3, embedded: 3 });
        assert.deepEqual(statusUpdate(pool).params, ['ready', MATERIAL, '{}']);
    });

    it(`records a cut file in meta.truncated (the first ${MAX_CHUNKS_PER_MATERIAL} chunks are indexed)`, async () => {
        delete process.env.GEMINI_ALLOWED;
        const pool = mockPool();
        setPoolForTests(pool);
        const { value } = await withFile('long.txt', 'Rise Path material. '.repeat(15000), (file) => ingestMaterial(MATERIAL, file, 'text/plain', LEARNER));
        assert.equal(value.truncated.indexed, MAX_CHUNKS_PER_MATERIAL);
        assert.ok(value.truncated.total > MAX_CHUNKS_PER_MATERIAL, JSON.stringify(value));
        const [status, id, meta] = statusUpdate(pool).params;
        assert.deepEqual([status, id, JSON.parse(meta)], ['ready', MATERIAL, { truncated: value.truncated }]);
    });
});

describe('ingestMaterial: a file with no readable text is status error, with the reason', () => {
    const assertUnreadable = (pool, error, reason) => {
        assert.ok(error, 'ingestMaterial threw');
        assert.equal(unreadableReason(error), reason);
        assert.equal(error.ingestStage, 'extract');
        assert.equal(jobErrorCode(error), reason, 'GET /jobs/:id shows the same code');
        const update = statusUpdate(pool);
        assert.match(update.sql, /UPDATE materials SET status = 'error', meta = \(COALESCE\(meta, '\{\}'::jsonb\) - '\{error,embedding,truncated\}'::text\[\]\) \|\| \$2::jsonb/);
        assert.deepEqual(update.params, [MATERIAL, JSON.stringify({ error: reason })]);
        assert.ok(!pool.queries.some((q) => /INSERT INTO material_chunks/.test(q.sql)), 'no chunks');
    };

    it('a text file with no letter (blanks, marks, page numbers) is no_text, and nothing is embedded', async () => {
        const client = embeddingClient();
        setEmbeddingClientForTests(client);
        const pool = mockPool();
        setPoolForTests(pool);
        const { error } = await withFile('blank.txt', '  \n\n\t ・・・ \n1\n2\n- 3 -\n', (file) => ingestMaterial(MATERIAL, file, 'text/plain', LEARNER));
        assertUnreadable(pool, error, 'no_text');
        assert.equal(client.calls.length, 0);
    });

    it('a PDF page with no text (a scan holds only images) is no_text', async () => {
        delete process.env.GEMINI_ALLOWED;
        const pool = mockPool();
        setPoolForTests(pool);
        const { error } = await withFile('scan.pdf', tinyPdf(null), (file) => ingestMaterial(MATERIAL, file, 'application/pdf', LEARNER));
        assertUnreadable(pool, error, 'no_text');
    });

    it('a small PDF with text is read and indexed', async () => {
        delete process.env.GEMINI_ALLOWED;
        const pool = mockPool();
        setPoolForTests(pool);
        const { value, error } = await withFile('note.pdf', tinyPdf('BT /F1 12 Tf 20 100 Td (Hello PDF) Tj ET'), (file) => ingestMaterial(MATERIAL, file, 'application/pdf', LEARNER));
        assert.equal(error, undefined, String(error));
        assert.deepEqual(value, { chunks: 1, embedded: 0 });
        const insert = pool.queries.find((q) => /INSERT INTO material_chunks/.test(q.sql));
        assert.equal(insert.params[2], 'Hello PDF');
        assert.deepEqual(statusUpdate(pool).params, ['ready', MATERIAL, '{}']);
    });

    it('a PDF that pdf-parse cannot read is extract_failed, and its reason is logged', async () => {
        delete process.env.GEMINI_ALLOWED;
        const pool = mockPool();
        setPoolForTests(pool);
        const { error, logs } = await withFile('broken.pdf', '%PDF-1.4 not really a PDF', (file) => ingestMaterial(MATERIAL, file, 'application/pdf', LEARNER));
        assertUnreadable(pool, error, 'extract_failed');
        assert.ok(logs.some((line) => /Ingestion failed: .*Invalid PDF structure/.test(line)), logs.join('\n'));
    });

    it('a missing file is not a reason to mark the material: it may still have its chunks', async () => {
        delete process.env.GEMINI_ALLOWED;
        const pool = mockPool();
        setPoolForTests(pool);
        const { error } = await capture(async () => {
            try {
                await ingestMaterial(MATERIAL, path.join(os.tmpdir(), 'rp-material-missing', 'gone.pdf'), 'application/pdf', LEARNER);
                return {};
            } catch (thrown) {
                return { error: thrown };
            }
        }).then(({ value }) => value);
        assert.equal(error?.code, 'ENOENT');
        assert.equal(unreadableReason(error), null);
        assert.equal(jobErrorCode(error), 'file_missing');
        assert.equal(statusUpdate(pool), undefined, 'status unchanged');
    });

    it('a failure to mark the material is logged, and the reason still reaches the caller', async () => {
        delete process.env.GEMINI_ALLOWED;
        const pool = mockPool();
        const query = pool.query;
        pool.query = async (sql, params) => {
            if (/UPDATE materials/.test(sql)) throw Object.assign(new Error('connection terminated'), { code: '57P01' });
            return query(sql, params);
        };
        setPoolForTests(pool);
        const { error, logs } = await withFile('blank.txt', '\n', (file) => ingestMaterial(MATERIAL, file, 'text/plain', LEARNER));
        assert.equal(unreadableReason(error), 'no_text');
        assert.ok(logs.some((line) => line.includes(MATERIAL) && line.includes('57P01')), logs.join('\n'));
    });
});

describe('search says why it matched by keyword (fallback_reason)', () => {
    const KEYWORD_HIT = [{ content: 'Blender modifiers stack', chunk_index: 1, material_id: MATERIAL }];

    it('embeddings off: embeddings_off', async () => {
        delete process.env.GEMINI_ALLOWED;
        setPoolForTests(mockPool({ keywordRows: KEYWORD_HIT }));
        const result = await searchContent({ query: 'blender modifiers', userId: LEARNER });
        assert.equal(result.search_type, 'keyword');
        assert.equal(result.fallback_reason, 'embeddings_off');
        assert.equal(result.results[0].source, MATERIAL);
    });

    it('no pgvector: no_pgvector, without embedding the query', async () => {
        const client = embeddingClient();
        setEmbeddingClientForTests(client);
        const pool = mockPool({ hasVector: false, keywordRows: KEYWORD_HIT });
        setPoolForTests(pool);
        const result = await searchContent({ query: 'blender modifiers', userId: LEARNER });
        assert.equal(result.fallback_reason, 'no_pgvector');
        assert.equal(result.results.length, 1);
        assert.equal(client.calls.length, 0);
        assert.ok(!pool.queries.some((q) => /AS has_current|<=>/.test(q.sql)));
    });

    it('embedding the query fails: embedding_error, keyword results, and a log line without the query', async () => {
        setEmbeddingClientForTests(embeddingClient({ fails: true }));
        const pool = mockPool({ keywordRows: KEYWORD_HIT });
        setPoolForTests(pool);
        const { value: result, logs } = await capture(() => searchContent({ query: 'blender modifiers', userId: LEARNER }));
        assert.equal(result.search_type, 'keyword');
        assert.equal(result.fallback_reason, 'embedding_error');
        assert.deepEqual(result.results.map((r) => [r.source, r.relevance_score]), [[MATERIAL, 0.5]]);
        assert.ok(!pool.queries.some((q) => /<=>/.test(q.sql)));
        const warning = logs.find((line) => line.includes('Resource has been exhausted'));
        assert.ok(warning, logs.join('\n'));
        assert.ok(!warning.includes('blender modifiers'), 'the query is not logged');
    });

    it('nothing in scope: no results, no reason to re-embed, and no embedding call', async () => {
        const client = embeddingClient();
        setEmbeddingClientForTests(client);
        const pool = mockPool({ coverage: { current: false, legacy: false } });
        setPoolForTests(pool);
        const result = await searchContent({ query: 'blender modifiers', userId: LEARNER });
        assert.deepEqual(result.results, []);
        assert.equal(result.search_type, 'none');
        assert.equal('fallback_reason' in result, false);
        assert.equal(client.calls.length, 0);
        assert.ok(!pool.queries.some((q) => /ILIKE|<=>/.test(q.sql)));
    });

    it('a vector search has no fallback_reason', async () => {
        setEmbeddingClientForTests(embeddingClient());
        setPoolForTests(mockPool({ vectorRows: [{ content: 'Blender basics', chunk_index: 0, distance: 0.25, material_id: MATERIAL }] }));
        const result = await searchContent({ query: 'blender modifiers', userId: LEARNER });
        assert.equal(result.search_type, 'vector');
        assert.equal('fallback_reason' in result, false);
    });
});

describe('retrieveContext (course generator): the learner\'s ready materials, attached ones first', () => {
    it('reads only ready materials', async () => {
        delete process.env.GEMINI_ALLOWED;
        const pool = mockPool({ keywordRows: [{ content: 'ready chunk', chunk_index: 0, material_id: MATERIAL }] });
        setPoolForTests(pool);
        const { value } = await capture(() => retrieveContext('Blenderのモディファイア', 3, LEARNER));
        assert.deepEqual(value, ['ready chunk']);
        const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(keyword.sql, /WHERE m\.status = 'ready' AND m\.user_id = \$1 AND \(n\.text ILIKE/);
        assert.equal(keyword.params[0], LEARNER);
    });

    it('matches by keyword when embedding the query fails (it used to return nothing)', async () => {
        setEmbeddingClientForTests(embeddingClient({ fails: true }));
        const pool = mockPool({ keywordRows: [{ content: 'keyword chunk', chunk_index: 0, material_id: MATERIAL }] });
        setPoolForTests(pool);
        const { value, logs } = await capture(() => retrieveContext('Blenderのモディファイア', 3, LEARNER));
        assert.deepEqual(value, ['keyword chunk']);
        assert.ok(logs.some((line) => line.includes('Resource has been exhausted')), logs.join('\n'));
        assert.ok(!logs.some((line) => line.includes('モディファイア')), 'the learner\'s message is not logged');
    });

    it('without pgvector: keyword matches, not the newest chunks', async () => {
        const pool = mockPool({ hasVector: false, keywordRows: [{ content: 'keyword chunk', chunk_index: 0, material_id: MATERIAL }] });
        setPoolForTests(pool);
        const { value } = await capture(() => retrieveContext('Blenderのモディファイア', 3, LEARNER));
        assert.deepEqual(value, ['keyword chunk']);
        assert.ok(!pool.queries.some((q) => /ORDER BY c\.created_at DESC\s+LIMIT/.test(q.sql) && !/ILIKE/.test(q.sql)), 'no "latest chunks" query');
    });

    const attachedPool = () => mockPool({
        // The message's words are found once in the attached file and once in another material.
        keywordRows: (sql) => (/m\.id = ANY/.test(sql)
            ? [{ content: 'attached: match', chunk_index: 5, material_id: ATTACHED }]
            : /m\.id <> ALL/.test(sql) ? [{ content: 'other: match', chunk_index: 2, material_id: MATERIAL }] : []),
        openingRows: [
            { content: 'attached: opening', chunk_index: 0, material_id: ATTACHED },
            { content: 'attached: match', chunk_index: 5, material_id: ATTACHED },
            { content: 'attached: second', chunk_index: 1, material_id: ATTACHED },
        ],
    });

    it('fills from the attached material first: its matches, then its opening chunks', async () => {
        delete process.env.GEMINI_ALLOWED;
        const pool = attachedPool();
        setPoolForTests(pool);
        const { value } = await capture(() => retrieveContext('この資料でコースを作りたい', 3, LEARNER, { materialIds: [ATTACHED] }));
        assert.deepEqual(value, ['attached: match', 'attached: opening', 'attached: second']);
        const search = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(search.sql, /WHERE m\.status = 'ready' AND m\.user_id = \$1 AND m\.id = ANY\(\$2::uuid\[\]\) AND/);
        assert.deepEqual(search.params.slice(0, 2), [LEARNER, [ATTACHED]]);
        const opening = pool.queries.find((q) => /ORDER BY c\.chunk_index/.test(q.sql));
        assert.match(opening.sql, /WHERE m\.status = 'ready' AND m\.user_id = \$1 AND m\.id = ANY\(\$2::uuid\[\]\)/);
        assert.deepEqual(opening.params, [LEARNER, [ATTACHED], 3]);
        assert.ok(!pool.queries.some((q) => /m\.id <> ALL/.test(q.sql)), 'the limit was reached: other materials are not read');
    });

    it('then the learner\'s other materials, without the attached ones', async () => {
        delete process.env.GEMINI_ALLOWED;
        const pool = attachedPool();
        setPoolForTests(pool);
        const { value } = await capture(() => retrieveContext('この資料でコースを作りたい', 4, LEARNER, { materialIds: [ATTACHED] }));
        assert.deepEqual(value, ['attached: match', 'attached: opening', 'attached: second', 'other: match']);
        const others = pool.queries.find((q) => /m\.id <> ALL/.test(q.sql));
        assert.match(others.sql, /WHERE m\.status = 'ready' AND m\.user_id = \$1 AND m\.id <> ALL\(\$2::uuid\[\]\) AND/);
        assert.deepEqual(others.params.slice(0, 2), [LEARNER, [ATTACHED]]);
        assert.equal(others.params.at(-1), 1, 'only the slots left');
    });

    it('embeds the query once for both searches, and logs a failure once', async () => {
        const client = embeddingClient({ fails: true });
        setEmbeddingClientForTests(client);
        const pool = attachedPool();
        setPoolForTests(pool);
        const { value, logs } = await capture(() => retrieveContext('この資料でコースを作りたい', 4, LEARNER, { materialIds: [ATTACHED] }));
        assert.deepEqual(value, ['attached: match', 'attached: opening', 'attached: second', 'other: match']);
        assert.equal(client.calls.length, 1, 'one embedding call');
        assert.equal(logs.filter((line) => line.includes('Resource has been exhausted')).length, 1, logs.join('\n'));
    });

    it('ignores attached ids that are not UUIDs', async () => {
        delete process.env.GEMINI_ALLOWED;
        const pool = mockPool();
        setPoolForTests(pool);
        await capture(() => retrieveContext('Blender', 3, LEARNER, { materialIds: ['../etc', 42, null] }));
        assert.ok(!pool.queries.some((q) => /m\.id = ANY|m\.id <> ALL/.test(q.sql)));
    });
});

describe('POST /ai/generate: attachments', () => {
    it('accepts at most 5 attachments, each with a material_id UUID', () => {
        assert.equal(invalidGenerateBody({ message: 'SQL', attachments: [{ material_id: ATTACHED }] }), null);
        assert.equal(invalidGenerateBody({ message: 'SQL', attachments: [] }), null);
        assert.equal(invalidGenerateBody({ message: 'SQL' }), null);
        for (const attachments of ['x', { material_id: ATTACHED }, [{ material_id: 'not-a-uuid' }], ['b2b2b2b2-0000-4000-8000-000000000002'],
            Array.from({ length: 6 }, () => ({ material_id: ATTACHED }))]) {
            assert.equal(typeof invalidGenerateBody({ message: 'SQL', attachments }), 'string', JSON.stringify(attachments).slice(0, 60));
        }
    });
});

describe('scripts/rag/reembed.mjs clears meta.embedding once a material is embedded', () => {
    it('in the batch\'s transaction, for the batch\'s materials whose chunks all use the current model', async () => {
        const chunks = [
            { id: '00000000-0000-0000-0000-000000000001', content: 'one', embedding_model: null, material_id: MATERIAL },
            { id: '00000000-0000-0000-0000-000000000002', content: 'two', embedding_model: null, material_id: ATTACHED },
        ];
        const queries = [];
        const run = async (sql, params = []) => {
            queries.push({ sql, params });
            if (/FROM pg_type/.test(sql)) return { rowCount: 1, rows: [{}] };
            if (/GROUP BY/.test(sql)) return { rowCount: 1, rows: [{ embedding_model: '(none)', chunks: chunks.length }] };
            if (/SELECT id, content/.test(sql)) {
                const [, afterId, limit] = params;
                const rows = chunks.filter((c) => c.embedding_model !== CURRENT && (afterId === null || c.id > afterId)).slice(0, limit);
                return { rowCount: rows.length, rows: rows.map(({ id, content, material_id }) => ({ id, content, material_id })) };
            }
            if (/^\s*UPDATE material_chunks/.test(sql)) {
                const row = chunks.find((c) => c.id === params[3]);
                row.embedding_model = params[1];
                return { rowCount: 1, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        };
        const pool = { query: run, async connect() { return { query: run, release() {} }; } };

        await reembedChunks({ pool, embed: async (texts) => texts.map((_, i) => vector(i)), log: () => {} });

        const clear = queries.find((q) => /UPDATE materials/.test(q.sql));
        assert.ok(clear, 'meta.embedding is cleared');
        assert.match(clear.sql, /SET meta = m\.meta - 'embedding'/);
        assert.match(clear.sql, /m\.id = ANY\(\$1::uuid\[\]\) AND m\.meta \? 'embedding'/);
        assert.match(clear.sql, /NOT EXISTS \(SELECT 1 FROM material_chunks c WHERE c\.material_id = m\.id AND c\.embedding_model IS DISTINCT FROM \$2\)/);
        assert.deepEqual(clear.params, [[MATERIAL, ATTACHED], CURRENT]);
        const order = queries.map((q) => q.sql.trim().split(/\s+/).slice(0, 2).join(' '));
        assert.ok(order.lastIndexOf('UPDATE materials') < order.indexOf('COMMIT'), 'before COMMIT: one transaction with the vectors');
    });
});

describe('the course generator says when no text could be read from the attached file', () => {
    const view = readFileSync(path.join(ROOT, 'components/features/ai/CourseGeneratorView.tsx'), 'utf8');

    it('stops before sending unless the upload is ready: the file comes off and the message goes back to the composer', () => {
        assert.match(view, /if \(uploadRes\?\.status !== 'ready'\) \{\s*(\/\/[^\n]*\n\s*)*setSelectedFile\(null\);\s*throw unusableUpload\(uploadRes\?\.status\);\s*\}\s*uploaded = \{ name: selectedFile\.name, materialId: uploadRes\.material_id \};/);
        assert.match(view, /\{ unusableUpload: status === 'error' \? 'upload_unreadable' : 'upload_not_indexed' \}/);
        assert.match(view, /const unusable = \(err as \{ unusableUpload\?: unknown \} \| null\)\?\.unusableUpload;\s*if \(unusable === 'upload_unreadable' \|\| unusable === 'upload_not_indexed'\) return unusable;/);
        assert.match(view, /upload_unreadable: 'unreadable',\s*upload_not_indexed: 'not_indexed',/);
        assert.match(view, /else if \(isUploadFailure\(failure\)\) \{\s*focusAfterRef\.current = 'file';\s*setUploadNotice\(UPLOAD_NOTICES\[failure\]\);\s*restoreAttempt\(\);/);
        assert.match(view, /unreadable: t\.uploadUnreadable,\s*not_indexed: t\.uploadNotIndexed,/);
    });

    it('a file sent without words says what it is for (the server needs a message)', () => {
        assert.match(view, /const sentText = msgText\.trim\(\) \? msgText : isRevision \? t\.fileOnlyRevision : t\.fileOnlyTopic;/);
        assert.match(view, /text: fileName \? `\$\{sentText\} \(Attached: \$\{fileName\}\)`\.trim\(\) : sentText,/);
        assert.match(view, /'revise', sentText, attachments\)/);
        assert.match(view, /sendAiChat\(sentText, sessionId \|\| undefined, attachments\)/);
        assert.match(view, /fileOnlyTopic: 'Make a course from the attached file\.'/);
        assert.match(view, /fileOnlyTopic: '添付した資料でコースを作りたいです。'/);
    });

    it('the roadmap and curriculum steps take no file: the attach button and a leftover file say so', () => {
        assert.match(view, /const filesRead = pendingApproval !== 'roadmap' && pendingApproval !== 'curriculum';/);
        assert.match(view, /if \(!filesRead && \(selectedFile \|\| uploadedFile\)\) \{\s*setSelectedFile\(null\);\s*setUploadedFile\(null\);\s*focusAfterRef\.current = 'input';\s*setUploadNotice\('requirements_only'\);\s*return;\s*\}/);
        assert.match(view, /if \(!filesRead\) \{\s*setUploadNotice\('requirements_only'\);\s*return;\s*\}\s*fileInputRef\.current\?\.click\(\);/);
        assert.match(view, /requirements_only: t\.uploadRequirementsOnly,/);
        assert.match(view, /uploadRequirementsOnly: 'ファイルを添付できるのは、要件を決める段階だけです。'/);
    });

    it('a revision sends the attached file too', () => {
        assert.match(view, /sendAiDecision\(curriculumId, sessionId, pendingApproval, 'revise', sentText, attachments\)/);
        const api = readFileSync(path.join(ROOT, 'services/curriculumApi.ts'), 'utf8');
        assert.match(api, /decision: 'approved' \| 'revise', feedbackText\?: string, attachments: \{ material_id: string \}\[\] = \[\]\) => \{/);
        assert.match(api, /message: feedbackText,\s*\.\.\.\(attachments\.length > 0 \? \{ attachments \} : \{\}\),/);
    });

    it('in both languages', () => {
        assert.match(view, /uploadUnreadable: 'No text could be read from this file, so it was removed\./);
        assert.match(view, /uploadUnreadable: 'このファイルからは文字を読み取れなかったため、添付を外しました。/);
        assert.match(view, /uploadNotIndexed: 'This file could not be processed, so it was removed\. Attach it again in a moment\.'/);
        assert.match(view, /uploadNotIndexed: 'このファイルを取り込めなかったため、添付を外しました。少し待ってから、もう一度添付してください。'/);
    });
});
