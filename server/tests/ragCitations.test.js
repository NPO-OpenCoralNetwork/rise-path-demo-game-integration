// 「出典と検索」 step 3: rag-search results that a learner or an AI app can cite.
// - A PDF's chunks are cut as before, from pdf-parse's text (so short pages such as slides still
//   share a chunk, and the 200-chunk cap and the course generator's 3 chunks read as much as before).
//   Each chunk records its pages in material_chunks.metadata (server/ragService.js pageMetadata): the
//   page its text starts on, and `breaks`, where the next pages start in it. Pages count the file's
//   pages from 1. Other files have no page (metadata NULL). A material indexed before this gets its
//   pages when it is read again (POST /api/v2/rag/index runs the same ingestMaterial).
// - searchContent results name the material (its title: stdio and SSE only), the page of the quote,
//   the part of the material the chunk is (part of parts) and a label to cite (location), and quote up
//   to 500 characters from the sentence of the first matched word, on that word's page.
// - searchContent reads neither the title nor the page unless asked. The remote endpoint never asks
//   (mcp-server/remotePolicy.js REMOTE_RAG_CITE): the owner chose that AI apps see where a passage is,
//   not the file's name, and the remote role (deploy/risepath-vm/sql/mcp_remote_role.sql) grants
//   neither column. Every column its statements read is granted to that role.
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
    LOCAL_RAG_CITE,
    citedPassage,
    excerptAround,
    keywordPlan,
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
 * found (a function: it throws); everything else gets one empty row.
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
            if (typeof parts === 'function') return parts();
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
 * A PDF with one page per entry: the page's lines of text, each 14 points below the last; null for a
 * page with no content stream (as a scan's text layer is); or { raw } for the page object as written
 * (a broken one). Hand-built like tinyPdf in materialFailures.test.js: a few hundred bytes a page,
 * Helvetica, ASCII text without parentheses.
 * @param {Array<string[] | null | { raw: string }>} pages
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
        if (!Array.isArray(lines)) {
            objects.push(lines.raw);
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

/** Run `fn` with the console silenced; `warnings` holds what it warned. */
const quietly = async (fn) => {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    const warnings = [];
    console.log = () => {};
    console.warn = (...args) => warnings.push(args.join(' '));
    console.error = () => {};
    try {
        return { value: await fn(), warnings };
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
        return (await quietly(() => ingestMaterial(MATERIAL, file, mimeType, LEARNER).then((value) => ({ value }), (error) => ({ error })))).value;
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
};

/** The chunks an ingest stored, in order: index, text, metadata (the INSERT's last value) and the SQL. */
const storedChunks = (pool) => pool.queries
    .filter((q) => /INSERT INTO material_chunks/.test(q.sql))
    .map((q) => ({ index: q.params[1], content: q.params[2], metadata: typeof q.params.at(-1) === 'string' ? JSON.parse(q.params.at(-1)) : q.params.at(-1), sql: q.sql }));

/** The page a position of a stored chunk is on, by its metadata. */
const pageAt = ({ metadata }, offset) => metadata.page + (metadata.breaks ?? []).filter((at) => at <= offset).length;

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

describe('ingestMaterial records the pages of a PDF\'s chunks (material_chunks.metadata)', () => {
    it('short pages (slides) still share a chunk, which records where each page starts', async () => {
        const pool = mockPool();
        setPoolForTests(pool);
        const slides = Array.from({ length: 6 }, (_, i) => [`Slide ${i + 1}: one short idea about modifiers.`]);
        const { error } = await ingest('slides.pdf', pdfWithPages(slides), 'application/pdf');

        assert.equal(error, undefined, String(error));
        const [chunk, ...rest] = storedChunks(pool);
        assert.deepEqual(rest, [], 'one chunk, as before: not one per page');
        assert.equal(chunk.metadata.page, 1);
        assert.equal(chunk.metadata.breaks.length, 5);
        chunk.metadata.breaks.forEach((at, i) => assert.ok(chunk.content.slice(at).startsWith(`Slide ${i + 2}:`), `page ${i + 2} starts at ${at}`));
    });

    it('chunks are cut from pdf-parse\'s text as before; a blank page and a long page are mapped too', async () => {
        const pool = mockPool();
        setPoolForTests(pool);
        const long = Array.from({ length: 24 }, (_, i) => `Page four, line ${i + 10}: the modifier stack runs from top to bottom.`);
        const bytes = pdfWithPages([['Alpha opens the book.'], null, ['7'], long, ['Omega closes it.']]);
        const { error } = await ingest('book.pdf', bytes, 'application/pdf');

        assert.equal(error, undefined, String(error));
        const chunks = storedChunks(pool);
        const whole = (await pdfParse(new Uint8Array(bytes))).text;
        let from = 0;
        for (const chunk of chunks) {
            const at = whole.indexOf(chunk.content, from);
            assert.ok(at >= 0, `chunk ${chunk.index} is a part of pdf-parse's text, in order`);
            from = at + 1;
        }
        assert.deepEqual(chunks.map((c) => c.index), chunks.map((_, i) => i));
        const [first, ...later] = chunks;
        assert.ok(first.content.startsWith('Alpha opens the book.') && first.content.includes('Page four, line 10'), 'pages 1 to 4 in the first chunk');
        assert.equal(first.metadata.page, 1);
        const [blank, seven, four] = first.metadata.breaks;
        assert.deepEqual([seven - blank, first.content.slice(seven, seven + 1)], [2, '7'], 'the blank page 2 starts and ends between pages 1 and 3');
        assert.ok(first.content.slice(four).startsWith('Page four, line 10'));
        assert.equal(pageAt(first, first.content.indexOf('line 12')), 4);
        const last = later.at(-1);
        assert.equal(last.metadata.page, 4, 'the last chunk starts inside page 4');
        assert.deepEqual(last.metadata.breaks, [last.content.indexOf('Omega closes it.')]);
        assert.equal(pageAt(last, last.content.indexOf('Omega')), 5);
        const deleted = pool.queries.findIndex((q) => /DELETE FROM material_chunks WHERE material_id = \$1/.test(q.sql));
        assert.ok(deleted >= 0 && deleted < pool.queries.findIndex((q) => /INSERT INTO material_chunks/.test(q.sql)),
            'reading a material again replaces its chunks, so an older one gets its pages');
    });

    it('a chunk cut in the blank line between two pages starts on the later page', async () => {
        // The text is "\n\n" + page 1 (400) + "\n\n" + page 2. The first chunk ends after page 2's first
        // line, 200 characters after the blank line (a line break is the last cut point past 500), so
        // the next chunk starts, 200 back, on the blank line itself.
        const pool = mockPool();
        setPoolForTests(pool);
        const page1 = 'Alpha '.repeat(66).padEnd(400, 'a');
        const page2 = ['Bravo '.repeat(32).padEnd(197, 'b'), 'Charlie '.repeat(88).padEnd(700, 'c')];
        const { error } = await ingest('cut.pdf', pdfWithPages([[page1], page2]), 'application/pdf');

        assert.equal(error, undefined, String(error));
        const chunks = storedChunks(pool);
        assert.equal(chunks.length, 2);
        assert.deepEqual(chunks[0].metadata, { page: 1, breaks: [402] });
        assert.ok(chunks[1].content.startsWith('Bravo Bravo'), chunks[1].content.slice(0, 20));
        assert.deepEqual(chunks[1].metadata, { page: 2 }, 'credited to page 2, not to page 1 before the blank line');
    });

    it('a page that pdf.js cannot read is empty, and the pages after it keep their numbers', async () => {
        const pool = mockPool();
        setPoolForTests(pool);
        const bytes = pdfWithPages([['Page one about extrude.'], { raw: '<< /Foo /Bar >>' }, ['Page three about the mirror modifier.'], ['Page four.']]);
        const { error } = await ingest('broken-page.pdf', bytes, 'application/pdf');

        assert.equal(error, undefined, String(error));
        const [chunk, ...rest] = storedChunks(pool);
        assert.deepEqual(rest, []);
        const [two, three, four] = chunk.metadata.breaks;
        assert.equal(three - two, 2, 'page 2 holds nothing');
        assert.ok(chunk.content.slice(three).startsWith('Page three') && chunk.content.slice(four).startsWith('Page four'));
        assert.deepEqual(citedPassage(chunk.content, keywordPlan('mirror'), chunk.metadata.page, chunk.metadata.breaks),
            { quote: 'Page three about the mirror modifier.', page: 3 });
    });

    it('a chunk on one page records only its page', async () => {
        const pool = mockPool();
        setPoolForTests(pool);
        const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 10} of a long first page about the mirror modifier.`);
        const { error } = await ingest('long.pdf', pdfWithPages([lines, ['Second page.']]), 'application/pdf');

        assert.equal(error, undefined, String(error));
        const [first, ...later] = storedChunks(pool);
        assert.deepEqual(first.metadata, { page: 1 });
        assert.equal(later.at(-1).metadata.page, 1);
        assert.ok(later.at(-1).metadata.breaks.length === 1 && later.at(-1).content.endsWith('Second page.'));
    });

    it('with embeddings on, the rows with a vector carry the pages too', async () => {
        process.env.GEMINI_ALLOWED = 'true';
        setEmbeddingClientForTests(embeddingClient());
        const pool = mockPool();
        setPoolForTests(pool);
        const { value, error } = await ingest('two.pdf', pdfWithPages([['First page.'], ['Second page.']]), 'application/pdf');

        assert.equal(error, undefined, String(error));
        assert.deepEqual(value, { chunks: 1, embedded: 1 });
        const [chunk] = storedChunks(pool);
        assert.deepEqual([chunk.content, chunk.metadata], ['First page.\n\nSecond page.', { page: 1, breaks: [13] }]);
        assert.match(chunk.sql, /\(material_id, chunk_index, content, embedding, token_count, embedding_model, embedding_dim, metadata\)\s+VALUES \(\$1, \$2, \$3, \$4::vector, \$5, \$6, \$7, \$8::jsonb\)/);
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

describe('excerptAround, citedPassage and locationLabel', () => {
    it('quotes 500 characters from the sentence of the first match, the chunk\'s first 500 without one', () => {
        assert.equal(EXCERPT_CHARS, 500);
        assert.equal(excerptAround('Short text about mirrors.', ['mirror']), 'Short text about mirrors.');
        const late = excerptAround(LATE_HIT, ['modifier']);
        assert.ok(late.startsWith('The mirror modifier copies'), late.slice(0, 40));
        assert.equal(late.length, EXCERPT_CHARS);
        assert.ok(LATE_HIT.includes(late), 'a verbatim part of the chunk');
        assert.equal(excerptAround('y'.repeat(800), ['mirror']), 'y'.repeat(500));
        assert.equal(excerptAround('y'.repeat(800), []), 'y'.repeat(500));
    });

    it('a sentence that starts exactly at the edge of the window counts', () => {
        const text = `${'a'.repeat(499)}。${'b'.repeat(299)}。${'c'.repeat(99)}。mirror${'d'.repeat(94)}`;
        assert.equal(excerptAround(text, ['mirror']), text.slice(500), 'from 500, not from the later sentence at 800');
        const lead = `${'e'.repeat(449)}。${'f'.repeat(150)}mirror${'g'.repeat(600)}`;
        assert.ok(excerptAround(lead, ['mirror']).startsWith('f'), 'a sentence 150 characters before the word');
    });

    it('a printed line break is not a sentence end (PDF text), but a line is when no sentence ends near', () => {
        const pdfText = `${'a'.repeat(200)}。The sentence that holds\nthe mirror word goes on.「引用。」その後。${'z'.repeat(600)}`;
        assert.ok(excerptAround(pdfText, ['mirror']).startsWith('The sentence that holds\nthe mirror'), 'from the sentence, not the printed line');
        const list = `${'x'.repeat(600)}\n- item one\n- item two with the mirror\n${'y'.repeat(600)}`;
        assert.ok(excerptAround(list, ['mirror']).startsWith('- item two with the mirror'), 'a list item without punctuation');
        const quoted = `${'b'.repeat(200)}「前の文です。」後の文に mirror があります。${'c'.repeat(600)}`;
        assert.ok(excerptAround(quoted, ['mirror']).startsWith('後の文に mirror'), 'not from the closing bracket');
    });

    it('near the end of a chunk, from the first sentence in the last 500 characters (else the last 500)', () => {
        const text = `${'x'.repeat(980)} mirror.`;
        assert.equal(excerptAround(text, ['mirror']), text.slice(-500));
        const sentences = `${'a'.repeat(300)}。${'b'.repeat(400)}。\nThe mirror.`;
        assert.equal(excerptAround(sentences, ['mirror']), `${'b'.repeat(400)}。\nThe mirror.`, 'not from the middle of the a-sentence');
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

    it('quotes one page: the one holding the matched word, or the longest without one', () => {
        const chunk = 'End of page seven.\n\nPage eight is about the mirror modifier.\n\nPage nine.';
        const breaks = [chunk.indexOf('Page eight'), chunk.indexOf('Page nine')];
        assert.deepEqual(citedPassage(chunk, keywordPlan('mirror'), 7, breaks), { quote: 'Page eight is about the mirror modifier.', page: 8 });
        assert.deepEqual(citedPassage(chunk, keywordPlan('nine'), 7, breaks), { quote: 'Page nine.', page: 9 });
        assert.deepEqual(citedPassage(chunk, keywordPlan('zebra'), 7, breaks), { quote: 'Page eight is about the mirror modifier.', page: 8 }, 'a vector match');
        assert.deepEqual(citedPassage(chunk, keywordPlan('mirror'), 7, undefined), { quote: chunk, page: 7 }, 'a chunk on one page');
        assert.deepEqual(citedPassage(chunk, keywordPlan('mirror'), 7, []), { quote: chunk, page: 7 }, 'a chunk on one page');
        assert.deepEqual(citedPassage(chunk, keywordPlan('mirror'), null, breaks), { quote: chunk, page: null }, 'no page: the whole chunk');
        for (const bad of [[0], [500], [40, 30], ['20'], 'x']) {
            assert.deepEqual(citedPassage(chunk, keywordPlan('mirror'), 7, bad), { quote: chunk, page: null }, `breaks ${JSON.stringify(bad)} do not fit: no page is claimed`);
        }
    });

    it('cites the page where the query\'s words weigh most, not the first one that mentions one', () => {
        const slides = [
            'Slide 3: Next time we look at the mirror tool.',
            'Slide 4: Extrude and inset faces.',
            'Slide 5: Mirror modifier settings: axis, bisect and clipping keep both halves joined.',
        ];
        const chunk = slides.join('\n\n');
        const breaks = [slides[0].length + 2, slides[0].length + 2 + slides[1].length + 2];
        assert.deepEqual(citedPassage(chunk, keywordPlan('mirror modifier settings'), 3, breaks), { quote: slides[2], page: 5 });
        assert.deepEqual(citedPassage(chunk, keywordPlan('mirror'), 3, breaks), { quote: slides[0], page: 3 }, 'a tie: the earliest page');
        assert.deepEqual(citedPassage(chunk, keywordPlan('ミラーの面'), 3, breaks).page, 5, 'no Japanese word here: the longest page');
    });

    it('names the place: the page counted from the file\'s start, or the part; 「あなたの教材」 without a name', () => {
        assert.equal(locationLabel({ title: 'Blender入門.pdf', page: 3, part: 5, parts: 12 }), '「Blender入門.pdf」3 ページ目');
        assert.equal(locationLabel({ title: null, page: 3, part: 5, parts: 12 }), 'あなたの教材・3 ページ目');
        assert.equal(locationLabel({ title: 'メモ.md', part: 2, parts: 4 }), '「メモ.md」4 つの部分のうち 2 番目');
        assert.equal(locationLabel({ part: 2, parts: 4 }), 'あなたの教材・4 つの部分のうち 2 番目');
        assert.equal(locationLabel({ title: 'メモ.md', part: 1, parts: 1 }), '「メモ.md」');
        assert.equal(locationLabel({ part: 1, parts: 1 }), 'あなたの教材');
        assert.equal(locationLabel({ title: 'メモ.md', part: 2 }), '「メモ.md」', 'no count: no part');
        assert.equal(locationLabel({ part: 5, parts: 4 }), 'あなたの教材', 'a count older than the chunk (re-indexed between the two statements)');
    });
});

describe('searchContent: results that can be cited (stdio and SSE: LOCAL_RAG_CITE)', () => {
    it('the material\'s name, the page, the part and a location to cite; the name and pages read with the chunk', async () => {
        const pool = mockPool({
            hasVector: false,
            keywordRows: [{ content: LATE_HIT, chunk_index: 4, material_id: MATERIAL, material_title: 'Blender入門.pdf', page: '3', page_breaks: null }],
            parts: { [MATERIAL]: 12 },
        });
        setPoolForTests(pool);
        const result = await searchContent({ query: 'mirror modifier', userId: LEARNER, cite: LOCAL_RAG_CITE });

        assert.equal(result.fallback_reason, 'no_pgvector', 'the reason for a keyword match stays (step 2)');
        const [hit] = result.results;
        assert.deepEqual(
            { title: hit.title, page: hit.page, part: hit.part, parts: hit.parts, location: hit.location, source: hit.source, relevance: hit.relevance_score },
            { title: 'Blender入門.pdf', page: 3, part: 5, parts: 12, location: '「Blender入門.pdf」3 ページ目', source: MATERIAL, relevance: 0.5 });
        assert.ok(hit.content.startsWith('The mirror modifier copies'), 'the passage around the match, not the chunk\'s first 500');
        assert.ok(hit.content.length <= EXCERPT_CHARS);
        const keyword = pool.queries.find((q) => /ILIKE/.test(q.sql));
        assert.match(keyword.sql, /^SELECT c\.content, c\.chunk_index, m\.id as material_id, m\.title AS material_title, c\.metadata->>'page' AS page, c\.metadata->'breaks' AS page_breaks\s+FROM material_chunks c/);
        assert.deepEqual(keyword.params, [LEARNER, '%mirror%', '%modifier%', 3], 'no new parameter');
        const count = partsQuery(pool);
        assert.match(count.sql, /SELECT c\.material_id, count\(\*\)::int AS parts\s+FROM material_chunks c\s+JOIN materials m ON c\.material_id = m\.id\s+WHERE m\.status = 'ready' AND m\.user_id = \$1 AND c\.material_id = ANY\(\$2::uuid\[\]\)\s+GROUP BY c\.material_id/,
            'counted in the same scope as the search: the learner\'s own ready materials');
        assert.deepEqual(count.params, [LEARNER, [MATERIAL]]);
    });

    it('a chunk over several pages cites the page of the matched word, and quotes that page only', async () => {
        const content = 'The end of page seven.\n\nPage eight explains the mirror modifier.\n\nPage nine.';
        setPoolForTests(mockPool({
            hasVector: false,
            keywordRows: [{ content, chunk_index: 2, material_id: MATERIAL, material_title: 'Blender入門.pdf', page: '7', page_breaks: [24, 66] }],
            parts: { [MATERIAL]: 9 },
        }));
        const { results: [hit] } = await searchContent({ query: 'mirror', userId: LEARNER, cite: LOCAL_RAG_CITE });
        assert.deepEqual([hit.page, hit.location, hit.content], [8, '「Blender入門.pdf」8 ページ目', 'Page eight explains the mirror modifier.']);
    });

    it('a vector match reads the same, and quotes around a word of the query', async () => {
        process.env.GEMINI_ALLOWED = 'true';
        setEmbeddingClientForTests(embeddingClient());
        const pool = mockPool({
            vectorRows: [{ content: LATE_HIT, chunk_index: 1, distance: 0.2, material_id: MATERIAL, material_title: 'メモ.md', page: null, page_breaks: null }],
            parts: { [MATERIAL]: 4 },
        });
        setPoolForTests(pool);
        const result = await searchContent({ query: 'mirror modifier', userId: LEARNER, cite: LOCAL_RAG_CITE });

        assert.equal(result.search_type, 'vector');
        const [hit] = result.results;
        assert.equal(hit.location, '「メモ.md」4 つの部分のうち 2 番目');
        assert.ok(!('page' in hit), 'a text file has no page');
        assert.ok(hit.content.startsWith('The mirror modifier copies'), hit.content.slice(0, 40));
        const search = pool.queries.find((q) => /<=>/.test(q.sql));
        assert.match(search.sql, /m\.id as material_id, m\.title AS material_title, c\.metadata->>'page' AS page, c\.metadata->'breaks' AS page_breaks\s+FROM material_chunks c/);
        assert.match(partsQuery(pool).sql, /WHERE m\.status = 'ready' AND m\.user_id = \$1 AND c\.material_id = ANY\(\$2::uuid\[\]\)/);
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
        const { results } = await searchContent({ query: 'mirror', userId: LEARNER, cite: LOCAL_RAG_CITE });
        assert.deepEqual(partsQuery(pool).params, [LEARNER, [MATERIAL, OTHER]]);
        assert.deepEqual(results.map((r) => [r.part, r.parts, r.location]), [
            [1, 2, 'あなたの教材・2 つの部分のうち 1 番目'],
            [3, 3, 'あなたの教材・3 つの部分のうち 3 番目'],
            [2, 2, 'あなたの教材・2 つの部分のうち 2 番目'],
        ]);

        const empty = mockPool({ hasVector: false });
        setPoolForTests(empty);
        assert.deepEqual((await searchContent({ query: 'mirror', userId: LEARNER, cite: LOCAL_RAG_CITE })).results, []);
        assert.equal(partsQuery(empty), undefined, 'no count without a result');
    });

    it('when counting fails, the results stand without a count (logged without the query)', async () => {
        setPoolForTests(mockPool({
            hasVector: false,
            keywordRows: [{ content: 'The mirror modifier.', chunk_index: 1, material_id: MATERIAL, material_title: 'メモ.md' }],
            parts: () => { throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }); },
        }));
        const { value: result, warnings } = await quietly(() => searchContent({ query: 'secret mirror words', userId: LEARNER, cite: LOCAL_RAG_CITE }));
        assert.equal(result.error_type, undefined);
        assert.deepEqual([result.results[0].location, result.results[0].parts], ['「メモ.md」', undefined]);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /57014/);
        assert.doesNotMatch(warnings[0], /secret/);
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
        const { results } = await searchContent({ query: 'mirror', userId: LEARNER, cite: LOCAL_RAG_CITE });

        assert.deepEqual(results.map((r) => [r.title, r.page, r.location]), [
            [undefined, 2, 'あなたの教材・2 ページ目'],
            [undefined, undefined, 'あなたの教材・3 つの部分のうち 2 番目'],
        ]);
    });

    it('without `cite`, neither the name nor the page is read', async () => {
        const pool = mockPool({ hasVector: false, keywordRows: [{ content: 'The mirror modifier.', chunk_index: 0, material_id: MATERIAL }], parts: { [MATERIAL]: 2 } });
        setPoolForTests(pool);
        const { results: [hit] } = await searchContent({ query: 'mirror', userId: LEARNER });
        assert.equal(hit.location, 'あなたの教材・2 つの部分のうち 1 番目');
        for (const { sql } of pool.queries) assert.doesNotMatch(sql, /title|metadata/, sql);
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
            const { value: result } = await quietly(() => searchContent({ query: 'Blender の押し出し mirror', userId: LEARNER, cite: REMOTE_RAG_CITE }));
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
        assert.match(step3, /ファイルの先頭から数えた/, 'the page is counted from the file\'s first page');
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
            const { value: body } = await quietly(async () => {
                const turn = await registerAgentTurn(LEARNER);
                const result = await client.callTool({ name: 'rag-search', arguments: { query: 'mirror modifier', rp_turn: turn } });
                assert.ok(!result.isError, result.content[0].text);
                return JSON.parse(result.content[0].text);
            });
            assert.deepEqual([body.results[0].title, body.results[0].page, body.results[0].location], ['Blender入門.pdf', 3, '「Blender入門.pdf」3 ページ目']);
            const { tools } = await client.listTools();
            assert.match(tools.find((t) => t.name === 'rag-search').description, /location は引用する場所（教材の名前とページ/);
        } finally {
            await client.close();
        }
    });
});
