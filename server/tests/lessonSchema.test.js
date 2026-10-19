import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BLOCK_TYPES } from '../../shared/lesson/schema.js';
import { validateLesson, validateCourse } from '../../shared/lesson/validate.js';
import { isMigrationAuthor, lintLesson } from '../../shared/lesson/lint.js';
import { lessonStats, formatPath } from '../../shared/lesson/walk.js';
import { docChapterStats } from '../../shared/lesson/fromDocChapter.js';
import { t, resolveText, hasLocale, toBcp47, fromBcp47 } from '../../shared/lesson/text.js';
import { lessonJsonSchema, LLM_UNSUPPORTED_KEYWORDS, assertNoRecursion } from '../../shared/lesson/jsonSchema.js';
import { VIBE_LEGACY, loadLegacyChapter, loadLegacyQuiz, migrateEntry } from '../../scripts/lessons/migrate-legacy.mjs';
import { schemaFiles } from '../../scripts/lessons/export-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COURSE_DIR = path.join(ROOT, 'content/courses/vibe-coding');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const course = readJson(path.join(COURSE_DIR, 'course.json'));
const lessonFile = (id) => path.join(COURSE_DIR, 'lessons', `${id}.lesson.json`);
const loadLesson = (id) => readJson(lessonFile(id));
const clone = (value) => structuredClone(value);

// Path of the first quiz block of a given mode, e.g. ['sections', 1, 'blocks', 5].
function findQuiz(lesson, mode) {
  for (const [si, section] of lesson.sections.entries()) {
    for (const [bi, block] of section.blocks.entries()) {
      if (block.type === 'quiz' && block.mode === mode) return { si, bi, block };
    }
  }
  throw new Error(`no ${mode} quiz`);
}

function runCli(script, args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts/lessons', script), ...args], { cwd: ROOT, encoding: 'utf8' });
}

describe('risepath.lesson/v1 content', () => {
  it('validates all 12 Vibe Coding lessons against the course', () => {
    const files = fs.readdirSync(path.join(COURSE_DIR, 'lessons')).filter((f) => f.endsWith('.lesson.json'));
    assert.equal(files.length, 12);
    for (const file of files) {
      const result = validateLesson(readJson(path.join(COURSE_DIR, 'lessons', file)), { course });
      assert.deepEqual(result.errors, [], file);
      assert.equal(result.ok, true);
    }
  });

  it('validates course.json and its next-lesson chain', () => {
    const ids = VIBE_LEGACY.map((e) => e.lessonId);
    const result = validateCourse(course, { lessonIds: ids });
    assert.deepEqual(result.errors, []);
    assert.equal(course.world, 'vibe');
    const refs = course.modules.flatMap((m) => m.lessons);
    assert.deepEqual(refs.map((r) => r.id), ids);
    refs.forEach((ref, i) => {
      if (i < refs.length - 1) assert.equal(ref.next.lessonId, refs[i + 1].id);
      else assert.equal(ref.next, undefined);
    });
  });

  it('keeps no mindmap blocks; mind maps become mermaid mindmap diagrams', () => {
    for (const { lessonId } of VIBE_LEGACY) {
      for (const section of loadLesson(lessonId).sections) {
        for (const block of section.blocks) assert.notEqual(block.type, 'mindmap');
      }
    }
    const diagram = loadLesson('vibe-ch0').sections[0].blocks.find((b) => b.type === 'diagram');
    assert.match(diagram.code.jp, /^mindmap\n {2}root\(\("バイブコーディング"\)\)/);
    assert.match(diagram.code.en, /^mindmap\n/);
    assert.match(diagram.description.jp, /ロングコンテキスト/);
    assert.ok(!BLOCK_TYPES.includes('mindmap'));
    assert.ok(BLOCK_TYPES.includes('code') && BLOCK_TYPES.includes('diagram'));
  });
});

describe('validateLesson errors', () => {
  const ch1 = loadLesson('vibe-ch1');

  it('reports a broken answer id with its path', () => {
    const broken = clone(ch1);
    const { si, bi } = findQuiz(broken, 'inline');
    broken.sections[si].blocks[bi].questions[0].answer = ['z'];
    const result = validateLesson(broken, { course });
    assert.equal(result.ok, false);
    const expected = `sections[${si}].blocks[${bi}].questions[0].answer[0]`;
    const error = result.errors.find((e) => e.path === expected);
    assert.ok(error, JSON.stringify(result.errors));
    assert.match(error.message, /"z" is not an option id/);
  });

  it('lessons:validate exits 1 on a broken copy and prints the path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-lesson-'));
    try {
      const broken = clone(ch1);
      const { si, bi } = findQuiz(broken, 'exam');
      broken.sections[si].blocks[bi].questions[0].answer[0] = 'nope';
      const file = path.join(dir, 'vibe-ch1.lesson.json');
      fs.writeFileSync(file, JSON.stringify(broken));

      const text = runCli('validate.mjs', [file]);
      assert.equal(text.status, 1, text.stdout + text.stderr);
      assert.ok(text.stdout.includes(`sections[${si}].blocks[${bi}].questions[0].answer[0]`), text.stdout);

      const json = runCli('validate.mjs', [file, '--format', 'json']);
      assert.equal(json.status, 1);
      const report = JSON.parse(json.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.files[0].errors[0].path, `sections[${si}].blocks[${bi}].questions[0].answer[0]`);

      const github = runCli('validate.mjs', [file, '--format', 'github']);
      assert.match(github.stdout, /^::error file=.*vibe-ch1\.lesson\.json,title=lessons:validate::sections\[/m);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lessons:validate exits 0 on the repository content', () => {
    const result = runCli('validate.mjs', []);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    // 12 Vibe chapters plus content/examples/blocks-gallery.lesson.json (WP-05).
    const summary = /(\d+) lesson files, 1 course file: no errors/.exec(result.stdout);
    assert.ok(summary && Number(summary[1]) >= 13, result.stdout);
  });

  it('names unknown block types and unknown fields', () => {
    const lesson = clone(ch1);
    lesson.sections[1].blocks[0] = { id: 'x', type: 'mindmap', root: {} };
    lesson.sections[1].blocks[1].colour = 'red';
    const { errors } = validateLesson(lesson);
    assert.ok(errors.some((e) => e.path === 'sections[1].blocks[0].type' && /Unknown block type "mindmap"/.test(e.message)), JSON.stringify(errors));
    assert.ok(errors.some((e) => e.path === 'sections[1].blocks[1]' && /Unknown field: "colour"/.test(e.message)), JSON.stringify(errors));
  });

  it('rejects duplicate ids, unknown objectives and missing objectiveId', () => {
    const lesson = clone(ch1);
    lesson.sections[2].blocks[0].id = lesson.sections[1].blocks[0].id;
    const { si, bi } = findQuiz(lesson, 'inline');
    lesson.sections[si].blocks[bi].questions[0].objectiveId = 'o9';
    const exam = findQuiz(lesson, 'exam');
    delete lesson.sections[exam.si].blocks[exam.bi].questions[0].objectiveId;
    const { errors } = validateLesson(lesson);
    assert.ok(errors.some((e) => e.path === 'sections[2].blocks[0].id' && /Duplicate id/.test(e.message)));
    assert.ok(errors.some((e) => e.path === `sections[${si}].blocks[${bi}].questions[0].objectiveId` && /Unknown objective "o9"/.test(e.message)));
    assert.ok(errors.some((e) => e.path === `sections[${exam.si}].blocks[${exam.bi}].questions[0].objectiveId` && /required/.test(e.message)));
  });

  it('requires every declared locale and matching table rows', () => {
    const lesson = clone(loadLesson('vibe-ch2'));
    delete lesson.sections[0].blocks[0].md.en;
    const tableSection = lesson.sections.findIndex((s) => s.blocks.some((b) => b.type === 'table'));
    const tableIndex = lesson.sections[tableSection].blocks.findIndex((b) => b.type === 'table');
    lesson.sections[tableSection].blocks[tableIndex].rows[0].push('extra');
    const { errors } = validateLesson(lesson);
    assert.ok(errors.some((e) => e.path === 'sections[0].blocks[0].md.en' && /Missing "en"/.test(e.message)), JSON.stringify(errors));
    assert.ok(errors.some((e) => e.path === `sections[${tableSection}].blocks[${tableIndex}].rows[0]` && /3 cells but the table has 2 columns/.test(e.message)));
  });

  it('checks next.lessonId against the course', () => {
    const lesson = clone(ch1);
    lesson.next = { lessonId: 'vibe-ch99' };
    const { errors } = validateLesson(lesson, { course });
    assert.ok(errors.some((e) => e.path === 'next.lessonId'));
    lesson.next = { lessonId: 'vibe-ch2' };
    assert.equal(validateLesson(lesson, { course }).ok, true);
  });

  it('formats paths like JS accessors', () => {
    assert.equal(formatPath(['sections', 2, 'blocks', 0, 'questions', 0, 'answer', 0]), 'sections[2].blocks[0].questions[0].answer[0]');
    assert.equal(formatPath([]), '(root)');
  });
});

describe('lintLesson', () => {
  it('vibe-ch1 passes the strict lint', () => {
    const { lesson } = validateLesson(loadLesson('vibe-ch1'), { course });
    assert.deepEqual(lintLesson(lesson).warnings, []);
    const cli = runCli('lint.mjs', ['content/courses/vibe-coding/lessons/vibe-ch1.lesson.json', '--strict']);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  });

  it('vibe-ch1 meets the polish brief', () => {
    const lesson = loadLesson('vibe-ch1');
    assert.equal(lesson.objectives.length, 3);
    assert.ok(lesson.objectives.every((o) => o.bloom && o.text.jp && o.text.en));
    assert.equal(lesson.sections[0].role, 'hook');
    assert.equal(findQuiz(lesson, 'predict').block.questions.length, 1);
    const inline = lesson.sections.filter((s) => s.blocks.some((b) => b.type === 'quiz' && b.mode === 'inline')).map((s) => s.id);
    assert.deepEqual(inline, ['1-1', '1-2']);
    const stats = lessonStats(lesson);
    assert.equal(stats.image || 0, 0);
    assert.equal(stats.cards, 5);
    assert.ok(stats.prompt >= 2);
    assert.equal(stats.summary, 1);
    assert.equal(lesson.provenance.author, 'human+claude-code');
  });

  it('flags migrated chapters and common authoring mistakes', () => {
    const { lesson } = validateLesson(loadLesson('vibe-ch3'), { course });
    const rules = new Set(lintLesson(lesson).warnings.map((w) => w.rule));
    for (const rule of ['objectives-count', 'summary-missing', 'inline-quiz-density', 'flashcards-count']) assert.ok(rules.has(rule), rule);

    const draft = clone(loadLesson('vibe-ch1'));
    draft.sections[2].blocks.push({ id: 'bad-code', type: 'code', lang: 'markdown', code: 'You are a PM.' });
    const { si, bi } = findQuiz(draft, 'inline');
    delete draft.sections[si].blocks[bi].questions[0].options[0].feedback;
    draft.sections[1].blocks[0].md.jp = 'これは簡単です。';
    const { warnings } = lintLesson(validateLesson(draft).lesson);
    const byRule = (rule) => warnings.filter((w) => w.rule === rule);
    assert.equal(byRule('code-should-be-prompt').length, 1);
    assert.equal(byRule('code-filename').length, 1);
    assert.equal(byRule('quiz-feedback')[0].path, `sections[${si}].blocks[${bi}].questions[0].options[0]`);
    assert.equal(byRule('banned-phrase')[0].path, 'sections[1].blocks[0].md.jp');
  });
});

describe('legacy migration', () => {
  it('loads the legacy TypeScript chapters through esbuild', async () => {
    const { chapter, exportName } = await loadLegacyChapter('data/curricula/vibe_coding/chapter1.ts');
    assert.equal(chapter.id, 'vibe-ch1');
    assert.equal(exportName, 'VIBE_CHAPTER_1_DATA');
    const { quiz } = await loadLegacyQuiz('data/curricula/vibe_coding/chapter1_quiz.ts');
    assert.equal(quiz.questions.length, 5);
  });

  it('preserves table, diagram, code and prose counts', async () => {
    let tables = 0;
    for (const entry of VIBE_LEGACY) {
      const { chapter } = await loadLegacyChapter(entry.source);
      const quiz = entry.quizSource ? (await loadLegacyQuiz(entry.quizSource)).quiz : null;
      const legacy = docChapterStats(chapter, quiz);
      const lesson = loadLesson(entry.lessonId);
      const stats = lessonStats(lesson);

      assert.deepEqual(lesson.provenance.migratedFrom.counts, legacy, `${entry.lessonId} provenance counts`);
      assert.equal(stats.table || 0, legacy.table || 0, `${entry.lessonId} tables`);
      assert.equal(stats.tableRows, legacy.tableRows, `${entry.lessonId} table rows`);
      tables += stats.table || 0;

      // Only lessons still in machine-migrated form keep the legacy block counts; a rework
      // (any new author, e.g. claude-code from /author-lesson) restructures them.
      if (isMigrationAuthor(lesson.provenance.author)) {
        assert.equal(stats.sections, legacy.sections, `${entry.lessonId} sections`);
        assert.equal(stats.blocks, legacy.blocks, `${entry.lessonId} blocks`);
        assert.equal(stats.markdown || 0, legacy.text || 0, `${entry.lessonId} text`);
        assert.equal((stats.code || 0) + (stats.prompt || 0), legacy.code || 0, `${entry.lessonId} code`);
        assert.equal(stats.diagram || 0, (legacy.mermaid || 0) + (legacy.mindmap || 0), `${entry.lessonId} diagrams`);
        assert.equal((stats.list || 0) + (stats.definitions || 0), legacy.list || 0, `${entry.lessonId} lists`);
      }
    }
    assert.equal(tables, 6);
  });

  it('reproduces the committed machine-migrated lessons exactly', async () => {
    for (const entry of VIBE_LEGACY) {
      const committed = loadLesson(entry.lessonId);
      if (committed.provenance.author !== 'migration') continue;
      const { lesson } = await migrateEntry(entry);
      assert.deepEqual(lesson, committed, entry.lessonId);
    }
  });
});

describe('JSON Schema export', () => {
  it('committed schema files are up to date', () => {
    for (const [name, content] of Object.entries(schemaFiles())) {
      assert.equal(fs.readFileSync(path.join(ROOT, 'content/schema', name), 'utf8'), content, `${name} is stale; run npm run lessons:schema`);
    }
  });

  it('LLM profile has no unsupported keywords, closed objects and no recursion', () => {
    const llm = lessonJsonSchema({ profile: 'llm' });
    const keys = new Set();
    const objects = [];
    const visit = (node, parentKey) => {
      if (Array.isArray(node)) return node.forEach((n) => visit(n));
      if (!node || typeof node !== 'object') return;
      if (parentKey !== 'properties' && parentKey !== '$defs') {
        Object.keys(node).forEach((k) => keys.add(k));
        if (node.type === 'object') objects.push(node);
      }
      for (const [k, v] of Object.entries(node)) visit(v, k);
    };
    visit(llm);
    for (const keyword of LLM_UNSUPPORTED_KEYWORDS) assert.ok(!keys.has(keyword), keyword);
    assert.ok(!keys.has('oneOf'));
    assert.ok(objects.length > 20);
    for (const node of objects) assert.equal(node.additionalProperties, false);
    assert.doesNotThrow(() => assertNoRecursion(llm));
    assert.ok(!JSON.stringify(llm).includes('mindmap"'));
    assert.ok(!('migratedFrom' in llm.$defs.Provenance.properties));
    assert.ok(llm.$defs.QuizQuestion.required.includes('objectiveId'));
    assert.equal(llm.$defs.Block.anyOf.length, BLOCK_TYPES.length);

    const full = lessonJsonSchema();
    assert.equal(full.$defs.Block.anyOf.length, BLOCK_TYPES.length);
    assert.ok(JSON.stringify(full).includes('"pattern"'));
  });
});

describe('localized text helpers', () => {
  it('resolves with fallback and reports the locale used', () => {
    const text = { jp: 'こんにちは', en: 'Hello' };
    assert.equal(t(text, 'en'), 'Hello');
    assert.equal(t(text, 'fr'), 'こんにちは');
    assert.equal(t(text, 'fr', 'en'), 'Hello');
    assert.deepEqual(resolveText({ en: 'Hi' }, 'jp'), { value: 'Hi', locale: 'en' });
    assert.equal(t('plain', 'en'), 'plain');
    assert.equal(t(undefined, 'jp'), '');
    assert.equal(hasLocale('plain', 'jp'), true);
    assert.equal(hasLocale('plain', 'en'), false);
    assert.equal(hasLocale({ jp: ' ' }, 'jp'), false);
    assert.equal(toBcp47('jp'), 'ja');
    assert.equal(fromBcp47('ja-JP'), 'jp');
    assert.equal(fromBcp47('de'), null);
  });
});
