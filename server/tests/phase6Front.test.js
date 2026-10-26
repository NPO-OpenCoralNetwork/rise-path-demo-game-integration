// Phase 6 front end, the UI (design p6 §5.3–§5.7, §7.1 "Client: a11y, tokens, copy"): the review
// card (ReviewCardView), the page's state views (ReviewStateView), the dashboard card
// (ReviewTodayCardView), the sidebar entry and its count (Layout), the reset dialog's review
// sentence (LessonEnd), and the copy and token rules of the new files.
// The components are bundled with esbuild against a React stub whose jsx() returns
// { type, props, key } (as phase5Front.test.js does); function components are expanded into host
// elements, so classes, attributes and text can be read without a DOM.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const TOKEN_RULE = /\[#[0-9a-fA-F]{3,8}\]|rounded-\[|text-\[(9|10|11)px\]|text-slate-400/;

const ICONS = [
  'Activity', 'ArrowLeft', 'ArrowRight', 'Blocks', 'BookOpen', 'Brain', 'ChevronDown', 'ChevronLeft', 'ChevronRight',
  'CloudOff', 'Flag', 'IdCard', 'Layers', 'LayoutDashboard', 'Library', 'ListChecks', 'LogIn', 'LogOut', 'Map', 'Menu',
  'PartyPopper', 'RotateCcw', 'RotateCw', 'Settings', 'Sparkles', 'Trophy', 'User', 'Users', 'X',
];
const STUBS = {
  react: `
    let index = 0;
    export const __resetHooks = () => { index = 0; };
    export const useState = (initial) => {
      const i = index++;
      const o = globalThis.__state;
      const value = o && i in o ? o[i] : (typeof initial === 'function' ? initial() : initial);
      return [value, () => {}];
    };
    export const useReducer = (reducer, initial) => [globalThis.__session ?? initial, (a) => { (globalThis.__dispatched ??= []).push(a); }];
    export const useRef = (value) => ({ current: value ?? null });
    let ids = 0;
    export const useId = () => ':r' + (ids += 1) + ':';
    export const useEffect = () => {};
    export const useLayoutEffect = useEffect;
    export const useCallback = (fn) => fn;
    export const useMemo = (fn) => fn();
    export const useSyncExternalStore = (subscribe, get) => get();
    export const forwardRef = (fn) => fn;
    export const memo = (fn) => fn;
    export const createContext = () => ({});
    export const useContext = () => null;
    export const Fragment = 'Fragment';
    export default { useState, useReducer, useRef, useId, useEffect, useLayoutEffect, useCallback, useMemo, useSyncExternalStore, forwardRef, memo, createContext, useContext, Fragment };
  `,
  'react/jsx-runtime': "export const jsx = (type, props, key) => ({ type, props, key }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'react-router-dom': "export const Link = 'Link'; export const useLocation = () => ({ pathname: globalThis.__path ?? '/' });",
  'lucide-react': ICONS.map((name) => `export const ${name} = '${name}';`).join('\n'),
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp', selectedLanguage: globalThis.__language ?? 'jp', setLanguage() {} });",
  theme: "export const useTheme = () => ({ theme: 'default', setTheme() {} });",
  dialog: "export const ConfirmDialog = 'ConfirmDialog'; export default 'ConfirmDialog';",
  reader: 'export const useReader = () => globalThis.__reader; export const useOptionalReader = () => globalThis.__reader ?? null;',
  md: "export const Markdown = 'Markdown'; export const MdText = 'MdText'; export const Txt = 'Txt';",
  syncClient: `
    export const useProgressSaveView = () => globalThis.__view;
    export const getProgressSaveView = () => globalThis.__view;
    export const useProgressSyncState = () => globalThis.__sync ?? { status: 'on', userId: 'u1' };
    export const syncedLearnerId = () => (globalThis.__sync ?? { userId: 'u1' }).userId;
    export const progressCapabilities = () => (globalThis.__caps === undefined ? { lessonReset: true, achievements: true, review: true } : globalThis.__caps);
    export const isSyncableLesson = () => true;
    export const retryProgressSync = () => true;
  `,
  reviewClient: `
    const INITIAL = { status: 'idle', learnerId: null, data: null, at: null };
    export const useReviewQueue = () => globalThis.__review ?? INITIAL;
    export const reloadReviewQueue = async () => { globalThis.__reloads = (globalThis.__reloads ?? 0) + 1; };
    export const reviewQueueSettled = async () => {};
    export const gradeAsSyncedLearner = async () => { throw new Error('not in these tests'); };
  `,
};

async function bundleUi(entry) {
  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'import.meta.env': '{"PROD":true}' },
    plugins: [{
      name: 'ui-stubs',
      setup(b) {
        const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
        stub(/^react$/, 'react');
        stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
        stub(/^react-router-dom$/, 'react-router-dom');
        stub(/^lucide-react$/, 'lucide-react');
        stub(/context\/LanguageContext$/, 'language');
        stub(/context\/ThemeContext$/, 'theme');
        stub(/safety\/ConfirmDialog$/, 'dialog');
        stub(/\/ReaderContext$/, 'reader');
        stub(/\/Md$/, 'md');
        stub(/\/progressSyncClient$/, 'syncClient');
        stub(/\/reviewClient$/, 'reviewClient');
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
      },
    }],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

let loads = 0;
const fresh = (code) => import(`data:text/javascript;base64,${Buffer.from(`${code}\n// load ${(loads += 1)}`).toString('base64')}`);

function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (node && typeof node === 'object' && 'type' in node) {
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}));
    return { type: node.type, key: node.key, props: { ...node.props, children: expand(node.props?.children) } };
  }
  return node;
}
function walk(node, out = []) {
  if (Array.isArray(node)) for (const child of node) walk(child, out);
  else if (node && typeof node === 'object' && 'type' in node) {
    out.push({ el: node });
    walk(node.props?.children, out);
  } else if (typeof node === 'string' || typeof node === 'number') out.push({ text: String(node) });
  return out;
}
const textOf = (tokens) => tokens.filter((t) => 'text' in t).map((t) => t.text).join('');
const elementsOf = (tokens) => tokens.filter((t) => 'el' in t).map((t) => t.el);
const textOfElement = (el) => textOf(walk(el.props?.children));
const classesOf = (el) => (typeof el.props?.className === 'string' ? el.props.className.split(/\s+/).filter(Boolean) : []);

function render(mod, component, props = {}, globals = {}) {
  Object.assign(globalThis, globals);
  mod.__resetHooks();
  try {
    return walk(expand(component(props)));
  } finally {
    for (const key of Object.keys(globals)) delete globalThis[key];
  }
}

let ui = null;
before(async () => {
  ui = await fresh(await bundleUi([
    "export { __resetHooks } from 'react';",
    "export { ReviewCardView, lineText } from './components/review/ReviewCardView';",
    "export { ReviewStateView, default as ReviewView } from './components/review/ReviewView';",
    "export { ReviewTodayCardView } from './components/review/ReviewTodayCard';",
    "export { reviewCopy } from './components/review/reviewCopy';",
    "export { startSession, sessionReducer } from './components/review/reviewModel';",
    "export { LessonEnd } from './components/lesson/LessonEnd';",
    "export { default as Layout } from './components/common/Layout';",
  ].join('\n')));
});

const CC_CARD = {
  courseSlug: 'claude-code',
  lessonId: 'cc-07-skills',
  cardId: 'card-dmi',
  lessonTitle: '第7回｜スキル',
  lessonLocale: 'jp',
  front: '`disable-model-invocation: true` は何をしますか？',
  back: 'Claude が自分からスキルを呼ばないようにします。',
  dueOn: '2026-10-25',
};
const BI_CARD = { ...CC_CARD, courseSlug: 'vibe-coding', lessonTitle: { jp: '第2回', en: 'Chapter 2' }, front: { jp: '問い', en: 'Question text' }, back: { jp: '答え', en: 'Answer text' } };

const cardProps = (patch = {}) => ({
  language: 'jp',
  card: CC_CARD,
  counter: { k: 1, total: 10 },
  flipped: false,
  revealed: false,
  busy: null,
  block: null,
  line: null,
  live: '',
  onFlip: () => {},
  onGrade: () => {},
  ...patch,
});
const face = (els) => els.find((el) => el.type === 'button' && 'aria-pressed' in el.props);
const inner = (els) => els.find((el) => 'data-review-card-inner' in el.props);
const sides = (els) => inner(els).props.children;
const gradeButtons = (els, language = 'jp') => {
  const t = ui.reviewCopy[language];
  return els.filter((el) => el.type === 'button' && [t.again, t.good].includes(textOfElement(el)));
};

describe('ReviewCardView: the flip card and the two buttons (design §5.3)', () => {
  it('motion: every transition class of the turning card is under motion-safe: (reduced motion swaps at once); the face has the 3D perspective', () => {
    for (const flipped of [false, true]) {
      const els = elementsOf(render(ui, ui.ReviewCardView, cardProps({ flipped, revealed: flipped })));
      const classes = classesOf(inner(els));
      for (const cls of ['grid', 'transform-3d', 'motion-safe:transition-transform', 'motion-safe:duration-320', 'motion-safe:ease-rise']) {
        assert.ok(classes.includes(cls), cls);
      }
      const bare = classes.filter((cls) => /^(duration-|transition|ease-|animate-)/.test(cls));
      assert.deepEqual(bare, [], 'no transition, duration or easing outside motion-safe:');
      assert.equal(classes.includes('rotate-y-180'), flipped);
      assert.ok(classesOf(face(els)).includes('perspective-distant'));
      assert.equal(face(els).props['aria-pressed'], flipped);
      for (const side of sides(els)) assert.ok(classesOf(side).includes('backface-hidden'));
    }
  });

  it('the turning part is keyed by the card: the next card mounts unturned (it never turns back from the previous answer); the same card keeps it while it turns', () => {
    // React reuses an element of the same type and key at the same place, with its transition: the
    // previous card's turned span would turn back over 320 ms while already holding the next card's
    // answer on its back. A new key makes React mount a new span, unturned and without a transition.
    const answered = inner(elementsOf(render(ui, ui.ReviewCardView, cardProps({ flipped: true, revealed: true }))));
    const next = inner(elementsOf(render(ui, ui.ReviewCardView, cardProps({ card: { ...CC_CARD, cardId: 'card-next', back: 'NEXT ANSWER' } }))));
    assert.equal(typeof answered.key, 'string');
    assert.notEqual(next.key, answered.key, 'another card: another element, mounted fresh');
    assert.ok(classesOf(answered).includes('rotate-y-180'));
    assert.ok(!classesOf(next).includes('rotate-y-180'), 'the next card starts unturned');
    for (const card of [{ ...CC_CARD, lessonId: 'cc-08-hooks' }, { ...CC_CARD, courseSlug: 'vibe-coding' }]) {
      assert.notEqual(inner(elementsOf(render(ui, ui.ReviewCardView, cardProps({ card })))).key, answered.key, 'the key names the course, the lesson and the card');
    }
    const front = inner(elementsOf(render(ui, ui.ReviewCardView, cardProps())));
    assert.equal(front.key, answered.key, 'one card turning keeps its element (the flip animates)');
  });

  it('the hidden side is aria-hidden and inert; both sides share one grid cell (the taller sets the height)', () => {
    const front = sides(elementsOf(render(ui, ui.ReviewCardView, cardProps())));
    assert.deepEqual(front.map((s) => [s.props['aria-hidden'], s.props.inert]), [[undefined, undefined], ['true', true]]);
    const back = sides(elementsOf(render(ui, ui.ReviewCardView, cardProps({ flipped: true, revealed: true }))));
    assert.deepEqual(back.map((s) => [s.props['aria-hidden'], s.props.inert]), [['true', true], [undefined, undefined]]);
    for (const side of front) {
      assert.ok(classesOf(side).includes('col-start-1') && classesOf(side).includes('row-start-1'));
    }
    assert.ok(classesOf(front[1]).includes('rotate-y-180') && classesOf(front[1]).includes('bg-primary-soft'), 'the back is pre-rotated');
    assert.ok(classesOf(front[0]).includes('bg-sunken'));
  });

  it('the face: a button described by the hint line (try first → flip back), and a polite live region for the answer', () => {
    let els = elementsOf(render(ui, ui.ReviewCardView, cardProps({ live: '' })));
    const hint = els.find((el) => el.props.id === face(els).props['aria-describedby']);
    assert.equal(textOfElement(hint), 'まず思い出してから、カードを押して答えを見ましょう。');
    els = elementsOf(render(ui, ui.ReviewCardView, cardProps({ flipped: true, revealed: true, live: '答え：x' })));
    assert.equal(textOfElement(els.find((el) => el.props.id === face(els).props['aria-describedby'])), 'カードをまた押すと、問いに戻ります。');
    const live = els.find((el) => el.props['aria-live'] === 'polite' && classesOf(el).includes('sr-only'));
    assert.equal(textOfElement(live), '答え：x');
    const section = els.find((el) => el.type === 'section');
    const counter = els.find((el) => el.props.id === section.props['aria-labelledby']);
    assert.equal(textOfElement(counter), '今日の 1 / 10 枚目');
    assert.equal(counter.props['aria-live'], 'polite', 'the counter is announced after each advance');
  });

  it('the buttons appear only once the answer was seen: 「もう一度」 (secondary) then 「覚えた」 (primary), each with its helper', () => {
    assert.deepEqual(gradeButtons(elementsOf(render(ui, ui.ReviewCardView, cardProps()))), [], 'answer before rating');
    const els = elementsOf(render(ui, ui.ReviewCardView, cardProps({ flipped: true, revealed: true })));
    const [again, good] = gradeButtons(els);
    assert.deepEqual([textOfElement(again), textOfElement(good)], ['もう一度', '覚えた']);
    assert.ok(classesOf(again).includes('bg-surface') && !classesOf(again).includes('bg-primary'), 'secondary');
    assert.ok(classesOf(good).includes('bg-primary'), 'the one primary');
    for (const b of [again, good]) {
      assert.ok(classesOf(b).includes('min-h-11'));
      assert.equal(b.props['aria-disabled'], undefined);
    }
    const helpOf = (b) => els.find((el) => el.props.id === b.props['aria-describedby']);
    assert.equal(textOfElement(helpOf(again)), '近いうちに、また出ます。');
    assert.equal(textOfElement(helpOf(good)), '間をあけて、また出ます。');
    const flipped = elementsOf(render(ui, ui.ReviewCardView, cardProps({ flipped: false, revealed: true })));
    assert.equal(gradeButtons(flipped).length, 2, 'flipped back to the question: the buttons stay');
  });

  it('offline: the buttons are aria-disabled (still focusable) and described by the reason; pressing records nothing; the card still flips', () => {
    let graded = 0;
    let flips = 0;
    const els = elementsOf(render(ui, ui.ReviewCardView, cardProps({ flipped: true, revealed: true, block: 'offline', onGrade: () => { graded += 1; }, onFlip: () => { flips += 1; } })));
    const buttons = gradeButtons(els);
    assert.equal(buttons.length, 2);
    for (const b of buttons) {
      assert.equal(b.props['aria-disabled'], true);
      assert.equal(b.props.disabled, undefined, 'not disabled: focus can stay on it');
      const ids = b.props['aria-describedby'].split(' ');
      const reason = els.find((el) => el.props.id === ids[1]);
      assert.equal(textOfElement(reason), 'インターネットにつながると、記録できます。');
      b.props.onClick();
    }
    assert.equal(graded, 0);
    face(els).props.onClick();
    assert.equal(flips, 1);
    for (const [block, text] of [['auth', 'ログインし直すと、答えを記録できます。'], ['loading', '読み込みが終わると、答えを記録できます。'], ['later', 'いまは答えを記録できません。']]) {
      assert.ok(textOf(render(ui, ui.ReviewCardView, cardProps({ flipped: true, revealed: true, block }))).includes(text), block);
    }
  });

  it('while a grade is sent: both buttons aria-disabled (double-tap safe) and the status says so', () => {
    let graded = 0;
    const els = elementsOf(render(ui, ui.ReviewCardView, cardProps({ flipped: true, revealed: true, busy: 'good', onGrade: () => { graded += 1; } })));
    for (const b of gradeButtons(els)) {
      assert.equal(b.props['aria-disabled'], true);
      b.props.onClick();
    }
    assert.equal(graded, 0);
    assert.equal(textOfElement(els.find((el) => el.props.role === 'status')), '記録しています…');
  });

  it('a failed grade names the button to press once more; no other line near the buttons says 「もう一度」', () => {
    const tokens = render(ui, ui.ReviewCardView, cardProps({ flipped: true, revealed: true, line: { kind: 'gradeFailed', button: 'good' } }));
    const els = elementsOf(tokens);
    assert.equal(textOfElement(els.find((el) => el.props.role === 'status')), '「覚えた」を記録できませんでした。同じボタンを、また押してください。');
    const again = gradeButtons(els)[0];
    const others = els.filter((el) => el !== again && typeof el.type === 'string' && el.type !== 'section' && el.type !== 'div' && !walk(el.props.children).some((t) => t.el === again));
    for (const el of others) assert.doesNotMatch(textOfElement(el), /もう一度/, `${el.type}: ${textOfElement(el)}`);
    assert.equal(ui.lineText({ kind: 'gradeFailed', button: 'again' }, 'jp'), '「もう一度」を記録できませんでした。同じボタンを、また押してください。');
    assert.equal(ui.lineText({ kind: 'gradeFailed', button: 'good' }, 'en'), 'We couldn\'t save "Got it". Press the same button once more.');
  });

  it('EN UI with a Japanese-only claude-code card: lang="ja" on the lesson title and on both sides\' text; a card with English text has none', () => {
    const els = elementsOf(render(ui, ui.ReviewCardView, cardProps({ language: 'en' })));
    const title = els.find((el) => el.type === 'span' && textOfElement(el) === '第7回｜スキル');
    assert.equal(title.props.lang, 'ja');
    const texts = els.filter((el) => el.type === 'span' && el.props.children?.type === 'Markdown');
    assert.deepEqual(texts.map((el) => [el.props.lang, el.props.children.props.source]), [['ja', CC_CARD.front], ['ja', CC_CARD.back]]);
    for (const el of texts) {
      assert.equal(el.props.children.props.inline, true);
      for (const cls of ['wrap-anywhere', '[&_code]:[overflow-wrap:anywhere]', '[&_code]:font-mono']) assert.ok(classesOf(el).includes(cls), cls);
    }
    assert.ok(textOf(walk(els)).includes('From: '), 'the caption, no extra one for the language');
    const jp = elementsOf(render(ui, ui.ReviewCardView, cardProps({ language: 'jp' })));
    assert.ok(jp.filter((el) => el.type === 'span' && el.props.lang !== undefined).length === 0, 'the UI language: no lang');
    const bi = elementsOf(render(ui, ui.ReviewCardView, cardProps({ language: 'en', card: BI_CARD })));
    const biTexts = bi.filter((el) => el.type === 'span' && el.props.children?.type === 'Markdown');
    assert.deepEqual(biTexts.map((el) => [el.props.lang, el.props.children.props.source]), [[undefined, 'Question text'], [undefined, 'Answer text']]);
  });
});

const QUEUE = (patch = {}) => ({
  learnerId: U1, today: '2026-10-27', timeZone: 'Asia/Tokyo', dailyLimit: 10, doneToday: 0, remainingToday: 10, dueTotal: 12, carriedOver: 2, inQueue: 40, nextDueOn: '2026-10-29', cards: [], ...patch,
});
const SNAP = (status, data = null) => ({ status, learnerId: data ? U1 : null, data, at: data ? 1 : null });

describe('ReviewTodayCardView: the dashboard card (design §5.5), server numbers only', () => {
  const card = (snapshot, language = 'jp') => render(ui, ui.ReviewTodayCardView, { language, snapshot, onReload: () => { globalThis.__reloads = (globalThis.__reloads ?? 0) + 1; } });

  it('due: 「今日の復習 N 枚（約 M 分）」 and a secondary 「復習する」 link to /review', () => {
    const tokens = card(SNAP('ready', QUEUE()));
    const els = elementsOf(tokens);
    assert.equal(textOfElement(els.find((el) => el.type === 'h2')), '今日の復習 10 枚（約 3 分）');
    assert.ok(textOf(tokens).includes('忘れかけているカードから出します。'));
    const link = els.find((el) => el.type === 'Link');
    assert.equal(link.props.to, '/review');
    assert.equal(textOfElement(link), '復習する');
    assert.ok(classesOf(link).includes('bg-surface') && !classesOf(link).includes('bg-primary'), 'secondary: ContinueCard is the one primary');
    assert.equal(textOfElement(elementsOf(card(SNAP('ready', QUEUE({ remainingToday: 1 })), 'en')).find((el) => el.type === 'h2')), "Today's review: 1 card (about 1 min)");
  });

  it('done, none_today and empty say what comes next; the empty card names lessons that have review cards', () => {
    assert.ok(textOf(card(SNAP('ready', QUEUE({ remainingToday: 0, doneToday: 10, carriedOver: 2 })))).includes('今日の復習は終わりました残りの 2 枚は、明日からの復習に回します。'));
    assert.ok(textOf(card(SNAP('ready', QUEUE({ remainingToday: 0, doneToday: 4, carriedOver: 0 })))).includes('次の復習は 10月29日（木）です。'));
    assert.ok(textOf(card(SNAP('ready', QUEUE({ remainingToday: 0, doneToday: 0, carriedOver: 0, dueTotal: 0 })))).includes('今日の復習はありません次の復習は 10月29日（木）です。'));
    const empty = textOf(card(SNAP('ready', QUEUE({ remainingToday: 0, doneToday: 0, carriedOver: 0, dueTotal: 0, inQueue: 0, nextDueOn: null }))));
    assert.ok(empty.includes('まだ復習カードはありません') && empty.includes('復習カードのあるレッスン'));
    assert.ok(textOf(card(SNAP('ready', QUEUE({ remainingToday: 0, doneToday: 0, carriedOver: 0, dueTotal: 0, inQueue: 0, nextDueOn: null })), 'en')).includes('a lesson that has review cards'));
  });

  it('loading, no_account, unavailable and unsupported show no number (never a made-up zero); unavailable can reload', () => {
    for (const status of ['idle', 'loading', 'no_account', 'unavailable', 'unsupported']) {
      const tokens = card(SNAP(status));
      assert.doesNotMatch(textOf(tokens), /\d/, status);
      assert.equal(elementsOf(tokens).some((el) => el.type === 'Link'), false, status);
    }
    assert.ok(textOf(card(SNAP('unsupported'))).includes('復習は、いまは使えません。'));
    const reload = elementsOf(card(SNAP('unavailable'))).find((el) => el.type === 'button');
    assert.equal(textOfElement(reload), '読み込み直す');
    globalThis.__reloads = 0;
    reload.props.onClick();
    assert.equal(globalThis.__reloads, 1);
  });

  it('the dashboard uses the card; the old placeholder that promised missed questions and tutor cards is gone', () => {
    const dash = readFile('components/features/dashboard/MissionControlDashboard.tsx');
    assert.match(dash, /<ReviewTodayCard \/>/);
    for (const old of ['確認問題で間違えた所', 'Questions you missed', '今日の復習 0枚', '0 reviews due today', 'reviewTitle', 'reviewBody']) {
      assert.ok(!dash.includes(old), old);
    }
  });
});

describe('ReviewStateView and the /review page outside a session (design §5.3)', () => {
  const state = (props) => render(ui, ui.ReviewStateView, { language: 'jp', summary: null, offline: false, onReload: () => {}, ...props });

  it('done: the heading takes focus (tabIndex -1), then the carried-over line or the next day; no per-button split', () => {
    const els = elementsOf(state({ state: 'done', summary: { carriedOver: 2, nextDueOn: '2026-10-29', remainingToday: 0 } }));
    const h2 = els.find((el) => el.type === 'h2');
    assert.equal(textOfElement(h2), '今日の復習は終わりです。おつかれさまでした。');
    assert.equal(h2.props.tabIndex, -1);
    const text = textOf(walk(els));
    assert.ok(text.includes('残りの 2 枚は、明日からの復習に回します。'));
    assert.ok(!text.includes('次の復習は'), 'carried cards come tomorrow: no later date beside them');
    assert.ok(textOf(state({ state: 'done', summary: { carriedOver: 0, nextDueOn: '2026-10-29', remainingToday: 0 } })).includes('次の復習は 10月29日（木）です。'));
    assert.equal(els.find((el) => el.type === 'Link').props.to, '/');
  });

  it('no_account, unsupported, unavailable (online: reload; offline: wait for the connection), empty, none_today, loading', () => {
    assert.ok(textOf(state({ state: 'no_account' })).includes('復習は、ログインすると使えます'));
    assert.ok(textOf(state({ state: 'no_account' })).includes('レッスンの中の復習カードは、いつでも使えます。'));
    assert.ok(textOf(state({ state: 'unsupported' })).includes('復習は、いまは使えません。しばらくしてから、また開いてください。'));
    const failed = elementsOf(state({ state: 'unavailable' }));
    assert.ok(textOf(walk(failed)).includes('いまは復習を読み込めません。'));
    assert.equal(textOfElement(failed.find((el) => el.type === 'button')), '読み込み直す');
    const offline = state({ state: 'unavailable', offline: true });
    assert.ok(textOf(offline).includes('インターネットにつながると、今日の復習を読み込めます。'));
    assert.equal(elementsOf(offline).some((el) => el.type === 'button'), false);
    assert.ok(textOf(state({ state: 'empty' })).includes('復習カードのあるレッスンを終えると'));
    assert.ok(textOf(state({ state: 'none_today', summary: { carriedOver: 0, nextDueOn: '2026-10-29', remainingToday: 0 } })).includes('今日の復習はありません。次の復習は 10月29日（木）です。'));
    const loading = elementsOf(state({ state: 'loading' }));
    assert.equal(loading[0].props['aria-busy'], 'true');
    assert.ok(loading.every((el) => !classesOf(el).includes('animate-pulse')), 'the skeleton pulses only with motion allowed');
  });

  it('the page: before the first fresh read a due list waits (loading); a guest sees the sign-in message; no request from the view itself', () => {
    const page = (globals) => render(ui, ui.ReviewView, {}, { __view: { state: 'saved', reason: null, online: true }, __sync: { status: 'on', userId: U1 }, ...globals });
    assert.equal(elementsOf(page({ __review: SNAP('ready', QUEUE()) })).find((el) => el.props['aria-busy'] === 'true') !== undefined, true);
    const guest = page({ __review: SNAP('no_account') });
    assert.ok(textOf(guest).includes('復習は、ログインすると使えます'));
    const h1 = elementsOf(guest).find((el) => el.type === 'h1');
    assert.equal(textOfElement(h1), '今日の復習');
    assert.ok(textOf(guest).startsWith('復習'), 'the eyebrow');
  });

  it('the page in a session: the card, its counter after a reload (3 done → 4 / 10), and the buttons blocked while the sync is not on', () => {
    const cards = Array.from({ length: 7 }, (_, i) => ({ ...CC_CARD, cardId: `card-${i}` }));
    const session = ui.sessionReducer(ui.startSession(QUEUE({ doneToday: 3, remainingToday: 7, cards })), { type: 'flip' });
    const page = (globals) => elementsOf(render(ui, ui.ReviewView, {}, { __view: { state: 'saved', reason: null, online: true }, __sync: { status: 'on', userId: U1 }, __review: SNAP('ready', QUEUE({ doneToday: 3, remainingToday: 7, cards })), __session: session, ...globals }));
    const on = page({});
    assert.ok(textOf(walk(on)).includes('今日の 4 / 10 枚目'));
    assert.ok(gradeButtons(on).every((b) => b.props['aria-disabled'] === undefined));
    const offline = page({ __view: { state: 'offline', reason: null, online: false } });
    assert.ok(gradeButtons(offline).every((b) => b.props['aria-disabled'] === true));
    const other = page({ __sync: { status: 'on', userId: 'bbbbbbbb-0000-4000-8000-000000000002' } });
    assert.ok(gradeButtons(other).every((b) => b.props['aria-disabled'] === true), 'another learner\'s sync: not this list');
  });

  const ended = (end, summary = {}) => {
    const cards = [{ ...CC_CARD, cardId: 'card-0' }];
    const s = ui.startSession(QUEUE({ remainingToday: 1, cards }));
    return { ...s, index: 1, end, line: { kind: 'gone' }, summary: { ...s.summary, ...summary } };
  };
  const pageWith = (globals) => render(ui, ui.ReviewView, {}, { __view: { state: 'saved', reason: null, online: true }, __sync: { status: 'on', userId: U1 }, __review: SNAP('ready', QUEUE()), ...globals });

  it('the list ended but the server still has cards today (a skipped card used no slot): 「復習する」 reads the list again and goes on; offline it says they load once online; none left: the done view', () => {
    globalThis.__dispatched = [];
    globalThis.__reloads = 0;
    const more = pageWith({ __session: ended('done', { doneToday: 9, remainingToday: 2, carriedOver: 0 }) });
    const els = elementsOf(more);
    assert.equal(textOfElement(els.find((el) => el.type === 'h2')), '今日の復習 2 枚（約 1 分）');
    assert.ok(textOf(more).includes('このカードは、いまは復習にありません。'), 'the skipped card\'s line stays');
    assert.ok(!textOf(more).includes('今日の復習は終わりです'), 'not "done" while the server has cards for today');
    const start = els.find((el) => el.type === 'button' && textOfElement(el) === '復習する');
    assert.ok(start);
    start.props.onClick();
    assert.deepEqual(globalThis.__dispatched, [{ type: 'clear' }], 'the session goes; the next one starts from a fresh read');
    assert.equal(globalThis.__reloads, 1);
    const offline = pageWith({ __session: ended('done', { remainingToday: 2 }), __view: { state: 'offline', reason: null, online: false } });
    assert.ok(textOf(offline).includes('インターネットにつながると、今日の復習を読み込めます。'));
    assert.equal(elementsOf(offline).some((el) => el.type === 'button' && textOfElement(el) === '復習する'), false);
    const done = elementsOf(pageWith({ __session: ended('done', { remainingToday: 0, carriedOver: 0 }) }));
    assert.equal(textOfElement(done.find((el) => el.type === 'h2')), '今日の復習は終わりです。おつかれさまでした。');
    const limit = elementsOf(pageWith({ __session: ended('limit', { remainingToday: 0, carriedOver: 3 }) }));
    assert.equal(textOfElement(limit.find((el) => el.type === 'h2')), '今日の復習は終わりです。おつかれさまでした。');
    delete globalThis.__dispatched;
    delete globalThis.__reloads;
  });

  it('a session that ended without a card: a sign-out says so (not "another account"); another account keeps its line; the always-mounted status line and the title can take focus', () => {
    // useState order in ReviewView: 0 settled, 1 the end note, 2 the live text.
    const signedOut = pageWith({ __session: ended('switched'), __review: SNAP('no_account'), __state: { 1: 'signedOut' } });
    const status = elementsOf(signedOut).find((el) => el.type === 'div' && el.props.role === 'status');
    assert.equal(textOfElement(status), 'ログインが切れたため、この復習はここで止めました。');
    assert.equal(status.props.tabIndex, -1, 'a focus target after the card left');
    assert.ok(textOf(signedOut).includes('復習は、ログインすると使えます'));
    const other = pageWith({ __session: ended('switched'), __state: { 1: 'other' } });
    assert.equal(textOfElement(elementsOf(other).find((el) => el.type === 'div' && el.props.role === 'status')), '別のアカウントでログインしたため、この復習はここで止めました。');
    const en = render(ui, ui.ReviewView, {}, { __view: { state: 'saved', reason: null, online: true }, __sync: { status: 'off', userId: null }, __review: SNAP('no_account'), __session: ended('switched'), __state: { 1: 'signedOut' }, __language: 'en' });
    assert.ok(textOf(en).includes('You were signed out, so this review stopped here.'));
    assert.equal(elementsOf(other).find((el) => el.type === 'h1').props.tabIndex, -1, 'the title is a focus target');
    const unsupported = pageWith({ __session: ended('unsupported') });
    assert.ok(textOf(unsupported).includes('復習は、いまは使えません。しばらくしてから、また開いてください。'));
    assert.equal(elementsOf(unsupported).some((el) => el.type === 'button' && textOfElement(el).includes('復習する')), false);
  });
});

describe('LessonEnd: the reset dialog says the lesson\'s review cards leave too (R4, design §5.6)', () => {
  const LESSON = { id: 'cc-03-plan-first', objectives: [{ id: 'o1', text: 'Goal' }], sections: [{ id: 's1', blocks: [{ id: 'b1', type: 'markdown' }] }] };
  const reader = { lesson: LESSON, courseSlug: 'claude-code', scrollToBlock() {}, progress: { progress: { v: 1, seen: ['b1'], answers: {}, checks: {}, ratings: {}, lastBlockId: null, updatedAt: '2026-10-25T00:00:00.000Z' }, pct: 50, getCheck: () => undefined, setRating() {}, resetLesson: async () => ({ ok: true }) } };
  const dialogText = (caps, language = 'jp') => {
    const els = elementsOf(render(ui, ui.LessonEnd, { next: null, prev: null, backTo: '/c', resettable: true }, {
      __view: { state: 'saved', reason: null, userId: U1, pending: 0, failures: 0, busy: false, savedAt: null, online: true },
      __sync: { status: 'on', userId: U1 },
      __reader: reader,
      __caps: caps,
      __language: language,
    }));
    const dialog = els.find((el) => el.type === 'ConfirmDialog');
    return textOf(walk(expand(dialog.props.body)));
  };

  it('a server with reviews: the sentence after the reset body; an older server: none', () => {
    const on = dialogText({ lessonReset: true, achievements: true, review: true });
    assert.ok(on.includes('このレッスンの復習カードも、復習の予定と記録ごと外れます（もう一度終えると、はじめから加わります）。'));
    assert.ok(on.indexOf('元に戻すことはできません。') < on.indexOf('このレッスンの復習カードも'), 'after the reset body');
    assert.ok(dialogText({ lessonReset: true, achievements: true, review: true }, 'en').includes("This lesson's review cards also leave your review, with their schedule and history"));
    assert.ok(!dialogText({ lessonReset: true, achievements: true }).includes('復習カード'), 'Phase 5 API');
    assert.ok(!dialogText({ lessonReset: true, achievements: true, review: false }).includes('復習カード'));
  });
});

describe('the sidebar 「復習」 and today\'s count (design §5.4)', () => {
  const layout = (review, { path = '/', language = 'jp' } = {}) => elementsOf(render(ui, ui.Layout, { currentView: 'DASHBOARD', onNavigate() {}, children: null }, { __review: review, __path: path, __language: language }));
  const entry = (els) => els.find((el) => el.type === 'a' && el.props.href === '/review') ?? null;

  it('after 学習コンテンツ; the pill is hidden from screen readers and the entry\'s name carries the count', () => {
    const els = layout(SNAP('ready', QUEUE({ remainingToday: 3 })));
    const links = els.filter((el) => el.type === 'a' && el.props.href && el.props.href.startsWith('/'));
    const hrefs = links.map((el) => el.props.href);
    assert.equal(hrefs.indexOf('/review'), hrefs.indexOf('/learning-hub') + 1);
    const a = entry(els);
    const parts = walk(a.props.children).filter((t) => 'el' in t).map((t) => t.el);
    const pill = parts.find((el) => classesOf(el).includes('rounded-full') && classesOf(el).includes('bg-primary-soft'));
    assert.equal(pill.props['aria-hidden'], 'true');
    assert.equal(textOfElement(pill), '3');
    const sr = parts.find((el) => classesOf(el).includes('sr-only') && textOfElement(el).includes('枚'));
    assert.equal(textOfElement(sr), '（今日 3 枚）');
    assert.ok(textOfElement(a).startsWith('復習'));
    const en = entry(layout(SNAP('ready', QUEUE({ remainingToday: 3 })), { language: 'en' }));
    assert.ok(textOfElement(en).includes('Review') && textOfElement(en).includes(' (3 due today)'));
  });

  it('no count for loading, no_account, unavailable or nothing left today; no entry at all on a server without reviews', () => {
    for (const snap of [SNAP('loading'), SNAP('no_account'), SNAP('unavailable'), SNAP('ready', QUEUE({ remainingToday: 0, doneToday: 10 }))]) {
      const a = entry(layout(snap));
      assert.ok(a, snap.status);
      assert.equal(textOfElement(a), '復習', snap.status);
    }
    assert.equal(entry(layout(SNAP('unsupported'))), null);
  });

  it('the rail (lesson pages): a dot instead of the pill, the count in the title and the screen-reader name', () => {
    const a = entry(layout(SNAP('ready', QUEUE({ remainingToday: 4 })), { path: '/learn/claude-code/cc-03-plan-first' }));
    assert.equal(a.props.title, '復習 (今日 4 枚)');
    const parts = walk(a.props.children).filter((t) => 'el' in t).map((t) => t.el);
    const dot = parts.find((el) => classesOf(el).includes('size-1.5'));
    assert.equal(dot.props['aria-hidden'], 'true');
    assert.ok(textOfElement(a).includes('（今日 4 枚）'));
  });
});

describe('Phase 6 copy and token rules (static)', () => {
  const NEW_FILES = [
    'components/review/ReviewCardView.tsx', 'components/review/ReviewView.tsx', 'components/review/ReviewTodayCard.tsx',
    'components/review/reviewCopy.ts', 'components/review/reviewModel.ts', 'components/review/reviewText.ts',
    'components/review/reviewClient.ts', 'services/reviewApi.ts',
  ];

  it('new files: design tokens only, no 「簡単です」「誰でも」, nothing in browser storage, no window scrolling', () => {
    for (const file of NEW_FILES) {
      const text = readFile(file);
      assert.doesNotMatch(text, TOKEN_RULE, file);
      assert.doesNotMatch(text, /簡単です|誰でも/, file);
      assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB/, file);
      assert.doesNotMatch(text, /window\.scrollTo|scrollTo\(/, file);
    }
    assert.match(readFile('components/review/reviewCopy.ts'), /const copy = \{\s*en: \{/);
    const layout = readFile('components/common/Layout.tsx');
    const added = layout.slice(layout.indexOf('// Phase 6: the review entry'), layout.indexOf('const languageOptions'));
    assert.doesNotMatch(added, TOKEN_RULE);
  });

  const keysOf = (value, prefix = '') => Object.entries(value).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();
  const valuesOf = (value, prefix = '') => Object.entries(value).flatMap(([k, v]) => {
    if (v && typeof v === 'object') return valuesOf(v, `${prefix}${k}.`);
    if (typeof v === 'function') return [[`${prefix}${k}`, String(v(3, 3))]];
    return [[`${prefix}${k}`, v]];
  });

  it('every copy key in both languages; every value but the Again button\'s label avoids 「もう一度」 / "again"', () => {
    const { en, jp } = ui.reviewCopy;
    assert.deepEqual(keysOf(en), keysOf(jp));
    for (const [lang, copy] of [['en', en], ['jp', jp]]) {
      for (const [key, value] of valuesOf(copy)) {
        if (key === 'again') continue;
        assert.doesNotMatch(value, /もう一度/, `${lang}.${key}`);
        assert.doesNotMatch(value, /\bagain\b/i, `${lang}.${key}`);
      }
    }
    assert.equal(jp.again, 'もう一度');
    assert.equal(en.again, 'Again');
    assert.equal(jp.good, '覚えた');
    assert.ok(jp.emptyBody.includes('復習カードのあるレッスン'));
    assert.ok(en.emptyBody.includes('a lesson that has review cards'));
    assert.equal(jp.card.dueTitle(10, 3), '今日の復習 10 枚（約 3 分）');
  });

  it('reset, delete-all and deletion copy mention the review schedule and history; the safety guide no longer says 「保存した復習カード」', () => {
    const del = readFile('components/features/settings/LessonProgressDeleteSection.tsx');
    assert.match(del, /scopeAccount: 'ログインしているすべての端末から消えます。復習カードの予定と記録も消えます。元に戻すことはできません。'/);
    assert.match(del, /dialogAccount: 'すべてのコース、すべての端末が対象で、確認問題の答えと復習の記録も消えます。元に戻すことはできません。'/);
    assert.match(del, /scopeAccount: 'It is deleted on every device where you are signed in, together with your review schedule and history\. This cannot be undone\.'/);
    assert.match(del, /dialogAccount: 'Every course, on every device, quiz answers and review history included\. This cannot be undone\.'/);
    const account = readFile('components/features/settings/DeleteAccountView.tsx');
    assert.ok(account.includes("'学習の進み具合と解答、復習の予定と記録、学習の履歴、XP とバッジ、学んだ日、やり直したレッスンの記録'"));
    assert.ok(account.includes("'Lesson progress and answers, your review schedule and history, learning history, XP, badges, learning days and the lessons you started over'"));
    const safety = readFile('components/features/safety/AiSafetyGuideView.tsx');
    assert.ok(!safety.includes('保存した復習カード') && !safety.includes('saved review cards'));
    assert.ok(safety.includes('AI 先生の答えから作ったカード'));
  });

  it('the route, the view state, the nav key and the lazy page', () => {
    assert.match(readFile('types.ts'), /REVIEW = 'REVIEW'/);
    assert.match(readFile('navigation/viewPaths.ts'), /\[ViewState\.REVIEW\]: '\/review'/);
    assert.match(readFile('navigation/viewPaths.ts'), /startsWithSegment\(path, '\/review'\)\) return 'review'/);
    assert.match(readFile('App.tsx'), /<Route path="\/review" element=\{<ReviewView \/>\} \/>/);
    assert.match(readFile('components/routes/lazyRoutes.tsx'), /export const ReviewView = lazy\(\s*\(\) => import\('\.\.\/review\/ReviewView'\)/);
    assert.ok(!readFile('components/lesson/blocks/FlashcardsBlock.tsx').includes('review/'), 'the in-lesson deck is unchanged');
  });
});
