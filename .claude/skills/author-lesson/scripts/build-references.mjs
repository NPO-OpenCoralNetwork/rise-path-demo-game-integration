#!/usr/bin/env node
/**
 * Generates two reference files of the author-lesson skill from their sources of truth:
 *   references/block-cookbook.md ← content/examples/blocks-gallery.lesson.json (good examples),
 *                                  content/schema/lesson.schema.json (fields), shared/lesson/lint.js (rules)
 *   references/rubric.md         ← content/schema/rubric.v1.json
 *
 * Usage:
 *   node .claude/skills/author-lesson/scripts/build-references.mjs          # write
 *   node .claude/skills/author-lesson/scripts/build-references.mjs --check  # exit 1 when stale
 *
 * Re-run it after changing the gallery lesson, the lesson schema, the lint rules or the rubric.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LINT_RULES } from '../../../../shared/lesson/lint.js';
import { BLOCK_TYPES } from '../../../../shared/lesson/constants.js';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(SKILL_DIR, '../../..');
const GALLERY = 'content/examples/blocks-gallery.lesson.json';

/** Block type → JSON Schema $defs name. */
const DEF_NAME = {
  markdown: 'MarkdownBlock', callout: 'CalloutBlock', list: 'ListBlock', definitions: 'DefinitionsBlock',
  table: 'TableBlock', code: 'CodeBlock', prompt: 'PromptBlock', diagram: 'DiagramBlock', image: 'ImageBlock',
  quiz: 'QuizBlock', flashcards: 'FlashcardsBlock', steps: 'StepsBlock', checklist: 'ChecklistBlock',
  summary: 'SummaryBlock', askTutor: 'AskTutorBlock',
};

/**
 * Hand-written guidance per block. `good` is a block id in the gallery lesson; `bad` is a small
 * counter-example with the lint rule it trips (or `null` when only a reviewer would catch it).
 *
 * @type {Record<string, { job: string, role: string, use: string[], avoid: string[], good: string,
 *   bad: { block: Record<string, unknown>, rule: string | null, why: string } }>}
 */
export const GUIDE = {
  markdown: {
    job: '新しい考えを読む / read a new idea',
    role: 'concept, example',
    use: [
      'Explanation prose. One idea per block; at most 160 JP characters per paragraph and 60 per sentence (80 EN words).',
      '`style: "lead"` for the first paragraph of a lesson or section; `"quote"` for a quoted statement.',
      'Inline markdown only: **bold** (at most 1–2 per paragraph), `code`, [descriptive link](https://…), [[glossary term]].',
    ],
    avoid: [
      'Lists written as paragraphs, and "**Label**: text" lines (use `definitions`).',
      'Raw HTML, headings inside md (sections have titles), *italics* in Japanese (use 「」).',
    ],
    good: 'prose-md',
    bad: {
      block: { id: 'intro', type: 'markdown', md: 'プログラミングは簡単です。誰でもすぐに書けるようになります。変数や関数、条件分岐、繰り返し、配列、オブジェクト、クラス、非同期処理など、覚えることはたくさんありますが、ひとつずつ覚えれば大丈夫です。まずは全部をざっと眺めて、雰囲気をつかむところから始めましょう。分からなくても気にせず、どんどん先へ進んでください。' },
      rule: 'banned-phrase',
      why: 'Pressure phrases (簡単です, 誰でも), eight new terms at once, and a paragraph over 160 characters (paragraph-length). Split by idea and define each term where it is first needed.',
    },
  },
  callout: {
    job: 'たとえで直観をつかむ・つまずきを避ける / grasp by analogy, avoid a pitfall',
    role: 'concept, pitfalls',
    use: [
      '`analogy` before the formal definition (never quiz the analogy itself). In a `level: "beginner"` lesson, an everyday analogy before the definition of each new term, saying what maps to what; one may cover a segment\'s related terms, and it may sit in the text instead.',
      '`pitfall` for one real, common error per segment, with how to notice and fix it.',
      '`warning` for data loss, security or cost; `tip`, `info`, `note`, `success` (expected result after a task).',
      'At most 2 callouts per section, at most 3 sentences each.',
    ],
    avoid: [
      'Stacking callouts, or putting the main explanation in one.',
      'Vague warnings ("注意してください") that do not say what to do.',
    ],
    good: 'prose-analogy',
    bad: {
      block: { id: 'warn', type: 'callout', variant: 'warning', md: 'エラーが出ることがあるので注意してください。' },
      rule: null,
      why: 'Says neither which error, nor why, nor what to do. A pitfall callout names the mistake, the symptom and the fix.',
    },
  },
  list: {
    job: '並列の項目を見渡す / scan parallel items',
    role: 'concept, practice',
    use: [
      '3–7 parallel, short items. `style: "number"` for an order without expected results (otherwise use `steps`), `"check"` for criteria.',
    ],
    avoid: ['More than 7 items (split or group).', 'Items shaped "**Label**: description" (use `definitions`).'],
    good: 'prose-list',
    bad: {
      block: { id: 'parts', type: 'list', items: ['**フロントエンド**: 画面の部分', '**バックエンド**: サーバーの部分', '**データベース**: データの保存場所'] },
      rule: 'list-definitions',
      why: 'Every item is a term plus its meaning; a definitions block renders and reads better.',
    },
  },
  definitions: {
    job: '用語を覚える / learn terms',
    role: 'concept',
    use: [
      'The first definition of new terms, at most 3 new terms per segment. Mirror each term in `glossary` and mark later uses as [[term]].',
      'Katakana terms carry the English on first use: 参照（reference）.',
    ],
    avoid: ['A glossary dump of terms the lesson never uses.', 'Defining a term after it has already been used.'],
    good: 'prose-defs',
    bad: {
      block: { id: 'terms', type: 'definitions', items: [{ term: 'API', md: '色々なものをつなぐもの。' }] },
      rule: null,
      why: '"色々なものをつなぐもの" explains nothing. A definition says what it is, what it does, and an example the learner knows.',
    },
  },
  table: {
    job: '比べる / compare',
    role: 'concept, example',
    use: ['Compare 2–4 things across the same attributes. At most 6 columns; a caption that states what the comparison shows.'],
    avoid: ['Tables for sequences (use `steps`) or for layout.', 'Long prose inside cells.'],
    good: 'visuals-table',
    bad: {
      block: { id: 'cmp', type: 'table', columns: ['名前', '速さ', '価格', '難しさ', '人気', '対応OS', '日本語', 'サポート'], rows: [['A', '速い', '無料', '低', '高', '全部', 'あり', 'メール']] },
      rule: 'table-columns',
      why: '8 columns do not fit a phone. Keep the 3–4 attributes that matter for the objective.',
    },
  },
  code: {
    job: 'コードを読む・写す / read or type code',
    role: 'example, practice',
    use: [
      'Code the learner reads or runs: always `lang` and `filename`, at most 25 lines, runnable as written, `highlight` the lines the text talks about.',
      'Ask for a prediction before showing output; state the expected output after it, not in comments.',
    ],
    avoid: ['Instructions to an AI (use `prompt`).', 'Pseudo-code that looks runnable but is not.'],
    good: 'code-ts',
    bad: {
      block: { id: 'ask-ai', type: 'code', lang: 'text', filename: 'prompt.txt', code: 'このファイルを読んで、改善点を教えてください。' },
      rule: 'code-should-be-prompt',
      why: 'An instruction to an AI belongs in a prompt block, which adds copy, variables and the expected answer.',
    },
  },
  prompt: {
    job: 'AI に依頼する / instruct an AI',
    role: 'example, practice',
    use: [
      'Every example instruction to an AI tool. `target` (claude-code, chatgpt, …), `{{variables}}` with `vars[].hint`, and `expect`: what a good answer looks like (shown collapsed — doubles as the model answer).',
      'In a multi-locale lesson the variable names differ per locale; list each name in `vars` (see the gallery).',
    ],
    avoid: ['Vague asks ("いい感じに作って").', 'Secrets, keys or personal data in the prompt.'],
    good: 'practice-prompt-chat',
    bad: {
      block: { id: 'make-app', type: 'prompt', prompt: 'いい感じのアプリを作って。' },
      rule: null,
      why: 'No goal, constraint or expected result, so the learner cannot tell a good answer. Add context, `{{variables}}` and `expect`.',
    },
  },
  diagram: {
    job: '構造・流れを見る / see structure or flow',
    role: 'concept',
    use: [
      'Only for structure, process, state change or comparison. Mermaid flowchart, sequence, er or mindmap; at most 12 nodes.',
      'Labels in the lesson language (localize `code` per locale when labels differ), the same terms as the text.',
      '`caption` states the takeaway; `alt` is one sentence; `description` holds the long explanation.',
      'Prefer `flowchart TD` for chains longer than 4 nodes: wide LR diagrams scroll sideways on phones.',
    ],
    avoid: ['Decorative diagrams that repeat the text.', 'English-only labels in a Japanese lesson.', 'Mermaid init directives or styling (the reader themes diagrams).'],
    good: 'visuals-flow',
    bad: {
      block: { id: 'flow', type: 'diagram', engine: 'mermaid', code: 'graph LR\n  User --> Frontend --> API --> Backend --> DB', alt: 'Web app flow' },
      rule: 'diagram-caption',
      why: 'No caption, English labels in a JP lesson, and a long LR chain that overflows a phone.',
    },
  },
  image: {
    job: '画面を確かめる / check a screen',
    role: 'example, practice',
    use: ['Teaching images only: screenshots, before/after comparisons. `alt` says what matters in the picture; `caption` ties it to the text.'],
    avoid: ['Stock photos or decoration (they lower recall).', 'Text baked into images.', 'Invented URLs: use a file that exists under public/, or ask the owner for one.'],
    good: 'visuals-image',
    bad: {
      block: { id: 'hero', type: 'image', src: 'https://images.unsplash.com/photo-123', alt: '笑顔でパソコンを使う人' },
      rule: 'image-decorative',
      why: 'A stock photo teaches nothing and distracts. Show the actual screen the learner will see, or nothing.',
    },
  },
  quiz: {
    job: '予想する・思い出す・確かめる / predict, retrieve, check',
    role: 'hook (predict), concept/example (inline), check (exam)',
    use: [
      '`predict` in the hook: ungraded; the explanation reveals the answer.',
      '`inline` at least once per 2 content sections, 1–2 questions, right after the idea.',
      '`exam` in the check section: covers every objective, at least one apply-level question.',
      'Every question: `objectiveId`, 3–4 options, `feedback` on every wrong option (≤ 2 sentences naming the misconception), `explanation`, `bloom`.',
    ],
    avoid: ['Quizzing the analogy, the anecdote or trivia.', '"All of the above"; answers findable by matching words in the previous sentence.'],
    good: 'prose-check',
    bad: {
      block: { id: 'q1', type: 'quiz', mode: 'inline', questions: [{ id: 'q1a', prompt: 'API は何の略？', options: [{ id: 'a', md: 'Application Programming Interface' }, { id: 'b', md: 'Apple Pie Inc.' }], answer: ['a'], explanation: 'API は Application Programming Interface の略です。', objectiveId: 'o1' }] },
      rule: 'quiz-feedback',
      why: 'Recall of an acronym, a joke distractor and no feedback on the wrong option. Ask the learner to apply the idea in a new situation, with one distractor per real misconception.',
    },
  },
  flashcards: {
    job: '間隔をあけて復習する / spaced review',
    role: 'summary',
    use: ['4–8 cards per lesson, one fact or cue each; the front is a question or cue, the back a short answer.'],
    avoid: ['Copying paragraphs onto cards.', 'More than 8 cards.'],
    good: 'wrapup-cards',
    bad: {
      block: { id: 'cards', type: 'flashcards', cards: [{ id: 'c1', front: 'API', back: 'Application Programming Interface。ソフトウェア同士をつなぐ窓口で、決まった形式でリクエストを送るとレスポンスが返ってきます。REST や GraphQL などの種類があります。' }] },
      rule: 'flashcards-count',
      why: 'One card, and its back is a paragraph. Use 4–8 cards with one short answer each.',
    },
  },
  steps: {
    job: '手順をたどる / follow a procedure',
    role: 'example (worked), practice',
    use: [
      'Procedures of at most 8 steps. Each step: a subgoal title, `expect` (what the learner sees), `keys` for shortcuts, `hint`, `troubleshoot`.',
      'Worked example: the same subgoal titles reused in the text; a faded version later leaves 1–2 steps for the learner.',
      '`cite` the sources the commands, menus and expected results come from. Name a menu, button, screen or shortcut only as the official docs of the pinned version show it; when you cannot check it, describe the goal instead of the clicks.',
      'Steps that only ask the learner to write or decide have nothing to cite: keep the `steps-cite` warning and give the reason in the report.',
    ],
    avoid: ['Steps without an expected result.', 'Ten-step marathons (split into two blocks).', 'Menus, buttons and shortcuts written from memory.', 'A cite to a source that does not say it, just to quiet the lint.'],
    good: 'practice-steps',
    bad: {
      block: { id: 'setup', type: 'steps', items: [{ id: 's1', title: 'ターミナルを開く' }, { id: 's2', title: 'npm install を実行する' }] },
      rule: 'steps-expect',
      why: 'The learner cannot tell whether a step worked, and nothing says where the steps come from (`steps-cite`). Add `expect` to every step and `cite` the docs they follow.',
    },
  },
  checklist: {
    job: 'できたか確かめる / confirm success',
    role: 'practice',
    use: ['Success criteria of a practice task, or a setup check. At most 7 items; ticks are saved per learner.'],
    avoid: ['Items that are instructions (use `steps`).'],
    good: 'practice-checklist',
    bad: {
      block: { id: 'done', type: 'checklist', items: [{ id: 'c1', label: '頑張った' }] },
      rule: null,
      why: 'Not checkable. Each item names an observable result ("ブラウザに一覧が表示される").',
    },
  },
  summary: {
    job: '要点を持ち帰る / take away the key points',
    role: 'summary (required in the last section)',
    use: ['3–5 points, each an outcome tied to an objective. Place it after the recap questions.'],
    avoid: ['Repeating headings; new information.'],
    good: 'wrapup-summary',
    bad: {
      block: { id: 'sum', type: 'summary', points: ['API について学びました。', 'フロントエンドについて学びました。'] },
      rule: 'summary-points',
      why: 'Two points that list topics, not takeaways. Write 3–5 statements the learner can now use.',
    },
  },
  askTutor: {
    job: 'AI先生に聞く / ask the AI tutor',
    role: 'concept, practice, reflection',
    use: ['2–3 specific questions a learner is likely to have at this point; they open the AI tutor grounded in the lesson.'],
    avoid: ['Generic suggestions ("質問はありますか？").'],
    good: 'code-ask',
    bad: {
      block: { id: 'ask', type: 'askTutor', suggestions: ['何でも聞いてください'] },
      rule: null,
      why: 'Gives the learner nothing to start from. Suggest the questions a confused learner would actually ask here.',
    },
  },
};

/** Section roles in reading order, with the blocks they usually hold. */
const ROLES = [
  ['hook', 'markdown (the problem, ≤ 3 sentences) + quiz mode "predict"'],
  ['concept', 'markdown, callout analogy, definitions, diagram, table + quiz mode "inline" (one idea per section)'],
  ['example', 'steps or code as a worked example with subgoal labels, then quiz "inline"'],
  ['practice', 'markdown (task + success criteria), steps or prompt (hints in `hint`/`troubleshoot`, model answer in `expect`), checklist'],
  ['pitfalls', 'callout pitfall (one real mistake: symptom → cause → fix); optional if the segments already cover it'],
  ['check', 'quiz mode "exam" covering every objective, at least one apply question'],
  ['summary', 'summary (3–5 points) + flashcards (4–8)'],
  ['reflection', 'markdown (one question to think about) + askTutor; the reader adds a per-objective confidence check at the end'],
];

const COMMON_FIELDS = new Set(['id', 'type', 'slide', 'narration', 'cite']);

/** @param {string} rel */
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/**
 * Field list of one object schema from the generated JSON Schema, plus one line per nested
 * array of objects (quiz questions → options, steps items, …).
 *
 * @param {any} def
 * @param {any} defs
 * @param {string} [label]
 * @param {number} [depth]
 * @returns {string[]} lines
 */
function fieldLines(def, defs, label = 'Fields', depth = 0) {
  const resolve = (/** @type {any} */ s) => (s && s.$ref ? defs[s.$ref.replace('#/$defs/', '')] : s);
  const required = new Set(def.required || []);
  const nested = [];
  const fields = Object.entries(def.properties || {})
    .filter(([name]) => depth > 0 || !COMMON_FIELDS.has(name))
    .map(([name, prop]) => {
      const p = /** @type {any} */ (prop);
      const values = p.enum ? ` (${p.enum.map((/** @type {string} */ v) => `\`${v}\``).join(' | ')})` : p.const ? ` (\`${p.const}\`)` : '';
      const desc = p.description && name !== 'id' ? ` — ${String(p.description).replace(/\.$/, '')}` : '';
      const item = p.type === 'array' ? resolve(p.items) : null;
      if (item && item.properties && depth < 2) nested.push(...fieldLines(item, defs, `Each \`${name}\` item`, depth + 1));
      return `\`${name}\`${required.has(name) ? '' : '?'}${values}${desc}`;
    });
  return [`${label}: ${fields.join('; ')}.`, ...nested];
}

/**
 * JSON with short objects and arrays kept on one line, so examples stay readable.
 *
 * @param {unknown} value
 * @param {string} [indent]
 * @returns {string}
 */
export function compactJson(value, indent = '') {
  const flat = JSON.stringify(value);
  if (flat === undefined) return 'null';
  if (value === null || typeof value !== 'object' || flat.length + indent.length <= 110) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((v) => `${inner}${compactJson(v, inner)}`).join(',\n')}\n${indent}]`;
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${compactJson(v, inner)}`).join(',\n')}\n${indent}}`;
}

/** @param {unknown} value */
const jsonBlock = (value) => ['```json', compactJson(value), '```'].join('\n');

/** @returns {string} */
export function buildCookbook() {
  const gallery = readJson(GALLERY);
  const schema = readJson('content/schema/lesson.schema.json');
  /** @type {Map<string, any>} */
  const blocks = new Map();
  for (const section of gallery.sections) for (const block of section.blocks) blocks.set(block.id, { block, section: section.id });

  const out = [
    '<!-- Generated by .claude/skills/author-lesson/scripts/build-references.mjs. Do not edit by hand. -->',
    '# Block cookbook (risepath.lesson/v1)',
    '',
    `Which block to use for which teaching job. Good examples are copied from the block gallery (\`${GALLERY}\`,`,
    'rendered at `/dev/blocks?dev=1`); bad examples show the mistake and the lint rule it trips.',
    'Every block also accepts `id` (required, unique in the lesson), `cite` (source ids), `narration` and `slide`.',
    '',
    '## Pick a block by what the learner should do',
    '',
    '| 学習者にさせたいこと / learner job | Block | Usual section role |',
    '|---|---|---|',
    ...BLOCK_TYPES.map((type) => `| ${GUIDE[type].job} | [\`${type}\`](#${type.toLowerCase()}) | ${GUIDE[type].role} |`),
    '',
    '## Section roles, in reading order',
    '',
    '| role | Typical blocks |',
    '|---|---|',
    ...ROLES.map(([role, blocksText]) => `| \`${role}\` | ${blocksText} |`),
    '',
    '## Blocks',
  ];

  for (const type of BLOCK_TYPES) {
    const guide = GUIDE[type];
    const def = schema.$defs[DEF_NAME[/** @type {keyof typeof DEF_NAME} */ (type)]];
    const example = blocks.get(guide.good) ?? [...blocks.values()].find((b) => b.block.type === type);
    const rules = Object.entries(LINT_RULES).filter(([rule]) => rule === guide.bad.rule || lintRulesFor(type).includes(rule));
    out.push(
      '',
      `### ${type}`,
      '',
      def?.description ? `${def.description}` : '',
      '',
      fieldLines(def, schema.$defs).join('\n\n'),
      '',
      '**Use**',
      ...guide.use.map((line) => `- ${line}`),
      '',
      '**Avoid**',
      ...guide.avoid.map((line) => `- ${line}`),
    );
    if (rules.length) {
      out.push('', `**Lint**: ${rules.map(([rule, text]) => `\`${rule}\` (${text})`).join('; ')}`);
    }
    if (example) {
      out.push('', `**Good** — gallery block \`${example.block.id}\` (section \`${example.section}\`):`, '', jsonBlock(example.block));
    }
    out.push(
      '',
      `**Bad**${guide.bad.rule ? ` — trips \`${guide.bad.rule}\`` : ' — a reviewer catches this'}:`,
      '',
      jsonBlock(guide.bad.block),
      '',
      `Why: ${guide.bad.why}`,
    );
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/**
 * Lint rules that inspect a block type (kept in sync with shared/lesson/lint.js by the test).
 *
 * @param {string} type
 * @returns {string[]}
 */
export function lintRulesFor(type) {
  /** @type {Record<string, string[]>} */
  const map = {
    markdown: ['paragraph-length', 'sentence-length', 'banned-phrase'],
    callout: ['callout-count'],
    list: ['list-length', 'list-definitions'],
    table: ['table-columns'],
    code: ['code-filename', 'code-length', 'code-should-be-prompt'],
    diagram: ['diagram-caption'],
    image: ['image-decorative'],
    quiz: ['quiz-feedback', 'feedback-length', 'inline-quiz-density', 'objective-unassessed'],
    flashcards: ['flashcards-count'],
    steps: ['steps-length', 'steps-expect', 'steps-cite'],
    summary: ['summary-missing', 'summary-points'],
  };
  return map[type] ?? [];
}

/** @returns {string} */
export function buildRubric() {
  const rubric = readJson('content/schema/rubric.v1.json');
  const levels = Object.entries(rubric.scale.levels).sort((a, b) => Number(b[0]) - Number(a[0]));
  const out = [
    '<!-- Generated by .claude/skills/author-lesson/scripts/build-references.mjs from content/schema/rubric.v1.json. Do not edit by hand. -->',
    `# ${rubric.title.jp} / ${rubric.title.en} (\`${rubric.id}\`)`,
    '',
    rubric.description,
    '',
    '## Pass rule',
    '',
    `- ${rubric.pass.rule}`,
    `- Thresholds: each criterion ≥ ${rubric.pass.minEach}, mean ≥ ${rubric.pass.minMean}.`,
    `- ${rubric.notApplicable}`,
    '- Check reviews with `node .claude/skills/review-lesson/scripts/check-review.mjs <review.json>…` (exit 0 = pass).',
    '',
    '## Scale',
    '',
    '| Score | 意味 | Meaning |',
    '|---|---|---|',
    ...levels.map(([score, text]) => `| ${score} | ${/** @type {any} */ (text).jp} | ${/** @type {any} */ (text).en} |`),
    '',
    '## Criteria',
    '',
    '| id | 観点 / Criterion | Lint assist |',
    '|---|---|---|',
    ...rubric.criteria.map((/** @type {any} */ c) => `| \`${c.id}\` | ${c.title.jp} / ${c.title.en} | ${c.lint.length ? c.lint.map((/** @type {string} */ r) => `\`${r}\``).join(', ') : '—'} |`),
  ];
  for (const c of rubric.criteria) {
    out.push(
      '',
      `### \`${c.id}\` ${c.title.jp} / ${c.title.en}`,
      '',
      `${c.question.jp}`,
      `${c.question.en}`,
      '',
      ...['4', '3', '2'].map((score) => `- **${score}**: ${c.anchors[score].jp} — ${c.anchors[score].en}`),
      '- **1–0**: mostly or entirely missing, or harmful.',
    );
  }
  out.push(
    '',
    '## Reviewer output',
    '',
    'Reviewers return JSON matching `content/schema/review.v1.json`: `lessonId`, `file`, `lessonHash`, `reviewer`,',
    '`rubricVersion: "rubric.v1"`, `scores[] {id, score 0–4, evidence, blockIds?}`, `mustFix[] {criterion, blockId, issue, fix,',
    'screenshot?}`, `niceToHave[]`, `verdict` (pass | revise | reject) and `summary`. Evidence quotes the lesson or names block',
    'ids; a fix is specific enough to apply without guessing. `lessonHash` is the version the reviewer read',
    '(`node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --hash`); `check-review.mjs` refuses a review whose',
    '`lessonHash` is not the lesson\'s current hash (stale), and one without it (always).',
    '',
    '## Review rounds',
    '',
    '- Round 1 is a full review (`mode` absent or `"full"`): every criterion in the reviewer\'s scope is scored afresh.',
    '- A later round is a **verification round** (`"mode": "verify"`) when the author applied the previous must-fix items and',
    '  `node .claude/skills/review-lesson/scripts/review-scope.mjs <file> --since <revision> --expect-hash <previous lessonHash>`',
    '  exits 0. The reviewer marks each open must-fix `resolved` or `unresolved` in `resolved[] {blockId, criterion, status,',
    '  evidence, fixedIn?}` (a must-fix is resolved only by a change since the round that last had it open; `fixedIn` names the',
    '  changed block when the fix is not in `blockId`; a lesson-wide item, `blockId` `"lesson"`, needs a changed lesson-level',
    '  field or a `fixedIn` whose blocks all changed), reviews every changed or new block in full, adds `mustFix` only for',
    '  errors in changed blocks or regressions the changes caused, re-scores the criteria the changes affect and copies the',
    '  others with `carriedOver: true` (every criterion the previous review scored is listed). `verifies {reviewedRevision,',
    '  previousReview, changed, changedShare?, fullReviewRequired}` records what was verified; `previousReview` is a recorded',
    '  round, `<commit id>:<reports path>` or the snapshot copy, never the working-tree reports file or any other copy, and',
    '  commits are named by id (7–40 lowercase hex digits), never `HEAD`, a branch or a tag.',
    '- A full review is still required when a section was added, removed, reordered or changed its role, the objectives changed,',
    '  or more than 30% of the lesson\'s parts (each block, each section\'s own fields, each lesson field, each glossary and source',
    '  entry) or of its blocks changed (`review-scope.mjs` exits 1).',
    '- `check-review.mjs` counts as open must-fix items every `unresolved` entry, every open item without an entry and every',
    '  `resolved` entry without a change; open items carry over. The pass rule above is the same in both modes.',
    '  It refuses a verification (exit 2) when the previous review cannot be loaded, has no `lessonHash` or is itself an invalid',
    '  round (a previous verification is followed back to its full review), a commit is named by a ref instead of its id, the',
    '  scope it recomputes from `reviewedRevision` requires a full review or has changes `verifies.changed` leaves out, a',
    '  criterion the previous review scored is missing, or a reviewer of the verified round (the reviews recorded next to it',
    '  that read the same version) is left out of the gate run. Rules: `.claude/skills/review-lesson/SKILL.md`.',
  );
  return `${out.join('\n')}\n`;
}

/** @returns {Record<string, string>} path relative to the skill directory → content */
export function referenceFiles() {
  return {
    'references/block-cookbook.md': buildCookbook(),
    'references/rubric.md': buildRubric(),
  };
}

function main() {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [rel, content] of Object.entries(referenceFiles())) {
    const file = path.join(SKILL_DIR, rel);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const shown = path.relative(ROOT, file);
    if (check) {
      if (current !== content) {
        stale += 1;
        console.error(`✗ ${shown} is out of date (run node .claude/skills/author-lesson/scripts/build-references.mjs)`);
      } else console.log(`✓ ${shown}`);
    } else if (current === content) {
      console.log(`= ${shown} (unchanged)`);
    } else {
      fs.writeFileSync(file, content);
      console.log(`✓ ${shown}`);
    }
  }
  return stale ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
