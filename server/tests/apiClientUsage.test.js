/**
 * Front-end calls to the API go through apiFetch (services/apiClient.ts), which sends the user's
 * token. Plain fetch() calls to /api/v2 got 401 in strict mode (production), and in dev they acted
 * as the placeholder user, so a signed-in user's own curricula did not show up.
 *
 * Also covers the pieces the library relies on: request headers for JSON and FormData bodies,
 * the resume card answer shape, and the curricula list query.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import ts from 'typescript';
import { buildRequestHeaders } from '../../services/apiHeaders.ts';
import { parseResumeCard } from '../../services/resumeCard.ts';
import contentRoutes from '../routes/content.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCAN_DIRS = ['services', 'components', 'context', 'hooks', 'content', 'navigation', 'config'];
const SCAN_FILES = ['App.tsx', 'index.tsx'];
// The client itself.
const CLIENT_FILE = 'services/apiClient.ts';
// GET /api/learning-portals is a public legacy route outside /api/v2 (server.js), so a plain GET
// without options is fine there.
const PUBLIC_GETS = [{ file: 'services/learningPortalApi.ts', prefix: '/api/learning-portals' }];

/**
 * fetch() calls whose URL is a literal under /api, or starts with API_BASE or a local constant
 * that holds an /api path. Only real code is read (comments and strings are not matched).
 * @returns {{ line: number, target: string, argCount: number }[]}
 */
function findApiFetchCalls(source, fileName = 'file.tsx') {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
        fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const apiConstants = new Set(['API_BASE']);
    const visitConstants = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
            && ts.isStringLiteralLike(node.initializer) && node.initializer.text.startsWith('/api')) {
            apiConstants.add(node.name.text);
        }
        ts.forEachChild(node, visitConstants);
    };
    visitConstants(sf);

    const targetOf = (arg) => {
        if (!arg) return null;
        if (ts.isStringLiteralLike(arg)) return arg.text.startsWith('/api') ? arg.text : null;
        if (ts.isTemplateExpression(arg)) {
            if (arg.head.text.startsWith('/api')) return arg.head.text;
            const first = arg.templateSpans[0]?.expression;
            if (arg.head.text === '' && first && ts.isIdentifier(first) && apiConstants.has(first.text)) return `\${${first.text}}`;
            return null;
        }
        if (ts.isBinaryExpression(arg) && ts.isIdentifier(arg.left) && apiConstants.has(arg.left.text)) return arg.left.text;
        return null;
    };
    const isFetch = (expr) => (ts.isIdentifier(expr) && expr.text === 'fetch')
        || (ts.isPropertyAccessExpression(expr) && expr.name.text === 'fetch'
            && ts.isIdentifier(expr.expression) && ['window', 'globalThis'].includes(expr.expression.text));

    const calls = [];
    const visit = (node) => {
        if (ts.isCallExpression(node) && isFetch(node.expression)) {
            const target = targetOf(node.arguments[0]);
            if (target) {
                const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
                calls.push({ line: line + 1, target, argCount: node.arguments.length });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return calls;
}

/**
 * String and template literals that mention /api/v2 (comments are not literals). Outside the
 * client, a URL into the API is a sign of a call that bypasses apiFetch: concatenation, a URL kept
 * in a constant, new URL/Request, EventSource, sendBeacon...
 * @returns {{ line: number, text: string }[]}
 */
function findApiV2Literals(source, fileName = 'file.tsx') {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
        fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found = [];
    const record = (node, text) => {
        if (!text.includes('/api/v2')) return;
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        found.push({ line: line + 1, text });
    };
    const visit = (node) => {
        if (ts.isStringLiteralLike(node)) record(node, node.text);
        else if (ts.isTemplateExpression(node)) {
            record(node, [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('${}'));
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

const toPosix = (file) => file.split(path.sep).join('/');

const listSources = () => {
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(rel);
            else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(toPosix(rel));
        }
    };
    for (const dir of SCAN_DIRS) if (fs.existsSync(path.join(ROOT, dir))) walk(dir);
    for (const file of SCAN_FILES) if (fs.existsSync(path.join(ROOT, file))) files.push(file);
    return files;
};

describe('front-end API calls use apiFetch', () => {
    it('the scanner finds literal, API_BASE and local-constant targets (and ignores the rest)', () => {
        const calls = findApiFetchCalls([
            "fetch('/api/v2/curricula');",
            'fetch(`${API_BASE}/upload`, { method: "POST" });',
            "const base = '/api/v2';",
            'window.fetch(`${base}/curricula/${id}/resume`);',
            "fetch('/data/curricula/blender/image_index.jsonl');",
            'fetch(`${MIXXX_URL}/controls`);',
            "// fetch('/api/v2/commented-out')",
            "apiFetch('/curricula');",
        ].join('\n'), 'sample.ts');
        assert.deepEqual(calls.map((c) => c.line), [1, 2, 4]);
    });

    it('the literal scan finds /api/v2 in strings and templates, not in comments', () => {
        const found = findApiV2Literals([
            "const url = '/api/v2/curricula/' + id;",
            'new EventSource(`${origin}/api/v2/stream`);',
            '// fetch("/api/v2/commented-out")',
            "apiFetch('/curricula');",
        ].join('\n'), 'sample.ts');
        assert.deepEqual(found.map((f) => f.line), [1, 2]);
    });

    it('no string outside the client points into /api/v2', () => {
        const offenders = [];
        for (const file of listSources()) {
            if (file === CLIENT_FILE) continue;
            for (const literal of findApiV2Literals(fs.readFileSync(path.join(ROOT, file), 'utf8'), file)) {
                offenders.push(`${file}:${literal.line} ${literal.text}`);
            }
        }
        assert.deepEqual(offenders, [], 'call /api/v2 through apiFetch (services/apiClient.ts) with a path such as /curricula');
    });

    it('no plain fetch() reaches /api outside the client', () => {
        const offenders = [];
        for (const file of listSources()) {
            if (file === CLIENT_FILE) continue;
            const calls = findApiFetchCalls(fs.readFileSync(path.join(ROOT, file), 'utf8'), file);
            for (const call of calls) {
                const publicGet = PUBLIC_GETS.some((p) => p.file === file && call.target.startsWith(p.prefix) && call.argCount === 1);
                if (!publicGet) offenders.push(`${file}:${call.line} ${call.target}`);
            }
        }
        assert.deepEqual(offenders, [], 'call these through apiFetch (services/apiClient.ts)');
    });
});

describe('buildRequestHeaders', () => {
    it('sends JSON by default', () => {
        assert.deepEqual(buildRequestHeaders(undefined), { 'Content-Type': 'application/json' });
        assert.deepEqual(buildRequestHeaders(JSON.stringify({ a: 1 })), { 'Content-Type': 'application/json' });
    });

    it('leaves Content-Type to the browser for FormData (multipart boundary)', () => {
        const form = new FormData();
        form.append('file', new Blob(['x']), 'notes.txt');
        assert.deepEqual(buildRequestHeaders(form), {});
        assert.deepEqual(buildRequestHeaders(form, { 'content-type': 'application/json', 'X-Trace': '1' }), { 'X-Trace': '1' });
    });

    it('keeps an explicit Content-Type and other headers', () => {
        assert.deepEqual(buildRequestHeaders('text', { 'Content-Type': 'text/plain', 'X-Trace': '1' }), {
            'Content-Type': 'text/plain',
            'X-Trace': '1',
        });
    });
});

describe('parseResumeCard', () => {
    it('reads the card from the top level of the resume answer ({ ok, ...card })', () => {
        assert.deepEqual(parseResumeCard({ ok: true, type: 'continue', message: 'Next lesson' }), { type: 'continue', message: 'Next lesson' });
    });

    it('returns null for anything that is not a resume card', () => {
        for (const payload of [null, undefined, 'x', { ok: false, type: 'continue' }, { ok: true }, { ok: true, type: 'unknown' }, { resume_card: { type: 'continue' } }]) {
            assert.equal(parseResumeCard(payload), null, JSON.stringify(payload));
        }
    });
});

describe('GET /curricula (library list)', () => {
    it('returns the lesson count and status, and leaves out unfinished generation drafts', async () => {
        const queries = [];
        setPoolForTests({
            async query(sql, params = []) {
                queries.push({ sql: String(sql), params });
                return { rows: [], rowCount: 0 };
            },
        });
        try {
            const app = express();
            app.use('/api/v2', (req, _res, next) => {
                req.userId = '00000000-0000-0000-0000-0000000000aa';
                next();
            }, contentRoutes);
            const server = await new Promise((resolve) => {
                const s = app.listen(0, () => resolve(s));
            });
            try {
                const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/curricula`);
                assert.equal(res.status, 200);
            } finally {
                await new Promise((resolve) => server.close(resolve));
            }
        } finally {
            resetPoolForTests();
        }
        const list = queries.find((q) => /from curricula/i.test(q.sql));
        for (const column of ['total_lessons', 'status', 'ui_template_id']) assert.match(list.sql, new RegExp(`\\b${column}\\b`));
        assert.match(list.sql, /\(coalesce\(status, ''\) not like 'draft\\_%' or current_version_id is not null\)/);
    });
});
