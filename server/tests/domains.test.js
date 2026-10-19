// Learning domains (tools/core/domains.js): the vibe-coding stage count follows its course.json,
// so mastery reaches 1 only when every published lesson is complete.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COURSES_DIR, DOMAINS, DOMAIN_MAX_STAGES, calculateMastery, countCourseLessons } from '../../tools/core/domains.js';

const vibeCourseFile = path.join(COURSES_DIR, 'vibe-coding', 'course.json');
const vibeCourse = JSON.parse(fs.readFileSync(vibeCourseFile, 'utf8'));
const vibeLessonCount = vibeCourse.modules.reduce((sum, module) => sum + module.lessons.length, 0);

describe('domains', () => {
    it('vibe-coding maxStages equals the lesson count in course.json', () => {
        const vibe = DOMAINS.find((d) => d.id === 'vibe-coding');
        assert.ok(vibe, 'vibe-coding domain exists');
        assert.equal(vibe.maxStages, vibeLessonCount);
        assert.equal(DOMAIN_MAX_STAGES['vibe-coding'], vibeLessonCount);
        assert.equal(Object.hasOwn(vibe, 'courseSlug'), false, 'internal courseSlug is not exposed');
    });

    it('mastery stays below 1 until every vibe-coding lesson is complete', () => {
        assert.ok(vibeLessonCount >= 13, `course lists ${vibeLessonCount} lessons`);
        assert.ok(calculateMastery(12, 'vibe-coding') < 1);
        assert.ok(calculateMastery(vibeLessonCount - 1, 'vibe-coding') < 1);
        assert.equal(calculateMastery(vibeLessonCount, 'vibe-coding'), 1);
    });

    it('countCourseLessons returns null for a missing, invalid or empty course file', (t) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-domains-'));
        t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
        assert.equal(countCourseLessons(path.join(dir, 'missing.json')), null);
        const invalid = path.join(dir, 'invalid.json');
        fs.writeFileSync(invalid, '{ not json');
        assert.equal(countCourseLessons(invalid), null);
        const empty = path.join(dir, 'empty.json');
        fs.writeFileSync(empty, JSON.stringify({ modules: [] }));
        assert.equal(countCourseLessons(empty), null);
    });

    it('countCourseLessons counts distinct lesson ids across modules', (t) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-domains-'));
        t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
        const file = path.join(dir, 'course.json');
        fs.writeFileSync(file, JSON.stringify({
            modules: [
                { id: 'm1', lessons: [{ id: 'a' }, { id: 'b' }] },
                { id: 'm2', lessons: [{ id: 'c' }, { id: 'a' }, {}] },
                { id: 'm3' },
            ],
        }));
        assert.equal(countCourseLessons(file), 3);
        assert.equal(countCourseLessons(vibeCourseFile), vibeLessonCount);
    });
});
