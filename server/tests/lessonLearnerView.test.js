// The learner view of a lesson for AI apps (shared/lesson/learnerView.js): one locale, quiz
// options relabelled by position, and no answers, explanations, feedback, hints, provenance or
// narration, checked over every published lesson.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTOR_PROTOCOL,
  availableLocales,
  labelForOptionId,
  learnerLocale,
  lessonOutline,
  optionIdForLabel,
  toLearnerLesson,
} from '../../shared/lesson/learnerView.js';
import { LOCALES } from '../../shared/lesson/constants.js';
import { resolveText } from '../../shared/lesson/text.js';
import { publishedLessons } from './helpers/publishedLessons.js';

const LESSONS = publishedLessons();
const byId = (id) => LESSONS.find((entry) => entry.lesson.id === id).lesson;

/** Calls fn(key, value, path) for every object member in a JSON value. */
function walk(value, fn, path = '') {
  if (Array.isArray(value)) value.forEach((item, i) => walk(item, fn, `${path}[${i}]`));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      fn(key, item, `${path}.${key}`);
      walk(item, fn, `${path}.${key}`);
    }
  }
}

const isLTextObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length > 0 && Object.keys(value).every((key) => LOCALES.includes(key));

describe('toLearnerLesson over every published lesson', () => {
  it('finds the published lessons', () => {
    assert.ok(LESSONS.length >= 20, `found ${LESSONS.length}`);
  });

  for (const { file, lesson } of LESSONS) {
    it(`${file}: one locale, no answers, positional labels, prompts for the learner`, () => {
      for (const locale of [...availableLocales(lesson), 'fr']) {
        const view = toLearnerLesson(lesson, { locale });
        const used = learnerLocale(lesson, locale);
        assert.equal(view.locale, used);
        assert.deepEqual(view.available_locales, availableLocales(lesson));
        const text = (value) => resolveText(value, used, lesson.locale).value;

        // Forbidden members anywhere, and no localized-text object left (one locale only).
        walk(view, (key, value, where) => {
          assert.ok(!['provenance', 'narration', 'slide', 'tags', 'answer', 'explanation', 'feedback'].includes(key), `${file} ${locale}: ${where}`);
          assert.ok(!isLTextObject(value), `${file} ${locale}: ${where} is still localized`);
        });

        const json = JSON.stringify(view);
        assert.equal(view.sections.length, lesson.sections.length);
        lesson.sections.forEach((section, si) => {
          const out = view.sections[si];
          assert.equal(out.id, section.id);
          assert.equal(out.title, text(section.title));
          section.blocks.forEach((block, bi) => {
            const got = out.blocks[bi];
            assert.equal(got.id, block.id);
            assert.equal(got.type, block.type);
            if (block.type === 'prompt') assert.equal(got.for, 'learner', `${file} ${block.id}`);
            if (block.type !== 'quiz') return;
            assert.deepEqual(Object.keys(got).filter((k) => !['id', 'type', 'mode', 'title', 'cite', 'questions'].includes(k)), [], `${file} ${block.id}`);
            block.questions.forEach((question, qi) => {
              const q = got.questions[qi];
              assert.deepEqual(Object.keys(q).sort(), ['id', 'kind', 'multiple', 'options', 'prompt', ...(question.objectiveId ? ['objectiveId'] : [])].sort());
              assert.equal(q.kind, question.kind ?? 'single');
              assert.equal(q.multiple, question.kind === 'multi');
              assert.equal(q.prompt, text(question.prompt));
              // No mapping from labels back to option ids: options are {label, md} only, labelled by position.
              assert.deepEqual(q.options, question.options.map((o, i) => ({ label: String(i + 1), md: text(o.md) })));
              // The texts that mark or explain the answer appear nowhere in the view.
              for (const secret of [question.explanation, question.hint, ...question.options.map((o) => o.feedback)]) {
                if (secret === undefined) continue;
                assert.ok(!json.includes(JSON.stringify(text(secret)).slice(1, -1)), `${file} ${question.id}: answer text leaked`);
              }
            });
          });
        });
      }
    });
  }

  it('keeps the learner-facing lesson fields and drops the rest', () => {
    const lesson = byId('cc-01-first-session');
    const view = toLearnerLesson(lesson, { locale: 'jp' });
    const allowed = ['id', 'title', 'subtitle', 'estMinutes', 'level', 'prerequisites', 'objectives', 'sections', 'glossary', 'sources', 'locale', 'available_locales'];
    assert.deepEqual(Object.keys(view).filter((key) => !allowed.includes(key)), []);
    assert.deepEqual(Object.keys(view.objectives[0]).sort(), ['bloom', 'id', 'text']);
    if (view.glossary?.length) assert.deepEqual(Object.keys(view.glossary[0]).sort(), ['md', 'term']);
    for (const source of view.sources ?? []) {
      assert.deepEqual(Object.keys(source).filter((key) => !['id', 'title', 'url', 'publisher'].includes(key)), []);
    }
    const cited = lesson.sections.flatMap((s) => s.blocks).find((b) => b.cite);
    if (cited) {
      const out = view.sections.flatMap((s) => s.blocks).find((b) => b.id === cited.id);
      assert.deepEqual(out.cite, cited.cite);
    }
  });

  it('reads the requested locale, falling back to the source locale', () => {
    const ch1 = byId('vibe-ch1');
    assert.deepEqual(availableLocales(ch1), ['jp', 'en']);
    assert.equal(toLearnerLesson(ch1, { locale: 'en' }).title, ch1.title.en);
    assert.equal(toLearnerLesson(ch1, { locale: 'en-US' }).locale, 'en');
    assert.equal(toLearnerLesson(ch1, { locale: 'ja' }).locale, 'jp');
    assert.equal(toLearnerLesson(ch1, { locale: 'fr' }).locale, 'jp');
    assert.equal(toLearnerLesson(ch1).locale, 'jp');
    const cc = byId('cc-01-first-session');
    assert.deepEqual(availableLocales(cc), ['jp']);
    assert.equal(toLearnerLesson(cc, { locale: 'en' }).locale, 'jp');
  });

  it('limits the sections to the requested ids, in lesson order', () => {
    const ch1 = byId('vibe-ch1');
    const ids = [ch1.sections[2].id, ch1.sections[0].id, 'nope'];
    assert.deepEqual(toLearnerLesson(ch1, { sectionIds: ids }).sections.map((s) => s.id), [ch1.sections[0].id, ch1.sections[2].id]);
    assert.equal(toLearnerLesson(ch1, { sectionIds: 'all' }).sections.length, ch1.sections.length);
    assert.equal(toLearnerLesson(ch1, { sectionIds: [] }).sections.length, 0);
  });
});

describe('lessonOutline', () => {
  for (const { file, lesson } of LESSONS) {
    it(`${file}: sections with their question ids, no answers`, () => {
      const outline = lessonOutline(lesson, { locale: 'en' });
      assert.equal(outline.locale, learnerLocale(lesson, 'en'));
      assert.deepEqual(outline.sections.map((s) => s.id), lesson.sections.map((s) => s.id));
      lesson.sections.forEach((section, i) => {
        const ids = section.blocks.filter((b) => b.type === 'quiz').flatMap((b) => b.questions.map((q) => q.id));
        assert.deepEqual(outline.sections[i].question_ids, ids);
      });
      assert.equal(outline.objectives.length, (lesson.objectives ?? []).length);
      assert.equal(outline.glossary_terms.length, (lesson.glossary ?? []).length);
      walk(outline, (key) => assert.ok(!['blocks', 'answer', 'explanation', 'feedback', 'hint', 'options'].includes(key), `${file}: ${key}`));
    });
  }
});

describe('option labels', () => {
  const question = { options: [{ id: 'd', md: 'D' }, { id: 'a', md: 'A' }, { id: 'c', md: 'C' }] };

  it('maps positional labels (string or integer) to option ids and back', () => {
    assert.equal(optionIdForLabel(question, '1'), 'd');
    assert.equal(optionIdForLabel(question, 2), 'a');
    assert.equal(optionIdForLabel(question, ' 3 '), 'c');
    assert.equal(labelForOptionId(question, 'a'), '2');
    for (const bad of ['0', 0, 4, '4', '1.0', 1.5, '01', 'a', '', null, undefined, ['1']]) {
      assert.equal(optionIdForLabel(question, bad), null, JSON.stringify(bad));
    }
    assert.equal(labelForOptionId(question, 'b'), null);
  });

  it('round-trips for every published question', () => {
    for (const { lesson } of LESSONS) {
      for (const block of lesson.sections.flatMap((s) => s.blocks).filter((b) => b.type === 'quiz')) {
        for (const q of block.questions) {
          for (const option of q.options) assert.equal(optionIdForLabel(q, labelForOptionId(q, option.id)), option.id);
        }
      }
    }
  });
});

describe('TUTOR_PROTOCOL', () => {
  it('is short English text that names the rules agents need', () => {
    const lines = TUTOR_PROTOCOL.split('\n');
    assert.ok(lines.length <= 10, `${lines.length} lines`);
    assert.doesNotMatch(TUTOR_PROTOCOL, /[぀-ヿ一-鿿]/, 'English only');
    for (const needle of [/course-quiz-check/, /own choice/, /probe/, /exam/, /predict/, /for: "learner"/, /course-progress-update/, /learner's language/, /reveal/]) {
      assert.match(TUTOR_PROTOCOL, needle);
    }
  });
});
