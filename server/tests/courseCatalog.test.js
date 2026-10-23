// tools/core/courseCatalog.js: the published lessons the server keeps progress for. Reads
// lessons/ only (never drafts/ or content/examples/), leaves out (and logs once) any course or
// lesson that is missing, invalid or breaks the one id rule, honours RP_CONTENT_DIR, and carries
// the review hash and the progress index of each lesson.
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    clearCatalogCacheForTests,
    getPublishedLesson,
    isPublishedLesson,
    isSafeSlug,
    listPublishedCourses,
    listPublishedLessons,
} from '../../tools/core/courseCatalog.js';
import { lessonHash, lessonHashOfFile } from '../../shared/lesson/hash.js';
import { lessonIndex } from '../../shared/lesson/progressMerge.js';
import { courseLessonIds } from '../../shared/lesson/walk.js';
import { ROOT, publishedLessons } from './helpers/publishedLessons.js';

const COURSES = path.join(ROOT, 'content/courses');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const withWarnings = (fn) => {
    const warnings = [];
    const { warn } = console;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        return { result: fn(), warnings };
    } finally {
        console.warn = warn;
    }
};

describe('courseCatalog: the repository content', () => {
    before(() => {
        delete process.env.RP_CONTENT_DIR;
        clearCatalogCacheForTests();
    });

    it('holds every lesson that course.json lists, in module order, with its review hash and index', () => {
        const { result: lessons, warnings } = withWarnings(() => listPublishedLessons());
        assert.deepEqual(warnings, [], 'the published content is complete and valid');
        const expected = fs.readdirSync(COURSES).sort().flatMap((slug) => courseLessonIds(readJson(path.join(COURSES, slug, 'course.json'))).map((id) => `${slug}/${id}`));
        assert.deepEqual(lessons.map((l) => `${l.courseSlug}/${l.lesson.id}`), expected);
        assert.equal(lessons.length, publishedLessons().length, 'every lessons/ file is listed');
        for (const entry of lessons) {
            const file = path.join(COURSES, entry.courseSlug, 'lessons', `${entry.lesson.id}.lesson.json`);
            assert.equal(entry.hash, lessonHashOfFile(file), `${entry.lesson.id}: the review hash`);
            assert.deepEqual(entry.lesson, readJson(file), 'the raw file, as the web reader bundles it');
            assert.deepEqual(entry.index, lessonIndex(entry.lesson));
            assert.ok(isSafeSlug(entry.courseSlug) && isSafeSlug(entry.lesson.id));
        }
        assert.deepEqual(listPublishedLessons({ courseSlug: 'claude-code' }).map((l) => l.courseSlug), Array(11).fill('claude-code'));
    });

    it('looks lessons up by slug and id; anything else is null', () => {
        assert.equal(getPublishedLesson('vibe-coding', 'vibe-ch1')?.lesson.id, 'vibe-ch1');
        assert.equal(isPublishedLesson('claude-code', 'cc-04-verify'), true);
        for (const [slug, id] of [['vibe-coding', 'vibe-ch99'], ['vibe-coding', 'cc-04-verify'], ['examples', 'blocks-gallery'], ['Vibe-coding', 'vibe-ch1'],
            ['vibe-coding', 'vibe-ch1.5'], ['vibe-coding', '../lessons/vibe-ch1'], [undefined, 'vibe-ch1'], ['vibe-coding', 42], ['vibe-coding', `a${'b'.repeat(80)}`], ['__proto__', 'constructor']]) {
            assert.equal(getPublishedLesson(slug, id), null, `${slug}/${id}`);
            assert.equal(isPublishedLesson(slug, id), false);
        }
    });

    it('lists courses for an AI app in one locale, with sizes and no answers', () => {
        const en = listPublishedCourses({ locale: 'en' });
        assert.deepEqual(en.map((c) => c.course_slug), ['claude-code', 'vibe-coding']);
        const vibe = en.find((c) => c.course_slug === 'vibe-coding');
        assert.equal(vibe.locale, 'en');
        assert.equal(vibe.title, 'Vibe Coding');
        assert.deepEqual(vibe.available_locales, ['jp', 'en']);
        const ch1 = vibe.modules.flatMap((m) => m.lessons).find((l) => l.id === 'vibe-ch1');
        assert.deepEqual(ch1, { id: 'vibe-ch1', title: 'Chapter 1 | Minimum Viable Knowledge', estMinutes: 20, questions: 6, hasExam: true });
        const ch0 = vibe.modules.flatMap((m) => m.lessons).find((l) => l.id === 'vibe-ch0');
        assert.equal(ch0.questions, 0);
        assert.equal(ch0.hasExam, false);
        const cc = en.find((c) => c.course_slug === 'claude-code');
        assert.equal(cc.locale, 'jp', 'a jp-only course falls back to its source locale');
        assert.equal(cc.modules.flatMap((m) => m.lessons).length, 11);
        assert.equal(listPublishedCourses({ locale: 'ja' }).find((c) => c.course_slug === 'vibe-coding').locale, 'jp', 'BCP 47 tags are accepted');
        const text = JSON.stringify(en);
        assert.doesNotMatch(text, /"(answer|explanation|feedback|hint|provenance)"/);
    });
});

describe('courseCatalog: RP_CONTENT_DIR with drafts, broken and non-conforming lessons', () => {
    let dir;
    const saved = process.env.RP_CONTENT_DIR;

    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-catalog-'));
        const src = path.join(COURSES, 'vibe-coding');
        const course = path.join(dir, 'courses', 'vibe-coding');
        fs.mkdirSync(path.join(course, 'lessons'), { recursive: true });
        fs.mkdirSync(path.join(course, 'drafts'), { recursive: true });
        const ch1 = readJson(path.join(src, 'lessons', 'vibe-ch1.lesson.json'));
        const write = (rel, json) => fs.writeFileSync(path.join(course, rel), JSON.stringify(json, null, 2));
        // Published: vibe-ch0 and vibe-ch1 only (the other refs have no file and are left out).
        fs.copyFileSync(path.join(src, 'lessons', 'vibe-ch0.lesson.json'), path.join(course, 'lessons', 'vibe-ch0.lesson.json'));
        write('lessons/vibe-ch1.lesson.json', ch1);
        // A draft of a published lesson is never read; a draft-only lesson is not published.
        write('drafts/vibe-ch1.lesson.json', { ...ch1, title: { jp: '下書き', en: 'DRAFT' } });
        write('drafts/draft-only.lesson.json', { ...ch1, id: 'draft-only' });
        // Listed in course.json but broken: an id the table cannot store, a schema error, a file
        // whose id is not its name, and a file that is not JSON.
        write('lessons/vibe-ch1.5.lesson.json', { ...ch1, id: 'vibe-ch1.5' });
        write('lessons/broken.lesson.json', { ...ch1, id: 'broken', sections: [] });
        write('lessons/wrong-id.lesson.json', { ...ch1, id: 'other-id' });
        fs.writeFileSync(path.join(course, 'lessons', 'not-json.lesson.json'), '{');
        const courseJson = readJson(path.join(src, 'course.json'));
        courseJson.modules.push({
            id: 'mx',
            title: { jp: '追加', en: 'Extra' },
            lessons: ['vibe-ch1.5', 'broken', 'wrong-id', 'not-json', 'draft-only'].map((id) => ({ id, title: { jp: id, en: id } })),
        });
        write('course.json', courseJson);
        // Course folders that are left out: a name the table cannot store, and an id that is not
        // the folder name. content/examples is never read.
        fs.mkdirSync(path.join(dir, 'courses', 'Bad_Folder'), { recursive: true });
        fs.copyFileSync(path.join(course, 'course.json'), path.join(dir, 'courses', 'Bad_Folder', 'course.json'));
        fs.mkdirSync(path.join(dir, 'courses', 'renamed', 'lessons'), { recursive: true });
        fs.copyFileSync(path.join(course, 'course.json'), path.join(dir, 'courses', 'renamed', 'course.json'));
        fs.copyFileSync(path.join(course, 'lessons', 'vibe-ch1.lesson.json'), path.join(dir, 'courses', 'renamed', 'lessons', 'vibe-ch1.lesson.json'));
        fs.mkdirSync(path.join(dir, 'examples'), { recursive: true });
        fs.copyFileSync(path.join(ROOT, 'content/examples/blocks-gallery.lesson.json'), path.join(dir, 'examples', 'blocks-gallery.lesson.json'));
        process.env.RP_CONTENT_DIR = dir;
        clearCatalogCacheForTests();
    });

    after(() => {
        if (saved === undefined) delete process.env.RP_CONTENT_DIR;
        else process.env.RP_CONTENT_DIR = saved;
        clearCatalogCacheForTests();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    afterEach(() => {
        process.env.RP_CONTENT_DIR = dir;
    });

    it('publishes only valid, conforming lessons/ files listed in a valid course, and logs the rest once', () => {
        const { result, warnings } = withWarnings(() => listPublishedLessons());
        assert.deepEqual(result.map((l) => `${l.courseSlug}/${l.lesson.id}`), ['vibe-coding/vibe-ch0', 'vibe-coding/vibe-ch1']);
        assert.equal(getPublishedLesson('vibe-coding', 'vibe-ch1').lesson.title.en, 'Chapter 1 | Minimum Viable Knowledge', 'lessons/, not drafts/');
        for (const expected of ['courses/Bad_Folder', 'courses/renamed/course.json', 'vibe-ch1.5.lesson.json', 'broken.lesson.json', 'wrong-id.lesson.json', 'not-json.lesson.json', 'draft-only.lesson.json', 'vibe-ch2.lesson.json']) {
            assert.ok(warnings.some((w) => w.includes(expected)), `logged: ${expected}`);
        }
        assert.ok(warnings.every((w) => w.startsWith('[courseCatalog] left out: ') && !w.includes(dir)), 'no absolute paths in the log');
        const again = withWarnings(() => [listPublishedLessons(), listPublishedCourses(), getPublishedLesson('vibe-coding', 'broken')]);
        assert.deepEqual(again.warnings, [], 'built once per content directory: logged once');
        assert.equal(again.result[2], null);
        assert.deepEqual(again.result[1].map((c) => c.course_slug), ['vibe-coding']);
        assert.deepEqual(again.result[1][0].modules.map((m) => m.id), ['m1'], 'modules without a published lesson are not listed');
    });

    it('the hash ignores provenance (the review hash) and the catalog follows RP_CONTENT_DIR', () => {
        const entry = withWarnings(() => getPublishedLesson('vibe-coding', 'vibe-ch1')).result;
        assert.equal(entry.hash, lessonHash({ ...entry.lesson, provenance: { author: 'someone-else' } }));
        assert.notEqual(entry.hash, lessonHash({ ...entry.lesson, title: 'changed' }));
        process.env.RP_CONTENT_DIR = path.join(dir, 'nowhere');
        const empty = withWarnings(() => listPublishedLessons());
        assert.deepEqual(empty.result, []);
        assert.equal(empty.warnings.length, 1);
        assert.equal(getPublishedLesson('vibe-coding', 'vibe-ch1'), null);
    });
});
