import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleAlert, CircleCheck, FlaskConical, RotateCcw, TriangleAlert } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { validateLessonDev, type DevLessonReport } from '../../content';
import type { Block, Course, Lesson, Section } from '../../shared/lesson/schema.js';
import { BLOCK_TYPES, WORLDS } from '../../shared/lesson/constants.js';
import LessonReader from '../lesson/LessonReader';
import { clearProgress } from '../lesson/progressStore';

/**
 * /dev/blocks (dev builds with features.devSamples only): every lesson block rendered by the
 * real reader, for visual regression checks and for authors (and Claude Code) to see what a
 * block looks like. The lesson is content/examples/blocks-gallery.lesson.json, which
 * `npm run lessons:validate` checks with the rest of content/.
 *
 * Below it, a "render checks" section built here (not in the JSON, so the gallery stays
 * lint-clean) holds the edge cases: a folded 30-line file, an unsupported language, a hostile
 * mermaid source for the sanitizer and an unknown block type.
 *
 * The world accent is picked with ?world=<name>; ?checks=0 hides the render checks.
 * The reader runs with recordLastLesson={false}, so the dashboard's "continue" card keeps the
 * learner's real last lesson.
 */

const COURSE_SLUG = 'dev-blocks';
const GALLERY_FILE = 'content/examples/blocks-gallery.lesson.json';

const copy = {
  en: {
    loading: 'Loading the block gallery…',
    failed: 'The gallery lesson could not be loaded.',
    pageTitle: 'Block gallery (dev) | Rise Path',
    badge: 'Dev',
    title: 'Block gallery',
    coverage: (n: number, m: number) => `${n}/${m} block types`,
    missing: (types: string) => `Missing: ${types}`,
    valid: 'Schema valid',
    invalid: (n: number) => `${n} schema error${n === 1 ? '' : 's'}`,
    warnings: (n: number) => `${n} lint warning${n === 1 ? '' : 's'}`,
    checking: 'Validating…',
    world: 'World',
    checks: 'Render checks',
    reset: 'Reset progress',
    courseTitle: 'Dev samples',
    checksTitle: '6. Render checks (dev only)',
    checksIntro: 'Edge cases that are not in the gallery JSON: a long file that starts folded, a language without highlighting, a mermaid source full of HTML and click handlers (it must render as harmless text), and a block type the reader does not know.',
  },
  jp: {
    loading: 'ブロック見本帳を読み込んでいます…',
    failed: 'ギャラリーのレッスンを読み込めませんでした。',
    pageTitle: 'ブロック見本帳（開発用） | Rise Path',
    badge: '開発用',
    title: 'ブロック見本帳',
    coverage: (n: number, m: number) => `ブロック ${m}種中 ${n}種`,
    missing: (types: string) => `未使用：${types}`,
    valid: 'スキーマ検証 OK',
    invalid: (n: number) => `スキーマエラー ${n}件`,
    warnings: (n: number) => `lint 警告 ${n}件`,
    checking: '検証しています…',
    world: 'ワールド',
    checks: '表示テスト',
    reset: '進捗をリセット',
    courseTitle: '開発用サンプル',
    checksTitle: '6. 表示テスト（開発用）',
    checksIntro: 'ギャラリーの JSON には入れていない境界ケースです。最初から折りたたまれる長いファイル、色分けのない言語、HTML とクリック処理を含む mermaid（無害な文字として表示されること）、リーダーが知らないブロック型を並べています。',
  },
} as const;

const LONG_CODE = `type State = { items: string[]; filter: 'all' | 'done' | 'open'; done: Set<string> };

type Action =
  | { type: 'add'; item: string }
  | { type: 'toggle'; item: string }
  | { type: 'filter'; filter: State['filter'] };

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add':
      if (state.items.includes(action.item)) return state;
      return { ...state, items: [...state.items, action.item] };
    case 'toggle': {
      const done = new Set(state.done);
      if (done.has(action.item)) done.delete(action.item);
      else done.add(action.item);
      return { ...state, done };
    }
    case 'filter':
      return { ...state, filter: action.filter };
    default:
      return state;
  }
}

export function visible(state: State): string[] {
  if (state.filter === 'all') return state.items;
  const wantDone = state.filter === 'done';
  return state.items.filter((item) => state.done.has(item) === wantDone);
}`;

/**
 * An init directive (must not change the theme or shrink the labels), labels with HTML, a
 * javascript: link and click directives: all must end up inert.
 */
const HOSTILE_MERMAID = `%%{init: {"theme": "forest", "themeVariables": {"fontSize": "8px"}}}%%
flowchart LR
  A["<img src=x onerror=window.__rpXss=1> 画像 / image"] --> B["<a href='javascript:window.__rpXss=2'>リンク / link</a>"]
  B --> C["<b onclick='window.__rpXss=3'>太字 / bold</b>"]
  C --> D["<script>window.__rpXss=4</script>script"]
  click A call alert(5)
  click B "javascript:window.__rpXss=6"`;

function renderChecksSection(): Section {
  const blocks = [
    { id: 'dev-intro', type: 'markdown', md: { jp: copy.jp.checksIntro, en: copy.en.checksIntro } },
    { id: 'dev-long-code', type: 'code', lang: 'tsx', filename: 'todoReducer.ts', code: LONG_CODE, highlight: [8, 9] },
    { id: 'dev-plain-code', type: 'code', lang: 'ini', filename: 'settings.ini', code: '[reader]\ntheme = sepia\nsize = l' },
    {
      id: 'dev-hostile-diagram',
      type: 'diagram',
      engine: 'mermaid',
      code: HOSTILE_MERMAID,
      caption: { jp: 'サニタイズの確認：HTML ラベルとクリック処理', en: 'Sanitizer check: HTML labels and click handlers' },
      alt: { jp: '4つの箱が矢印でつながった図。ラベルの HTML は文字として表示される。', en: 'Four boxes joined by arrows; the HTML in the labels shows as plain text.' },
    },
    { id: 'dev-unknown', type: 'sandbox', md: 'An unsupported block type.' },
  ] as unknown as Block[];
  return { id: 'dev-checks', title: { jp: copy.jp.checksTitle, en: copy.en.checksTitle }, role: 'example', blocks };
}

function DevBanner({
  lesson,
  report,
  world,
  onWorld,
  checks,
  onChecks,
  onReset,
}: {
  lesson: Lesson;
  report: DevLessonReport | null | undefined;
  world: Course['world'];
  onWorld: (world: Course['world']) => void;
  checks: boolean;
  onChecks: (on: boolean) => void;
  onReset: () => void;
}) {
  const { language } = useLanguage();
  const text = copy[language];
  const used = new Set(lesson.sections.flatMap((s) => s.blocks.map((b) => b.type)));
  const missing = BLOCK_TYPES.filter((type) => !used.has(type));
  const errors = report?.errors ?? [];
  const warnings = report?.warnings ?? [];

  return (
    <section aria-label={text.title} className="border-b border-line bg-surface px-4 py-3 text-small text-fg-2 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-0.5 text-caption font-semibold text-primary-text">
          <FlaskConical size={13} aria-hidden="true" />
          {text.badge}
        </span>
        <code className="min-w-0 truncate font-mono text-caption text-fg-3">{GALLERY_FILE}</code>
        <span className={`inline-flex items-center gap-1 font-semibold ${missing.length ? 'text-danger' : 'text-success'}`}>
          {missing.length ? <CircleAlert size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
          {text.coverage(BLOCK_TYPES.length - missing.length, BLOCK_TYPES.length)}
          {missing.length > 0 && <span className="font-normal"> · {text.missing(missing.join(', '))}</span>}
        </span>
        {report === undefined && <span className="text-fg-3">{text.checking}</span>}
        {report && report.ok && (
          <span className="inline-flex items-center gap-1 font-semibold text-success">
            <CircleCheck size={14} aria-hidden="true" />{text.valid}
          </span>
        )}
        {report && !report.ok && (
          <span className="inline-flex items-center gap-1 font-semibold text-danger">
            <CircleAlert size={14} aria-hidden="true" />{text.invalid(errors.length)}
          </span>
        )}
        {report && (
          <span className="inline-flex items-center gap-1">
            <TriangleAlert size={14} aria-hidden="true" />{text.warnings(warnings.length)}
          </span>
        )}
        <span className="flex-1" />
        <label className="inline-flex items-center gap-2">
          <span className="font-semibold text-fg">{text.world}</span>
          <select
            value={world}
            onChange={(event) => onWorld(event.target.value as Course['world'])}
            className="h-8 rounded-control border border-line-strong bg-surface px-2 text-small text-fg"
          >
            {WORLDS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={checks}
            onChange={(event) => onChecks(event.target.checked)}
            className="size-4 accent-primary"
          />
          <span className="font-semibold text-fg">{text.checks}</span>
        </label>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-8 items-center gap-1.5 rounded-control border border-line bg-surface px-3 font-semibold text-fg hover:bg-sunken"
        >
          <RotateCcw size={14} aria-hidden="true" />
          {text.reset}
        </button>
      </div>
      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-caption">
          {errors.map((e, i) => (
            <li key={`e${i}`} className="text-danger">✕ {e.path || '(root)'} — {e.message}</li>
          ))}
          {warnings.map((w, i) => (
            <li key={`w${i}`}>⚠ [{w.rule}] {w.path} — {w.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; lesson: Lesson };

export default function DevBlocksRoute() {
  const { language } = useLanguage();
  const text = copy[language];
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [report, setReport] = useState<DevLessonReport | null | undefined>(undefined);
  const [resetCount, setResetCount] = useState(0);
  const worldParam = params.get('world');
  const world: Course['world'] = (WORLDS as readonly string[]).includes(worldParam ?? '') ? (worldParam as Course['world']) : 'vibe';
  const checks = params.get('checks') !== '0';

  useEffect(() => {
    let cancelled = false;
    import('../../content/examples/blocks-gallery.lesson.json')
      .then((mod) => {
        if (cancelled) return;
        const lesson = (mod as { default: unknown }).default as Lesson;
        setState({ status: 'ready', lesson });
        validateLessonDev(lesson)
          .then((result) => {
            if (!cancelled) setReport(result);
          })
          .catch(() => {
            if (!cancelled) setReport(null);
          });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = text.pageTitle;
    return () => {
      document.title = previous;
    };
  }, [text]);

  const gallery = state.status === 'ready' ? state.lesson : null;
  const lesson = useMemo<Lesson | null>(() => {
    if (!gallery) return null;
    if (!checks) return gallery;
    const sections = [...gallery.sections];
    // Render checks go before the summary, so the summary stays the last section.
    sections.splice(Math.max(0, sections.length - 1), 0, renderChecksSection());
    return { ...gallery, sections };
  }, [gallery, checks]);

  const course = useMemo<Course>(() => ({
    schema: 'risepath.course/v1',
    id: COURSE_SLUG,
    world,
    title: { jp: copy.jp.courseTitle, en: copy.en.courseTitle },
    locale: 'jp',
    locales: ['jp', 'en'],
    modules: [{
      id: 'gallery',
      title: { jp: copy.jp.title, en: copy.en.title },
      lessons: [{ id: gallery?.id ?? 'blocks-gallery', title: gallery?.title ?? { jp: copy.jp.title, en: copy.en.title } }],
    }],
    glossary: gallery?.glossary,
  }), [world, gallery]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  if (state.status === 'loading') {
    return <div role="status" className="p-8 text-small text-fg-3">{text.loading}</div>;
  }
  if (state.status === 'error' || !lesson || !gallery) {
    return <div role="alert" className="p-8 text-small text-danger">{text.failed}</div>;
  }

  return (
    <LessonReader
      key={`${resetCount}-${checks ? 'c' : 'n'}`}
      course={course}
      courseSlug={COURSE_SLUG}
      lesson={lesson}
      backTo="/learning-hub"
      next={null}
      prev={null}
      recordLastLesson={false}
      banner={(
        <DevBanner
          lesson={gallery}
          report={report}
          world={world}
          onWorld={(value) => setParam('world', value === 'vibe' ? null : value)}
          checks={checks}
          onChecks={(on) => setParam('checks', on ? null : '0')}
          onReset={() => {
            clearProgress(COURSE_SLUG, gallery.id);
            setResetCount((n) => n + 1);
          }}
        />
      )}
    />
  );
}
