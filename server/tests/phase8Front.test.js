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
    // By call order (FlashcardsBlock: 0 order, 1 pos, 2 flipped, 3 finished, 4 live).
    export const useState = (initial) => {
      const i = index++;
      const o = globalThis.__state;
      const value = o && i in o ? o[i] : (typeof initial === 'function' ? initial() : initial);
      return [value, () => {}];
    };
    export const useRef = (value) => ({ current: value ?? null });
    export const useMemo = (fn) => fn();
    export const useCallback = (fn) => fn;
    export const useEffect = () => {};
    export const Fragment = 'Fragment';
    export default { useState, useRef, useMemo, useCallback, useEffect, Fragment };
  `,
  'react/jsx-runtime': "export const jsx = (type, props, key) => ({ type, props, key }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'lucide-react': ['Check', 'ChevronLeft', 'ChevronRight', 'RotateCcw', 'ThumbsUp'].map((name) => `export const ${name} = '${name}';`).join('\n'),
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp' });",
  reader: 'export const useReader = () => globalThis.__reader;',
  md: "export const MdText = 'MdText';",
  model: "export const plainText = (value) => String(value ?? '');",
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
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
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
