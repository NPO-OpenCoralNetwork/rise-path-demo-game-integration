// 「出典と検索」 step 3: rag-search results that a learner or an AI app can cite.
// - A PDF is read page by page (pdf-parse's pagerender): a chunk never spans two pages and keeps its
//   page in material_chunks.metadata.page; a page without a letter adds no chunk. Other files have no
//   page (metadata NULL). A material indexed before this gets its pages when it is read again
//   (POST /api/v2/rag/index runs the same ingestMaterial).
// - searchContent results name the material (its title: stdio and SSE only), the page, the part of
//   the material the chunk is (part of parts) and a label to cite (location), and quote the 500
//   characters around the first matched word instead of the chunk's first 500.
// - The remote endpoint reads and returns neither the title nor the page (mcp-server/remotePolicy.js
//   REMOTE_RAG_CITE): the owner chose that AI apps see where a passage is, not the file's name, and
//   the remote role (deploy/risepath-vm/sql/mcp_remote_role.sql) grants neither column. Every column
//   its statements read is granted to that role.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import {
    EMBEDDING_DIM,
    EXCERPT_CHARS,
    excerptAround,
    locationLabel,
    resetEmbeddingClientForTests,
    resetLegacyEmbeddingWarningForTests,
    searchContent,
    setEmbeddingClientForTests,
} from '../../tools/core/ragSearch.js';
import { clearMcpUserScopeForTests, registerAgentTurn } from '../../tools/core/mcpUserScope.js';
import { ingestMaterial } from '../ragService.js';
import { createMcpServer } from '../../mcp-server/createMcpServer.js';
import { REMOTE_RAG_CITE, createRemotePolicy } from '../../mcp-server/remotePolicy.js';

const pdfParse = createRequire(import.meta.url)('pdf-parse');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEARNER = 'a1a1a1a1-0000-4000-8000-000000000001';
const MATERIAL = 'c3c3c3c3-0000-4000-8000-000000000003';

const vector = (seed = 0) => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i + seed) / EMBEDDING_DIM);

/** A @google/genai stand-in that answers one vector per input. */
const embeddingClient = () => ({
    models: {
        async embedContent(params) {
            const contents = Array.isArray(params.contents) ? params.contents : [params.contents];
            return { embeddings: contents.map((_, i) => ({ values: vector(i) })) };
        },
    },
});

/**
 * Mock pg pool recording every query: `keywordRows` answers the ILIKE search, `vectorRows` the vector
 * search, `coverage` the EXISTS probes, `parts` (material id → chunk count) the count of the materials
 * found; everything else gets one empty row.
 */
const mockPool = ({ hasVector = true, coverage = { current: true, legacy: false }, keywordRows = [], vectorRows = [], parts = {} } = {}) => {
    const queries = [];
    const run = async (sql, params = []) => {
        queries.push({ sql, params });
        if (/FROM pg_type/.test(sql)) return { rowCount: hasVector ? 1 : 0, rows: hasVector ? [{}] : [] };
        if (/AS has_current/.test(sql)) return { rowCount: 1, rows: [{ has_current: coverage.current, has_legacy: coverage.legacy }] };
        if (/embedding IS NOT NULL/.test(sql)) return { rowCount: 1, rows: [{ embedded: 0 }] };
        if (/ILIKE/.test(sql)) return { rowCount: keywordRows.length, rows: keywordRows };
        if (/<=>/.test(sql)) return { rowCount: vectorRows.length, rows: vectorRows };
        if (/AS parts/.test(sql)) {
            const rows = params.at(-1).filter((id) => Object.hasOwn(parts, id)).map((id) => ({ material_id: id, parts: parts[id] }));
            return { rowCount: rows.length, rows };
        }
        return { rowCount: 1, rows: [] };
    };
    return { queries, query: run, async connect() { return { query: run, release() {} }; } };
};

/** The statement that counted the found materials' chunks (searchContent `parts`). */
const partsQuery = (pool) => pool.queries.find((q) => /AS parts/.test(q.sql));

/**
 * A PDF with one page per entry: the page's lines of text, each 14 points below the last, or null for
 * a page with no content stream (as a scan's text layer is). Hand-built like tinyPdf in
 * materialFailures.test.js: a few hundred bytes a page, Helvetica, ASCII text without parentheses.
 * @param {Array<string[] | null>} pages
 */
const pdfWithPages = (pages) => {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    const kids = [];
    for (const lines of pages) {
        const number = objects.length + 1;
        kids.push(`${number} 0 R`);
        if (lines === null) {
            objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] >>');
            continue;
        }
        const stream = `BT /F1 10 Tf 20 780 Td ${lines.map((line) => `(${line}) Tj 0 -14 Td`).join(' ')} ET`;
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents ${number + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
        objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
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

/** Run `fn` with the console silenced. */
const quietly = async (fn) => {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    try {
        return await fn();
    } finally {
        Object.assign(console, saved);
    }
};

/** Write `bytes` to a temp file and ingest it quietly; `error` is what ingestMaterial threw. */
const ingest = async (name, bytes, mimeType) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-cite-'));
    const file = path.join(dir, name);
    await fs.writeFile(file, bytes);
    try {
        return await quietly(() => ingestMaterial(MATERIAL, file, mimeType, LEARNER).then((value) => ({ value }), (error) => ({ error })));
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
};

/** The chunks an ingest stored, in order: index, text, metadata (the INSERT's last value) and the SQL. */
const storedChunks = (pool) => pool.queries
    .filter((q) => /INSERT INTO material_chunks/.test(q.sql))
    .map((q) => ({ index: q.params[1], content: q.params[2], metadata: typeof q.params.at(-1) === 'string' ? JSON.parse(q.params.at(-1)) : q.params.at(-1), sql: q.sql }));

/** A chunk whose first 500 characters do not hold the matched words (they start at 700). */
const LATE_HIT = `${'The book starts with other things. '.repeat(20)}The mirror modifier copies one half of the mesh to the other. ${'It ends with other things too. '.repeat(20)}`;

const ENV_KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_ALLOWED'];
const savedEnv = {};

beforeEach(() => {
    // Embeddings off, as in production; the tests that need them set GEMINI_ALLOWED.
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

describe('ingestMaterial reads a PDF page by page (material_chunks.metadata.page)', () => {
    it('a chunk never spans two pages and keeps its page; a page without a letter adds no chunk', async () => {
        const pool = mockPool();
        setPoolForTests(pool);
        const long = Array.from({ length: 24 }, (_, i) => `Page four, line ${i + 10}: the modifier stack runs from top to bottom.`);
        const { error } = await ingest('book.pdf', pdfWithPages([['Alpha opens the book.'], null, ['7'], long, ['Omega closes it.']]), 'application/pdf');

        assert.equal(error, undefined, String(error));
        const chunks = storedChunks(pool);
        assert.deepEqual(chunks.map((c) => c.index), chunks.map((_, i) => i), 'chunk_index counts on across pages');
        assert.deepEqual([chunks[0].content, chunks[0].metadata], ['Alpha opens the book.', { page: 1 }]);
        assert.deepEqual([chunks.at(-1).content, chunks.at(-1).metadata], ['Omega closes it.', { page: 5 }]);
        const pageFour = chunks.slice(1, -1);
        assert.ok(pageFour.length >= 2, 'the long page gives several chunks');
        for (const chunk of pageFour) {
            assert.deepEqual(chunk.metadata, { page: 4 });
            assert.ok(long.join('\n').includes(chunk.content), `only page 4's text: ${chunk.content.slice(0, 60)}`);
        }
        assert.ok(!chunks.some((c) => /^7$/m.test(c.content)), 'the page holding only a number adds nothing');
        const deleted = pool.queries.findIndex((q) => /DELETE FROM material_chunks WHERE material_id = \$1/.test(q.sql));
        assert.ok(deleted >= 0 && deleted < pool.queries.findIndex((q) => /INSERT INTO material_chunks/.test(q.sql)),
            'reading a material again replaces its chunks, so an older one gets its pages');
    });

    it('reads each page as pdf-parse itself does: a new line where the text moves to another line', async () => {
        const pool = mockPool();
        setPoolForTests(pool);
        const bytes = pdfWithPages([['Two lines', 'on page one.'], ['Page two.'], ['Three', 'short', 'lines.']]);
        const { error } = await ingest('lines.pdf', bytes, 'application/pdf');

        assert.equal(error, undefined, String(error));
        const chunks = storedChunks(pool);
        assert.deepEqual(chunks.map((c) => [c.content, c.metadata]), [
            ['Two lines\non page one.', { page: 1 }], ['Page two.', { page: 2 }], ['Three\nshort\nlines.', { page: 3 }],
        ]);
        const whole = await pdfParse(new Uint8Array(bytes));
        assert.equal(whole.text, chunks.map((c) => `\n\n${c.content}`).join(''), "pdf-parse's own text is the same pages");
    });

    it('with embeddings on, the rows with a vector carry the page too', async () => {
        process.env.GEMINI_ALLOWED = 'true';
        setEmbeddingClientForTests(embeddingClient());
        const pool = mockPool();
        setPoolForTests(pool);
        const { value, error } = await ingest('two.pdf', pdfWithPages([['First page.'], ['Second page.']]), 'application/pdf');

        assert.equal(error, undefined, String(error));
        assert.deepEqual(value, { chunks: 2, embedded: 2 });
        const chunks = storedChunks(pool);
        assert.deepEqual(chunks.map((c) => [c.content, c.metadata]), [['First page.', { page: 1 }], ['Second page.', { page: 2 }]]);
        assert.match(chunks[0].sql, /\(material_id, chunk_index, content, embedding, token_count, embedding_model, embedding_dim, metadata\)\s+VALUES \(\$1, \$2, \$3, \$4::vector, \$5, \$6, \$7, \$8::jsonb\)/);
    });

    it('a text file has no page: its chunks keep metadata NULL', async () => {
        const pool = mockPool();
        setPoolForTests(pool);
        const { error } = await ingest('notes.md', 'Rise Path material. '.repeat(120), 'text/plain');

        assert.equal(error, undefined, String(error));
        const chunks = storedChunks(pool);
        assert.equal(chunks.length, 3);
        for (const chunk of chunks) {
            assert.match(chunk.sql, /\(material_id, chunk_index, content, embedding, token_count, embedding_model, embedding_dim, metadata\)\s+VALUES \(\$1, \$2, \$3, NULL, \$4, NULL, NULL, \$5::jsonb\)/);
            assert.equal(chunk.metadata, null);
        }
    });
});

describe('excerptAround and locationLabel', () => {
    it('quotes 500 characters from the sentence before the first match, the chunk\'s first 500 without one', () => {
        assert.equal(EXCERPT_CHARS, 500);
        assert.equal(excerptAround('Short text about mirrors.', ['mirror']), 'Short text about mirrors.');
        const late = excerptAround(LATE_HIT, ['modifier']);
        assert.ok(late.startsWith('The mirror modifier copies'), late.slice(0, 40));
        assert.equal(late.length, EXCERPT_CHARS);
        assert.ok(LATE_HIT.includes(late), 'a verbatim part of the chunk');
        assert.equal(excerptAround('y'.repeat(800), ['mirror']), 'y'.repeat(500));
        assert.equal(excerptAround('y'.repeat(800), []), 'y'.repeat(500));
    });

    it('near the end of a chunk, the last 500 characters', () => {
        const text = `${'x'.repeat(980)} mirror.`;
        const excerpt = excerptAround(text, ['mirror']);
        assert.equal(excerpt, text.slice(-500));
    });

    it('finds the word in full-width, half-width and upper-case forms, and quotes the chunk as written', () => {
        const text = `${'z'.repeat(600)}。ＢＬＥＮＤＥＲのﾓﾃﾞｨﾌｧｲｱを使う。${'w'.repeat(600)}`;
        assert.ok(excerptAround(text, ['blender']).startsWith('ＢＬＥＮＤＥＲのﾓﾃﾞｨﾌｧｲｱ'), 'NFKC and case are ignored when matching');
        assert.ok(excerptAround(text, ['モディファイア']).startsWith('ＢＬＥＮＤＥＲのﾓﾃﾞｨﾌｧｲｱ'), 'the chunk\'s own characters are quoted, from the sentence');
    });

    it('never cuts a character in two (a kanji outside the BMP is two UTF-16 units)', () => {
        for (const prefix of ['', 'a']) {
            for (const text of [`${prefix}${'𠮷'.repeat(400)} mirror`, `${prefix}mirror ${'𠮷'.repeat(400)}`, `${prefix}${'𠮷'.repeat(400)}`]) {
                const excerpt = excerptAround(text, ['mirror']);
                assert.ok(excerpt.isWellFormed(), `${prefix ? 'odd' : 'even'} offset: ${excerpt.length}`);
                assert.ok(excerpt.length >= EXCERPT_CHARS - 1 && excerpt.length <= EXCERPT_CHARS, String(excerpt.length));
            }
        }
    });

    it('names the place: the page, or the part of the material; 「あなたの教材」 without a name', () => {
        assert.equal(locationLabel({ title: 'Blender入門.pdf', page: 3, part: 5, parts: 12 }), '「Blender入門.pdf」3 ページ');
        assert.equal(locationLabel({ title: null, page: 3, part: 5, parts: 12 }), 'あなたの教材・3 ページ');
        assert.equal(locationLabel({ title: 'メモ.md', part: 2, parts: 4 }), '「メモ.md」4 つの部分のうち 2 番目');
        assert.equal(locationLabel({ part: 2, parts: 4 }), 'あなたの教材・4 つの部分のうち 2 番目');
        assert.equal(locationLabel({ title: 'メモ.md', part: 1, parts: 1 }), '「メモ.md」');
        assert.equal(locationLabel({ part: 1, parts: 1 }), 'あなたの教材');
        assert.equal(locationLabel({ title: 'メモ.md', part: 2 }), '「メモ.md」', 'no count: no part');
    });
});

describe('searchContent: results that can be cited (stdio and SSE)', () => {
    it('the material\'s name, the page, the part and a location to cite; the name and page read with the chunk', async () => {
        const pool = mockPool({
            hasVector: false,
            keywordRows: [{ content: LATE_HIT, chunk_index: 4, material_id: MATERIAL, material_title: 'Blender入門.pdf', page: '3' }],
            parts: { [MATERIAL]: 12 },
        });
        setPoolForTests(pool);
        const result = await searchContent({ query: 'mirror modifier', userId: LEARNER });

        assert.equal(result.fallback_reason, 'no_pgvector', 'the reason for a keyword match stays (step 2)');
        const [hit] = result.results;
        assert.deepEqual(
            { title: hit.title, page: hit.page, part: hit.part, parts: hit.parts, location: hit.location, source: hit.source, relevance: hit.relevance_score },
            { title: 'Blender入門.pdf', page: 3, part: 5, parts: 12, location: '「Blender入門.pdf」3 ページ', source: MATERIAL, relevance: 0.5 });
        assert.ok(hit.content.startsWith('The mirror modifier copies'), 'the passage around the match, not the chunk\'s first 500');
        assert.ok(hit.content.length <= EXCERPT_CHARS);
        const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(keyword.sql, /^SELECT c\.content, c\.chunk_index, m\.id as material_id, m\.title AS material_title, c\.metadata->>'page' AS page\s+FROM material_chunks c/);
        assert.deepEqual(keyword.params, [LEARNER, '%mirror%', '%modifier%', 3], 'no new parameter');
        const count = partsQuery(pool);
        assert.match(count.sql, /SELECT c\.material_id, count\(\*\)::int AS parts\s+FROM material_chunks c\s+JOIN materials m ON c\.material_id = m\.id\s+WHERE m\.status = 'ready' AND m\.user_id = \$1 AND c\.material_id = ANY\(\$2::uuid\[\]\)\s+GROUP BY c\.material_id/,
            'counted in the same scope as the search: the learner\'s own ready materials');
        assert.deepEqual(count.params, [LEARNER, [MATERIAL]]);
    });

    it('counts each material found once, and nothing when nothing is found', async () => {
        const OTHER = 'd4d4d4d4-0000-4000-8000-000000000004';
        const pool = mockPool({
            hasVector: false,
            keywordRows: [
                { content: 'mirror one', chunk_index: 0, material_id: MATERIAL },
                { content: 'mirror two', chunk_index: 2, material_id: OTHER },
                { content: 'mirror three', chunk_index: 1, material_id: MATERIAL },
            ],
            parts: { [MATERIAL]: 2, [OTHER]: 3 },
        });
        setPoolForTests(pool);
        const { results } = await searchContent({ query: 'mirror', userId: LEARNER });
        assert.deepEqual(partsQuery(pool).params, [LEARNER, [MATERIAL, OTHER]]);
        assert.deepEqual(results.map((r) => [r.part, r.parts, r.location]), [
            [1, 2, 'あなたの教材・2 つの部分のうち 1 番目'],
            [3, 3, 'あなたの教材・3 つの部分のうち 3 番目'],
            [2, 2, 'あなたの教材・2 つの部分のうち 2 番目'],
        ]);

        const empty = mockPool({ hasVector: false });
        setPoolForTests(empty);
        assert.deepEqual((await searchContent({ query: 'mirror', userId: LEARNER })).results, []);
        assert.equal(partsQuery(empty), undefined, 'no count without a result');
    });

    it('a vector match reads the same, and quotes around a word of the query', async () => {
        process.env.GEMINI_ALLOWED = 'true';
        setEmbeddingClientForTests(embeddingClient());
        const pool = mockPool({
            vectorRows: [{ content: LATE_HIT, chunk_index: 1, distance: 0.2, material_id: MATERIAL, material_title: 'メモ.md', page: null }],
            parts: { [MATERIAL]: 4 },
        });
        setPoolForTests(pool);
        const result = await searchContent({ query: 'mirror modifier', userId: LEARNER });

        assert.equal(result.search_type, 'vector');
        const [hit] = result.results;
        assert.equal(hit.location, '「メモ.md」4 つの部分のうち 2 番目');
        assert.ok(!('page' in hit), 'a text file has no page');
        assert.ok(hit.content.startsWith('The mirror modifier copies'), hit.content.slice(0, 40));
        const search = pool.queries.find((q) => /<=>/.test(q.sql));
        assert.match(search.sql, /m\.id as material_id, m\.title AS material_title, c\.metadata->>'page' AS page\s+FROM material_chunks c/);
        assert.match(partsQuery(pool).sql, /WHERE m\.status = 'ready' AND m\.user_id = \$1 AND c\.material_id = ANY\(\$2::uuid\[\]\)/);
    });

    it('a material without a title, or with a page that is not a whole number, is cited by what is known', async () => {
        setPoolForTests(mockPool({
            hasVector: false,
            keywordRows: [
                { content: 'The mirror modifier.', chunk_index: 0, material_id: MATERIAL, material_title: null, page: '2' },
                { content: 'Another mirror.', chunk_index: 1, material_id: MATERIAL, material_title: '  ', page: 'two' },
            ],
            parts: { [MATERIAL]: 3 },
        }));
        const { results } = await searchContent({ query: 'mirror', userId: LEARNER });

        assert.deepEqual(results.map((r) => [r.title, r.page, r.location]), [
            [undefined, 2, 'あなたの教材・2 ページ'],
            [undefined, undefined, 'あなたの教材・3 つの部分のうち 2 番目'],
        ]);
    });
});

describe('searchContent on the remote endpoint (REMOTE_RAG_CITE)', () => {
    it('reads and returns neither the title nor the page, and names the place instead', async () => {
        const pool = mockPool({ hasVector: false, keywordRows: [{ content: LATE_HIT, chunk_index: 1, material_id: MATERIAL }], parts: { [MATERIAL]: 4 } });
        setPoolForTests(pool);
        const result = await searchContent({ query: 'mirror modifier', userId: LEARNER, cite: REMOTE_RAG_CITE });

        const [hit] = result.results;
        assert.equal(hit.location, 'あなたの教材・4 つの部分のうち 2 番目');
        assert.deepEqual([hit.part, hit.parts], [2, 4]);
        assert.ok(!('title' in hit) && !('page' in hit), JSON.stringify(hit));
        assert.ok(hit.content.startsWith('The mirror modifier copies'));
        for (const { sql } of pool.queries) assert.doesNotMatch(sql, /title|metadata/, sql);
    });

    it('every column its statements read is granted to risepath_mcp_remote', async () => {
        const role = readFileSync(path.join(ROOT, 'deploy/risepath-vm/sql/mcp_remote_role.sql'), 'utf8');
        const granted = Object.fromEntries([...role.matchAll(/^GRANT SELECT \(([a-z_, ]+)\) ON (materials|material_chunks) TO risepath_mcp_remote;$/gm)]
            .map(([, columns, table]) => [table, new Set(columns.split(',').map((c) => c.trim()))]));
        assert.deepEqual(Object.keys(granted).sort(), ['material_chunks', 'materials']);
        assert.ok(!granted.materials.has('title') && !granted.material_chunks.has('metadata'), 'the role SQL is unchanged');

        const statements = [];
        const searches = [
            { pool: { hasVector: false }, env: false },                                    // no_pgvector
            { pool: {}, env: false },                                                      // embeddings_off
            { pool: { coverage: { current: false, legacy: true } }, env: true },           // reembed_required
            { pool: { coverage: { current: true, legacy: true } }, env: true },            // vector + older chunks by keyword
        ];
        for (const search of searches) {
            if (search.env) {
                process.env.GEMINI_ALLOWED = 'true';
                setEmbeddingClientForTests(embeddingClient());
            } else {
                delete process.env.GEMINI_ALLOWED;
            }
            const found = [{ content: 'Blender mirror', chunk_index: 0, material_id: MATERIAL, distance: 0.1 }];
            const pool = mockPool({ ...search.pool, keywordRows: found, vectorRows: found, parts: { [MATERIAL]: 2 } });
            setPoolForTests(pool);
            const result = await quietly(() => searchContent({ query: 'Blender の押し出し mirror', userId: LEARNER, cite: REMOTE_RAG_CITE }));
            assert.equal(result.results[0]?.location, 'あなたの教材・2 つの部分のうち 1 番目', JSON.stringify(result));
            statements.push(...pool.queries.map((q) => q.sql));
        }
        assert.ok(statements.some((sql) => /ILIKE/.test(sql)) && statements.some((sql) => /<=>/.test(sql)), 'keyword and vector searches ran');
        assert.ok(statements.some((sql) => /AS parts/.test(sql)), 'and the count of the parts');

        const tables = { c: 'material_chunks', m: 'materials' };
        for (const sql of statements) {
            for (const [, alias, column] of sql.matchAll(/\b([a-z_]+)\.([a-z_]+)\b/g)) {
                if (alias === 'n' && column === 'text') continue; // the normalized chunk text (CROSS JOIN LATERAL)
                assert.ok(Object.hasOwn(tables, alias), `unknown alias ${alias} in ${sql}`);
                assert.ok(granted[tables[alias]].has(column), `${tables[alias]}.${column} is not granted to the remote role:\n${sql}`);
            }
        }
    });

    it('the remote policy carries REMOTE_RAG_CITE: no title, no page', () => {
        assert.deepEqual(REMOTE_RAG_CITE, { title: false, page: false });
        assert.ok(Object.isFrozen(REMOTE_RAG_CITE));
        const policy = createRemotePolicy({
            env: { APP_PUBLIC_URL: 'https://app.example.org' },
            reserveCap: async () => ({ handle: { refund: async () => {} } }),
            terms: { refusal: async () => null },
        });
        assert.equal(policy.ragCite, REMOTE_RAG_CITE);
    });
});

describe('the content-search skill cites by place', () => {
    it('asks for the location and the quoted passage, never a lesson title the results do not have', () => {
        const skill = readFileSync(path.join(ROOT, 'skills/content-search/SKILL.md'), 'utf8');
        const step3 = skill.slice(skill.indexOf('### Step 3'), skill.indexOf('## ルール'));
        assert.match(step3, /`location`/);
        assert.match(step3, /`content`/);
        assert.doesNotMatch(step3, /レッスンタイトル|このレッスンを始めますか/);
    });
});

describe('rag-search over MCP on stdio and SSE (no remote policy)', () => {
    afterEach(() => clearMcpUserScopeForTests());

    it('names the learner\'s own material and page, and the tool asks for the location when citing', async () => {
        setPoolForTests(mockPool({
            hasVector: false,
            keywordRows: [{ content: 'The mirror modifier copies one half.', chunk_index: 2, material_id: MATERIAL, material_title: 'Blender入門.pdf', page: '3' }],
            parts: { [MATERIAL]: 12 },
        }));
        const server = createMcpServer({ profile: 'learner' });
        const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'rag-citations-test', version: '1.0.0' });
        await client.connect(clientSide);
        try {
            const body = await quietly(async () => {
                const turn = await registerAgentTurn(LEARNER);
                const result = await client.callTool({ name: 'rag-search', arguments: { query: 'mirror modifier', rp_turn: turn } });
                assert.ok(!result.isError, result.content[0].text);
                return JSON.parse(result.content[0].text);
            });
            assert.deepEqual([body.results[0].title, body.results[0].page, body.results[0].location], ['Blender入門.pdf', 3, '「Blender入門.pdf」3 ページ']);
            const { tools } = await client.listTools();
            assert.match(tools.find((t) => t.name === 'rag-search').description, /location/);
        } finally {
            await client.close();
        }
    });
});
