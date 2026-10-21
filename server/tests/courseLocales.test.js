// Course page language note (CoursePathView): shown only when the UI language is not one of
// the course's locales. The course JSON is the real claude-code and vibe-coding files.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { courseOnlyLocales } from '../../components/features/programming/courseLocales.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const claudeCode = readJson('content/courses/claude-code/course.json');
const vibe = readJson('content/courses/vibe-coding/course.json');

describe('courseOnlyLocales', () => {
  it('names Japanese for the Japanese-only claude-code course in the English UI', () => {
    assert.deepEqual(courseOnlyLocales(claudeCode, 'en'), ['jp']);
    assert.equal(courseOnlyLocales(claudeCode, 'jp'), null);
  });

  it('shows no note for vibe-coding in either UI language', () => {
    assert.equal(courseOnlyLocales(vibe, 'en'), null);
    assert.equal(courseOnlyLocales(vibe, 'jp'), null);
  });

  it('names English for an English-only course in the Japanese UI', () => {
    assert.deepEqual(courseOnlyLocales({ locale: 'en', locales: ['en'] }, 'jp'), ['en']);
  });

  it('falls back to locale when locales is missing or empty', () => {
    assert.deepEqual(courseOnlyLocales({ locale: 'jp' }, 'en'), ['jp']);
    assert.deepEqual(courseOnlyLocales({ locale: 'jp', locales: [] }, 'en'), ['jp']);
    assert.equal(courseOnlyLocales({ locale: 'en' }, 'en'), null);
  });

  it('lists every course locale when none matches', () => {
    assert.deepEqual(courseOnlyLocales({ locale: 'jp', locales: ['jp', 'fr'] }, 'en'), ['jp', 'fr']);
  });
});
