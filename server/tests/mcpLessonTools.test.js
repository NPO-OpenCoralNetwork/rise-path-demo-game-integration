import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
    getLessonSchema,
    getLessonContract,
    validateLessonDraft,
    getLesson,
    upsertLessonDraft,
    previewUrl,
    hashLesson,
    stampDraft,
    resolveLessonStore,
    buildAuthorLessonPrompt,
    BUILTIN_CONTRACT,
    LESSON_UI_TEMPLATE_ID,
} from '../../tools/core/lessons.js';
import { saveDraft } from '../../tools/core/curriculum.js';
import { validateLesson } from '../../shared/lesson/validate.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COURSE = 'vibe-coding';
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const EXEMPLAR = readJson(path.join(ROOT, 'content/courses', COURSE, 'lessons/vibe-ch1.lesson.json'));
const LESSON_TOOLS = ['lesson-schema-get', 'lesson-validate', 'lesson-get', 'lesson-upsert-draft', 'lesson-preview-url'];
const USER_ID = '14fe15a2-bc4a-4449-afca-f39196f383b1';
const CURRICULUM_ID = '6b1d3c1e-8a52-4d7e-9a43-2f0f6c1b9e10';

const tmpDirs = [];
/** Empty temporary directory, removed after the run. */
function tmpDir(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
}
after(() => { for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true }); });

/** Temporary content/ with a copy of the vibe-coding course, so tests never write to the repo. */
function makeContentDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-lesson-tools-'));
    fs.cpSync(path.join(ROOT, 'content/courses', COURSE), path.join(dir, 'courses', COURSE), { recursive: true });
    return dir;
}

function newLesson(id = 'mcp-new-lesson') {
    const lesson = structuredClone(EXEMPLAR);
    lesson.id = id;
    delete lesson.provenance;
    return lesson;
}

/**
 * Mock pg pool: records every query (pool and client) and answers with respond(sql, params).
 */
function createMockPool(respond = () => undefined) {
    const queries = [];
    let released = 0;
    const run = async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        queries.push({ sql: text, params });
        const answer = await respond(text, params);
        if (answer instanceof Error) throw answer;
        return answer || { rowCount: 0, rows: [] };
    };
    return {
        queries,
        get released() { return released; },
        query: run,
        connect: async () => ({ query: run, release: () => { released += 1; } }),
        statements: () => queries.map((q) => q.sql.split(' ').slice(0, 3).join(' ').toLowerCase()),
    };
}

/** Answers for the version-insert path (new curricula row, version 1). */
function versionInsertResponder({ existing = null, nextVersion = 2, owned = true } = {}) {
    return (sql) => {
        const lower = sql.toLowerCase();
        if (lower.startsWith('select c.id, v.content_json')) {
            return owned ? { rowCount: 1, rows: [{ id: CURRICULUM_ID, content_json: existing }] } : { rowCount: 0, rows: [] };
        }
        if (lower.startsWith('select id from curricula')) {
            return owned ? { rowCount: 1, rows: [{ id: CURRICULUM_ID }] } : { rowCount: 0, rows: [] };
        }
        if (lower.startsWith('select coalesce(max(version)')) return { rowCount: 1, rows: [{ next_version: nextVersion }] };
        if (lower.startsWith('insert into curricula ')) return { rowCount: 1, rows: [{ id: CURRICULUM_ID }] };
        if (lower.startsWith('insert into curriculum_versions')) {
            return { rowCount: 1, rows: [{ id: 'version-1', status: 'draft', created_at: '2026-10-18T00:00:00.000Z' }] };
        }
        return undefined;
    };
}

const findQuery = (pool, prefix) => pool.queries.find((q) => q.sql.toLowerCase().startsWith(prefix));

describe('lesson-schema-get', () => {
    it('returns the LLM schema, the built-in contract and a valid exemplar excerpt', async () => {
        const result = await getLessonSchema({ root: tmpDir('rp-noskill-') });
        assert.equal(result.schema_id, 'risepath.lesson/v1');
        assert.equal(result.profile, 'llm');
        assert.match(result.json_schema.title, /LLM profile/);
        assert.ok(result.json_schema.$defs.Lesson || result.json_schema.properties);
        assert.equal(result.contract.source, 'builtin');
        assert.equal(result.contract.text, BUILTIN_CONTRACT);

        const { exemplar } = result;
        assert.equal(exemplar.lesson_id, 'vibe-ch1');
        assert.equal(exemplar.kind, 'excerpt');
        const roles = exemplar.lesson.sections.map((s) => s.role);
        assert.equal(new Set(roles).size, roles.length, 'one section per role');
        assert.ok(exemplar.omitted_sections.length > 0);
        assert.equal(exemplar.lesson.provenance.migratedFrom, undefined);
        assert.deepEqual(validateLesson(exemplar.lesson).errors, []);
    });

    it('returns the full profile and can leave the exemplar out', async () => {
        const result = await getLessonSchema({ profile: 'full', exemplar: 'none' });
        assert.equal(result.profile, 'full');
        assert.equal(result.json_schema.title, 'risepath.lesson/v1');
        assert.equal(result.exemplar, undefined);
    });

    it('reads the contract and the author-lesson prompt from the skill when present', async () => {
        const root = tmpDir('rp-skill-');
        const skillDir = path.join(root, '.claude/skills/author-lesson');
        fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'references/lesson-contract.md'), '# Contract from skill\n');
        fs.writeFileSync(
            path.join(skillDir, 'SKILL.md'),
            '---\nname: author-lesson\ndescription: test\n---\n# Skill body\nCatalog: !`npm run -s lessons:catalog`\nArgs: $ARGUMENTS\n',
        );

        const contract = await getLessonContract({ root });
        assert.equal(contract.source, '.claude/skills/author-lesson/references/lesson-contract.md');
        assert.equal(contract.text, '# Contract from skill');

        const prompt = await buildAuthorLessonPrompt({ courseSlug: COURSE, lessonId: 'vibe-ch1-practice', brief: '演習', root });
        assert.equal(prompt.source, '.claude/skills/author-lesson/SKILL.md');
        assert.ok(prompt.text.startsWith('# Skill body'), 'frontmatter stripped');
        assert.ok(prompt.text.includes('Catalog: `npm run -s lessons:catalog`'));
        assert.ok(prompt.text.includes('Args: vibe-coding vibe-ch1-practice 演習'));
        assert.ok(prompt.text.includes('lesson-upsert-draft'));
    });

    it('falls back to the built-in author-lesson prompt', async () => {
        const prompt = await buildAuthorLessonPrompt({ courseSlug: COURSE, root: tmpDir('rp-noskill-') });
        assert.equal(prompt.source, 'builtin');
        assert.ok(prompt.text.includes('lesson-schema-get'));
        assert.ok(prompt.text.includes(`course_slug: ${COURSE}`));
    });
});

describe('lesson-validate', () => {
    it('accepts the exemplar with no errors or warnings', async () => {
        const result = await validateLessonDraft(EXEMPLAR, { courseSlug: COURSE });
        assert.equal(result.ok, true);
        assert.deepEqual(result.errors, []);
        assert.deepEqual(result.warnings, []);
        assert.equal(result.course_checked, true);
    });

    it('returns errors with JSON paths for a broken lesson', async () => {
        const broken = structuredClone(EXEMPLAR);
        broken.sections[0].blocks[1].questions[0].answer = ['zz'];
        broken.objectives[0].bloom = 'memorize';
        const structural = await validateLessonDraft(broken, { courseSlug: COURSE });
        assert.equal(structural.ok, false);
        assert.ok(structural.errors.some((e) => e.path === 'objectives[0].bloom'));
        assert.equal(structural.lint_skipped, true);

        broken.objectives[0].bloom = 'understand';
        const semantic = await validateLessonDraft(broken, { courseSlug: COURSE });
        assert.equal(semantic.ok, false);
        assert.deepEqual(semantic.errors.map((e) => e.path), ['sections[0].blocks[1].questions[0].answer[0]']);
    });

    it('fills the server-owned fields the way the upsert does', async () => {
        const lesson = newLesson();
        delete lesson.schema;
        delete lesson.courseId;
        const result = await validateLessonDraft(lesson, { courseSlug: COURSE, clientName: 'Claude Desktop' });
        assert.equal(result.ok, true, JSON.stringify(result.errors));
        assert.deepEqual(result.stamped, ['schema', 'courseId', 'provenance.author', 'provenance.generatedAt']);

        const unstamped = await validateLessonDraft(lesson, { stamp: false });
        assert.equal(unstamped.ok, false);
    });

    it('rejects a non-object lesson and a bad course slug', async () => {
        assert.equal((await validateLessonDraft([], {})).ok, false);
        assert.equal((await validateLessonDraft(EXEMPLAR, { courseSlug: '../x' })).error_type, 'validation');
    });
});

describe('lesson-get / lesson-upsert-draft (fs store)', () => {
    let contentDir;
    beforeEach(() => { contentDir = makeContentDir(); });
    afterEach(() => { fs.rmSync(contentDir, { recursive: true, force: true }); });

    const draftFile = (id) => path.join(contentDir, 'courses', COURSE, 'drafts', `${id}.lesson.json`);

    it('defaults to the fs store', () => {
        assert.equal(resolveLessonStore({}), 'fs');
        assert.equal(resolveLessonStore({ RP_LESSON_STORE: 'DB' }), 'db');
    });

    it('reads a published lesson with its hash, and lists ids when not found', async () => {
        const got = await getLesson({ courseSlug: COURSE, lessonId: 'vibe-ch1', contentDir });
        assert.equal(got.source, 'published');
        assert.equal(got.path, 'content/courses/vibe-coding/lessons/vibe-ch1.lesson.json');
        assert.equal(got.hash, hashLesson(EXEMPLAR));
        assert.equal(got.has_draft, false);

        const missing = await getLesson({ courseSlug: COURSE, lessonId: 'nope', contentDir });
        assert.equal(missing.error_type, 'not_found');
        assert.ok(missing.available.lessons.includes('vibe-ch1'));

        const noCourse = await getLesson({ courseSlug: 'no-course', lessonId: 'x', contentDir });
        assert.equal(noCourse.error_type, 'not_found');
        assert.deepEqual(noCourse.available_courses, [COURSE]);
    });

    it('rejects path traversal in course_slug and lesson ids', async () => {
        for (const bad of ['../x', '..', 'a/b', '.hidden', 'Upper', 'x_y', 'x.y', '', '-x']) {
            const got = await getLesson({ courseSlug: COURSE, lessonId: bad, contentDir });
            assert.equal(got.error_type, 'validation', bad);
            const lesson = newLesson();
            lesson.id = bad;
            const saved = await upsertLessonDraft({ courseSlug: COURSE, lesson, contentDir });
            assert.equal(saved.error_type, 'validation', bad);
        }
        const saved = await upsertLessonDraft({ courseSlug: '../../etc', lesson: newLesson(), contentDir });
        assert.equal(saved.error_type, 'validation');
        assert.equal((await previewUrl({ courseSlug: COURSE, lessonId: '../x', contentDir })).error_type, 'validation');
        assert.deepEqual(fs.readdirSync(path.join(contentDir, 'courses')), [COURSE]);
        assert.equal(fs.existsSync(path.join(contentDir, 'courses', COURSE, 'drafts')), false);
    });

    it('creates a draft in drafts/ and stamps provenance', async () => {
        const now = new Date('2026-10-18T09:00:00.000Z');
        const lesson = newLesson();
        lesson.provenance = { author: '', reviewedBy: 'someone' };
        const saved = await upsertLessonDraft({ courseSlug: COURSE, lesson, clientName: 'Claude Desktop', contentDir, now });
        assert.equal(saved.ok, true, JSON.stringify(saved));
        assert.equal(saved.action, 'created');
        assert.equal(saved.store, 'fs');
        assert.equal(saved.path, 'content/courses/vibe-coding/drafts/mcp-new-lesson.lesson.json');
        assert.equal(saved.previous_hash, null);
        assert.deepEqual(saved.warnings, []);

        const onDisk = readJson(draftFile('mcp-new-lesson'));
        assert.deepEqual(onDisk.provenance, { author: 'mcp:Claude-Desktop', generatedAt: now.toISOString() });
        assert.equal(saved.hash, hashLesson(onDisk));
        assert.ok(fs.readFileSync(draftFile('mcp-new-lesson'), 'utf8').endsWith('}\n'));
        assert.equal(fs.existsSync(path.join(contentDir, 'courses', COURSE, 'lessons', 'mcp-new-lesson.lesson.json')), false);

        const got = await getLesson({ courseSlug: COURSE, lessonId: 'mcp-new-lesson', contentDir });
        assert.equal(got.source, 'draft');
        assert.equal(got.hash, saved.hash);
    });

    it('needs base_hash to replace an existing version, and returns conflict for a stale one', async () => {
        const published = await getLesson({ courseSlug: COURSE, lessonId: 'vibe-ch1', contentDir });
        const edit = structuredClone(EXEMPLAR);
        edit.estMinutes = 25;

        const blind = await upsertLessonDraft({ courseSlug: COURSE, lesson: edit, contentDir });
        assert.equal(blind.error_type, 'conflict');
        assert.equal(blind.current_hash, published.hash);
        assert.equal(blind.current_source, 'published');

        const first = await upsertLessonDraft({ courseSlug: COURSE, lesson: edit, baseHash: published.hash, contentDir });
        assert.equal(first.action, 'created');
        assert.equal(first.based_on, 'published');
        assert.equal(first.previous_hash, published.hash);

        // Retrying the same content is a no-op, even with the old hash.
        const again = await upsertLessonDraft({ courseSlug: COURSE, lesson: edit, baseHash: published.hash, contentDir });
        assert.equal(again.action, 'unchanged');
        assert.equal(again.hash, first.hash);

        edit.estMinutes = 30;
        const stale = await upsertLessonDraft({ courseSlug: COURSE, lesson: edit, baseHash: published.hash, contentDir });
        assert.equal(stale.error_type, 'conflict');
        assert.equal(stale.current_hash, first.hash);
        assert.equal(stale.current_source, 'draft');
        assert.equal(readJson(draftFile('vibe-ch1')).estMinutes, 25);

        const updated = await upsertLessonDraft({ courseSlug: COURSE, lesson: edit, baseHash: first.hash, contentDir });
        assert.equal(updated.action, 'updated');
        assert.equal(updated.previous_hash, first.hash);
        assert.equal(readJson(draftFile('vibe-ch1')).estMinutes, 30);
        assert.equal(readJson(path.join(contentDir, 'courses', COURSE, 'lessons/vibe-ch1.lesson.json')).estMinutes, EXEMPLAR.estMinutes);

        const unknownBase = await upsertLessonDraft({ courseSlug: COURSE, lesson: newLesson('brand-new'), baseHash: 'abc', contentDir });
        assert.equal(unknownBase.error_type, 'conflict');
        assert.equal(unknownBase.current_hash, null);
    });

    it('lets only one of two concurrent creates win', async () => {
        const a = newLesson('race');
        const b = newLesson('race');
        b.estMinutes = 40;
        const results = await Promise.all([
            upsertLessonDraft({ courseSlug: COURSE, lesson: a, contentDir }),
            upsertLessonDraft({ courseSlug: COURSE, lesson: b, contentDir }),
        ]);
        assert.deepEqual(results.map((r) => r.action || r.error_type).sort(), ['conflict', 'created']);
    });

    it('saves nothing when the lesson is invalid', async () => {
        const lesson = newLesson('invalid-one');
        lesson.sections[0].blocks[1].questions[0].answer = ['zz'];
        const saved = await upsertLessonDraft({ courseSlug: COURSE, lesson, contentDir });
        assert.equal(saved.error_type, 'validation');
        assert.equal(saved.errors[0].path, 'sections[0].blocks[1].questions[0].answer[0]');
        assert.equal(fs.existsSync(draftFile('invalid-one')), false);

        const mismatch = newLesson('other-course');
        mismatch.courseId = 'another-course';
        assert.equal((await upsertLessonDraft({ courseSlug: COURSE, lesson: mismatch, contentDir })).errors[0].path, 'courseId');
        assert.equal((await upsertLessonDraft({ courseSlug: COURSE, lesson: 'text', contentDir })).error_type, 'validation');

        const huge = newLesson('huge');
        huge.tags = ['x'.repeat(600 * 1024)];
        assert.match((await upsertLessonDraft({ courseSlug: COURSE, lesson: huge, contentDir })).error, /limit/);
    });

    it('refuses file writes when the server disables them', async () => {
        const saved = await upsertLessonDraft({ courseSlug: COURSE, lesson: newLesson(), allowFsWrite: false, contentDir });
        assert.equal(saved.error_type, 'store_unavailable');
        assert.equal(fs.existsSync(draftFile('mcp-new-lesson')), false);
    });

    it('returns preview URLs', async () => {
        const before = await previewUrl({ courseSlug: COURSE, lessonId: 'mcp-new-lesson', contentDir, baseUrl: 'https://dev.example/' });
        assert.equal(before.preview_url, 'https://dev.example/preview/vibe-coding/mcp-new-lesson');
        assert.equal(before.learn_url, null);
        assert.deepEqual(before.exists, { draft: false, published: false });

        await upsertLessonDraft({ courseSlug: COURSE, lesson: newLesson(), contentDir });
        const published = await previewUrl({ courseSlug: COURSE, lessonId: 'vibe-ch1', contentDir });
        assert.equal(published.learn_url, 'http://localhost:3007/learn/vibe-coding/vibe-ch1');
        assert.equal((await previewUrl({ courseSlug: COURSE, lessonId: 'mcp-new-lesson', contentDir })).exists.draft, true);
    });
});

describe('lesson hashing and stamping', () => {
    it('hashes canonical JSON, independent of key order', () => {
        const a = { b: 1, a: { d: [1, 2], c: 'x' } };
        const b = { a: { c: 'x', d: [1, 2] }, b: 1 };
        assert.equal(hashLesson(a), hashLesson(b));
        assert.match(hashLesson(a), /^[0-9a-f]{16}$/);
        assert.notEqual(hashLesson(a), hashLesson({ ...a, b: 2 }));
    });

    it('keeps a given author and never mutates the input', () => {
        const lesson = newLesson();
        lesson.provenance = { author: 'human+claude-code', model: 'm' };
        const { lesson: out } = stampDraft(lesson, { courseSlug: COURSE, now: new Date(0) });
        assert.equal(out.provenance.author, 'human+claude-code');
        assert.equal(out.provenance.model, 'm');
        assert.equal(out.provenance.generatedAt, '1970-01-01T00:00:00.000Z');
        assert.equal(lesson.provenance.generatedAt, undefined);
    });
});

describe('lesson tools (db store, mock pool)', () => {
    let contentDir;
    beforeEach(() => { contentDir = makeContentDir(); });
    afterEach(() => {
        resetPoolForTests();
        fs.rmSync(contentDir, { recursive: true, force: true });
    });

    it('inserts a new draft version in curriculum_versions.content_json', async () => {
        const pool = createMockPool(versionInsertResponder());
        setPoolForTests(pool);
        const saved = await upsertLessonDraft({ courseSlug: COURSE, lesson: newLesson(), store: 'db', userId: USER_ID, contentDir });
        assert.equal(saved.ok, true, JSON.stringify(saved));
        assert.equal(saved.store, 'db');
        assert.equal(saved.action, 'created');
        assert.equal(saved.curriculum_id, CURRICULUM_ID);
        assert.equal(saved.curriculum_version_id, 'version-1');
        assert.equal(saved.version, 1);
        assert.deepEqual(pool.statements(), [
            'begin', 'insert into curricula', 'insert into curriculum_versions', 'update curricula set', 'commit',
        ]);

        const created = findQuery(pool, 'insert into curricula ');
        assert.deepEqual(created.params.slice(0, 2), [USER_ID, EXEMPLAR.title.jp]);
        assert.equal(created.params[3], LESSON_UI_TEMPLATE_ID);
        const version = findQuery(pool, 'insert into curriculum_versions');
        assert.match(version.sql, /\(curriculum_id, version, status, content_json, requirements, roadmap, ui_hints, created_by\)/);
        const contentJson = JSON.parse(version.params[2]);
        assert.equal(contentJson.schema, 'risepath.lesson/v1');
        assert.equal(contentJson.id, 'mcp-new-lesson');
        assert.equal(saved.hash, hashLesson(contentJson));
        assert.equal(JSON.parse(version.params[5]).format, 'risepath.lesson/v1');
        assert.equal(version.params[6], USER_ID);
        const update = findQuery(pool, 'update curricula set');
        assert.match(update.sql, /current_version_id = CAST\(\$3 AS uuid\)/);
        assert.equal(update.params[2], 'version-1');
        assert.equal(pool.released, 1);
        assert.equal(fs.existsSync(path.join(contentDir, 'courses', COURSE, 'drafts')), false);
    });

    it('adds a version to an owned draft only with the current hash', async () => {
        const current = stampDraft(newLesson(), { courseSlug: COURSE }).lesson;
        const currentHash = hashLesson(current);
        const edit = newLesson();
        edit.estMinutes = 33;

        let pool = createMockPool(versionInsertResponder({ existing: current, nextVersion: 4 }));
        setPoolForTests(pool);
        const stale = await upsertLessonDraft({ courseSlug: COURSE, lesson: edit, curriculumId: CURRICULUM_ID, baseHash: 'deadbeefdeadbeef', userId: USER_ID, contentDir });
        assert.equal(stale.error_type, 'conflict');
        assert.equal(stale.current_hash, currentHash);
        assert.deepEqual(pool.statements(), ['begin', 'select c.id, v.content_json', 'rollback']);
        assert.match(pool.queries[1].sql, /for update of c/);
        assert.deepEqual(pool.queries[1].params, [CURRICULUM_ID, USER_ID]);

        pool = createMockPool(versionInsertResponder({ existing: current, nextVersion: 4 }));
        setPoolForTests(pool);
        const saved = await upsertLessonDraft({ courseSlug: COURSE, lesson: edit, curriculumId: CURRICULUM_ID, baseHash: currentHash, userId: USER_ID, contentDir });
        assert.equal(saved.action, 'updated', JSON.stringify(saved));
        assert.equal(saved.version, 4);
        assert.equal(saved.previous_hash, currentHash);
        assert.equal(JSON.parse(findQuery(pool, 'insert into curriculum_versions').params[2]).estMinutes, 33);
        assert.equal(findQuery(pool, 'insert into curricula '), undefined);
    });

    it('returns not_found for a curriculum the user does not own, and db_connection without a pool', async () => {
        const pool = createMockPool(versionInsertResponder({ owned: false }));
        setPoolForTests(pool);
        const saved = await upsertLessonDraft({ courseSlug: COURSE, lesson: newLesson(), curriculumId: CURRICULUM_ID, userId: USER_ID, contentDir });
        assert.equal(saved.error_type, 'not_found');
        assert.equal(pool.statements().at(-1), 'rollback');

        setPoolForTests(null);
        assert.equal((await upsertLessonDraft({ courseSlug: COURSE, lesson: newLesson(), store: 'db', userId: USER_ID, contentDir })).error_type, 'db_connection');
        assert.equal((await getLesson({ curriculumId: CURRICULUM_ID, userId: USER_ID })).error_type, 'db_connection');
        assert.equal((await getLesson({ curriculumId: 'not-a-uuid', userId: USER_ID })).error_type, 'validation');
    });

    it('rolls back and classifies a DB error', async () => {
        const pool = createMockPool((sql) => (sql.startsWith('insert into curriculum_versions') ? Object.assign(new Error('boom'), { code: '42P01' }) : versionInsertResponder()(sql)));
        setPoolForTests(pool);
        const saved = await upsertLessonDraft({ courseSlug: COURSE, lesson: newLesson(), store: 'db', userId: USER_ID, contentDir });
        assert.equal(saved.error_type, 'table_not_found');
        assert.equal(pool.statements().at(-1), 'rollback');
        assert.equal(pool.released, 1);
    });

    it('reads the current DB version of an owned lesson draft', async () => {
        const lesson = stampDraft(newLesson(), { courseSlug: COURSE }).lesson;
        const pool = createMockPool((sql) => (sql.startsWith('select c.id, v.id as version_id')
            ? { rowCount: 1, rows: [{ id: CURRICULUM_ID, version_id: 'v-2', version: 2, status: 'draft', content_json: lesson }] }
            : undefined));
        setPoolForTests(pool);
        const got = await getLesson({ courseSlug: COURSE, lessonId: 'ignored', curriculumId: CURRICULUM_ID, userId: USER_ID });
        assert.equal(got.source, 'db');
        assert.equal(got.version, 2);
        assert.equal(got.hash, hashLesson(lesson));
        assert.deepEqual(pool.queries[0].params, [CURRICULUM_ID, USER_ID]);
    });
});

describe('saveDraft (save-curriculum-draft) writes real columns', () => {
    afterEach(() => resetPoolForTests());

    const curriculum = {
        title: 'Webの基本',
        summary: 'Webアプリの仕組みを学ぶ',
        modules: [{
            title: '基礎',
            goal: '役割を説明できる',
            lessons: [{ title: 'フロントとバック', objective: '違いを説明できる' }],
        }],
    };
    const intake = { target_audience: '初学者', goal: 'Webを理解する', current_level: '初学者', duration_weeks: 2 };

    it('inserts curricula + a draft curriculum_versions row with content_json', async () => {
        const pool = createMockPool(versionInsertResponder());
        setPoolForTests(pool);
        const saved = await saveDraft({ intake, curriculum, userId: USER_ID, generationMeta: { provider: 'anthropic', model: 'test-model' } });
        assert.equal(saved.error, undefined, JSON.stringify(saved));
        assert.equal(saved.action, 'created');
        assert.equal(saved.curriculum_id, CURRICULUM_ID);
        assert.equal(saved.curriculum_version_id, 'version-1');
        assert.equal(saved.status, 'draft');
        assert.equal(saved.lesson_count, 1);
        assert.deepEqual(pool.statements(), [
            'begin', 'insert into curricula', 'insert into curriculum_versions', 'update curricula set', 'commit',
        ]);
        for (const q of pool.queries) {
            assert.doesNotMatch(q.sql, /curriculum_data|generation_meta\s*=|\bintake\s*=|\(user_id, title, description, intake/, q.sql);
        }

        const version = findQuery(pool, 'insert into curriculum_versions');
        const contentJson = JSON.parse(version.params[2]);
        assert.equal(contentJson.curriculum_id, CURRICULUM_ID);
        assert.equal(contentJson.modules.length, 1);
        assert.equal(contentJson._meta.generation_meta.model, 'test-model');
        assert.equal(contentJson._meta.source, 'mcp');
        assert.equal(JSON.parse(version.params[3]).goal, 'Webを理解する');
        const update = findQuery(pool, 'update curricula set');
        assert.equal(update.params[3], 1);
        assert.equal(update.params[5], 'test-model');
        assert.equal(pool.released, 1);
    });

    it('adds a version to an owned curriculum and rejects one the user does not own', async () => {
        let pool = createMockPool(versionInsertResponder({ nextVersion: 3 }));
        setPoolForTests(pool);
        const updated = await saveDraft({ intake, curriculum, userId: USER_ID, curriculumId: CURRICULUM_ID });
        assert.equal(updated.action, 'updated', JSON.stringify(updated));
        assert.equal(updated.version, 3);
        assert.deepEqual(findQuery(pool, 'select id from curricula').params, [CURRICULUM_ID, USER_ID]);
        assert.equal(findQuery(pool, 'insert into curricula '), undefined);

        pool = createMockPool(versionInsertResponder({ owned: false }));
        setPoolForTests(pool);
        const denied = await saveDraft({ intake, curriculum, userId: USER_ID, curriculumId: CURRICULUM_ID });
        assert.equal(denied.error_type, 'not_found');
        assert.deepEqual(pool.statements(), ['begin', 'select id from', 'rollback']);
    });

    it('validates before touching the DB, and reports a missing DB', async () => {
        const pool = createMockPool();
        setPoolForTests(pool);
        const invalid = await saveDraft({ intake, curriculum: { title: 'x' }, userId: USER_ID });
        assert.equal(invalid.error_type, 'validation');
        assert.equal(pool.queries.length, 0);

        setPoolForTests(null);
        assert.equal((await saveDraft({ intake, curriculum, userId: USER_ID })).error_type, 'db_connection');
    });
});

describe('tool-registry.json lesson entries', () => {
    const registry = createRequire(import.meta.url)('../../mcp-server/tool-registry.json');
    const shape = registry.tools.find((t) => t.tool_id === 'save-curriculum-draft');

    it('registers the five lesson tools with the full entry shape', () => {
        for (const id of LESSON_TOOLS) {
            const entry = registry.tools.find((t) => t.tool_id === id);
            assert.ok(entry, id);
            assert.deepEqual(Object.keys(entry).sort(), Object.keys(shape).sort(), id);
            assert.deepEqual(Object.keys(entry.annotations).sort(), Object.keys(shape.annotations).sort(), id);
            assert.deepEqual(entry.exposure_profiles, ['curriculum-builder', 'admin'], id);
            assert.equal(entry.annotations.openWorldHint, false);
        }
        const upsert = registry.tools.find((t) => t.tool_id === 'lesson-upsert-draft');
        assert.equal(upsert.risk, 'write');
        assert.equal(upsert.audit, true);
        assert.equal(upsert.max_calls_per_session, 50);
        assert.equal(upsert.annotations.readOnlyHint, false);
        assert.equal(registry.server, 'rise-path-learning');
    });
});

describe('MCP server (stdio) lesson tools', () => {
    const contentDir = makeContentDir();
    const connect = async (profile) => {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [path.join(ROOT, 'mcp-server/index.js')],
            cwd: ROOT,
            env: { ...process.env, RISE_PATH_MCP_PROFILE: profile, RP_LESSON_STORE: 'fs', RP_CONTENT_DIR: contentDir, DATABASE_URL_PHASE1: '' },
            stderr: 'pipe',
        });
        const client = new Client({ name: 'mcp-lesson-tools-test', version: '1.0.0' });
        await client.connect(transport);
        return client;
    };
    const text = (result) => JSON.parse(result.content[0].text);
    let builder;

    before(async () => { builder = await connect('curriculum-builder'); });
    after(async () => {
        await builder?.close();
        fs.rmSync(contentDir, { recursive: true, force: true });
    });

    it('lists the lesson tools, resource and prompt in curriculum-builder', async () => {
        assert.equal(builder.getServerVersion().name, 'rise-path-learning');
        const names = (await builder.listTools()).tools.map((t) => t.name);
        for (const id of LESSON_TOOLS) assert.ok(names.includes(id), id);
        const upsert = (await builder.listTools()).tools.find((t) => t.name === 'lesson-upsert-draft');
        assert.equal(upsert.annotations.readOnlyHint, false);
        assert.ok(upsert.inputSchema.required.includes('lesson'));

        const resources = (await builder.listResources()).resources.map((r) => r.uri);
        assert.ok(resources.includes('rp://schema/lesson/v1'));
        const prompts = (await builder.listPrompts()).prompts.map((p) => p.name);
        assert.ok(prompts.includes('author-lesson'));
    });

    it('validates, saves a draft and reports a conflict over MCP', async () => {
        const valid = text(await builder.callTool({ name: 'lesson-validate', arguments: { lesson: EXEMPLAR, course_slug: COURSE } }));
        assert.equal(valid.ok, true);

        const saved = await builder.callTool({ name: 'lesson-upsert-draft', arguments: { course_slug: COURSE, lesson: newLesson('over-mcp') } });
        assert.equal(saved.isError, undefined);
        assert.equal(text(saved).action, 'created');
        const onDisk = readJson(path.join(contentDir, 'courses', COURSE, 'drafts/over-mcp.lesson.json'));
        assert.equal(onDisk.provenance.author, 'mcp:mcp-lesson-tools-test');

        const again = newLesson('over-mcp');
        again.estMinutes = 45;
        const clash = await builder.callTool({ name: 'lesson-upsert-draft', arguments: { course_slug: COURSE, lesson: again, base_hash: '0000000000000000' } });
        assert.equal(clash.isError, true);
        assert.equal(text(clash).error_type, 'conflict');

        const traversal = await builder.callTool({ name: 'lesson-get', arguments: { course_slug: COURSE, lesson_id: '../lessons/vibe-ch1' } });
        assert.equal(traversal.isError, true);
    });

    it('hides the lesson tools, resource and prompt from the learner profile', async () => {
        const learner = await connect('learner');
        try {
            const names = (await learner.listTools()).tools.map((t) => t.name);
            assert.deepEqual(names.filter((n) => n.startsWith('lesson-')), []);
            const resources = (await learner.listResources()).resources.map((r) => r.uri);
            assert.equal(resources.includes('rp://schema/lesson/v1'), false);
            const prompts = (await learner.listPrompts()).prompts.map((p) => p.name);
            assert.equal(prompts.includes('author-lesson'), false);
        } finally {
            await learner.close();
        }
    });
});
