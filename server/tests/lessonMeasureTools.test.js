// Lesson measuring tools in scripts/lessons/: the length measure (measure.mjs), the sentence count
// (para-sentences.mjs) and the pure parts of the browser checks (mobile-fit.mjs, diagram-width.mjs).
// Small inline lessons only, so the numbers do not move when a real lesson is edited.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureLesson, textLength } from '../../scripts/lessons/measure.mjs';
import { countSentences, longParagraphs } from '../../scripts/lessons/para-sentences.mjs';
import { countProblems, parseArgs as parseFitArgs, reportLines, VIEWPORTS } from '../../scripts/lessons/mobile-fit.mjs';
import {
  diagramSources,
  FONT_FAMILY,
  FONT_PX,
  MAX_NATURAL_WIDTH,
  parseArgs as parseDiagramArgs,
  webFontsHref,
} from '../../scripts/lessons/diagram-width.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('measure.mjs', () => {
  it('counts characters without whitespace, inline markers, link targets or glossary keys', () => {
    assert.equal(textLength('あ い\nう'), 3);
    assert.equal(textLength('**太字**と`code`'), 7);
    assert.equal(textLength('[リンク](https://example.com/長いURL)'), 3);
    assert.equal(textLength('[[context-window|コンテキスト]]と[[用語]]'), 9);
    assert.equal(textLength(undefined), 0);
  });

  it('splits body prose, study reading, practice reading and questions by section role', () => {
    const lesson = {
      sections: [
        { id: 'hook', role: 'hook', blocks: [{ type: 'markdown', md: 'あいう' }] },
        {
          id: 's1',
          role: 'concept',
          blocks: [
            { type: 'markdown', md: { jp: '**太字**と`code`', en: 'not counted' } },
            { type: 'definitions', items: [{ term: '用語', md: '説明です' }] },
            { type: 'table', caption: '表', columns: ['列A'], rows: [['セル']] },
            { type: 'code', code: 'npm test # 数えない' },
            { type: 'quiz', questions: [{ prompt: '問い' }, { prompt: '問い' }] },
          ],
        },
        {
          id: 'practice',
          role: 'practice',
          blocks: [
            { type: 'steps', title: 'やる', items: [{ title: '一', md: '二', expect: '三' }] },
            { type: 'checklist', title: 'チェック', items: [{ label: 'はい' }] },
          ],
        },
        { id: 'check', role: 'check', blocks: [{ type: 'markdown', md: 'ここは数えない' }, { type: 'quiz', questions: [{}, {}, {}] }] },
        {
          id: 'summary',
          role: 'summary',
          blocks: [{ type: 'summary', points: ['まとめ'] }, { type: 'checklist', items: [{ label: '数えない' }] }],
        },
      ],
    };
    const m = measureLesson(lesson);
    // prose: hook 3 + markdown 7 + summary 3. read adds definitions (2 + 4) and the table (1 + 2 + 2).
    assert.equal(m.prose, 13);
    assert.equal(m.read, 24);
    // practice: steps 2 + 1 + 1 + 1, checklist 4 + 2 (a checklist counts only in practice).
    assert.equal(m.practice, 11);
    assert.equal(m.questions, 5);
    assert.equal(m.tasks, 1);
    assert.equal(m.est.toFixed(2), ((24 + 11) / 450 + (5 * 40) / 60 + 2).toFixed(2));
    assert.deepEqual(m.sections.map((s) => `${s.id} ${s.chars}`), ['hook 3', 's1 18', 'practice 11', 'check 0', 'summary 3']);
  });

  it('counts localized ({jp, en}) list items, summary points and table columns like plain strings', () => {
    const lesson = (item) => ({
      sections: [{
        id: 's1',
        role: 'concept',
        blocks: [
          { type: 'list', items: [item('あいう', 'abc')] },
          { type: 'summary', points: [item('まとめ', 'sum')] },
          { type: 'table', columns: [item('列', 'col')], rows: [['セル']] },
        ],
      }],
    });
    const pair = (m) => [m.prose, m.read];
    // prose: list 3 + summary 3; read adds the table (column 1 + cell 2).
    assert.deepEqual(pair(measureLesson(lesson((jp) => jp))), [6, 9]);
    assert.deepEqual(pair(measureLesson(lesson((jp, en) => ({ jp, en })))), [6, 9]);
    // Like every localized field, the Japanese text counts, and English only when there is no Japanese.
    assert.deepEqual(pair(measureLesson(lesson((jp, en) => ({ en })))), [6, 11]);
  });

  it('measures an empty lesson as zero', () => {
    assert.deepEqual(measureLesson({}), { prose: 0, read: 0, practice: 0, questions: 0, tasks: 0, est: 0, sections: [] });
  });
});

describe('para-sentences.mjs', () => {
  it('counts sentence ends outside brackets, inline code and links', () => {
    assert.equal(countSentences('一つ目。二つ目！三つ目？'), 3);
    assert.equal(countSentences('「中。の文。」は数えません。'), 1);
    assert.equal(countSentences('（補足。）本文です。'), 1);
    assert.equal(countSentences('`a。b。`の後です。'), 1);
    assert.equal(countSentences('[文。](https://example.com/a。b) を見ます。'), 1);
    assert.equal(countSentences('文末がありません'), 0);
  });

  it('finds paragraphs over the limit per line, skips code, prompt bodies and sources, and marks quiz stems as advisory', () => {
    const four = '一。二。三。四。';
    const lesson = {
      sections: [{
        id: 's1',
        blocks: [
          { id: 'b1', type: 'markdown', md: `${four}\n短い。` },
          { id: 'b2', type: 'markdown', md: `短い。\n${four}` },
          { id: 'b3', type: 'code', code: four },
          { id: 'b4', type: 'prompt', prompt: four },
          { id: 'q', type: 'quiz', questions: [{ id: 'q1', prompt: four, options: [{ id: 'a', text: '一。二。三。' }] }] },
        ],
      }],
      sources: [{ id: 'src', title: four }],
      provenance: { note: four },
    };
    assert.deepEqual(longParagraphs(lesson), [
      { path: 'sections[s1].blocks[b1].md', sentences: 4, text: four, advisory: false },
      { path: 'sections[s1].blocks[b2].md#line2', sentences: 4, text: four, advisory: false },
      { path: 'sections[s1].blocks[q].questions[q1].prompt', sentences: 4, text: four, advisory: true },
    ]);
    assert.deepEqual(longParagraphs(lesson, 4), []);
  });

  it('tests a localized value ({jp, en}) as its field: quiz stems stay advisory, prompt bodies and diagram code are skipped', () => {
    const four = '一。二。三。四。';
    const lesson = {
      sections: [{
        id: 's1',
        blocks: [
          { id: 'm', type: 'markdown', md: { jp: four, en: 'One. Two. Three. Four.' } },
          { id: 'p', type: 'prompt', prompt: { jp: four } },
          { id: 'd', type: 'diagram', code: { jp: `flowchart LR\n  A[${four}]` }, alt: { jp: four } },
          { id: 'q', type: 'quiz', questions: [{ id: 'q1', prompt: { jp: four, en: four } }] },
        ],
      }],
    };
    assert.deepEqual(longParagraphs(lesson), [
      { path: 'sections[s1].blocks[m].md.jp', sentences: 4, text: four, advisory: false },
      { path: 'sections[s1].blocks[q].questions[q1].prompt.jp', sentences: 4, text: four, advisory: true },
      { path: 'sections[s1].blocks[q].questions[q1].prompt.en', sentences: 4, text: four, advisory: true },
    ]);
  });
});

describe('mobile-fit.mjs helpers', () => {
  it('parses arguments like lessons:preview', () => {
    assert.deepEqual(parseFitArgs(['claude-code', 'cc-01-first-session'], {}), { course: 'claude-code', lesson: 'cc-01-first-session', base: 'http://localhost:3007' });
    assert.equal(parseFitArgs(['c', 'l', '--base', 'http://x:1/'], {}).base, 'http://x:1');
    assert.equal(parseFitArgs(['c', 'l'], { RISE_PATH_PREVIEW_BASE_URL: 'http://y:2' }).base, 'http://y:2');
    assert.throws(() => parseFitArgs(['c'], {}), /Usage/);
    assert.throws(() => parseFitArgs(['c', 'l', 'extra'], {}), /Usage/);
    assert.throws(() => parseFitArgs(['../etc', 'l'], {}), /Invalid course slug/);
    assert.throws(() => parseFitArgs(['c', '../l'], {}), /Invalid lesson id/);
    assert.throws(() => parseFitArgs(['c', 'l', '--base'], {}), /needs a value/);
    assert.throws(() => parseFitArgs(['c', 'l', '--png', 'x'], {}), /Unknown option/);
    assert.deepEqual(VIEWPORTS.mobile, { width: 390, height: 844 });
    assert.deepEqual(VIEWPORTS.desktop, { width: 1440, height: 900 });
  });

  it('counts split chips, cut-off lines and wide tables as problems, long chips and soft wraps as advisories', () => {
    const clean = { name: 'mobile', chips: [], cut: [], wrapped: [], tables: [{ block: 't', width: 300, box: 316, over: false }] };
    assert.equal(countProblems(clean), 0);
    assert.deepEqual(reportLines(clean), []);
    const advisories = {
      name: 'desktop',
      chips: [{ block: 'b1', code: 'claude --permission-mode plan', context: '…', long: true }],
      cut: [],
      wrapped: [{ block: 'b2', line: 3 }, { block: 'b2', line: 4 }],
      tables: [],
    };
    assert.equal(countProblems(advisories), 0);
    assert.deepEqual(reportLines(advisories), [
      'desktop: advisory, b1: `claude --permission-mode plan` is longer than a line and wraps inside its chip (a code block reads better)',
      'desktop: advisory, code lines soft-wrapped: b2 line 3, b2 line 4',
    ]);
    const broken = {
      name: 'mobile',
      chips: [{ block: 'b1', code: '--continue', context: '続きは --continue で', long: false }],
      cut: [{ block: 'b3', line: 2, text: 'npm run lessons:preview', over: 12 }],
      wrapped: [],
      tables: [{ block: 't', width: 420, box: 316, over: true }],
    };
    assert.equal(countProblems(broken), 3);
    assert.deepEqual(reportLines(broken), [
      'mobile: b1: `--continue` is split across lines — in 「続きは --continue で」',
      'mobile: b3: code line 2 is cut off (12px too wide): npm run lessons:preview',
      'mobile: t: table 420px in a 316px box (scrolls sideways)',
    ]);
  });
});

describe('diagram-width.mjs helpers', () => {
  it('parses one lesson file and an optional PNG folder', () => {
    assert.deepEqual(parseDiagramArgs(['a.lesson.json']), { file: path.resolve('a.lesson.json'), png: null });
    assert.deepEqual(parseDiagramArgs(['a.lesson.json', '--png', 'out']), { file: path.resolve('a.lesson.json'), png: path.resolve('out') });
    assert.throws(() => parseDiagramArgs([]), /Usage/);
    assert.throws(() => parseDiagramArgs(['a.json', 'b.json']), /Usage/);
    assert.throws(() => parseDiagramArgs(['a.json', '--png']), /needs a value/);
    assert.throws(() => parseDiagramArgs(['a.json', '--wide']), /Unknown option/);
  });

  it('lists every diagram once per locale with init directives stripped', () => {
    const lesson = {
      sections: [
        { id: 's1', blocks: [{ id: 'd1', type: 'diagram', code: '%%{init: {"theme": "dark"}}%%\nflowchart LR\n  A --> B' }, { id: 'm1', type: 'markdown', md: 'x' }] },
        { id: 's2', blocks: [{ id: 'd2', type: 'diagram', code: { jp: 'flowchart TD\n  あ --> い', en: 'flowchart TD\n  a --> b', fr: ' ' } }] },
      ],
    };
    assert.deepEqual(diagramSources(lesson), [
      { id: 'd1', locale: null, code: 'flowchart LR\n  A --> B' },
      { id: 'd2', locale: 'jp', code: 'flowchart TD\n  あ --> い' },
      { id: 'd2', locale: 'en', code: 'flowchart TD\n  a --> b' },
    ]);
    assert.deepEqual(diagramSources({}), []);
  });

  it('keeps the reader settings it copies: label size, font stack and the 0.87 scale behind 362 px', () => {
    const renderer = read('components/lesson/blocks/mermaidRenderer.ts');
    assert.match(renderer, new RegExp(`DIAGRAM_FONT_PX = ${FONT_PX};`));
    assert.ok(renderer.includes(`const FONT_FAMILY = '${FONT_FAMILY}';`), 'FONT_FAMILY matches mermaidRenderer.ts');
    assert.match(read('components/lesson/blocks/DiagramBlock.tsx'), /const MIN_SCALE = 0\.87;/);
    // A ~316 px box at 390 px holds a diagram shrunk to 0.87 of its natural width.
    assert.equal(MAX_NATURAL_WIDTH, 362);
    assert.ok(MAX_NATURAL_WIDTH * 0.87 <= 316);
  });

  it('measures labels in the web fonts the app loads (the first Google Fonts css2 link of index.html)', () => {
    const href = webFontsHref(read('index.html'));
    assert.match(href, /^https:\/\/fonts\.googleapis\.com\/css2\?family=Inter[^&]*&family=Noto\+Sans\+JP/);
    assert.doesNotMatch(href, /&amp;/);
    assert.equal(webFontsHref('<link href="https://fonts.googleapis.com/css2?family=A&amp;family=B" rel="stylesheet" />'), 'https://fonts.googleapis.com/css2?family=A&family=B');
    assert.equal(webFontsHref('<link rel="preconnect" href="https://fonts.googleapis.com" />'), null);
  });
});
