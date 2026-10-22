import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_IDS } from '../llm/models.config.js';
import { EMBEDDING_DIM, resetEmbeddingClientForTests, setEmbeddingClientForTests } from '../../tools/core/ragSearch.js';
import {
    countStaleChunks,
    parseArgs,
    reembedChunks,
    selectStaleChunks,
} from '../../scripts/rag/reembed.mjs';

const CURRENT = MODEL_IDS.gemini.embedding;
/** Stands in for a retired model's id stored on old rows (any value other than CURRENT). */
const LEGACY = 'retired-embedding-model';
const vector = (seed = 0) => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i + seed) / EMBEDDING_DIM);
const silent = () => {};

/**
 * In-memory material_chunks behind a mock pg pool. It answers the script's SQL the way Postgres
 * would (stale = embedding_model IS DISTINCT FROM $1, keyset on id, guarded UPDATE), so reruns
 * show whether the script is idempotent.
 */
const chunkStore = (chunks, { hasVector = true } = {}) => {
    const rows = chunks.map((c) => ({ ...c }));
    const queries = [];
    const isStale = (row, model) => row.embedding_model !== model; // null counts as stale
    const run = async (sql, params = []) => {
        queries.push({ sql, params });
        if (/FROM pg_type/.test(sql)) return { rowCount: hasVector ? 1 : 0, rows: hasVector ? [{}] : [] };
        if (/GROUP BY/.test(sql)) {
            const counts = new Map();
            for (const row of rows.filter((r) => isStale(r, params[0]))) {
                const key = row.embedding_model ?? '(none)';
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            const out = [...counts].map(([embedding_model, n]) => ({ embedding_model, chunks: n })).sort((a, b) => b.chunks - a.chunks);
            return { rowCount: out.length, rows: out };
        }
        if (/SELECT id, content/.test(sql)) {
            const [model, afterId, limit] = params;
            const out = rows
                .filter((r) => isStale(r, model) && (afterId === null || r.id > afterId))
                .sort((a, b) => a.id.localeCompare(b.id))
                .slice(0, limit)
                .map(({ id, content }) => ({ id, content }));
            return { rowCount: out.length, rows: out };
        }
        if (/^\s*UPDATE material_chunks/.test(sql)) {
            const [embedding, model, dim, id] = params;
            const row = rows.find((r) => r.id === id && isStale(r, model));
            if (!row) return { rowCount: 0, rows: [] };
            Object.assign(row, { embedding, embedding_model: model, embedding_dim: dim });
            return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
    };
    return {
        rows,
        queries,
        query: run,
        async connect() {
            return { query: run, release() {} };
        },
    };
};

const legacyChunks = () => [
    { id: '00000000-0000-0000-0000-000000000001', content: 'one', embedding_model: LEGACY },
    { id: '00000000-0000-0000-0000-000000000002', content: 'two', embedding_model: CURRENT },
    { id: '00000000-0000-0000-0000-000000000003', content: 'three', embedding_model: null },
    { id: '00000000-0000-0000-0000-000000000004', content: 'four', embedding_model: LEGACY },
    { id: '00000000-0000-0000-0000-000000000005', content: 'five', embedding_model: LEGACY },
    { id: '00000000-0000-0000-0000-000000000006', content: 'six', embedding_model: null },
];

/** Embedder spy with the embedTexts signature. */
const fakeEmbed = (calls = []) => Object.assign(async (texts) => {
    calls.push(texts);
    return texts.map((_, i) => vector(i));
}, { calls });

const savedGeminiAllowed = process.env.GEMINI_ALLOWED;
afterEach(() => {
    resetEmbeddingClientForTests();
    if (savedGeminiAllowed === undefined) delete process.env.GEMINI_ALLOWED;
    else process.env.GEMINI_ALLOWED = savedGeminiAllowed;
});

describe('scripts/rag/reembed.mjs selection SQL', () => {
    it('selects chunks not on the current model (NULL included), keyset-paged by id', async () => {
        const store = chunkStore([]);
        await selectStaleChunks(store, { afterId: null, batchSize: 100 });
        const [select] = store.queries;
        assert.match(select.sql, /WHERE embedding_model IS DISTINCT FROM \$1/);
        assert.match(select.sql, /AND \(\$2::uuid IS NULL OR id > \$2::uuid\)/);
        assert.match(select.sql, /ORDER BY id\s+LIMIT \$3/);
        assert.deepEqual(select.params, [CURRENT, null, 100]);
    });

    it('counts stale chunks per stored model with the same predicate', async () => {
        const store = chunkStore(legacyChunks());
        const byModel = await countStaleChunks(store);
        assert.match(store.queries[0].sql, /WHERE embedding_model IS DISTINCT FROM \$1/);
        assert.deepEqual(store.queries[0].params, [CURRENT]);
        assert.deepEqual(byModel, [
            { embedding_model: LEGACY, chunks: 3 },
            { embedding_model: '(none)', chunks: 2 },
        ]);
    });
});

describe('scripts/rag/reembed.mjs reembedChunks', () => {
    it('--dry-run only counts: no embedding call, no transaction, no UPDATE', async () => {
        const store = chunkStore(legacyChunks());
        const embed = fakeEmbed();
        const summary = await reembedChunks({ pool: store, embed, dryRun: true, log: silent });
        assert.deepEqual(summary, { stale: 5, processed: 0, reembedded: 0, batches: 0 });
        assert.equal(embed.calls.length, 0);
        assert.ok(!store.queries.some((q) => /UPDATE|BEGIN|SELECT id, content/.test(q.sql)));
    });

    it('re-embeds in batches, honours --limit, guards the UPDATE and advances the keyset', async () => {
        const store = chunkStore(legacyChunks());
        const embed = fakeEmbed();
        const summary = await reembedChunks({ pool: store, embed, limit: 3, batchSize: 2, log: silent });

        assert.deepEqual(summary, { stale: 5, processed: 3, reembedded: 3, batches: 2 });
        assert.deepEqual(embed.calls, [['one', 'three'], ['four']]);
        const selects = store.queries.filter((q) => /SELECT id, content/.test(q.sql));
        assert.deepEqual(selects.map((q) => q.params), [
            [CURRENT, null, 2],
            [CURRENT, '00000000-0000-0000-0000-000000000003', 1],
        ]);

        const updates = store.queries.filter((q) => /^\s*UPDATE/.test(q.sql));
        assert.equal(updates.length, 3);
        assert.match(updates[0].sql, /SET embedding = \$1::vector, embedding_model = \$2, embedding_dim = \$3/);
        assert.match(updates[0].sql, /WHERE id = \$4 AND embedding_model IS DISTINCT FROM \$2/);
        assert.deepEqual(updates[0].params.slice(1), [CURRENT, EMBEDDING_DIM, '00000000-0000-0000-0000-000000000001']);
        assert.equal(JSON.parse(updates[0].params[0]).length, EMBEDDING_DIM);
        assert.deepEqual(store.queries.filter((q) => /^(BEGIN|COMMIT)$/.test(q.sql)).map((q) => q.sql), ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
    });

    it('is idempotent: a rerun handles only what is left, then nothing', async () => {
        const store = chunkStore(legacyChunks());
        await reembedChunks({ pool: store, embed: fakeEmbed(), limit: 3, log: silent });

        const second = fakeEmbed();
        assert.deepEqual(await reembedChunks({ pool: store, embed: second, log: silent }), { stale: 2, processed: 2, reembedded: 2, batches: 1 });
        assert.deepEqual(second.calls, [['five', 'six']]);

        const third = fakeEmbed();
        assert.deepEqual(await reembedChunks({ pool: store, embed: third, log: silent }), { stale: 0, processed: 0, reembedded: 0, batches: 0 });
        assert.equal(third.calls.length, 0);
        assert.ok(store.rows.every((row) => row.embedding_model === CURRENT && row.id));
    });

    it('defaults to the ingestion embedder (embedTexts: configured model at the column width)', async () => {
        process.env.GEMINI_ALLOWED = 'true'; // embeddings use Gemini only when allowed
        const log = [];
        setEmbeddingClientForTests({
            models: {
                async embedContent(params) {
                    log.push(params);
                    return { embeddings: params.contents.map((_, i) => ({ values: vector(i) })) };
                },
            },
        });
        const store = chunkStore(legacyChunks());
        await reembedChunks({ pool: store, log: silent });
        assert.deepEqual(log, [{ model: CURRENT, contents: ['one', 'three', 'four', 'five', 'six'], config: { outputDimensionality: EMBEDDING_DIM } }]);
    });

    it('writes a FLOAT8[] array without ::vector when pgvector is missing', async () => {
        const store = chunkStore(legacyChunks().slice(0, 1), { hasVector: false });
        await reembedChunks({ pool: store, embed: fakeEmbed(), log: silent });
        const [update] = store.queries.filter((q) => /^\s*UPDATE/.test(q.sql));
        assert.doesNotMatch(update.sql, /::vector/);
        assert.ok(Array.isArray(update.params[0]));
    });
});

describe('scripts/rag/reembed.mjs parseArgs', () => {
    it('reads --dry-run, --limit and --batch-size (space or = form)', () => {
        assert.deepEqual(parseArgs([]), { dryRun: false, limit: Infinity, batchSize: 100 });
        assert.deepEqual(parseArgs(['--dry-run', '--limit', '50', '--batch-size=20']), { dryRun: true, limit: 50, batchSize: 20 });
    });

    it('rejects bad numbers and unknown flags', () => {
        assert.throws(() => parseArgs(['--limit', '0']), /positive integer/);
        assert.throws(() => parseArgs(['--limit']), /positive integer/);
        assert.throws(() => parseArgs(['--batch-size=abc']), /positive integer/);
        assert.throws(() => parseArgs(['--force']), /Unknown argument/);
    });
});
