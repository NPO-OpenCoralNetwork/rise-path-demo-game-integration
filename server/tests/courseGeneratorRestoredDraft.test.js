/**
 * The course generator (components/features/ai/CourseGeneratorView.tsx) with a restored draft shows
 * what the draft is waiting for. Before, the restore message and the approval card asked the learner
 * to approve 「上記の内容」, but neither the requirements (intake_json) nor the roadmap (modules_json)
 * was on screen, though GET /api/v2/ai/drafts returns both. Now the restore message carries a panel
 * (RestoredDraftPanel.tsx) built from the saved draft by restoredDraft.ts, without calling the model,
 * and 「修正を依頼」 takes the learner to the composer. The pure helper is tested directly (stage
 * results shaped like the prompts' examples, and the dev mock's replies, server/llm/providers/mock.js);
 * the view and the panel by source checks, as in courseGeneratorNewCourse.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTAKE_FIELDS, restoredDraftContent, restoredDraftText } from '../../components/features/ai/restoredDraft.ts';
import { createMockProvider } from '../llm/providers/mock.js';
import { buildRequirementsPrompt } from '../services/aiPrompts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const view = read('components/features/ai/CourseGeneratorView.tsx');
const panel = read('components/features/ai/RestoredDraftPanel.tsx');

/** The source from `start` up to (not including) the first `end` after it. */
const slice = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `found: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `found after ${start}: ${end}`);
  return source.slice(from, to);
};

const LABELS = {
  jp: {
    locale: 'jp',
    fields: { goal: '学習目標', target_audience: '対象者', current_level: '現在のレベル', duration_weeks: '期間', delivery_style: '形式', constraints: '制約・条件' },
    docChapter: '章ごとの読み物',
    weeks: (n) => `${n}週間`,
    module: (n) => `モジュール ${n}`,
    hours: (n) => `約${n}時間`,
    minutes: (n) => `${n}分`,
  },
  en: {
    locale: 'en',
    fields: { goal: 'Goal', target_audience: 'Who it is for', current_level: 'Current level', duration_weeks: 'Length', delivery_style: 'Format', constraints: 'Constraints' },
    docChapter: 'Reading, chapter by chapter',
    weeks: (n) => `${n} ${n === 1 ? 'week' : 'weeks'}`,
    module: (n) => `Module ${n}`,
    hours: (n) => `about ${n} ${n === 1 ? 'hour' : 'hours'}`,
    minutes: (n) => `${n} min`,
  },
};

/** A requirements stage result shaped like the prompt's example (aiPrompts.js buildRequirementsPrompt). */
const INTAKE = {
  goal: 'Python でデータ分析を学ぶ',
  target_audience: '初学者',
  current_level: 'プログラミングは未経験',
  duration_weeks: 4,
  delivery_style: 'doc_chapter',
  constraints: '週に3〜5時間',
};

/** A roadmap stage result shaped like the prompt's example (buildRoadmapPrompt). */
const MODULES = [
  {
    module_id: 'm1',
    title: { en: 'Python basics', jp: 'Python の基本' },
    objective: { en: 'Read and run short programs', jp: '短いプログラムを読んで動かす' },
    estimated_hours: 3,
    lessons: [
      { lesson_id: 'm1-l1', title: { en: 'Variables', jp: '変数' }, subtitle: { en: 'Names for values', jp: '値に名前を付ける' }, estimated_min: 15 },
      { lesson_id: 'm1-l2', title: { en: 'Lists', jp: 'リスト' }, subtitle: { en: 'Many values at once', jp: 'まとめて扱う' }, estimated_min: 20 },
    ],
  },
  {
    module_id: 'm2',
    title: { en: 'First steps with pandas', jp: 'pandas のはじめの一歩' },
    objective: { en: 'Load a table', jp: '表を読み込む' },
    estimated_hours: 1,
    lessons: [{ lesson_id: 'm2-l1', title: { en: 'DataFrame', jp: 'DataFrame' }, subtitle: { en: 'A table in Python', jp: 'Python の表' }, estimated_min: 1 }],
  },
];

/** What the dev API's mock model answers for a stage (aiGenerator.js callCourseModel's input). */
const mockStage = async (input) => {
  const { text } = await createMockProvider({ delayMs: 0 }).generate({ task: 'course.generate', input }, {});
  return JSON.parse(text);
};

const requirements = (intake, labels = LABELS.jp) => restoredDraftContent({ stage: 'requirements', intake_json: intake }, labels);
const roadmap = (modules, labels = LABELS.jp) => restoredDraftContent({ stage: 'roadmap', modules_json: modules }, labels);

describe('restoredDraft: what a restored draft is waiting for, without the model', () => {
  it('reads the fields the requirements prompt asks for', () => {
    const intakeExample = slice(buildRequirementsPrompt({}), '"intake": {', '\n  }');
    assert.deepEqual([...intakeExample.matchAll(/"(\w+)":/g)].map((m) => m[1]), ['intake', ...INTAKE_FIELDS]);
  });

  it('the requirements in the prompt order, with labels and units, in both languages', () => {
    assert.deepEqual(requirements(INTAKE), {
      stage: 'requirements',
      rows: [
        { key: 'goal', label: '学習目標', value: 'Python でデータ分析を学ぶ' },
        { key: 'target_audience', label: '対象者', value: '初学者' },
        { key: 'current_level', label: '現在のレベル', value: 'プログラミングは未経験' },
        { key: 'duration_weeks', label: '期間', value: '4週間' },
        // The reader template id is not shown as written.
        { key: 'delivery_style', label: '形式', value: '章ごとの読み物' },
        { key: 'constraints', label: '制約・条件', value: '週に3〜5時間' },
      ],
    });
    assert.deepEqual(requirements(INTAKE, LABELS.en).rows.map((row) => [row.label, row.value]), [
      ['Goal', 'Python でデータ分析を学ぶ'],
      ['Who it is for', '初学者'],
      ['Current level', 'プログラミングは未経験'],
      ['Length', '4 weeks'],
      ['Format', 'Reading, chapter by chapter'],
      ['Constraints', '週に3〜5時間'],
    ]);
  });

  it('localized values, digits, ranges, lists and fields the model added; empty ones are left out', () => {
    const intake = {
      constraints: '  週末だけ  ',
      learning_objectives: ['変数', ' ', { jp: '関数', en: 'Functions' }, { a: 1 }, 3],
      goal: { jp: 'Python を使えるようになる', en: 'Use Python' },
      duration_weeks: '6',
      前提知識: 'なし',
      note: '',
      has_prerequisites: true,
      nested: { level: { jp: 'x' } },
      current_level: null,
    };
    assert.deepEqual(requirements(intake).rows, [
      { key: 'goal', label: '学習目標', value: 'Python を使えるようになる' },
      { key: 'duration_weeks', label: '期間', value: '6週間' },
      { key: 'constraints', label: '制約・条件', value: '週末だけ' },
      // A field the model added is labelled with its key, read in English when the key is English.
      { key: 'learning_objectives', label: 'learning objectives', value: '変数、関数、3', lang: 'en' },
      { key: '前提知識', label: '前提知識', value: 'なし' },
    ]);
    assert.deepEqual(requirements(intake, LABELS.en).rows.map((row) => row.value), ['Use Python', '6 weeks', '週末だけ', '変数, Functions, 3', 'なし']);
    // `ja` stands for `jp`; the other language when the screen's is missing.
    assert.equal(requirements({ goal: { ja: 'ゴール', en: 'Goal' } }).rows[0].value, 'ゴール');
    assert.equal(requirements({ goal: { en: 'Only English' } }).rows[0].value, 'Only English');
    // A range keeps its unit; a length in words stays as written.
    assert.equal(requirements({ duration_weeks: '4-6' }).rows[0].value, '4-6週間');
    assert.equal(requirements({ duration_weeks: '4 〜 6' }, LABELS.en).rows[0].value, '4〜6 weeks');
    assert.equal(requirements({ duration_weeks: '1か月' }).rows[0].value, '1か月');
    assert.equal(requirements({ duration_weeks: 1 }, LABELS.en).rows[0].value, '1 week');
    assert.equal(requirements({ delivery_style: '動画とテキスト' }).rows[0].value, '動画とテキスト');
  });

  it('ids kept in the intake (the files attached to the conversation) are not shown; alone they are nothing to show', () => {
    const ids = ['0b6f0c2e-6f8e-4a51-9a39-3f0b8f4f9e01', '5d2c7a10-1b7e-4c3e-8f0a-2a9e7c1d4b22'];
    const intake = { goal: 'Python 入門', attached_material_ids: ids, material_id: ids[0], lesson_IDs: ids, id: 7, ideas: ['小さく作る'] };
    assert.deepEqual(requirements(intake).rows.map((row) => row.key), ['goal', 'ideas']);
    assert.doesNotMatch(restoredDraftText(requirements(intake)), /0b6f0c2e|5d2c7a10/);
    // A requirements reply that could not be read, with files attached: the panel says it could not be read.
    assert.equal(requirements({ attached_material_ids: ids }), null);
  });

  it('the roadmap: modules and lessons in order, in the screen language', () => {
    assert.deepEqual(roadmap(MODULES), {
      stage: 'roadmap',
      modules: [
        {
          label: 'モジュール 1',
          title: 'Python の基本',
          objective: '短いプログラムを読んで動かす',
          hours: '約3時間',
          lessons: [
            { title: '変数', subtitle: '値に名前を付ける', minutes: '15分' },
            { title: 'リスト', subtitle: 'まとめて扱う', minutes: '20分' },
          ],
        },
        {
          label: 'モジュール 2',
          title: 'pandas のはじめの一歩',
          objective: '表を読み込む',
          hours: '約1時間',
          lessons: [{ title: 'DataFrame', subtitle: 'Python の表', minutes: '1分' }],
        },
      ],
    });
    assert.deepEqual(roadmap(MODULES, LABELS.en).modules[1], {
      label: 'Module 2',
      title: 'First steps with pandas',
      objective: 'Load a table',
      hours: 'about 1 hour',
      lessons: [{ title: 'DataFrame', subtitle: 'A table in Python', minutes: '1 min' }],
    });
  });

  it('a module or a lesson with parts missing, or written as words alone; a module with nothing to read is left out', () => {
    const modules = [
      { objective: '基礎を固める' },
      'not a module, only words',
      { module_id: 'm3', estimated_hours: 2 },
      {
        title: { jp: '実践', en: 'Practice' },
        estimated_hours: '2-3',
        lessons: [{ subtitle: '副題だけ' }, { title: '同じ', subtitle: '同じ' }, {}, '小さなアプリ', { jp: '振り返り', en: 'Review' }, 7, { title: 'まとめ', estimated_min: 20 }],
      },
      { title: '発展', estimated_hours: '2〜3時間', lessons: { title: 'not a list' } },
    ];
    assert.deepEqual(roadmap(modules).modules, [
      { label: 'モジュール 1', title: '', objective: '基礎を固める', hours: '', lessons: [] },
      { label: 'モジュール 2', title: 'not a module, only words', objective: '', hours: '', lessons: [] },
      {
        label: 'モジュール 3',
        title: '実践',
        objective: '',
        hours: '約2-3時間',
        lessons: [
          { title: '副題だけ', subtitle: '', minutes: '' },
          { title: '同じ', subtitle: '', minutes: '' },
          { title: '小さなアプリ', subtitle: '', minutes: '' },
          { title: '振り返り', subtitle: '', minutes: '' },
          { title: 'まとめ', subtitle: '', minutes: '20分' },
        ],
      },
      { label: 'モジュール 4', title: '発展', objective: '', hours: '2〜3時間', lessons: [] },
    ]);
  });

  it('nothing to show is null: the panel then says no result could be read', () => {
    for (const intake of [null, undefined, 'text', 42, [], {}, { goal: '', flag: false, nested: { a: 1 } }]) {
      assert.equal(requirements(intake), null, JSON.stringify(intake));
    }
    // Modules with nothing to read: an empty card would still ask for approval.
    for (const modules of [null, undefined, 'text', {}, [], [2, null, true, []], [{}, { module_id: 'm1' }, { name: '基礎' }, { estimated_hours: 3, lessons: [{}] }]]) {
      assert.equal(roadmap(modules), null, JSON.stringify(modules));
    }
    // Each stage reads its own result only.
    assert.equal(restoredDraftContent({ stage: 'roadmap', intake_json: INTAKE }, LABELS.jp), null);
    assert.equal(restoredDraftContent({ stage: 'requirements', modules_json: MODULES }, LABELS.jp), null);
  });

  it('every value handed to the screen is a string, and every module has something to read, whatever the model saved', () => {
    const junk = [null, undefined, 0, -1, 2.5, NaN, Infinity, '', '   ', 'text', '3-4', true, false, [], [null], [{}], [['nested']], {}, { jp: 1 }, { jp: '' }, { en: ' x ' }, { a: { b: 'c' } }];
    const strings = (values) => values.every((value) => typeof value === 'string');
    for (const value of junk) {
      const intake = Object.fromEntries([...INTAKE_FIELDS, 'extra_field'].map((key) => [key, value]));
      for (const row of requirements(intake)?.rows ?? []) {
        assert.ok(strings([row.key, row.label, row.value]) && row.label && row.value, `${JSON.stringify(value)}: ${JSON.stringify(row)}`);
      }
      const modules = [{ title: value, objective: value, estimated_hours: value, lessons: [{ title: value, subtitle: value, estimated_min: value }, value] }, value];
      for (const module of roadmap(modules)?.modules ?? []) {
        assert.ok(strings([module.label, module.title, module.objective, module.hours]), `${JSON.stringify(value)}: ${JSON.stringify(module)}`);
        assert.ok(module.title || module.objective || module.lessons.length > 0, `${JSON.stringify(value)}: an empty module`);
        for (const lesson of module.lessons) {
          assert.ok(strings([lesson.title, lesson.subtitle, lesson.minutes]) && lesson.title, `${JSON.stringify(value)}: ${JSON.stringify(lesson)}`);
        }
      }
    }
  });

  it('the dev mock\'s stage replies (what the local stack shows) give every prompt field and every module with its lessons', async () => {
    const { intake } = await mockStage({ stage: 'requirements', message: 'Python入門' });
    assert.deepEqual(requirements(intake).rows.map((row) => row.key), [...INTAKE_FIELDS]);
    const { modules } = await mockStage({ stage: 'roadmap', intake });
    const content = roadmap(modules);
    assert.equal(content.modules.length, modules.length);
    content.modules.forEach((module, index) => {
      assert.ok(module.title && module.objective && module.hours, JSON.stringify(module));
      assert.equal(module.lessons.length, modules[index].lessons.length);
    });
  });

  it('the plain text a report of the panel sends', () => {
    assert.equal(
      restoredDraftText(requirements(INTAKE)),
      '学習目標: Python でデータ分析を学ぶ\n対象者: 初学者\n現在のレベル: プログラミングは未経験\n期間: 4週間\n形式: 章ごとの読み物\n制約・条件: 週に3〜5時間',
    );
    assert.equal(
      restoredDraftText(roadmap(MODULES)),
      'モジュール 1: Python の基本 (約3時間)\n短いプログラムを読んで動かす\n- 変数: 値に名前を付ける (15分)\n- リスト: まとめて扱う (20分)\n\n'
        + 'モジュール 2: pandas のはじめの一歩 (約1時間)\n表を読み込む\n- DataFrame: Python の表 (1分)',
    );
    assert.equal(restoredDraftText(roadmap([{ objective: '基礎を固める', lessons: [{ title: 'はじめに' }] }])), 'モジュール 1\n基礎を固める\n- はじめに');
  });
});

describe('course generator: the restored draft shows what it is waiting for', () => {
  it('the server already sends both saved results, and the restore calls no model', () => {
    assert.match(read('server/routes/ai.js'), /SELECT id, title, status, intake_json, modules_json, updated_at\s+FROM curricula/);
    assert.match(read('services/curriculumApi.ts'), /export const fetchAiDrafts = [^\n]*intake_json[^\n]*modules_json/);
    const restore = slice(view, 'fetchAiDrafts().then(', '}).catch(');
    assert.doesNotMatch(restore, /sendAiChat|sendAiDecision|apiFetch/);
  });

  it('the restore keeps the pending stage, the title and the saved results for the panel; 「新しく始める」 lets them go', () => {
    assert.match(view, /setPendingApproval\(stage\);[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*setRestoredDraft\(\{ stage, title: latest\.title, intake_json: latest\.intake_json, modules_json: latest\.modules_json \}\);/);
    assert.ok(slice(view, 'const startNewCourse = () => {', '\n  };').includes('setRestoredDraft(null);'));
    // Set by the restore, cleared by starting over: nothing else changes it.
    assert.equal([...view.matchAll(/setRestoredDraft\(/g)].length, 2);
  });

  it('the restore message follows the UI language, as the panel does', () => {
    assert.match(view, /useEffect\(\(\) => \{\s*if \(!restoredDraft\) return;\s*const text = t\.restoredDraft\(restoredDraft\.title, restoredDraft\.stage\);\s*setMessages\(\(prev\) => \(\s*prev\.some\(\(m\) => m\.id === 'restored-draft' && m\.text !== text\)\s*\? prev\.map\(\(m\) => \(m\.id === 'restored-draft' \? \{ \.\.\.m, text \} : m\)\)\s*: prev\s*\)\);\s*\}, \[language, restoredDraft\]\);/);
    assert.match(panel, /const \{ language \} = useLanguage\(\);\s*const t = copy\[language\];/);
  });

  it('the panel sits in the restore message only, after its text', () => {
    assert.match(view, /\{msg\.text\}\s*<\/ReactMarkdown>\s*\{\/\*[^*]*\*\/\}\s*\{msg\.id === 'restored-draft' && restoredDraft && \(\s*<RestoredDraftPanel draft=\{restoredDraft\} courseId=\{curriculumId \?\? undefined\} \/>\s*\)\}/);
    // The restore message itself is the app's: its AI notice comes with the panel's AI content.
    assert.match(view, /const APP_MESSAGE_IDS = new Set\(\['init', 'restored-draft'\]\);/);
  });

  it('the approval card is headed at the panel\'s level (h2), not under it', () => {
    const card = slice(view, "{!isGenerating && pendingApproval && pendingApproval !== 'none' && (", '{isGenerating && (');
    assert.match(card, /<h2 [^>]*>\s*<BrainCircuit [^>]*\/>\s*\{language === 'jp' \? '承認が必要です' : 'Confirmation Required'\}\s*<\/h2>/);
  });

  it('「修正を依頼」 takes the learner to the composer, which is enabled whenever the button is', () => {
    const card = slice(view, "{!isGenerating && pendingApproval && pendingApproval !== 'none' && (", '{isGenerating && (');
    assert.match(card, /<button\s+type="button"\s+onClick=\{\(\) => inputRef\.current\?\.focus\(\)\}\s+disabled=\{composerLocked\}[^>]*>\s*<ThumbsDown size=\{14\} aria-hidden="true" \/> \{t\.revise\}/);
    assert.doesNotMatch(view, /onClick=\{\(\) => \{\s*(?:\/\*[\s\S]*?\*\/)?\s*\}\}/);
    // The card shows only while nothing is generating; the composer is off only while generating or locked.
    assert.match(slice(view, 'ref={inputRef}', '/>'), /disabled=\{isGenerating \|\| composerLocked\}/);
  });

  it('the panel: both languages, a heading, semantic lists, the AI notice inside it, plain text, tokens only', () => {
    assert.match(panel, /const copy = \{\n  en: \{/);
    assert.match(panel, /\n  jp: \{/);
    // It stays in the conversation after the learner approves or changes the stage: not "waiting".
    assert.match(panel, /title: \{ requirements: '前回の学習要件', roadmap: '前回のロードマップ' \}/);
    assert.match(panel, /title: \{ requirements: 'Requirements from your previous session', roadmap: 'Roadmap from your previous session' \}/);
    assert.doesNotMatch(panel, /承認待ち|waiting for/);
    // A requirements change is written from the typed text alone: unreadable requirements ask for the topic again.
    assert.match(panel, /requirements: '前回のAIの返答から学習要件を読み取れなかったため、ここには表示できません。承認する前に、学びたいことをもう一度入力してください。AIが学習要件を作り直します。'/);
    assert.match(panel, /type what you want to learn again/);
    assert.match(panel, /<section aria-labelledby=\{headingId\}[^>]*>\s*<h2 id=\{headingId\}/);
    for (const tag of ['<dl', '<dt lang={row.lang}', '<dd', '<ol role="list"']) assert.ok(panel.includes(tag), tag);
    assert.match(panel, /\{content && \(\s*<AiNotice\s+surface="course_generation"\s+answer=\{restoredDraftText\(content\)\}/);
    assert.ok(panel.indexOf('<AiNotice') < panel.lastIndexOf('</section>'), 'the AI notice is inside the labelled section');
    // Model output is shown as text: never parsed as Markdown or HTML.
    assert.doesNotMatch(panel, /ReactMarkdown|dangerouslySetInnerHTML/);
    // Design tokens only in its classes (doc/design/design-system.md §6); every class list is a plain string.
    assert.doesNotMatch(panel, /className=\{/);
    const classes = [...panel.matchAll(/className="([^"]*)"/g)].map((m) => m[1]).join(' ');
    assert.doesNotMatch(classes, /\[#|rounded-\[|text-\[(9|10|11)px\]|slate-|indigo-|\bitalic\b|\buppercase\b|outline-none/);
  });
});
