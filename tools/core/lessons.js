/**
 * Shared Business Logic — risepath.lesson/v1 authoring (MCP lesson-* tools)
 *
 * Five operations for any MCP client: schema + contract + exemplar, validate + lint
 * without saving, read a lesson, upsert a draft with optimistic locking, preview URL.
 *
 * Store (RP_LESSON_STORE):
 *   fs (default) — drafts go to content/courses/<slug>/drafts/<id>.lesson.json, for PR
 *                  review. Never writes lessons/ (publishing is a human step).
 *   db           — drafts go to curriculum_versions.content_json (one curricula row per lesson).
 * Works without a database in fs mode. RP_CONTENT_DIR overrides the content/ root (tests, smoke).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPool } from '../../server/db.js';
import { classifyDbError } from './dbErrors.js';
import { writeCurriculumVersion } from './curriculum.js';
import { validateLesson } from '../../shared/lesson/validate.js';
import { lintLesson } from '../../shared/lesson/lint.js';
import { lessonJsonSchema } from '../../shared/lesson/jsonSchema.js';
import { lessonStats } from '../../shared/lesson/walk.js';
import { canonicalJson } from '../../shared/lesson/canonical.js';
import { t } from '../../shared/lesson/text.js';
import { LESSON_SCHEMA_ID, BLOCK_TYPES, SECTION_ROLES } from '../../shared/lesson/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Course slugs and lesson ids that become file names. Stricter than the schema's id pattern (no "." or "_"). */
export const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_SLUG_LENGTH = 80;
const MAX_LESSON_BYTES = 512 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ui_template_id of DB rows that hold one risepath.lesson/v1 draft. */
export const LESSON_UI_TEMPLATE_ID = 'risepath_lesson_v1';

/** The gold lesson returned by lesson-schema-get. */
export const EXEMPLAR = { courseSlug: 'vibe-coding', lessonId: 'vibe-ch1' };

const SKILL_DIR = path.join('.claude', 'skills', 'author-lesson');

/** Built-in lesson contract (PLAN §7.2), used until the author-lesson skill ships references/lesson-contract.md. */
export const BUILTIN_CONTRACT = `# risepath.lesson/v1 lesson contract

## Structure
- objectives: 2–4 observable outcomes, each with an id and a Bloom level.
- Section 1, role "hook": a real problem plus a predict question (quiz mode "predict", not graded).
- 3–5 segments (role "concept" / "example"): explanation of at most 300 JP characters, a diagram only when it has a purpose, a worked example of 3–6 steps, 1–2 inline check questions (quiz mode "inline"), at most 1 common pitfall.
- Try it (role "practice"): a task with 3 levels of hints and a model answer.
- Recap (role "check"): questions that cover every objective; at least 1 asks the learner to apply the idea.
- role "summary": a summary block with 3 points, plus 4–8 flashcards.
- role "reflection": 1 question.

## Limits
- A sentence is at most 60 JP characters; a paragraph at most 160 JP characters (80 EN words).
- Body text 1,200–2,400 JP characters in total; at most 3 new terms per segment.
- No decorative or stock images.

## Questions
- Every question has an objectiveId.
- Every wrong option maps to a real misconception and has feedback of at most 2 sentences that corrects it.
- Do not quiz on analogies or trivia.

## Style (jp)
- です・ます調.
- On first use, give the English for a katakana term, e.g. 参照（reference）.
- Never write 「簡単です」 or 「誰でも」 (en: "simply", "obviously", "anyone can").

## Locales
- Locale keys are jp | en | fr (not "ja").
- In a multi-locale lesson every learner-facing text is an object with every declared locale.
- Instructions to an AI go in "prompt" blocks; code blocks have a filename.`;

/** Built-in author-lesson procedure, used when .claude/skills/author-lesson/SKILL.md is absent. */
export const BUILTIN_AUTHOR_PROMPT = `# Author a Rise Path lesson (risepath.lesson/v1)

You write one lesson as JSON in risepath.lesson/v1. You save drafts only; a human reviews and publishes.

1. Call lesson-schema-get (profile "llm"). Read the contract and the exemplar. If the lesson already exists, call lesson-get and keep its hash.
2. Restate the brief: audience, prerequisites, and 2–4 objectives with Bloom levels. Ask at most one question if something essential is missing.
3. Outline the sections: hook → 3–5 segments → practice → check → summary → reflection. Map every objective to at least one check question.
4. Write the lesson section by section, following the contract.
5. Call lesson-validate. Fix every error (each has a path to the field). Fix lint warnings unless you have a reason not to.
6. Call lesson-upsert-draft with course_slug and the lesson. Pass base_hash when you update an existing lesson. On a conflict, call lesson-get, merge and retry.
7. Call lesson-preview-url and reply with the URL and a short report: objectives, open questions, remaining warnings.`;

const MCP_TOOL_MAPPING = `## Using the Rise Path MCP tools
Outside Claude Code, use these tools in place of files and npm scripts:
- lesson-schema-get: the JSON Schema, this contract and the exemplar lesson.
- lesson-validate: replaces \`npm run lessons:validate\` and \`npm run lessons:lint\`.
- lesson-get: read a lesson or draft (returns its hash).
- lesson-upsert-draft: replaces writing content/courses/<slug>/drafts/<id>.lesson.json.
- lesson-preview-url: replaces \`npm run lessons:preview\`.`;

// ============================================================
// Helpers
// ============================================================

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @returns {'fs'|'db'} */
export function resolveLessonStore(env = process.env) {
    return String(env.RP_LESSON_STORE || '').trim().toLowerCase() === 'db' ? 'db' : 'fs';
}

export function resolveContentDir(contentDir) {
    return path.resolve(contentDir || process.env.RP_CONTENT_DIR || path.join(REPO_ROOT, 'content'));
}

/**
 * @returns {{ error: string, error_type: string } | null}
 */
export function checkSlug(value, label) {
    if (typeof value !== 'string' || !SAFE_SLUG.test(value) || value.length > MAX_SLUG_LENGTH) {
        return {
            error: `Invalid ${label} ${JSON.stringify(value)}: use lowercase letters, digits and "-" (must start with a letter or digit, at most ${MAX_SLUG_LENGTH} characters).`,
            error_type: 'validation',
        };
    }
    return null;
}

/** Content hash used for optimistic locking (sha256 of canonical JSON, 16 hex chars). */
export function hashLesson(lesson) {
    return crypto.createHash('sha256').update(canonicalJson(lesson)).digest('hex').slice(0, 16);
}

/** Same lesson apart from the save timestamp. */
function sameContent(a, b) {
    const strip = (lesson) => {
        if (!isPlainObject(lesson) || !isPlainObject(lesson.provenance)) return lesson;
        const { generatedAt: _generatedAt, ...provenance } = lesson.provenance;
        return { ...lesson, provenance };
    };
    return canonicalJson(strip(a)) === canonicalJson(strip(b));
}

function cleanClientName(name) {
    return typeof name === 'string'
        ? name.replace(/[^\w.@+-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
        : '';
}

/**
 * Fill what the server owns before validation: schema, courseId, provenance.author and
 * provenance.generatedAt. A draft is never reviewed, so provenance.reviewedBy is removed.
 *
 * @returns {{ lesson: object, stamped: string[] }}
 */
export function stampDraft(lesson, { courseSlug, clientName, now = new Date() } = {}) {
    const out = structuredClone(lesson);
    const stamped = [];
    if (out.schema === undefined) {
        out.schema = LESSON_SCHEMA_ID;
        stamped.push('schema');
    }
    if (courseSlug && out.courseId === undefined) {
        out.courseId = courseSlug;
        stamped.push('courseId');
    }
    const provenance = isPlainObject(out.provenance) ? { ...out.provenance } : {};
    if (typeof provenance.author !== 'string' || provenance.author.trim() === '') {
        const client = cleanClientName(clientName);
        provenance.author = client ? `mcp:${client}` : 'mcp';
        stamped.push('provenance.author');
    }
    provenance.generatedAt = now.toISOString();
    stamped.push('provenance.generatedAt');
    if ('reviewedBy' in provenance) {
        delete provenance.reviewedBy;
        stamped.push('provenance.reviewedBy (removed)');
    }
    out.provenance = provenance;
    return { lesson: out, stamped };
}

async function readJsonFile(file) {
    let raw;
    try {
        raw = await fs.readFile(file, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
    return JSON.parse(raw);
}

async function exists(file) {
    return fs.stat(file).then(() => true, () => false);
}

async function listLessonIds(dir) {
    const entries = await fs.readdir(dir).catch(() => []);
    return entries
        .filter((name) => name.endsWith('.lesson.json'))
        .map((name) => name.slice(0, -'.lesson.json'.length))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/**
 * File locations of one lesson. Throws when a path would leave content/courses/
 * (the slug check already prevents it; this is the second guard).
 */
function lessonPaths(contentDir, courseSlug, lessonId) {
    const coursesDir = path.join(contentDir, 'courses');
    const courseDir = path.resolve(coursesDir, courseSlug);
    const files = {
        courseDir,
        courseFile: path.join(courseDir, 'course.json'),
        draftsDir: path.join(courseDir, 'drafts'),
        draft: lessonId ? path.join(courseDir, 'drafts', `${lessonId}.lesson.json`) : null,
        lesson: lessonId ? path.join(courseDir, 'lessons', `${lessonId}.lesson.json`) : null,
    };
    for (const file of Object.values(files)) {
        if (file && !file.startsWith(coursesDir + path.sep)) {
            throw new Error(`Path escapes content/courses: ${file}`);
        }
    }
    return files;
}

/** Repo-style path for reports, independent of RP_CONTENT_DIR. */
const displayPath = (courseSlug, folder, lessonId) => `content/courses/${courseSlug}/${folder}/${lessonId}.lesson.json`;

async function loadCourse(contentDir, courseSlug) {
    if (!courseSlug) return null;
    const { courseFile } = lessonPaths(contentDir, courseSlug, null);
    return readJsonFile(courseFile).catch(() => null);
}

// Writes to the same draft file run one at a time (read → check hash → write).
const fileLocks = new Map();
async function withFileLock(key, fn) {
    const previous = fileLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const chained = previous.then(() => current);
    fileLocks.set(key, chained);
    await previous;
    try {
        return await fn();
    } finally {
        release();
        if (fileLocks.get(key) === chained) fileLocks.delete(key);
    }
}

async function writeFileAtomic(file, text) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    try {
        await fs.rename(tmp, file);
    } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
    }
}

// ============================================================
// lesson-schema-get
// ============================================================

const schemaCache = new Map();

/** JSON Schema of risepath.lesson/v1 ('llm': no recursion, stricter required fields). */
export function getLessonJsonSchema(profile = 'llm') {
    const key = profile === 'full' ? 'full' : 'llm';
    if (!schemaCache.has(key)) schemaCache.set(key, lessonJsonSchema({ profile: key }));
    return schemaCache.get(key);
}

async function readSkillFile(root, relative) {
    const file = path.join(root, SKILL_DIR, relative);
    try {
        return { text: await fs.readFile(file, 'utf8'), source: path.posix.join('.claude/skills/author-lesson', relative) };
    } catch {
        return null;
    }
}

/** The lesson contract: the skill's references/lesson-contract.md when present, else the built-in text. */
export async function getLessonContract({ root = REPO_ROOT } = {}) {
    const file = await readSkillFile(root, path.join('references', 'lesson-contract.md'));
    if (file?.text.trim()) return { source: file.source, text: file.text.trim() };
    return { source: 'builtin', text: BUILTIN_CONTRACT };
}

/** One section per role, in order: a smaller exemplar that still shows every role it uses. */
function exemplarExcerpt(lesson) {
    const seen = new Set();
    const kept = [];
    const omitted = [];
    for (const section of lesson.sections || []) {
        const role = section.role || 'none';
        if (seen.has(role)) {
            omitted.push(section.id);
            continue;
        }
        seen.add(role);
        kept.push(section);
    }
    return { lesson: { ...lesson, sections: kept }, omitted };
}

/**
 * Schema, contract and exemplar for an LLM that is about to write a lesson.
 *
 * @param {Object} [params]
 * @param {'llm'|'full'} [params.profile]
 * @param {'excerpt'|'full'|'none'} [params.exemplar]
 * @param {string} [params.contentDir]
 * @param {string} [params.root] - repo root holding .claude/skills
 */
export async function getLessonSchema({ profile = 'llm', exemplar = 'excerpt', contentDir, root = REPO_ROOT } = {}) {
    try {
        const resolvedProfile = profile === 'full' ? 'full' : 'llm';
        const contract = await getLessonContract({ root });
        const result = {
            schema_id: LESSON_SCHEMA_ID,
            profile: resolvedProfile,
            json_schema: getLessonJsonSchema(resolvedProfile),
            contract,
            rules: {
                draft_ids: 'course_slug and lesson.id must match ^[a-z0-9][a-z0-9-]*$ (the id is the draft file name).',
                locales: 'jp | en | fr; a plain string is in lesson.locale.',
                block_types: BLOCK_TYPES,
                section_roles: SECTION_ROLES,
                server_fills: ['schema', 'courseId', 'provenance.author', 'provenance.generatedAt'],
            },
            workflow: ['lesson-schema-get', 'lesson-get (when editing)', 'lesson-validate', 'lesson-upsert-draft', 'lesson-preview-url'],
        };

        if (exemplar !== 'none') {
            const dir = resolveContentDir(contentDir);
            const { lesson: file } = lessonPaths(dir, EXEMPLAR.courseSlug, EXEMPLAR.lessonId);
            const lesson = await readJsonFile(file).catch(() => null);
            if (lesson) {
                // Show the provenance a new draft has (migration bookkeeping is not in the LLM schema).
                lesson.provenance = { author: lesson.provenance?.author || 'human', generatedAt: lesson.provenance?.generatedAt };
                const excerpt = exemplar === 'full' ? { lesson, omitted: [] } : exemplarExcerpt(lesson);
                result.exemplar = {
                    course_slug: EXEMPLAR.courseSlug,
                    lesson_id: EXEMPLAR.lessonId,
                    kind: exemplar === 'full' ? 'full' : 'excerpt',
                    omitted_sections: excerpt.omitted,
                    note: excerpt.omitted.length > 0
                        ? `First section of each role only. lesson-get ${EXEMPLAR.courseSlug}/${EXEMPLAR.lessonId} returns the whole lesson.`
                        : undefined,
                    lesson: excerpt.lesson,
                };
            }
        }
        return result;
    } catch (err) {
        return { error: `Failed to build lesson schema: ${err.message}`, error_type: 'exception' };
    }
}

// ============================================================
// lesson-validate
// ============================================================

/**
 * Validate (zod + semantic checks) and lint a lesson without saving it.
 * With stamp, the server-owned fields are filled first, exactly as lesson-upsert-draft
 * does, so a lesson that passes here also passes the upsert.
 *
 * @param {object} lesson
 * @param {Object} [options]
 * @param {string} [options.courseSlug] - validate next links and sources against this course
 * @param {boolean} [options.stamp]
 * @param {string} [options.contentDir]
 * @param {string} [options.clientName]
 */
export async function validateLessonDraft(lesson, { courseSlug, stamp = true, contentDir, clientName } = {}) {
    if (!isPlainObject(lesson)) {
        return { ok: false, errors: [{ path: '', message: 'The lesson must be a JSON object.' }], warnings: [] };
    }
    if (courseSlug) {
        const bad = checkSlug(courseSlug, 'course_slug');
        if (bad) return bad;
    }
    const dir = resolveContentDir(contentDir);
    const course = await loadCourse(dir, courseSlug);
    const prepared = stamp ? stampDraft(lesson, { courseSlug, clientName }) : { lesson, stamped: [] };
    const result = validateLesson(prepared.lesson, { course });
    const warnings = result.lesson ? lintLesson(result.lesson).warnings : [];

    return {
        ok: result.ok,
        errors: result.errors,
        warnings,
        lint_skipped: !result.lesson,
        stamped: prepared.stamped,
        course_checked: Boolean(course),
        stats: result.lesson ? lessonStats(result.lesson) : undefined,
    };
}

// ============================================================
// lesson-get
// ============================================================

/**
 * Read a lesson. Files: the draft first, then the published lesson (source 'auto').
 * With curriculumId, read the current DB version owned by userId instead. In the db store
 * (RP_LESSON_STORE=db) without curriculumId, userId's DB draft of courseSlug/lessonId comes
 * first, so the hash it returns is the one lesson-upsert-draft checks.
 *
 * @param {Object} params
 * @param {string} [params.courseSlug]
 * @param {string} [params.lessonId]
 * @param {'auto'|'draft'|'published'} [params.source]
 * @param {string} [params.curriculumId]
 * @param {string} [params.userId]
 * @param {'fs'|'db'} [params.store] - defaults to RP_LESSON_STORE
 * @param {string} [params.contentDir]
 */
export async function getLesson({ courseSlug, lessonId, source = 'auto', curriculumId, userId, store, contentDir } = {}) {
    if (curriculumId) return getLessonFromDb({ curriculumId, userId });

    const bad = checkSlug(courseSlug, 'course_slug') || checkSlug(lessonId, 'lesson_id');
    if (bad) return bad;

    if ((store || resolveLessonStore()) === 'db' && userId && source !== 'published') {
        const pool = getPool();
        if (pool) {
            try {
                const found = await findDbDraft(pool, { userId, courseSlug, lessonId });
                if (found) return getLessonFromDb({ curriculumId: found.id, userId });
            } catch (err) {
                return classifyDbError(err, 'getLesson');
            }
        }
    }

    try {
        const dir = resolveContentDir(contentDir);
        const files = lessonPaths(dir, courseSlug, lessonId);
        const order = source === 'draft' ? ['draft'] : source === 'published' ? ['lesson'] : ['draft', 'lesson'];

        for (const kind of order) {
            const lesson = await readJsonFile(files[kind]);
            if (lesson) {
                return {
                    course_slug: courseSlug,
                    lesson_id: lessonId,
                    source: kind === 'draft' ? 'draft' : 'published',
                    path: displayPath(courseSlug, kind === 'draft' ? 'drafts' : 'lessons', lessonId),
                    hash: hashLesson(lesson),
                    has_draft: kind === 'draft' || await exists(files.draft),
                    lesson,
                };
            }
        }

        if (!(await exists(files.courseDir))) {
            const courses = await fs.readdir(path.join(dir, 'courses')).catch(() => []);
            return {
                error: `Course "${courseSlug}" not found`,
                error_type: 'not_found',
                available_courses: courses.filter((name) => SAFE_SLUG.test(name)).sort(),
            };
        }
        return {
            error: `Lesson "${lessonId}" not found in course "${courseSlug}" (${source})`,
            error_type: 'not_found',
            available: {
                lessons: await listLessonIds(path.join(files.courseDir, 'lessons')),
                drafts: await listLessonIds(files.draftsDir),
            },
        };
    } catch (err) {
        if (err instanceof SyntaxError) {
            return { error: `Lesson file is not valid JSON: ${err.message}`, error_type: 'validation' };
        }
        return { error: `Failed to read lesson: ${err.message}`, error_type: 'exception' };
    }
}

/**
 * The user's DB draft of courseSlug/lessonId (the curricula row lesson-upsert-draft created),
 * newest first. `lock` takes a row lock inside a transaction.
 * @returns {Promise<{ id: string, content_json: any } | null>}
 */
async function findDbDraft(db, { userId, courseSlug, lessonId, lock = false }) {
    const result = await db.query(
        `select c.id as curriculum_id, v.content_json
         from curricula c
         join curriculum_versions v on v.id = c.current_version_id
         where c.user_id = CAST($1 AS uuid)
           and c.ui_template_id = $2
           and v.ui_hints->>'course_slug' = $3
           and v.ui_hints->>'lesson_id' = $4
         order by c.updated_at desc
         limit 1${lock ? '\n         for update of c' : ''}`,
        [userId, LESSON_UI_TEMPLATE_ID, courseSlug, lessonId]
    );
    const row = result.rowCount ? result.rows[0] : null;
    return row ? { id: row.curriculum_id, content_json: row.content_json } : null;
}

async function getLessonFromDb({ curriculumId, userId }) {
    if (!UUID_PATTERN.test(String(curriculumId))) {
        return { error: `Invalid curriculum_id ${JSON.stringify(curriculumId)} (expected a UUID)`, error_type: 'validation' };
    }
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    try {
        const result = await pool.query(
            `select c.id, v.id as version_id, v.version, v.status, v.content_json, v.updated_at
             from curricula c
             join curriculum_versions v on v.id = c.current_version_id
             where c.id = CAST($1 AS uuid) and c.user_id = CAST($2 AS uuid)`,
            [curriculumId, userId]
        );
        if (!result.rowCount) {
            return { error: `Curriculum ${curriculumId} not found or not owned by user`, error_type: 'not_found' };
        }
        const row = result.rows[0];
        if (row.content_json?.schema !== LESSON_SCHEMA_ID) {
            return {
                error: `Curriculum ${curriculumId} is not a ${LESSON_SCHEMA_ID} draft`,
                error_type: 'validation',
            };
        }
        return {
            curriculum_id: row.id,
            curriculum_version_id: row.version_id,
            version: row.version,
            status: row.status,
            source: 'db',
            course_slug: row.content_json.courseId,
            lesson_id: row.content_json.id,
            hash: hashLesson(row.content_json),
            lesson: row.content_json,
        };
    } catch (err) {
        return classifyDbError(err, 'getLesson');
    }
}

// ============================================================
// lesson-upsert-draft
// ============================================================

function conflict(currentHash, baseHash, detail) {
    return {
        error: `Conflict: ${detail}`,
        error_type: 'conflict',
        current_hash: currentHash,
        base_hash: baseHash ?? null,
        hint: 'Call lesson-get, merge your change into the returned lesson, then retry with base_hash set to its hash.',
    };
}

/**
 * Optimistic lock: creating needs nothing there (and no base_hash); updating needs
 * base_hash equal to the hash of what is there now.
 */
function checkBase(currentHash, baseHash) {
    if (currentHash == null) {
        return baseHash ? conflict(null, baseHash, 'base_hash was given but there is no lesson or draft to update.') : null;
    }
    if (!baseHash) {
        return conflict(currentHash, baseHash, 'a version already exists; pass base_hash from lesson-get to replace it.');
    }
    if (baseHash !== currentHash) {
        return conflict(currentHash, baseHash, 'the lesson changed since you read it.');
    }
    return null;
}

/**
 * Validate and save a lesson draft. Never touches published lessons.
 *
 * @param {Object} params
 * @param {string} params.courseSlug
 * @param {object} params.lesson - risepath.lesson/v1 JSON
 * @param {string} [params.baseHash] - hash from lesson-get (required to replace an existing version)
 * @param {string} [params.curriculumId] - DB draft to add a version to (implies the db store)
 * @param {string} [params.userId] - owner for the db store
 * @param {'fs'|'db'} [params.store]
 * @param {string} [params.clientName] - MCP client name for provenance.author
 * @param {boolean} [params.allowFsWrite] - false refuses file writes (remote production server)
 * @param {string} [params.contentDir]
 * @param {Date} [params.now]
 */
export async function upsertLessonDraft({
    courseSlug, lesson, baseHash, curriculumId, userId, store, clientName,
    allowFsWrite = true, contentDir, now = new Date(),
} = {}) {
    const badSlug = checkSlug(courseSlug, 'course_slug');
    if (badSlug) return badSlug;
    if (!isPlainObject(lesson)) {
        return { error: 'lesson must be a JSON object', error_type: 'validation' };
    }
    const size = Buffer.byteLength(JSON.stringify(lesson), 'utf8');
    if (size > MAX_LESSON_BYTES) {
        return { error: `Lesson is ${Math.round(size / 1024)} KB; the limit is ${MAX_LESSON_BYTES / 1024} KB. Split it into smaller lessons.`, error_type: 'validation' };
    }
    const badId = checkSlug(lesson.id, 'lesson.id');
    if (badId) return { ...badId, errors: [{ path: 'id', message: badId.error }] };
    if (lesson.courseId !== undefined && lesson.courseId !== courseSlug) {
        const message = `courseId "${lesson.courseId}" does not match course_slug "${courseSlug}".`;
        return { error: message, error_type: 'validation', errors: [{ path: 'courseId', message }] };
    }

    const dir = resolveContentDir(contentDir);
    const { lesson: draft, stamped } = stampDraft(lesson, { courseSlug, clientName, now });
    const course = await loadCourse(dir, courseSlug);
    const validation = validateLesson(draft, { course });
    if (!validation.ok) {
        return {
            error: 'Lesson validation failed; nothing was saved',
            error_type: 'validation',
            errors: validation.errors,
        };
    }
    const warnings = lintLesson(validation.lesson).warnings;
    const resolvedStore = curriculumId ? 'db' : (store || resolveLessonStore());

    if (resolvedStore === 'db') {
        return upsertDbDraft({ dir, courseSlug, draft, baseHash, curriculumId, userId, warnings, stamped });
    }
    if (!allowFsWrite) {
        return {
            error: 'File drafts are disabled on this server. Set RP_LESSON_STORE=db to store drafts in the database.',
            error_type: 'store_unavailable',
        };
    }
    return upsertFsDraft({ dir, courseSlug, draft, baseHash, warnings, stamped, courseExists: Boolean(course) });
}

async function upsertFsDraft({ dir, courseSlug, draft, baseHash, warnings, stamped, courseExists }) {
    const lessonId = draft.id;
    let files;
    try {
        files = lessonPaths(dir, courseSlug, lessonId);
    } catch (err) {
        return { error: err.message, error_type: 'validation' };
    }

    return withFileLock(files.draft, async () => {
        try {
            const currentDraft = await readJsonFile(files.draft);
            const current = currentDraft ?? await readJsonFile(files.lesson);
            const currentHash = current ? hashLesson(current) : null;
            const base = {
                course_slug: courseSlug,
                lesson_id: lessonId,
                store: 'fs',
                path: displayPath(courseSlug, 'drafts', lessonId),
            };

            if (currentDraft && sameContent(currentDraft, draft)) {
                return { ok: true, action: 'unchanged', ...base, hash: currentHash, previous_hash: currentHash, warnings, stamped: [] };
            }
            const clash = checkBase(currentHash, baseHash);
            if (clash) return { ...clash, current_source: currentDraft ? 'draft' : current ? 'published' : null };

            await writeFileAtomic(files.draft, `${JSON.stringify(draft, null, 2)}\n`);
            return {
                ok: true,
                action: currentDraft ? 'updated' : 'created',
                ...base,
                based_on: currentDraft ? 'draft' : current ? 'published' : null,
                hash: hashLesson(draft),
                previous_hash: currentHash,
                warnings,
                stamped,
                ...(courseExists ? {} : { note: `content/courses/${courseSlug}/course.json does not exist yet; add the lesson to a course before publishing.` }),
            };
        } catch (err) {
            if (err instanceof SyntaxError) {
                return { error: `Existing draft is not valid JSON: ${err.message}`, error_type: 'validation' };
            }
            return { error: `Failed to save draft: ${err.message}`, error_type: 'exception' };
        }
    });
}

async function upsertDbDraft({ dir, courseSlug, draft, baseHash, curriculumId, userId, warnings, stamped }) {
    if (curriculumId && !UUID_PATTERN.test(String(curriculumId))) {
        return { error: `Invalid curriculum_id ${JSON.stringify(curriculumId)} (expected a UUID)`, error_type: 'validation' };
    }
    if (!userId) return { error: 'A user is required to store drafts in the database', error_type: 'session_binding_required' };
    const pool = getPool();
    if (!pool) return { error: 'DB not configured (RP_LESSON_STORE=db)', error_type: 'db_connection' };

    const locale = draft.locale || 'jp';
    const title = t(draft.title, locale, locale) || draft.id;
    const description = t(draft.subtitle, locale, locale);
    let client = null;

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Without curriculum_id, the user's existing DB draft of this lesson is the one to update
        // (so a second upsert does not create a second curricula row).
        if (!curriculumId) {
            const found = await findDbDraft(client, { userId, courseSlug, lessonId: draft.id, lock: true });
            if (found) curriculumId = found.id;
        }

        // A new DB draft of a published lesson cites the published hash, as in the fs store.
        let currentHash = null;
        if (!curriculumId) {
            const published = await readJsonFile(lessonPaths(dir, courseSlug, draft.id).lesson);
            if (published) currentHash = hashLesson(published);
        } else {
            const existing = await client.query(
                `select c.id, v.content_json
                 from curricula c
                 left join curriculum_versions v on v.id = c.current_version_id
                 where c.id = CAST($1 AS uuid) and c.user_id = CAST($2 AS uuid)
                 for update of c`,
                [curriculumId, userId]
            );
            if (!existing.rowCount) {
                await client.query('ROLLBACK');
                return { error: `Curriculum ${curriculumId} not found or not owned by user`, error_type: 'not_found' };
            }
            const current = existing.rows[0].content_json;
            if (current && current.schema !== LESSON_SCHEMA_ID) {
                await client.query('ROLLBACK');
                return { error: `Curriculum ${curriculumId} is not a ${LESSON_SCHEMA_ID} draft`, error_type: 'validation' };
            }
            if (current) {
                currentHash = hashLesson(current);
                if (sameContent(current, draft)) {
                    await client.query('ROLLBACK');
                    return {
                        ok: true, action: 'unchanged', store: 'db', curriculum_id: curriculumId,
                        course_slug: courseSlug, lesson_id: draft.id,
                        hash: currentHash, previous_hash: currentHash, warnings, stamped: [],
                    };
                }
            }
        }

        const clash = checkBase(currentHash, baseHash);
        if (clash) {
            await client.query('ROLLBACK');
            return clash;
        }

        const saved = await writeCurriculumVersion(client, {
            curriculumId,
            userId,
            title,
            description,
            uiTemplateId: LESSON_UI_TEMPLATE_ID,
            content: draft,
            uiHints: { format: LESSON_SCHEMA_ID, course_slug: courseSlug, lesson_id: draft.id, source: 'mcp' },
            totalLessons: 1,
            modelUsed: typeof draft.provenance?.model === 'string' ? draft.provenance.model : null,
        });
        await client.query('COMMIT');

        return {
            ok: true,
            action: curriculumId ? 'updated' : 'created',
            store: 'db',
            course_slug: courseSlug,
            lesson_id: draft.id,
            curriculum_id: saved.curriculumId,
            curriculum_version_id: saved.curriculumVersionId,
            version: saved.version,
            status: saved.status,
            hash: hashLesson(draft),
            previous_hash: currentHash,
            warnings,
            stamped,
        };
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return classifyDbError(err, 'upsertLessonDraft');
    } finally {
        client?.release();
    }
}

// ============================================================
// lesson-preview-url
// ============================================================

/**
 * Preview URLs for a lesson. /preview/ is a dev-only route of the Vite app (npm run dev)
 * that shows drafts and the validation report; /learn/ shows published lessons.
 *
 * @param {Object} params
 * @param {string} params.courseSlug
 * @param {string} params.lessonId
 * @param {string} [params.baseUrl] - defaults to RISE_PATH_PREVIEW_BASE_URL or http://localhost:3007
 * @param {string} [params.contentDir]
 */
export async function previewUrl({ courseSlug, lessonId, baseUrl, contentDir } = {}) {
    const bad = checkSlug(courseSlug, 'course_slug') || checkSlug(lessonId, 'lesson_id');
    if (bad) return bad;

    const base = String(baseUrl || process.env.RISE_PATH_PREVIEW_BASE_URL || 'http://localhost:3007').replace(/\/+$/, '');
    const files = lessonPaths(resolveContentDir(contentDir), courseSlug, lessonId);
    const [hasDraft, hasLesson] = await Promise.all([exists(files.draft), exists(files.lesson)]);

    return {
        course_slug: courseSlug,
        lesson_id: lessonId,
        preview_url: `${base}/preview/${courseSlug}/${lessonId}`,
        learn_url: hasLesson ? `${base}/learn/${courseSlug}/${lessonId}` : null,
        exists: { draft: hasDraft, published: hasLesson },
        dev_only: true,
        note: hasDraft || hasLesson
            ? 'The /preview route runs only in the dev server (npm run dev) and shows the draft when one exists.'
            : 'Nothing to preview yet: save a draft with lesson-upsert-draft first.',
        screenshot_command: `npm run lessons:preview -- ${courseSlug} ${lessonId}`,
    };
}

// ============================================================
// author-lesson prompt
// ============================================================

function stripFrontmatter(text) {
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/**
 * Text of the author-lesson MCP prompt: the Claude Code skill body when
 * .claude/skills/author-lesson/SKILL.md exists, else the built-in procedure,
 * plus the MCP tool mapping and the arguments.
 *
 * @param {Object} [params]
 * @param {string} [params.courseSlug]
 * @param {string} [params.lessonId]
 * @param {string} [params.brief]
 * @param {string} [params.root]
 * @returns {Promise<{ source: string, text: string }>}
 */
export async function buildAuthorLessonPrompt({ courseSlug, lessonId, brief, root = REPO_ROOT } = {}) {
    const skill = await readSkillFile(root, 'SKILL.md');
    const args = [courseSlug, lessonId, brief].filter(Boolean).join(' ');
    let body;
    let source;
    if (skill?.text.trim()) {
        source = skill.source;
        body = stripFrontmatter(skill.text)
            // Claude Code shell injection (!`cmd`) means nothing to other clients; show the command instead.
            .replace(/!`([^`]+)`/g, '`$1`')
            // A replacer function: "$'", "$&" or "$$" in the brief stay literal text.
            .replace(/\$ARGUMENTS\b/g, () => args || '(none)')
            .trim();
    } else {
        source = 'builtin';
        body = BUILTIN_AUTHOR_PROMPT;
    }

    const request = [
        '## Request',
        `- course_slug: ${courseSlug || '(ask the user)'}`,
        `- lesson_id: ${lessonId || '(choose one: lowercase letters, digits and "-")'}`,
        `- brief: ${brief || '(ask the user)'}`,
    ].join('\n');

    return { source, text: [body, MCP_TOOL_MAPPING, request].join('\n\n') };
}
