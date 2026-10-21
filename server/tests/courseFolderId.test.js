// Course id and folder name stay one key: the reader saves progress under the folder name
// (courseSlug), while lesson links, tutor requests and course.json use course.id. The validator
// enforces id === folder, and the track totals read progress by the slug.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCourse } from '../../shared/lesson/validate.js';
import { validateFile } from '../../scripts/lessons/validate.mjs';
import { courseTotals } from '../../components/ui/lessonResume.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COURSES = path.join(ROOT, 'content/courses');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const course = readJson(path.join(COURSES, 'vibe-coding/course.json'));

describe('course id matches its folder', () => {
    it('reports a path-addressed error when the id and the folder differ', () => {
        const result = validateCourse({ ...course, id: 'vibe' }, { folder: 'vibe-coding' });
        assert.equal(result.ok, false);
        const idErrors = result.errors.filter((e) => e.path === 'id');
        assert.equal(idErrors.length, 1);
        assert.match(idErrors[0].message, /"vibe".*folder "vibe-coding"/);
    });

    it('accepts a matching id, and skips the check without a folder', () => {
        assert.deepEqual(validateCourse(course, { folder: 'vibe-coding' }).errors, []);
        assert.deepEqual(validateCourse({ ...course, id: 'vibe' }).errors, []);
    });

    it('holds for every course in content/courses', () => {
        for (const folder of fs.readdirSync(COURSES)) {
            const file = path.join(COURSES, folder, 'course.json');
            if (!fs.existsSync(file)) continue;
            assert.deepEqual(validateCourse(readJson(file), { folder }).errors.filter((e) => e.path === 'id'), [], folder);
        }
    });

    it('lessons:validate passes the folder name, and reports the mismatch once', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-course-'));
        try {
            const folder = path.join(dir, 'renamed-course');
            fs.mkdirSync(path.join(folder, 'lessons'), { recursive: true });
            fs.writeFileSync(path.join(folder, 'course.json'), JSON.stringify(course));
            const result = await validateFile(path.join(folder, 'course.json'));
            assert.equal(result.ok, false);
            const idErrors = result.errors.filter((e) => e.path === 'id');
            assert.equal(idErrors.length, 1);
            assert.match(idErrors[0].message, /folder "renamed-course"/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('track totals read progress by course slug', () => {
    it('looks up saved summaries under the slug it is given', () => {
        const seen = new Set();
        const renamed = { ...course, id: 'vibe' };
        const totals = courseTotals(renamed, (slug, id) => {
            seen.add(slug);
            return slug === 'vibe-coding' && id === 'vibe-ch1' ? { pct: 60, state: 'in_progress' } : null;
        }, 'vibe-coding');
        assert.deepEqual([...seen], ['vibe-coding']);
        assert.equal(totals.started, 1);
    });

    it('every app call site passes the folder slug (not course.id) to courseTotals', () => {
        const files = ['components/features/programming/CoursePathView.tsx', 'components/features/dashboard/MissionControlDashboard.tsx'];
        let calls = 0;
        for (const file of files) {
            const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
            for (const [call] of source.matchAll(/courseTotals\([^;]*?\)/g)) {
                calls += 1;
                // A slug constant, or the course page's courseSlug prop (the folder name, as in its /learn links).
                assert.match(call, /courseTotals\(\s*\w+\s*,\s*readLessonSummary\s*,\s*(?:[A-Z_]+|courseSlug)\s*\)/, `${file}: ${call}`);
            }
        }
        // The course page, plus the dashboard's Vibe Coding and Claude Code track cards.
        assert.equal(calls, 3);
    });

    it('defaults to course.id, which the validator keeps equal to the folder', () => {
        const seen = new Set();
        courseTotals(course, (slug) => {
            seen.add(slug);
            return null;
        });
        assert.deepEqual([...seen], ['vibe-coding']);
    });
});
