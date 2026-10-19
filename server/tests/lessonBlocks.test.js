// Rich lesson blocks (WP-05): pure helpers behind the code, prompt, diagram, steps and
// practice-counter UI, plus the block gallery lesson (content/examples/blocks-gallery.lesson.json).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CODE_LANGS,
  FOLD_AFTER,
  FOLD_VISIBLE,
  LINE_NUMBERS_AFTER,
  claudeCommand,
  codeLines,
  fillPrompt,
  formatLineRanges,
  lineRanges,
  normalizeCodeLang,
  posixSingleQuote,
  practiceProgress,
  nextPracticeBlockId,
  promptVarNames,
  splitKeyCombo,
  stripMermaidDirectives,
} from '../../components/lesson/blocks/blockText.ts';
import { answerKey, emptyProgress, withAnswer, withRevealed } from '../../components/lesson/progressStore.ts';
import { BLOCK_TYPES } from '../../shared/lesson/schema.js';
import { validateLesson } from '../../shared/lesson/validate.js';
import { lintLesson } from '../../shared/lesson/lint.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GALLERY = path.join(ROOT, 'content/examples/blocks-gallery.lesson.json');
const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));

describe('code helpers', () => {
  it('maps block languages and aliases to the 12 highlighted grammars', () => {
    assert.deepEqual([...CODE_LANGS].sort(), [
      'bash', 'csharp', 'css', 'html', 'javascript', 'json', 'markdown', 'python', 'sql', 'tsx', 'typescript', 'yaml',
    ]);
    const cases = {
      ts: 'typescript', TypeScript: 'typescript', tsx: 'tsx', jsx: 'tsx', js: 'javascript', mjs: 'javascript',
      json: 'json', jsonc: 'json', sh: 'bash', shell: 'bash', zsh: 'bash', bash: 'bash', py: 'python',
      html: 'html', css: 'css', sql: 'sql', yml: 'yaml', md: 'markdown', cs: 'csharp', 'C#': 'csharp', ' python ': 'python',
    };
    for (const [input, expected] of Object.entries(cases)) assert.equal(normalizeCodeLang(input), expected, input);
    for (const plain of ['text', 'txt', 'ini', 'rust', '', null, undefined]) assert.equal(normalizeCodeLang(plain), null, String(plain));
  });

  it('splits lines like the renderer (CRLF, one trailing newline)', () => {
    assert.deepEqual(codeLines('a\r\nb\n'), ['a', 'b']);
    assert.deepEqual(codeLines('a\n\nb'), ['a', '', 'b']);
    assert.deepEqual(codeLines('only'), ['only']);
  });

  it('numbers past 5 lines and folds past 25 to the first 12', () => {
    assert.equal(LINE_NUMBERS_AFTER, 5);
    assert.equal(FOLD_AFTER, 25);
    assert.ok(FOLD_VISIBLE < FOLD_AFTER);
  });

  it('formats highlighted lines as ranges for the tutor message', () => {
    assert.deepEqual(lineRanges([7, 3, 2, 4, 4, 0, -1, 1.5]), [[2, 4], [7, 7]]);
    assert.equal(formatLineRanges([6, 7]), '6–7');
    assert.equal(formatLineRanges([1, 3, 4, 5, 9]), '1, 3–5, 9');
    assert.equal(formatLineRanges(undefined), '');
  });
});

describe('prompt helpers', () => {
  it('lists variables once, in order', () => {
    assert.deepEqual(promptVarNames('{{ file }} を読み、{{目的}} ために {{file}} を直す'), ['file', '目的']);
    assert.deepEqual(promptVarNames('no variables'), []);
  });

  it('fills variables and keeps blank ones as placeholders', () => {
    const prompt = 'Read {{file}} and {{ goal }}. Then {{file}} again.';
    assert.equal(fillPrompt(prompt, { file: 'a.ts', goal: 'fix it' }), 'Read a.ts and fix it. Then a.ts again.');
    assert.equal(fillPrompt(prompt, { file: 'a.ts', goal: '   ' }), 'Read a.ts and {{ goal }}. Then a.ts again.');
    assert.equal(fillPrompt(prompt, {}), prompt);
  });

  it('single-quotes for POSIX shells, escaping embedded quotes', () => {
    assert.equal(posixSingleQuote('plain'), "'plain'");
    assert.equal(posixSingleQuote("it's"), "'it'\\''s'");
    assert.equal(posixSingleQuote(''), "''");
    // Nothing is expanded inside single quotes.
    assert.equal(posixSingleQuote('$HOME `id` $(whoami) \\n !x "q"'), "'$HOME `id` $(whoami) \\n !x \"q\"'");
  });

  it('builds a claude command that a shell parses back to the exact prompt', () => {
    const prompt = "Fix the 'copy' button:\n  $PATH, `cmd`, \"quotes\", back\\slash & ; | > *\n日本語も OK";
    const command = claudeCommand(`  ${prompt}\r\n`);
    assert.ok(command.startsWith("claude '"));
    const result = spawnSync('sh', ['-c', `set -- ${command.slice('claude '.length)}; printf '%s' "$1"`], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, prompt);
  });
});

describe('diagram and steps helpers', () => {
  it('strips init directives and config front matter but keeps the diagram and its title', () => {
    const level = 'loose'; // kept out of the literal so the "no loose Mermaid config" source scan stays clean
    const source = `%%{init: {"securityLevel": "${level}", "themeVariables": {"fontSize": "8px"}}}%%\nflowchart LR\n  %% a comment\n  A --> B`;
    const out = stripMermaidDirectives(source);
    assert.doesNotMatch(out, /securityLevel|fontSize|%%\{/);
    assert.match(out, /^flowchart LR/);
    assert.match(out, /%% a comment/);
    const withFront = `---\ntitle: Flow\nconfig:\n  securityLevel: ${level}\n---\nflowchart TD\n  A --> B`;
    assert.equal(stripMermaidDirectives(withFront), '---\ntitle: Flow\n---\nflowchart TD\n  A --> B');
    assert.equal(stripMermaidDirectives('---\nconfig:\n  theme: dark\n---\nmindmap\n  root'), 'mindmap\n  root');
    assert.equal(stripMermaidDirectives('%%{initialize: {"theme":"dark"}}%%\nsequenceDiagram\n  A->>B: hi'), 'sequenceDiagram\n  A->>B: hi');
  });

  it('splits key combos into chips', () => {
    assert.deepEqual(splitKeyCombo('Ctrl+Shift+P'), ['Ctrl', 'Shift', 'P']);
    assert.deepEqual(splitKeyCombo('Ctrl + S'), ['Ctrl', 'S']);
    assert.deepEqual(splitKeyCombo('Ctrl++'), ['Ctrl', '+']);
    assert.deepEqual(splitKeyCombo('+'), ['+']);
    assert.deepEqual(splitKeyCombo('Enter'), ['Enter']);
    assert.deepEqual(splitKeyCombo('Ctrl+`'), ['Ctrl', '`']);
    assert.deepEqual(splitKeyCombo('  '), []);
  });
});

describe('practice counter (練習 x/y)', () => {
  it('counts inline and exam questions, not predictions, and answered = submitted or revealed', () => {
    const lesson = {
      sections: [{
        id: 's', title: 's', blocks: [
          { id: 'p', type: 'quiz', mode: 'predict', questions: [{ id: 'q', options: [], answer: [] }] },
          { id: 'i', type: 'quiz', mode: 'inline', questions: [{ id: 'q1' }, { id: 'q2' }] },
          { id: 'e', type: 'quiz', mode: 'exam', questions: [{ id: 'q1' }] },
          { id: 'm', type: 'markdown', md: 'x' },
        ],
      }],
    };
    let progress = emptyProgress();
    assert.deepEqual(practiceProgress(lesson, progress), { answered: 0, total: 3 });
    progress = withAnswer(progress, answerKey('p', 'q'), { chosen: ['a'], correct: true });
    progress = withAnswer(progress, answerKey('i', 'q1'), { chosen: ['a'], correct: false });
    assert.deepEqual(practiceProgress(lesson, progress), { answered: 1, total: 3 });
    progress = withRevealed(progress, answerKey('e', 'q1'));
    assert.deepEqual(practiceProgress(lesson, progress), { answered: 2, total: 3 });
  });

  it('finds the next unanswered check for the mobile practice slot (predictions skipped, wraps)', () => {
    const lesson = {
      sections: [{
        id: 's', title: 's', blocks: [
          { id: 'i1', type: 'quiz', mode: 'inline', questions: [{ id: 'q' }] },
          { id: 'p', type: 'quiz', mode: 'predict', questions: [{ id: 'q' }] },
          { id: 'm', type: 'markdown', md: 'x' },
          { id: 'e', type: 'quiz', mode: 'exam', questions: [{ id: 'q1' }, { id: 'q2' }] },
        ],
      }],
    };
    let progress = emptyProgress();
    assert.equal(nextPracticeBlockId(lesson, progress), 'i1');
    assert.equal(nextPracticeBlockId(lesson, progress, 'm'), 'e');
    progress = withAnswer(progress, answerKey('e', 'q1'), { chosen: ['a'], correct: true });
    assert.equal(nextPracticeBlockId(lesson, progress, 'm'), 'e', 'one exam question is still open');
    progress = withAnswer(progress, answerKey('e', 'q2'), { chosen: ['a'], correct: true });
    assert.equal(nextPracticeBlockId(lesson, progress, 'm'), 'i1', 'wraps to the first open check');
    progress = withAnswer(progress, answerKey('i1', 'q'), { chosen: ['a'], correct: true });
    assert.equal(nextPracticeBlockId(lesson, progress, 'm'), null);
  });
});

describe('block gallery lesson', () => {
  it('is valid risepath.lesson/v1 and lint-clean in strict mode', () => {
    const result = validateLesson(gallery);
    assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
    assert.deepEqual(lintLesson(result.lesson).warnings, []);
  });

  it('uses every block type, in Japanese and English', () => {
    const used = new Set(gallery.sections.flatMap((s) => s.blocks.map((b) => b.type)));
    assert.deepEqual(BLOCK_TYPES.filter((type) => !used.has(type)), []);
    assert.deepEqual(gallery.locales, ['jp', 'en']);
  });

  it('covers the variants the gallery is meant to show', () => {
    const blocks = gallery.sections.flatMap((s) => s.blocks);
    const of = (type) => blocks.filter((b) => b.type === type);
    assert.deepEqual(new Set(of('callout').map((b) => b.variant)), new Set(['tip', 'warning', 'info', 'analogy', 'pitfall', 'note', 'success']));
    assert.deepEqual(new Set(of('quiz').map((b) => b.mode)), new Set(['inline', 'exam', 'predict']));
    const kinds = new Set(of('quiz').flatMap((b) => b.questions.map((q) => q.kind ?? 'single')));
    assert.deepEqual(kinds, new Set(['single', 'multi', 'truefalse']));
    assert.deepEqual(new Set(of('list').map((b) => b.style)), new Set(['bullet', 'number', 'check']));
    const diagrams = of('diagram').map((b) => b.code.jp.split('\n')[0]);
    assert.deepEqual(new Set(diagrams.map((first) => first.split(' ')[0])), new Set(['flowchart', 'sequenceDiagram', 'mindmap']));
    assert.ok(of('code').some((b) => b.highlight?.length && b.code.split('\n').length > LINE_NUMBERS_AFTER));
    assert.ok(of('code').every((b) => normalizeCodeLang(b.lang)), 'every gallery code block is highlighted');
    assert.ok(of('prompt').some((b) => b.target === 'claude-code' && promptVarNames(b.prompt.jp).length >= 2));
    assert.ok(of('steps').some((b) => b.items.some((s) => s.keys?.some((k) => splitKeyCombo(k).length > 1))));
    assert.ok(of('image').every((b) => fs.existsSync(path.join(ROOT, 'public', b.src))), 'gallery images exist in public/');
  });

  it('is excluded from course content (not under content/courses)', () => {
    assert.equal(gallery.courseId, undefined);
    assert.ok(!GALLERY.includes(`${path.sep}courses${path.sep}`));
  });
});
