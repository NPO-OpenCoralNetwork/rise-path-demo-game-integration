// Dashboard data (WP-09): streak days, the "続きから" target and the track card totals.
// Pure modules only; the lesson and course JSON are the real Vibe Coding files.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeDaysFrom,
  dayOfTimestamp,
  localDateKey,
  streakFromDays,
} from '../../components/ui/activity.ts';
import {
  DEFAULT_START,
  courseTotals,
  formatCourseMeta,
  lessonFacts,
  pickResumeTarget,
} from '../../components/ui/lessonResume.ts';
import { emptyProgress, withLastBlock, withSeen } from '../../components/lesson/progressStore.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const course = readJson('content/courses/vibe-coding/course.json');
const ch1 = readJson('content/courses/vibe-coding/lessons/vibe-ch1.lesson.json');

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

describe('activity: streak days', () => {
  it('uses local calendar days', () => {
    assert.equal(localDateKey(at(2026, 1, 5)), '2026-01-05');
    assert.equal(dayOfTimestamp(at(2026, 10, 18, 8).toISOString()), '2026-10-18');
  });

  it('ignores bad and epoch timestamps', () => {
    assert.equal(dayOfTimestamp('nope'), null);
    assert.equal(dayOfTimestamp(new Date(0).toISOString()), null);
    assert.equal(dayOfTimestamp(undefined), null);
    assert.equal(activeDaysFrom(['x', null, new Date(0).toISOString()]).size, 0);
  });

  it('counts consecutive days ending today', () => {
    const days = ['2026-10-16', '2026-10-17', '2026-10-18'];
    assert.deepEqual(streakFromDays(days, at(2026, 10, 18)), { days: 3, activeToday: true });
  });

  it('keeps yesterday\'s streak alive until today ends', () => {
    assert.deepEqual(streakFromDays(['2026-10-16', '2026-10-17'], at(2026, 10, 18)), { days: 2, activeToday: false });
  });

  it('drops a streak after a missed day, and handles month boundaries', () => {
    assert.deepEqual(streakFromDays(['2026-10-15'], at(2026, 10, 18)), { days: 0, activeToday: false });
    assert.deepEqual(streakFromDays(['2026-09-30', '2026-10-01'], at(2026, 10, 1)), { days: 2, activeToday: true });
    assert.deepEqual(streakFromDays([], at(2026, 10, 1)), { days: 0, activeToday: false });
  });

  it('merges several timestamps on the same day', () => {
    const days = activeDaysFrom([at(2026, 10, 18, 9).toISOString(), at(2026, 10, 18, 21).toISOString()]);
    assert.equal(days.size, 1);
  });
});

describe('lessonResume: 続きから target', () => {
  const exists = (slug, id) => slug === 'vibe-coding' && /^vibe-ch\d+$/.test(id);

  it('falls back to Vibe Coding chapter 1 without a last lesson', () => {
    assert.deepEqual(pickResumeTarget(null, exists), { ...DEFAULT_START, fromLast: false, pct: 0 });
  });

  it('points to the last lesson opened in the reader', () => {
    const last = { courseSlug: 'vibe-coding', lessonId: 'vibe-ch3', title: '第3章', pct: 42, at: '2026-10-18T00:00:00Z' };
    assert.deepEqual(pickResumeTarget(last, exists), { courseSlug: 'vibe-coding', lessonId: 'vibe-ch3', fromLast: true, pct: 42 });
  });

  it('ignores a last lesson that no longer exists', () => {
    const last = { courseSlug: 'gone', lessonId: 'x', title: '', pct: 10, at: '' };
    assert.equal(pickResumeTarget(last, exists).fromLast, false);
  });
});

describe('lessonResume: lesson facts', () => {
  it('counts sections and questions from the lesson JSON', () => {
    const facts = lessonFacts(ch1, emptyProgress(), 'jp');
    assert.equal(facts.sections, ch1.sections.length);
    const questions = ch1.sections
      .flatMap((s) => s.blocks)
      .filter((b) => b.type === 'quiz')
      .reduce((n, b) => n + b.questions.length, 0);
    assert.equal(facts.questions, questions);
    assert.equal(facts.resumeSection, null);
    assert.ok(facts.outline.every((item) => item.status === 'todo'));
  });

  it('labels the resume section by its number and marks read sections', () => {
    const section = ch1.sections.find((s) => /^\s*1-2/.test(typeof s.title === 'string' ? s.title : s.title.jp));
    assert.ok(section, 'chapter 1 has a 1-2 section');
    const first = ch1.sections[0];
    let progress = withSeen(emptyProgress(), first.blocks.map((b) => b.id));
    progress = withLastBlock(progress, section.blocks[0].id);
    const facts = lessonFacts(ch1, progress, 'jp');
    assert.deepEqual(facts.resumeSection, { id: section.id, label: '1-2' });
    const firstItem = facts.outline.find((item) => item.id === first.id);
    const hasQuiz = first.blocks.some((b) => b.type === 'quiz');
    if (!hasQuiz) assert.equal(firstItem.status, 'done');
    assert.equal(facts.outline.find((item) => item.id === section.id).status, 'current');
  });
});

describe('lessonResume: track totals', () => {
  it('sums lessons and minutes from course.json and averages saved progress', () => {
    const refs = course.modules.flatMap((m) => m.lessons);
    const minutes = refs.reduce((n, r) => n + (r.estMinutes || 0), 0);
    const none = courseTotals(course, () => null);
    assert.deepEqual(none, { lessons: refs.length, minutes, started: 0, pct: 0 });

    const some = courseTotals(course, (slug, id) => (id === 'vibe-ch1' ? { pct: 60, state: 'in_progress' } : null));
    assert.equal(some.started, 1);
    assert.equal(some.pct, Math.round(60 / refs.length));
  });

  it('formats the meta line in both languages', () => {
    assert.equal(formatCourseMeta({ lessons: 12, minutes: 270 }, 'jp'), '12レッスン · 約4.5時間');
    assert.equal(formatCourseMeta({ lessons: 12, minutes: 270 }, 'en'), '12 lessons · about 4.5 h');
    assert.equal(formatCourseMeta({ lessons: 1, minutes: 45 }, 'en'), '1 lesson · about 45 min');
    assert.equal(formatCourseMeta({ lessons: 3, minutes: 0 }, 'jp'), '3レッスン');
  });
});
