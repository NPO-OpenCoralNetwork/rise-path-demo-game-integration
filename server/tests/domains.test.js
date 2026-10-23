// Learning domains (tools/core/domains.js): the vibe-coding and claude-code stage counts follow their
// course.json, so mastery reaches 1 only when every published lesson is complete.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COURSES_DIR, DOMAINS, DOMAIN_COURSE_SLUGS, DOMAIN_MAX_STAGES, calculateMastery, countCourseLessons } from '../../tools/core/domains.js';

const vibeCourseFile = path.join(COURSES_DIR, 'vibe-coding', 'course.json');
const vibeCourse = JSON.parse(fs.readFileSync(vibeCourseFile, 'utf8'));
const vibeLessonCount = vibeCourse.modules.reduce((sum, module) => sum + module.lessons.length, 0);
const ccCourseFile = path.join(COURSES_DIR, 'claude-code', 'course.json');
const ccCourse = JSON.parse(fs.readFileSync(ccCourseFile, 'utf8'));
const ccLessonCount = ccCourse.modules.reduce((sum, module) => sum + module.lessons.length, 0);

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

    it('claude-code maxStages equals the lesson count in course.json', () => {
        assert.ok(ccLessonCount >= 11, `course lists ${ccLessonCount} lessons`);
        assert.equal(countCourseLessons(ccCourseFile), ccLessonCount);
        const cc = DOMAINS.find((d) => d.id === 'claude-code');
        assert.ok(cc, 'claude-code domain exists (served by content://domains)');
        assert.equal(cc.maxStages, ccLessonCount);
        assert.equal(DOMAIN_MAX_STAGES['claude-code'], ccLessonCount);
        assert.equal(Object.hasOwn(cc, 'courseSlug'), false, 'internal courseSlug is not exposed');
        assert.ok(calculateMastery(5, 'claude-code') < 1);
        assert.equal(calculateMastery(ccLessonCount, 'claude-code'), 1);
    });

    it('DOMAIN_COURSE_SLUGS names the course of the domains taught by one (content://domains course_slug)', () => {
        assert.deepEqual(DOMAIN_COURSE_SLUGS, { 'vibe-coding': 'vibe-coding', 'claude-code': 'claude-code' });
        assert.ok(Object.isFrozen(DOMAIN_COURSE_SLUGS));
        for (const slug of Object.values(DOMAIN_COURSE_SLUGS)) assert.ok(fs.existsSync(path.join(COURSES_DIR, slug, 'course.json')), slug);
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
