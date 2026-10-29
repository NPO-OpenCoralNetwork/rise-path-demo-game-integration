// @ts-check
// Phase 8 front end (design p8 §4.4, §6):
// - S6: the in-lesson flashcards (components/lesson/blocks/FlashcardsBlock.tsx) key the turning part
//   by the card, as the review page does (ReviewCardView). Without the key React reuses the turned
//   span for the next card and turns it back over 480 ms while it already holds the next card's
//   answer, so that answer shows for a few frames. Rendered with esbuild against a React stub whose
//   jsx() returns { type, props, key } (as phase6Front.test.js does).
// - S4: the privacy settings page (components/features/settings/SettingsPrivacyView.tsx) uses design
//   tokens only (no palette colour that stays light in dark), its icons are hidden from assistive
//   tech and its two DELETE inputs are named by their headings and described by their paragraphs;
//   read as a TSX syntax tree.
// - S4: the reader's top bar (components/lesson/reader.css) is opaque in dark only.
// - S1 (§1.3 6–7): the reader bar's OfflineReloadNotice per controller state (rendered), its hooks,
//   the root ErrorBoundary's waiting screens (rendered as a class against a fake controller), and
//   the wiring of index.tsx, LearnRoute, LessonReader and reader.css (read as source). The
//   controller itself is tested in chunkReload.test.js.
// The legal pages' wider token pin is in legalPagesFront.test.js.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** @param {string} rel */
const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const TOKEN_RULE = /\[#[0-9a-fA-F]{3,8}\]|rounded-\[|text-\[(9|10|11)px\]|text-slate-400/;
/** A Tailwind palette colour (stays the same in dark): design tokens only. Also in legalPagesFront.test.js. */
const PALETTE_RULE = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|accent|decoration)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/;

// ---------------------------------------------------------------------------------------------
// S6: FlashcardsBlock, rendered
// ---------------------------------------------------------------------------------------------

/** @type {Record<string, string>} */
const STUBS = {
  react: `
    let index = 0;
    export const __resetHooks = () => { index = 0; };
    // By call order (FlashcardsBlock: 0 order, 1 pos, 2 flipped, 3 finished, 4 live). With
    // globalThis.__hookStore the state lives there across renders and every set is logged in
    // __setLog as [index, value] (OfflineReloadNotice); otherwise sets do nothing.
    export const useState = (initial) => {
      const i = index++;
      const init = () => (typeof initial === 'function' ? initial() : initial);
      const store = globalThis.__hookStore;
      if (store) {
        if (!(i in store)) store[i] = init();
        return [store[i], (v) => {
          store[i] = typeof v === 'function' ? v(store[i]) : v;
          (globalThis.__setLog ??= []).push([i, store[i]]);
        }];
      }
      const o = globalThis.__state;
      const value = o && i in o ? o[i] : init();
      return [value, () => {}];
    };
    export const useRef = (value) => ({ current: value ?? null });
    export const useMemo = (fn) => fn();
    export const useCallback = (fn) => fn;
    // __effects collects effects when a test asks for them (useRequireReload).
    export const useEffect = (fn) => { if (globalThis.__effects) globalThis.__effects.push(fn); };
    export const useSyncExternalStore = (subscribe, get) => get();
    export class Component {
      constructor(props) { this.props = props; }
      forceUpdate() { globalThis.__forceUpdates = (globalThis.__forceUpdates ?? 0) + 1; }
      setState() {}
    }
    export const createRef = () => ({ current: null });
    export const Fragment = 'Fragment';
    export default { useState, useRef, useMemo, useCallback, useEffect, useSyncExternalStore, Component, createRef, Fragment };
  `,
  'react/jsx-runtime': "export const jsx = (type, props, key) => ({ type, props, key }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'lucide-react': ['Check', 'ChevronLeft', 'ChevronRight', 'CloudOff', 'RotateCcw', 'RotateCw', 'ThumbsUp'].map((name) => `export const ${name} = '${name}';`).join('\n'),
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp' });",
  reader: 'export const useReader = () => globalThis.__reader;',
  md: "export const MdText = 'MdText';",
  model: "export const plainText = (value) => String(value ?? '');",
  button: "export const Button = 'Button'; export const buttonClasses = () => 'btn';",
  // The real module, with the page's controller replaced by the test's fake.
  chunkReload: `
    export * from ${JSON.stringify(path.join(ROOT, 'components/common/chunkReload.ts'))};
    export const pageOfflineReload = () => globalThis.__controller ?? null;
  `,
};

/** @param {string} entry */
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
        /** @param {RegExp} filter @param {string} name */
        const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
        stub(/^react$/, 'react');
        stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
        stub(/^lucide-react$/, 'lucide-react');
        stub(/context\/LanguageContext$/, 'language');
        stub(/\/ReaderContext$/, 'reader');
        stub(/\/Md$/, 'md');
        stub(/^\.\.\/model$/, 'model');
        stub(/\/ui\/Button$/, 'button');
        stub(/^\.\/chunkReload$/, 'chunkReload');
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js', resolveDir: ROOT }));
      },
    }],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

/** @param {any} node @returns {any} */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (node && typeof node === 'object' && 'type' in node) {
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}));
    return { type: node.type, key: node.key, props: { ...node.props, children: expand(node.props?.children) } };
  }
  return node;
}
/** @param {any} node @param {any[]} [out] @returns {any[]} */
function elements(node, out = []) {
  if (Array.isArray(node)) for (const child of node) elements(child, out);
  else if (node && typeof node === 'object' && 'type' in node) {
    out.push(node);
    elements(node.props?.children, out);
  }
  return out;
}
/** @param {any} el */
const classesOf = (el) => (typeof el.props?.className === 'string' ? el.props.className.split(/\s+/).filter(Boolean) : []);

const DECK = {
  id: 'deck',
  cards: [
    { id: 'card-a', front: 'A front', back: 'A ANSWER' },
    { id: 'card-b', front: 'B front', back: 'B ANSWER' },
  ],
};

/** @type {any} */
let ui = null;
before(async () => {
  const code = await bundleUi([
    "export { __resetHooks } from 'react';",
    "export { default as FlashcardsBlock } from './components/lesson/blocks/FlashcardsBlock';",
    "export { default as OfflineReloadNotice, OfflineReloadNoticeView, useOfflineReloadState, useReaderOfflineWait, useRequireReload } from './components/common/OfflineReloadNotice';",
    "export { BAR_EXTRA_PROPERTY, barExtra, scrollElementIntoContainer } from './components/lesson/useScrollContainer';",
    "export { default as ErrorBoundary } from './components/common/ErrorBoundary';",
  ].join('\n'));
  ui = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
});

/**
 * The deck at card `pos`, turned or not.
 * @param {{ pos: number, flipped: boolean }} state
 */
function renderDeck({ pos, flipped }) {
  Object.assign(globalThis, {
    __state: { 1: pos, 2: flipped },
    __reader: { progress: { getCheck: () => undefined, setCheck: () => {} }, t: (/** @type {unknown} */ x) => x },
  });
  ui.__resetHooks();
  try {
    const els = elements(expand(ui.FlashcardsBlock({ block: DECK })));
    const face = els.find((el) => el.type === 'button' && classesOf(el).includes('rp-card-face'));
    const inner = els.find((el) => el.type === 'span' && classesOf(el).includes('rp-card-inner'));
    assert.ok(face && inner, 'the face button and its turning span');
    return { face, inner, answers: elements(inner).filter((el) => el.type === 'MdText').map((el) => el.props.value) };
  } finally {
    // @ts-ignore test globals
    delete globalThis.__state;
    // @ts-ignore test globals
    delete globalThis.__reader;
  }
}

describe('S6: the in-lesson flashcards never show the next answer while moving on (FlashcardsBlock)', () => {
  it('the turning span is keyed by the card: card A turned and card B (next, unturned) are different elements', () => {
    // React reuses an element of the same type and key at the same place, with its CSS transition:
    // without a key the turned span of A would turn back from 180° while already holding B's sides.
    const a = renderDeck({ pos: 0, flipped: true });
    const b = renderDeck({ pos: 1, flipped: false });
    assert.equal(typeof a.inner.key, 'string');
    assert.equal(typeof b.inner.key, 'string');
    assert.notEqual(b.inner.key, a.inner.key, 'another card mounts a new span (unturned, no transition)');
    assert.equal(a.face.props['data-flipped'], true);
    assert.equal(b.face.props['data-flipped'], undefined, 'the next card starts unturned');
    assert.equal(b.face.props['aria-pressed'], false);
    assert.deepEqual(b.answers, ['B front', 'B ANSWER'], 'the new span holds only the next card');
  });

  it('the same card keeps its span while it turns (its own flip animates)', () => {
    const front = renderDeck({ pos: 0, flipped: false });
    const back = renderDeck({ pos: 0, flipped: true });
    assert.equal(front.inner.key, back.inner.key);
    assert.equal(typeof front.inner.key, 'string');
  });

  it('the face button has no key: it stays mounted from card to card (focus stays on it)', () => {
    for (const state of [{ pos: 0, flipped: true }, { pos: 1, flipped: false }]) {
      assert.equal(renderDeck(state).face.key, undefined);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// S4: SettingsPrivacyView, read as a TSX syntax tree
// ---------------------------------------------------------------------------------------------

const PRIVACY = 'components/features/settings/SettingsPrivacyView.tsx';

/**
 * Every JSX opening or self-closing element with its attributes: a string literal as { str }, an
 * expression as { expr } (its source text), a bare attribute as true.
 * @param {string} source
 */
function jsxElements(source) {
  const sf = ts.createSourceFile('view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  /** @type {Array<{ tag: string, attrs: Record<string, any>, text: string }>} */
  const out = [];
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      /** @type {Record<string, any>} */
      const attrs = {};
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const init = attr.initializer;
        attrs[attr.name.getText(sf)] = !init ? true
          : ts.isStringLiteral(init) ? { str: init.text }
          : ts.isJsxExpression(init) ? { expr: init.expression?.getText(sf) }
          : null;
      }
      // An opening element's children as source text ('' for a self-closing one).
      const text = ts.isJsxOpeningElement(node) ? node.parent.children.map((c) => c.getText(sf)).join('').trim() : '';
      out.push({ tag: node.tagName.getText(sf), attrs, text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
/** @param {{ attrs: Record<string, any> }} el */
const classList = (el) => (el.attrs.className?.str ?? '').split(/\s+/).filter(Boolean);

describe('S4: the privacy settings page in dark (SettingsPrivacyView)', () => {
  const source = readFile(PRIVACY);
  const els = jsxElements(source);

  it('design tokens only: no banned class and no palette colour (the page wash and white cards stayed light in dark)', () => {
    assert.doesNotMatch(source, TOKEN_RULE);
    assert.doesNotMatch(source, PALETTE_RULE);
    const wrap = els.find((el) => classList(el).includes('min-h-screen'));
    assert.ok(wrap, 'the page wrapper');
    assert.ok(!classList(wrap).some((c) => c.startsWith('bg-')), 'no wash of its own: <main> is bg-canvas');
    const cards = els.filter((el) => el.tag === 'section');
    assert.equal(cards.length, 4);
    for (const card of cards) {
      for (const cls of ['bg-surface', 'border-line', 'shadow-1']) assert.ok(classList(card).includes(cls), cls);
    }
  });

  it('every lucide icon is aria-hidden; status lines say it with an icon and text, no soft status fill', () => {
    const imported = source.match(/^import \{([^}]+)\} from 'lucide-react';$/m);
    assert.ok(imported);
    const icons = imported[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const name of ['Info', 'CircleCheck', 'CircleAlert']) assert.ok(icons.includes(name), name);
    const iconEls = els.filter((el) => icons.includes(el.tag));
    for (const name of icons) assert.ok(iconEls.some((el) => el.tag === name), `${name} is used`);
    for (const el of iconEls) assert.deepEqual(el.attrs['aria-hidden'], { str: 'true' }, el.tag);
    const tone = /** @param {string} tag */ (tag) => classList(/** @type {any} */ (iconEls.find((el) => el.tag === tag)));
    assert.ok(tone('Info').includes('text-info'), 'the disclaimer');
    assert.ok(tone('CircleCheck').includes('text-success'), 'the done line');
    assert.ok(tone('CircleAlert').includes('text-danger'), 'the error line');
  });

  it('the two DELETE inputs are named by their headings (useId) and stay readable in dark', () => {
    const inputs = els.filter((el) => el.tag === 'input' && el.attrs.type?.str === 'text');
    assert.equal(inputs.length, 2);
    const names = new Set();
    for (const input of inputs) {
      const labelledBy = input.attrs['aria-labelledby']?.expr;
      assert.ok(labelledBy, 'aria-labelledby');
      names.add(labelledBy);
      const heading = els.find((el) => /^h[1-6]$/.test(el.tag) && el.attrs.id?.expr === labelledBy);
      assert.ok(heading, `a heading carries id={${labelledBy}}`);
      assert.ok(classList(heading).includes('text-danger'));
      assert.match(source, new RegExp(`const ${labelledBy} = useId\\(\\);`));
      // A native input stays white in dark without its own surface.
      for (const cls of ['bg-surface', 'text-fg', 'border-line-strong', 'placeholder:text-fg-3', 'focus:ring-danger']) {
        assert.ok(classList(input).includes(cls), cls);
      }
    }
    assert.equal(names.size, 2, 'each input its own heading');
  });

  it('each DELETE input is described by the paragraph that says to type DELETE (a placeholder is not read everywhere)', () => {
    const inputs = els.filter((el) => el.tag === 'input' && el.attrs.type?.str === 'text');
    assert.equal(inputs.length, 2);
    const bodies = new Set();
    for (const input of inputs) {
      const describedBy = input.attrs['aria-describedby']?.expr;
      assert.ok(describedBy, 'aria-describedby');
      assert.notEqual(describedBy, input.attrs['aria-labelledby']?.expr);
      const para = els.find((el) => el.tag === 'p' && el.attrs.id?.expr === describedBy);
      assert.ok(para, `a paragraph carries id={${describedBy}}`);
      assert.match(source, new RegExp(`const ${describedBy} = useId\\(\\);`));
      const key = para.text.match(/^\{t\.(\w+)\}$/)?.[1];
      assert.ok(key, `the paragraph is one copy string: ${para.text}`);
      bodies.add(key);
      const copies = [...source.matchAll(new RegExp(`^\\s*${key}: '([^']*)',$`, 'gm'))].map((m) => m[1]);
      assert.equal(copies.length, 2, `${key} in en and jp`);
      for (const copy of copies) assert.match(copy, /DELETE/, `${key} says to type DELETE`);
    }
    assert.equal(bodies.size, 2, 'each input its own paragraph');
  });

  it('the pinned lines stay (policy link, delete-account link)', () => {
    assert.match(source, /\{features\.legalPages && \(\s*<p className="text-body text-fg-2">\s*\{t\.policyLead\}\s*<Link to="\/privacy"/);
    assert.match(source, /<Link to="\/settings\/delete-account"/);
  });
});

// ---------------------------------------------------------------------------------------------
// S4: the reader's top bar
// ---------------------------------------------------------------------------------------------

/**
 * Innermost rules of a stylesheet (comments dropped): each selector of a selector list, with the
 * rule's declarations.
 * @param {string} css
 */
function cssRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @type {Array<{ selectors: string[], decls: Record<string, string> }>} */
  const rules = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    /** @type {Record<string, string>} */
    const decls = {};
    for (const part of m[2].split(';')) {
      const i = part.indexOf(':');
      if (i > 0) decls[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/\s+/g, ' ');
    }
    rules.push({ selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls });
  }
  return rules;
}

describe('S4: the reader top bar is opaque in dark (reader.css)', () => {
  const rules = cssRules(readFile('components/lesson/reader.css'));
  /** @param {string} selector */
  const withSelector = (selector) => rules.filter((r) => r.selectors.includes(selector));

  it('[data-theme="dark"] .rp-bar: the surface token, no backdrop filter (no ghost text under the title)', () => {
    const dark = withSelector('[data-theme="dark"] .rp-bar');
    assert.equal(dark.length, 1);
    assert.equal(dark[0].decls.background, 'var(--rp-surface)');
    assert.equal(dark[0].decls['backdrop-filter'], 'none');
    assert.equal(dark[0].decls['-webkit-backdrop-filter'], 'none');
  });

  it('light and sepia keep the frosted bar; the phone bottom bar is not changed in this phase', () => {
    const light = withSelector('.rp-bar');
    assert.equal(light.length, 1);
    assert.equal(light[0].decls.background, 'color-mix(in srgb, var(--rp-surface) 90%, transparent)');
    assert.match(light[0].decls['backdrop-filter'], /blur\(10px\)/);
    // Deferred on purpose (Phase 8 scope guard SG-2): a later change to it is deliberate.
    assert.equal(rules.filter((r) => r.selectors.some((s) => /\[data-theme="dark"\].*\.rp-bottombar\b/.test(s))).length, 0);
  });
});

// ---------------------------------------------------------------------------------------------
// S1: offline right after opening a lesson
// ---------------------------------------------------------------------------------------------

/** The wording of design p8 §1.2, exactly (a change is deliberate). */
const S1_COPY = {
  jp: {
    offline: 'インターネットにつながっていないため、ページの一部を読み込めませんでした。つながったら、ここから読み込み直せます。学習の記録は、この端末に残っています。',
    checking: 'インターネットにつながりました。Rise Path につながるか確かめています…',
    unreachable: 'Rise Path がまだ答えません。答えたら、ここから読み込み直せます。',
    back: 'つながりました。読み込み直すと、読み込めなかった部分も表示されます。',
    reload: '読み込み直す',
    close: '閉じる',
    titles: { offline: 'インターネットにつながっていません', checking: 'つながるか確かめています', unreachable: 'Rise Path につながりません' },
    bodies: {
      offline: 'このページを読み込めませんでした。Rise Path につながると、自動で読み込み直します。学習の記録は、この端末に残っています。',
      checking: 'インターネットにつながりました。Rise Path につながるか確かめています…',
      unreachable: 'インターネットにはつながっていますが、Rise Path が答えません。答えると、自動で読み込み直します。学習の記録は、この端末に残っています。',
    },
    reloadPage: '再読み込み',
  },
  en: {
    offline: "You're offline, so part of this page couldn't load. Once you're back online, you can reload it from here. Your learning records stay on this device.",
    checking: "You're back online. Checking that Rise Path answers…",
    unreachable: "Rise Path isn't answering yet. Once it does, you can reload from here.",
    back: "You're back online. Reload to show the parts that didn't load.",
    reload: 'Reload',
    close: 'Close',
    titles: { offline: "You're offline", checking: 'Checking the connection', unreachable: "Rise Path isn't answering" },
    bodies: {
      offline: "This page couldn't load. It reloads by itself once Rise Path answers again. Your learning records stay on this device.",
      checking: "You're back online. Checking that Rise Path answers…",
      unreachable: "You're online, but Rise Path isn't answering yet. The page reloads by itself once it does. Your learning records stay on this device.",
    },
    reloadPage: 'Reload page',
  },
};
const WAITS = /** @type {const} */ (['offline', 'checking', 'unreachable', 'back']);

/** Text content of a rendered tree. @param {any} node @returns {string} */
const textOf = (node) => {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
};

describe('S1: the reader bar notice (OfflineReloadNoticeView)', () => {
  /** @param {any} props */
  const render = (props) => expand(ui.OfflineReloadNoticeView({ language: 'jp', dismissed: false, onReload() {}, onDismiss() {}, ...props }));

  it('none, and a closed notice: one empty role="status" region (always mounted, so what appears is announced)', () => {
    for (const props of [{ wait: 'none' }, { wait: 'offline', dismissed: true }, { wait: 'back', dismissed: true }]) {
      const root = render(props);
      assert.equal(root.type, 'div');
      assert.equal(root.props.role, 'status');
      assert.ok(classesOf(root).includes('rp-chunk-status'));
      assert.equal(root.props.children, null, JSON.stringify(props));
    }
  });

  for (const language of /** @type {const} */ (['jp', 'en'])) {
    it(`each state's text in ${language}; 「${S1_COPY[language].reload}」 only when back; 閉じる everywhere; icons hidden`, () => {
      for (const wait of WAITS) {
        /** @type {string[]} */
        const calls = [];
        const root = render({ language, wait, onReload: () => calls.push('reload'), onDismiss: () => calls.push('dismiss') });
        assert.equal(root.props.role, 'status');
        const els = elements(root);
        const card = els.find((el) => el.type === 'p');
        assert.ok(card, wait);
        assert.equal(card.props['data-kind'], 'chunk');
        assert.equal(card.props['data-state'], wait);
        const text = els.find((el) => el.type === 'span' && classesOf(el).includes('rp-status-text'));
        assert.equal(textOf(text), S1_COPY[language][wait], `${language} ${wait}`);
        const icons = els.filter((el) => el.type === 'CloudOff' || el.type === 'RotateCw');
        assert.deepEqual(icons.map((el) => el.type), [wait === 'back' ? 'RotateCw' : 'CloudOff']);
        for (const icon of icons) assert.equal(icon.props['aria-hidden'], 'true');
        const buttons = els.filter((el) => el.type === 'button');
        for (const button of buttons) assert.equal(button.props.type, 'button');
        const close = buttons.find((el) => el.props['aria-label'] === S1_COPY[language].close);
        assert.ok(close, `${wait}: close`);
        const reload = buttons.find((el) => textOf(el) === S1_COPY[language].reload);
        assert.equal(Boolean(reload), wait === 'back', `${wait}: reload only once the app answered`);
        assert.equal(buttons.length, wait === 'back' ? 2 : 1);
        reload?.props.onClick();
        close.props.onClick();
        assert.deepEqual(calls, wait === 'back' ? ['reload', 'dismiss'] : ['dismiss']);
        for (const el of els) assert.doesNotMatch(classesOf(el).join(' '), TOKEN_RULE);
      }
    });
  }
});

describe('S1: the hooks LearnRoute and the notice use', () => {
  /** @param {string} state */
  const fakeController = (state) => {
    const log = /** @type {string[]} */ ([]);
    return {
      log,
      state: () => state,
      subscribe: () => () => {},
      requireReload: () => { log.push('require'); return () => log.push('release'); },
      reloadNow: () => log.push('reloadNow'),
    };
  };
  const withGlobals = (/** @type {Record<string, unknown>} */ g, /** @type {() => void} */ fn) => {
    Object.assign(globalThis, g);
    try { fn(); } finally { for (const key of Object.keys(g)) delete (/** @type {any} */ (globalThis))[key]; }
  };

  it('useOfflineReloadState reads the page controller; none without one', () => {
    withGlobals({ __controller: fakeController('unreachable') }, () => assert.equal(ui.useOfflineReloadState(), 'unreachable'));
    assert.equal(ui.useOfflineReloadState(), 'none');
  });

  it('useRequireReload(true) holds requireReload until cleanup; useRequireReload(false) asks for nothing', () => {
    const controller = fakeController('offline');
    /** @type {Array<() => unknown>} */
    const effects = [];
    withGlobals({ __controller: controller, __effects: effects }, () => {
      ui.useRequireReload(true);
      ui.useRequireReload(false);
      assert.equal(effects.length, 2);
      const cleanup = effects[0]();
      assert.equal(typeof cleanup, 'function');
      assert.deepEqual(controller.log, ['require']);
      /** @type {any} */ (cleanup)();
      assert.deepEqual(controller.log, ['require', 'release']);
      assert.equal(effects[1](), undefined);
      assert.deepEqual(controller.log, ['require', 'release']);
    });
  });
});

describe('S1: OfflineReloadNotice (closing per stretch of a state, reload, focus, the bar\'s extra height)', () => {
  /**
   * The notice on a page: a controller whose state the test sets, React state kept across renders
   * (the stub's __hookStore), a fake #main-content and window. `render(wait)` re-renders while a
   * render sets state, as React does. Unless `failedSinceMount` is false, the notice is first
   * mounted while nothing failed and then a part fails (`fail()`), as on the lesson that degraded.
   * @param {(p: any) => void} fn
   * @param {{ failedSinceMount?: boolean }} [o]
   */
  const onPage = (fn, { failedSinceMount = true } = {}) => {
    /** @type {any[]} */
    const log = [];
    const controller = {
      wait: 'none',
      count: 0,
      state: () => controller.wait,
      failures: () => controller.count,
      subscribe: () => () => {},
      requireReload: () => () => {},
      reloadNow: () => log.push('reloadNow'),
    };
    /** @type {Array<() => unknown>} */
    const effects = [];
    const main = { focus: (/** @type {unknown} */ o) => log.push(['focus', o]) };
    Object.assign(globalThis, {
      __controller: controller,
      __hookStore: {},
      __setLog: [],
      __effects: effects,
      document: { getElementById: (/** @type {string} */ id) => (id === 'main-content' ? main : null) },
      window: { location: { reload: () => log.push('location.reload') } },
    });
    /** @param {string} wait @param {'jp' | 'en'} [language] */
    const render = (wait, language = 'jp') => {
      controller.wait = wait;
      /** @type {any} */ (globalThis).__language = language;
      for (let pass = 0; pass < 3; pass += 1) {
        const sets = /** @type {any} */ (globalThis).__setLog.length;
        ui.__resetHooks();
        effects.length = 0;
        const tree = expand(ui.OfflineReloadNotice());
        if (/** @type {any} */ (globalThis).__setLog.length === sets) return tree;
      }
      throw new Error('a render keeps setting state');
    };
    /** @param {any} tree */
    const card = (tree) => elements(tree).find((el) => el.type === 'p');
    /** @param {any} tree @param {string} label */
    const button = (tree, label) => elements(tree).find((el) => el.type === 'button' && (textOf(el) === label || el.props['aria-label'] === label));
    const fail = () => { controller.count += 1; };
    /** A new reader (LessonReader is keyed per lesson): fresh React state, the same page controller. */
    const remount = () => { /** @type {any} */ (globalThis).__hookStore = {}; };
    try {
      if (failedSinceMount) {
        render('none');
        fail();
      }
      fn({ log, controller, effects, render, card, button, fail, remount });
    } finally {
      for (const key of ['__controller', '__hookStore', '__setLog', '__effects', '__language', 'document', 'window']) {
        delete (/** @type {any} */ (globalThis))[key];
      }
    }
  };
  const jp = S1_COPY.jp;

  it('closing hides the card for the rest of that state only; the next change shows it again, every time', () => {
    // Review round 1, finding 2: back → close → offline → back showed no card the second time.
    onPage(({ render, card, button }) => {
      let tree = render('back');
      assert.ok(button(tree, jp.reload));
      button(tree, jp.close).props.onClick();
      assert.equal(render('back').props.children, null, 'closed for the rest of this back');
      assert.equal(render('back').props.children, null);
      tree = render('offline');
      assert.equal(card(tree)?.props['data-state'], 'offline', 'a new state: shown again');
      tree = render('checking');
      assert.equal(card(tree)?.props['data-state'], 'checking');
      tree = render('back');
      assert.equal(card(tree)?.props['data-state'], 'back', 'back again after another outage: shown');
      assert.ok(button(tree, jp.reload), '「読み込み直す」 is there when the learner needs it');
      // The same for offline → checking → offline.
      button(render('offline'), jp.close).props.onClick();
      assert.equal(render('offline').props.children, null);
      assert.ok(card(render('checking')));
      assert.equal(card(render('offline'))?.props['data-state'], 'offline');
    });
  });

  it('a notice closed while offline comes back in back with 「読み込み直す」 (a degraded page never reloads by itself)', () => {
    onPage(({ render, card, button }) => {
      button(render('offline'), jp.close).props.onClick();
      assert.equal(render('offline').props.children, null, 'closed while offline: hidden while offline');
      const tree = render('back');
      assert.equal(card(tree)?.props['data-state'], 'back');
      assert.ok(button(tree, jp.reload));
    });
  });

  it('a reader where nothing failed since it mounted shows nothing in any state (final review, finding 1: cc-01 after cc-02 failed)', () => {
    // cc-02's lesson chunk failed offline (the page is 'offline'), the learner went Back to cc-01,
    // which is fully loaded: its new reader must not say a part failed, nor offer a reload later.
    onPage(({ render, card }) => {
      for (const wait of ['offline', 'checking', 'unreachable', 'back']) {
        const tree = render(wait);
        assert.equal(tree.props.role, 'status', `${wait}: the region stays mounted`);
        assert.equal(tree.props.children, null, `${wait}: empty`);
        assert.equal(card(tree), undefined);
      }
    }, { failedSinceMount: false });
  });

  it('useReaderOfflineWait (the notice and LessonReader read it): none until a part fails after mount, then the page\'s state; a new reader starts at none', () => {
    onPage(({ controller, fail, remount }) => {
      /** @param {string} wait */
      const read = (wait) => {
        controller.wait = wait;
        ui.__resetHooks();
        return ui.useReaderOfflineWait();
      };
      assert.equal(read('offline'), 'none', 'the page is offline, nothing failed here');
      fail();
      for (const wait of ['offline', 'checking', 'unreachable', 'back', 'none']) assert.equal(read(wait), wait);
      remount();
      assert.equal(read('offline'), 'none', 'a new reader: only its own failures count');
      fail();
      assert.equal(read('offline'), 'offline');
    }, { failedSinceMount: false });
  });

  it('a part that fails after mount shows the card for the page\'s state; 「読み込み直す」 in back (final review, finding 1)', () => {
    onPage(({ render, card, button, fail }) => {
      assert.equal(render('offline').props.children, null);
      fail(); // a diagram's chunk failed on this lesson
      let tree = render('offline');
      assert.equal(card(tree)?.props['data-state'], 'offline');
      tree = render('back');
      assert.equal(card(tree)?.props['data-state'], 'back');
      assert.ok(button(tree, jp.reload));
    }, { failedSinceMount: false });
  });

  it('a new reader in back starts empty; its own failure shows the card with 「読み込み直す」 (the lesson that degraded, design check g)', () => {
    onPage(({ render, card, button, fail, remount }) => {
      assert.ok(card(render('back')), 'the reader where the part failed');
      remount(); // another lesson, or back to the same one
      assert.equal(render('back').props.children, null, 'nothing failed here yet');
      fail(); // its diagram imports again (mermaidRenderer drops a failed load) and fails again
      const tree = render('back');
      assert.equal(card(tree)?.props['data-state'], 'back');
      assert.ok(button(tree, jp.reload));
    });
  });

  it('閉じる moves focus to #main-content without scrolling; 「読み込み直す」 goes through the controller\'s reloadNow', () => {
    for (const language of /** @type {const} */ (['jp', 'en'])) {
      onPage(({ log, render, button }) => {
        const tree = render('back', language);
        button(tree, S1_COPY[language].reload).props.onClick();
        assert.deepEqual(log, ['reloadNow'], 'once per page and never offline: not location.reload()');
        button(tree, S1_COPY[language].close).props.onClick();
        assert.deepEqual(log, ['reloadNow', ['focus', { preventScroll: true }]], language);
      });
    }
  });

  it('the bar\'s extra height: published on #main-content while the card shows, removed while empty and on unmount', () => {
    // Review round 1, finding 3: the notice grows the sticky bar; the offsets follow it.
    onPage(({ effects, render }) => {
      const tree = render('offline');
      assert.equal(effects.length, 1, 'one effect: the height');
      /** @type {Record<string, string>} */
      const props = {};
      const style = {
        setProperty: (/** @type {string} */ k, /** @type {string} */ v) => { props[k] = v; },
        removeProperty: (/** @type {string} */ k) => { delete props[k]; },
      };
      let height = 89.2;
      /** @type {string[]} */
      const asked = [];
      const host = {
        closest: (/** @type {string} */ sel) => { asked.push(sel); return sel === '#main-content' ? { style } : null; },
        getBoundingClientRect: () => ({ height }),
      };
      /** @type {any} */
      let observer = null;
      const saved = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
      globalThis.ResizeObserver = /** @type {any} */ (class {
        /** @param {() => void} cb */
        constructor(cb) { this.cb = cb; this.observed = /** @type {unknown[]} */ ([]); this.disconnected = false; observer = this; }
        /** @param {unknown} el */
        observe(el) { this.observed.push(el); }
        disconnect() { this.disconnected = true; }
      });
      try {
        tree.props.ref.current = host;
        const cleanup = /** @type {() => void} */ (effects[0]());
        assert.deepEqual(asked, ['#main-content']);
        assert.deepEqual(observer.observed, [host]);
        assert.deepEqual(props, { '--rp-bar-extra': '90px' });
        assert.equal(ui.BAR_EXTRA_PROPERTY, '--rp-bar-extra');
        height = 0; // closed: the region is empty
        observer.cb();
        assert.deepEqual(props, {});
        height = 120;
        observer.cb();
        assert.deepEqual(props, { '--rp-bar-extra': '120px' });
        cleanup();
        assert.equal(observer.disconnected, true);
        assert.deepEqual(props, {}, 'unmounted: nothing left on <main>');
        // Outside <main> it falls back to the reader root; with neither, nothing happens.
        const reader = { style, closest: undefined };
        const lone = { closest: (/** @type {string} */ sel) => (sel === '.rp-reader' ? reader : null), getBoundingClientRect: () => ({ height: 40 }) };
        tree.props.ref.current = lone;
        const cleanup2 = /** @type {() => void} */ (effects[0]());
        assert.deepEqual(props, { '--rp-bar-extra': '40px' });
        cleanup2();
        tree.props.ref.current = { closest: () => null, getBoundingClientRect: () => ({ height: 40 }) };
        assert.equal(effects[0](), undefined);
        assert.deepEqual(props, {});
      } finally {
        if (saved) Object.defineProperty(globalThis, 'ResizeObserver', saved);
        else delete (/** @type {any} */ (globalThis)).ResizeObserver;
      }
    });
  });

  it('the reader\'s jumps add the extra height read from the container\'s own inline style (useScrollContainer)', () => {
    /** @param {string} value */
    const containerWith = (value) => {
      /** @type {any[]} */
      const calls = [];
      return {
        calls,
        scrollTop: 100,
        style: { getPropertyValue: (/** @type {string} */ k) => (k === '--rp-bar-extra' ? value : '') },
        getBoundingClientRect: () => ({ top: 0 }),
        scrollTo: (/** @type {unknown} */ o) => calls.push(o),
      };
    };
    for (const [value, extra] of /** @type {const} */ ([['90px', 90], ['', 0], ['junk', 0], ['-4px', 0]])) {
      assert.equal(ui.barExtra(containerWith(value)), extra, value);
    }
    Object.assign(globalThis, { document: { documentElement: {} } });
    try {
      const target = { getBoundingClientRect: () => ({ top: 500 }) };
      const grown = containerWith('90px');
      ui.scrollElementIntoContainer(grown, target, { smooth: false });
      assert.deepEqual(grown.calls, [{ top: 500 + 100 - 72 - 90, behavior: 'auto' }], 'below the grown bar');
      const plain = containerWith('');
      ui.scrollElementIntoContainer(plain, target, { smooth: false });
      assert.deepEqual(plain.calls, [{ top: 500 + 100 - 72, behavior: 'auto' }], 'today\'s offset without the notice');
    } finally {
      // @ts-ignore test globals
      delete globalThis.document;
    }
  });
});

describe('S1: the root ErrorBoundary while the page waits for the connection', () => {
  const CHUNK = new TypeError('Failed to fetch dynamically imported module: https://app.example/assets/BadgesView-abc123.js');
  /** @param {string} wait */
  const controllerIn = (wait) => {
    const log = /** @type {string[]} */ ([]);
    /** @type {Array<() => void>} */
    const listeners = [];
    return {
      log,
      listeners,
      state: () => wait,
      subscribe: (/** @type {() => void} */ l) => { listeners.push(l); return () => log.push('unsubscribe'); },
      requireReload: () => { log.push('require'); return () => log.push('release'); },
      reloadNow: () => log.push('reloadNow'),
    };
  };
  /**
   * @param {{ wait: string, language?: 'jp' | 'en', error?: unknown }} o
   */
  const renderBoundary = ({ wait, language = 'jp', error = CHUNK }) => {
    const controller = controllerIn(wait);
    Object.assign(globalThis, {
      __controller: controller,
      document: { documentElement: { lang: language === 'jp' ? 'ja' : 'en' }, querySelector: () => null },
    });
    try {
      const eb = new ui.ErrorBoundary({});
      eb.state = { hasError: true, error };
      const tree = expand(eb.render());
      return { tree, els: elements(tree), controller, eb };
    } finally {
      // @ts-ignore test globals
      delete globalThis.__controller;
      // @ts-ignore test globals
      delete globalThis.document;
    }
  };

  for (const language of /** @type {const} */ (['jp', 'en'])) {
    it(`offline and checking (and back): the controller's words, no button at all (${language})`, () => {
      for (const [wait, shown] of [['offline', 'offline'], ['checking', 'checking'], ['back', 'checking']]) {
        const { els } = renderBoundary({ wait, language });
        const h1 = els.find((el) => el.type === 'h1');
        assert.equal(textOf(h1), S1_COPY[language].titles[/** @type {'offline'} */ (shown)], wait);
        const body = els.find((el) => el.type === 'p');
        assert.equal(body.props.role, 'status', 'a later state is announced');
        assert.equal(textOf(body), S1_COPY[language].bodies[/** @type {'offline'} */ (shown)]);
        assert.equal(els.filter((el) => el.type === 'Button' || el.type === 'button' || el.type === 'a').length, 0, `${wait}: no reload, no home link`);
      }
    });

    it(`unreachable: 「${S1_COPY[language].reloadPage}」 wired to the controller's reloadNow, no home link (${language})`, () => {
      const { els, controller } = renderBoundary({ wait: 'unreachable', language });
      assert.equal(textOf(els.find((el) => el.type === 'h1')), S1_COPY[language].titles.unreachable);
      assert.equal(textOf(els.find((el) => el.type === 'p')), S1_COPY[language].bodies.unreachable);
      const buttons = els.filter((el) => el.type === 'Button');
      assert.equal(buttons.length, 1);
      assert.equal(textOf(buttons[0]), S1_COPY[language].reloadPage);
      assert.equal(els.filter((el) => el.type === 'a').length, 0);
      Object.assign(globalThis, { __controller: controller });
      try { buttons[0].props.onClick(); } finally { /** @type {any} */ (globalThis).__controller = undefined; }
      assert.deepEqual(controller.log, ['reloadNow']);
    });
  }

  it('nothing waits: today\'s screens ("a new version", or a plain error) with reload and home', () => {
    const stale = renderBoundary({ wait: 'none' });
    assert.equal(textOf(stale.els.find((el) => el.type === 'h1')), '新しいバージョンがあります');
    assert.equal(stale.els.find((el) => el.type === 'p').props.role, undefined);
    assert.equal(stale.els.filter((el) => el.type === 'Button').length, 1);
    assert.equal(stale.els.filter((el) => el.type === 'a').length, 1);
    const bug = renderBoundary({ wait: 'offline', error: new TypeError("Cannot read properties of undefined (reading 'x')") });
    assert.equal(textOf(bug.els.find((el) => el.type === 'h1')), '問題が発生しました', 'a bug is not an offline screen');
    assert.equal(bug.els.filter((el) => el.type === 'Button').length, 1);
  });

  it('a chunk error while waiting holds requireReload until unmount; none when nothing waits or for a bug; follows the controller', () => {
    for (const [wait, error, held] of [['offline', CHUNK, true], ['unreachable', CHUNK, true], ['none', CHUNK, false], ['offline', new Error('bug'), false]]) {
      const controller = controllerIn(/** @type {string} */ (wait));
      Object.assign(globalThis, { __controller: controller, __forceUpdates: 0 });
      try {
        const eb = new ui.ErrorBoundary({});
        eb.componentDidMount();
        assert.equal(controller.listeners.length, 1, 'subscribed');
        controller.listeners[0]();
        assert.equal(/** @type {any} */ (globalThis).__forceUpdates, 0, 'no re-render without an error');
        eb.state = { hasError: true, error };
        eb.componentDidUpdate({}, { hasError: false, error: null });
        controller.listeners[0]();
        assert.equal(/** @type {any} */ (globalThis).__forceUpdates, 1, 'the waiting screen follows the controller');
        eb.componentDidUpdate({}, { hasError: true, error }); // a later update asks again for nothing
        eb.componentWillUnmount();
        assert.deepEqual(controller.log, held ? ['require', 'release', 'unsubscribe'] : ['unsubscribe'], `${wait} ${String(error)}`);
      } finally {
        // @ts-ignore test globals
        delete globalThis.__controller;
        // @ts-ignore test globals
        delete globalThis.__forceUpdates;
      }
    }
  });

  /**
   * A controller whose state the test moves; `notifyOnRequire` makes requireReload behave as in
   * 'back' (it checks again and notifies the subscribers synchronously, back → checking).
   * @param {{ wait: string, notifyOnRequire?: boolean }} o
   */
  const movingController = (o) => {
    const log = /** @type {string[]} */ ([]);
    /** @type {Array<() => void>} */
    const listeners = [];
    const c = {
      log,
      listeners,
      wait: o.wait,
      state: () => c.wait,
      subscribe: (/** @type {() => void} */ l) => { listeners.push(l); return () => log.push('unsubscribe'); },
      requireReload: () => {
        log.push('require');
        if (o.notifyOnRequire && c.wait === 'back') {
          c.wait = 'checking';
          for (const l of [...listeners]) l();
        }
        return () => log.push('release');
      },
      reloadNow: () => log.push('reloadNow'),
      /** @param {string} next */
      move(next) { c.wait = next; for (const l of [...listeners]) l(); },
    };
    return c;
  };
  /** @param {any} controller @param {() => void} fn */
  const withController = (controller, fn) => {
    Object.assign(globalThis, { __controller: controller, __forceUpdates: 0 });
    try { fn(); } finally {
      // @ts-ignore test globals
      delete globalThis.__controller;
      // @ts-ignore test globals
      delete globalThis.__forceUpdates;
    }
  };

  it('a chunk error shown while nothing waited takes the hold once the page starts waiting (another import failed offline)', () => {
    // Review round 1, finding 1: the screen then says it reloads by itself, so it must hold
    // requireReload; without it the controller ends in 'back' and the screen says "checking" for good.
    const controller = movingController({ wait: 'none' });
    withController(controller, () => {
      const eb = new ui.ErrorBoundary({});
      eb.componentDidMount();
      eb.state = { hasError: true, error: CHUNK };
      eb.componentDidUpdate({}, { hasError: false, error: null });
      assert.deepEqual(controller.log, [], 'nothing waits yet: today\'s screen, no hold');
      controller.move('offline');
      assert.deepEqual(controller.log, ['require'], 'the page waits now: hold');
      assert.equal(/** @type {any} */ (globalThis).__forceUpdates, 1);
      controller.move('checking');
      controller.move('unreachable');
      assert.deepEqual(controller.log, ['require'], 'one hold however often the state changes');
      eb.componentWillUnmount();
      assert.deepEqual(controller.log, ['require', 'release', 'unsubscribe']);
    });
  });

  it('a bug never takes the hold, also when the page starts waiting later', () => {
    const controller = movingController({ wait: 'none' });
    withController(controller, () => {
      const eb = new ui.ErrorBoundary({});
      eb.componentDidMount();
      eb.state = { hasError: true, error: new Error('bug') };
      eb.componentDidUpdate({}, { hasError: false, error: null });
      controller.move('offline');
      eb.componentWillUnmount();
      assert.deepEqual(controller.log, ['unsubscribe']);
    });
  });

  it('in back, requireReload notifies synchronously (back → checking): still exactly one hold, released once', () => {
    for (const late of [false, true]) {
      const controller = movingController({ wait: late ? 'none' : 'back', notifyOnRequire: true });
      withController(controller, () => {
        const eb = new ui.ErrorBoundary({});
        eb.componentDidMount();
        eb.state = { hasError: true, error: CHUNK };
        eb.componentDidUpdate({}, { hasError: false, error: null });
        if (late) controller.move('back'); // a degraded page answered; then this screen came up earlier
        assert.deepEqual(controller.log, ['require'], `late=${late}`);
        assert.equal(controller.wait, 'checking');
        eb.componentWillUnmount();
        eb.componentWillUnmount();
        assert.deepEqual(controller.log, ['require', 'release', 'unsubscribe'], `late=${late}`);
      });
    }
  });
});

describe('S1: wiring (index.tsx, LearnRoute, LessonReader, reader.css, copy)', () => {
  it('index.tsx hands every vite:preloadError to handlePreloadError with the online state and the controller\'s wait', () => {
    const index = readFile('index.tsx');
    assert.match(index, /const offlineReload = pageOfflineReload\(\);\nwindow\.addEventListener\('vite:preloadError', \(event\) => \{\n {2}handlePreloadError\(event, \{/);
    assert.match(index, /\n {4}online: navigatorOnline\(\),\n/);
    assert.match(index, /\n {4}waiting: \(offlineReload\?\.state\(\) \?\? 'none'\) !== 'none',\n/);
    assert.match(index, /\n {4}awaitOnline: \(\) => offlineReload\?\.chunkFailed\(\),\n/);
    assert.match(index, /reload: \(\) => \{\n {6}markChunkReloadStarted\(\);\n {6}window\.location\.reload\(\);\n {4}\},/);
    assert.doesNotMatch(index, /preventDefault\(\)/, 'only handlePreloadError decides preventDefault');
    assert.doesNotMatch(index, /claimReloadForPreloadError|claimChunkReload/, 'no claim of its own');
  });

  it('LearnRoute: the offline problem has no re-import retry; 「再読み込み」 (reloadNow) only when unreachable; it holds requireReload', () => {
    const route = readFile('components/routes/LearnRoute.tsx');
    assert.match(route, /const wait = useOfflineReloadState\(\);\n {2}const offlineError = state\.status === 'error' && wait !== 'none';\n {2}useRequireReload\(offlineError\);/);
    const start = route.indexOf("if (state.status === 'error' && wait !== 'none') {");
    const end = route.indexOf("if (state.status === 'error') {");
    assert.ok(start > 0 && end > start, 'the offline branch comes before the online one');
    const offline = route.slice(start, end);
    assert.doesNotMatch(offline, /setAttempt/, 're-importing a failed module URL fails again');
    assert.match(offline, /title=\{offlinePageTitle\(language, wait\)\}/);
    assert.match(offline, /body=\{offlinePageBody\(language, wait\)\}/);
    assert.match(offline, /\n {8}live\n/);
    assert.match(offline, /\{\.\.\.\(wait === 'unreachable'\n {10}\? \{ onRetry: \(\) => pageOfflineReload\(\)\?\.reloadNow\(\), retryLabel: offlineReloadCopy\[language\]\.reloadPage \}\n {10}: \{\}\)\}/);
    assert.equal((offline.match(/onRetry/g) ?? []).length, 1);
    // The online branch keeps its retry.
    assert.match(route.slice(end), /^if \(state\.status === 'error'\) \{\n {4}return \(\n {6}<Problem\n[^]*?onRetry=\{\(\) => setAttempt\(\(n\) => n \+ 1\)\}/);
    assert.match(route, /<p role=\{live \? 'status' : undefined\} className="mt-2 text-body text-fg-2">\{body\}<\/p>/);
  });

  it('LessonReader renders the notice first in the bar\'s notice slot; App.tsx has no notice of its own (scope guard SG-1)', () => {
    const reader = readFile('components/lesson/LessonReader.tsx');
    assert.match(reader, /^import OfflineReloadNotice, \{ useReaderOfflineWait \} from '\.\.\/common\/OfflineReloadNotice';$/m);
    assert.match(reader, /notice=\{\(\n {12}<>\n {14}\{\/\*[^\n]*\*\/\}\n {14}<OfflineReloadNotice \/>\n {14}\{resumed && !statusMessage \? \(/);
    assert.equal((reader.match(/<OfflineReloadNotice \/>/g) ?? []).length, 1);
    assert.doesNotMatch(readFile('App.tsx'), /OfflineReloadNotice/);
  });

  it('reader.css: the notice sits in the bar\'s flow, has no size while empty, and uses tokens only (outside the Phase 5 slice)', () => {
    const css = readFile('components/lesson/reader.css');
    const rules = cssRules(css);
    /** @param {string} selector */
    const one = (selector) => {
      const found = rules.filter((r) => r.selectors.includes(selector));
      assert.equal(found.length, 1, selector);
      return found[0].decls;
    };
    const host = one('.rp-chunk-status');
    assert.equal(host.display, 'flex');
    assert.equal(host.padding, '0 16px');
    assert.equal(host.position, undefined, 'in flow: the sticky bar grows, nothing is covered');
    assert.deepEqual(one('.rp-chunk-status:not(:empty)'), { 'padding-top': '10px', 'padding-bottom': '10px' });
    assert.equal(one('.rp-status-card[data-kind="chunk"] .rp-status-icon').color, 'var(--rp-info)');
    // The grown bar (--rp-bar-extra, OfflineReloadNotice): focus scrolling and the sticky columns follow it.
    const paddings = rules.filter((r) => r.selectors.includes('#main-content:has(.rp-reader)') && 'scroll-padding-top' in r.decls);
    assert.deepEqual(paddings.map((r) => r.decls['scroll-padding-top']), ['calc(72px + var(--rp-bar-extra, 0px))']);
    const sticky = one('.rp-col-sticky');
    assert.equal(sticky.top, 'calc(var(--rp-bar-total) + var(--rp-bar-extra, 0px) + 28px)');
    assert.equal(sticky['max-height'], 'calc(100dvh - var(--rp-bar-total) - var(--rp-bar-extra, 0px) - 48px)');
    const block = css.slice(css.indexOf('.rp-chunk-status {'), css.indexOf('/* Progress ring */'));
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'colours from tokens');
    assert.ok(css.indexOf('.rp-chunk-status {') > css.indexOf('.rp-status-card .rp-notice-x'), 'after the slice phase5Front.test.js reads');
  });

  it('copy: en and jp with the same keys, no 「簡単です」「誰でも」; new and changed TSX on tokens only', () => {
    const copySource = readFile('components/common/offlineReloadCopy.ts');
    const keys = (/** @type {string} */ lang) => {
      const start = copySource.indexOf(`  ${lang}: {`);
      const body = copySource.slice(start, copySource.indexOf('\n  },', start));
      return [...body.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
    };
    assert.deepEqual(keys('jp'), keys('en'));
    assert.equal(keys('en').length, 12);
    assert.doesNotMatch(copySource, /簡単です|誰でも/);
    assert.doesNotMatch(copySource, /from 'react'/, 'React-free: the boundary renders outside the providers');
    for (const file of ['components/common/OfflineReloadNotice.tsx', 'components/common/ErrorBoundary.tsx', 'components/routes/LearnRoute.tsx']) {
      const text = readFile(file);
      assert.doesNotMatch(text, TOKEN_RULE, file);
      assert.doesNotMatch(text, PALETTE_RULE, file);
      assert.doesNotMatch(text, /簡単です|誰でも/, file);
    }
  });
});

describe('S1: a failed diagram load is dropped, so the next diagram imports again (mermaidRenderer, final review, finding 1)', () => {
  // Without this, a diagram mounted after a mermaid failure got the kept rejection, never imported
  // again and never reached the page's offline controller: back on the lesson that degraded, the
  // reader notice (which counts failures since it mounted) would stay empty.
  /** @type {any} */
  let renderer = null;
  before(async () => {
    const result = await build({
      entryPoints: [path.join(ROOT, 'components/lesson/blocks/mermaidRenderer.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      external: ['mermaid', 'dompurify'],
      logLevel: 'silent',
    });
    renderer = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  });

  it('retryableLoad shares one load; a rejection is dropped and the next call loads again; a success is kept', async () => {
    let calls = 0;
    /** @type {Array<{ resolve: (v: unknown) => void, reject: (e: unknown) => void }>} */
    const pending = [];
    const load = renderer.retryableLoad(() => { calls += 1; return new Promise((resolve, reject) => pending.push({ resolve, reject })); });
    const a = load();
    assert.equal(load(), a, 'one load shared while it runs');
    assert.equal(calls, 1);
    pending[0].reject(new TypeError('Failed to fetch dynamically imported module'));
    await assert.rejects(a, /dynamically imported module/);
    const b = load();
    assert.notEqual(b, a, 'a failed load is not kept');
    assert.equal(calls, 2, 'imports again (and fails again until a reload, reaching the controller)');
    pending[1].resolve('mermaid');
    assert.equal(await b, 'mermaid');
    assert.equal(load(), b, 'a loaded module is kept');
    assert.equal(calls, 2);
  });

  it('mermaid and DOMPurify both load through it (no kept rejection: no `??= import(`)', () => {
    const source = readFile('components/lesson/blocks/mermaidRenderer.ts');
    assert.match(source, /^const loadMermaid = retryableLoad\(\(\) => import\('mermaid'\)\.then\(\(m\) => m\.default\)\);$/m);
    assert.match(source, /^const loadPurify = retryableLoad\(\(\) => import\('dompurify'\)\.then\(\(m\) => m\.default\)\);$/m);
    assert.doesNotMatch(source, /\?\?= import\(/);
  });
});
