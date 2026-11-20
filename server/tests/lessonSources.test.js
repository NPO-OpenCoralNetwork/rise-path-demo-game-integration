// @ts-check
// The reader shows a lesson's sources (「出典と検索」 step 5).
// - Model (components/lesson/model.ts, pure): sources are numbered in the order the lesson first
//   cites them (reading order), then the lesson's uncited sources; a block cites the lesson's or
//   the course's sources (validate.js accepts both; the lesson's wins on a shared id); only http(s)
//   URLs become links; checkedAt dates are read as ISO dates.
// - CiteMarks (under each block, from the block frame in registry.tsx) and LessonSources (the
//   folded list at the end of the lesson), rendered with esbuild against a React stub whose jsx()
//   returns { type, props, key } (as phase8Front.test.js does).
// - useSourceJump (the list's state, the jump, the way back, the resume-position hold), run on a
//   small hook runtime (state, refs and callbacks by call order; effects after each render when
//   their deps changed) against a fake page; the scroll helpers with a fake container.
// - Wiring (read as source): BlockView, ReaderContext and LessonReader; nothing here depends on the
//   AI tutor (training plan §4.6 reuses the blocks without it).
// - reader.css: design tokens only, 24 px targets for the numbers (WCAG 2.5.8).
// - AI apps: the tutoring protocol asks them to name the sources a block cites, and no others.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  allBlocks,
  citedSources,
  isoDateParts,
  lessonSources,
  sourceAnchorId,
  sourceHost,
  sourceHref,
} from '../../components/lesson/model.ts';
import {
  BAR_EXTRA_PROPERTY,
  READER_SCROLL_OFFSET,
  offsetInContainer,
  restoreOffsetInContainer,
} from '../../components/lesson/useScrollContainer.ts';
import { TUTOR_PROTOCOL } from '../../shared/lesson/learnerView.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** @param {string} rel */
const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** @param {string} rel */
const readJson = (rel) => JSON.parse(readFile(rel));

/** @param {string} id @param {string[]} [cite] @returns {any} */
const md = (id, cite) => ({ id, type: 'markdown', md: id, ...(cite ? { cite } : {}) });

/** @type {any} */
const LESSON = {
  schema: 'risepath.lesson/v1',
  id: 'l1',
  title: 'L1',
  locale: 'jp',
  estMinutes: 5,
  objectives: [],
  provenance: { author: 'human' },
  sources: [
    { id: 'a', title: 'Source A', url: 'https://docs.example.com/a', publisher: 'Example', checkedAt: '2026-10-20' },
    { id: 'b', title: 'Source B' },
    { id: 'c', title: 'Never cited' },
    { id: 'a', title: 'A again (a second entry with the same id)' },
  ],
  sections: [
    { id: 's1', title: 'S1', blocks: [md('m1'), md('m2', ['b'])] },
    { id: 's2', title: 'S2', blocks: [md('m3', ['course-1', 'a', 'b', 'missing', 'a'])] },
  ],
};

/** @type {any} */
const COURSE = {
  sources: [
    { id: 'course-1', title: 'Course source' },
    { id: 'b', title: 'Course B (the lesson has its own b)' },
    { id: 'course-2', title: 'A course source this lesson does not cite' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------

describe('lessonSources: numbers in the order the lesson first cites them', () => {
  it('numbers cited sources in reading order, then the uncited lesson sources; skips unknown ids', () => {
    const list = lessonSources(LESSON, COURSE);
    assert.deepEqual(list.items.map((s) => [s.n, s.id, s.title]), [
      [1, 'b', 'Source B'],
      [2, 'course-1', 'Course source'],
      [3, 'a', 'Source A'],
      [4, 'c', 'Never cited'],
    ]);
    assert.deepEqual([...list.numbers], [['b', 1], ['course-1', 2], ['a', 3], ['c', 4]]);
  });

  it('lists a course source only when the lesson cites it, and keeps the lesson’s entry on a shared id', () => {
    const list = lessonSources(LESSON, COURSE);
    assert.equal(list.numbers.has('course-2'), false);
    assert.equal(list.items.find((s) => s.id === 'b')?.title, 'Source B');
  });

  it('keeps the first of two lesson sources with the same id', () => {
    const a = lessonSources(LESSON, COURSE).items.find((s) => s.id === 'a');
    assert.equal(a?.title, 'Source A');
    assert.equal(a?.url, 'https://docs.example.com/a');
    assert.equal(a?.publisher, 'Example');
    assert.equal(a?.checkedAt, '2026-10-20');
  });

  it('works without a course, without sources and without cites', () => {
    assert.deepEqual(lessonSources({ ...LESSON, sources: undefined }, null).items.map((s) => s.id), []);
    const noCourse = lessonSources(LESSON);
    assert.deepEqual(noCourse.items.map((s) => s.id), ['b', 'a', 'c'], 'course-1 is unknown without the course');
  });

  it('gives a block its sources once each, by number, without unknown ids', () => {
    const list = lessonSources(LESSON, COURSE);
    const m3 = LESSON.sections[1].blocks[0];
    assert.deepEqual(citedSources(m3, list).map((s) => s.n), [1, 2, 3]);
    assert.deepEqual(citedSources(LESSON.sections[0].blocks[0], list), [], 'no cite');
    assert.deepEqual(citedSources(md('x', []), list), [], 'an empty cite');
    assert.deepEqual(citedSources(md('x', ['missing']), list), [], 'only unknown ids');
  });

  it('skips data that is not the schema’s shape instead of throwing (the dev preview shows invalid drafts)', () => {
    /** @type {any} */
    const broken = {
      ...LESSON,
      sources: [
        null,
        { id: 7, title: 'number id' },
        { id: 'no-title' },
        { id: 'ok', title: 'Fine', url: 42, publisher: ['x'], checkedAt: { at: 1 } },
      ],
      sections: [{ id: 's', title: 'S', blocks: [md('m1', /** @type {any} */ ('ok')), md('m2', /** @type {any} */ (5)), md('m3', /** @type {any} */ ([3, null, 'ok']))] }],
    };
    const list = lessonSources(broken, /** @type {any} */ ({ sources: 'not a list' }));
    assert.deepEqual(list.items, [{ n: 1, id: 'ok', title: 'Fine' }]);
    assert.deepEqual(citedSources(broken.sections[0].blocks[0], list), [], 'a string cite is not a list of ids');
    assert.deepEqual(citedSources(broken.sections[0].blocks[1], list), []);
    assert.deepEqual(citedSources(broken.sections[0].blocks[2], list).map((s) => s.id), ['ok']);
    assert.deepEqual(lessonSources(/** @type {any} */ ({ ...LESSON, sources: { a: 1 } })).items, []);
  });

  it('numbers every source of the published lessons, the vibe-ch1 draft and the block gallery', () => {
    const files = [];
    for (const course of fs.readdirSync(path.join(ROOT, 'content/courses'))) {
      for (const dir of ['lessons', 'drafts']) {
        const folder = path.join('content/courses', course, dir);
        if (!fs.existsSync(path.join(ROOT, folder))) continue;
        for (const file of fs.readdirSync(path.join(ROOT, folder))) {
          if (file.endsWith('.lesson.json')) files.push({ file: path.join(folder, file), course });
        }
      }
    }
    files.push({ file: 'content/examples/blocks-gallery.lesson.json', course: null });
    let cited = 0;
    for (const { file, course } of files) {
      const lesson = readJson(file);
      const courseJson = course ? readJson(path.join('content/courses', course, 'course.json')) : null;
      const list = lessonSources(lesson, courseJson);
      // The lesson's sources, plus the course sources it cites (validate.js lets a block cite them).
      const ids = new Set((lesson.sources ?? []).map((/** @type {{ id: string }} */ s) => s.id));
      const courseIds = new Set((courseJson?.sources ?? []).map((/** @type {{ id: string }} */ s) => s.id));
      for (const block of allBlocks(lesson)) {
        for (const id of block.cite ?? []) if (courseIds.has(id)) ids.add(id);
      }
      assert.equal(list.items.length, ids.size, file);
      assert.deepEqual(list.items.map((s) => s.n), list.items.map((_, i) => i + 1), `${file}: 1..n in list order`);
      let first = true;
      for (const block of allBlocks(lesson)) {
        if (!block.cite?.length) continue;
        cited += 1;
        const marks = citedSources(block, list);
        assert.equal(marks.length, new Set(block.cite).size, `${file} ${block.id}: every cite resolves`);
        if (first) assert.equal(marks.some((s) => s.n === 1), true, `${file}: the first citing block holds source 1`);
        first = false;
      }
    }
    assert.ok(cited >= 324, `${cited} citing blocks`);
  });
});

describe('source links, hosts, dates and anchors', () => {
  it('links only http(s) URLs', () => {
    assert.equal(sourceHref('https://code.claude.com/docs/en/overview'), 'https://code.claude.com/docs/en/overview');
    assert.equal(sourceHref('HTTP://example.com/x'), 'HTTP://example.com/x');
    for (const url of [undefined, '', 'javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,x', '/docs/a', 'ftp://example.com', 'mailto:a@example.com', 'https//example.com']) {
      assert.equal(sourceHref(url), null, String(url));
    }
  });

  it('shows the host of a link', () => {
    assert.equal(sourceHost('https://code.claude.com/docs/en/overview'), 'code.claude.com');
    assert.equal(sourceHost('https://www.agilebusiness.org/resource/x'), 'www.agilebusiness.org');
    assert.equal(sourceHost('not a url'), null);
  });

  it('reads ISO dates and leaves anything else alone', () => {
    assert.deepEqual(isoDateParts('2026-10-20'), { year: 2026, month: 10, day: 20 });
    assert.deepEqual(isoDateParts('2026-10-20T09:30:00Z'), { year: 2026, month: 10, day: 20 });
    assert.deepEqual(isoDateParts('2024-02-29'), { year: 2024, month: 2, day: 29 }, 'a leap day');
    for (const value of [undefined, '', '2026-13-01', '2026-00-10', '2026-10-32', '2026-02-31', '2026-02-29', '2026-04-31', '2026-10-00', '2026/10/20', 'yesterday', '2026-1-2']) {
      assert.equal(isoDateParts(value), null, String(value));
    }
  });

  it('anchors a source at rp-src-<id> (apart from #s- and #b- links)', () => {
    assert.equal(sourceAnchorId('cc-quickstart'), 'rp-src-cc-quickstart');
  });
});

// ---------------------------------------------------------------------------------------------
// CiteMarks and LessonSources, rendered
// ---------------------------------------------------------------------------------------------

/** @type {Record<string, string>} */
const STUBS = {
  react: `
    export const useId = () => 'uid';
    export const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
    export const useMemo = (fn) => fn();
    export const useCallback = (fn) => fn;
    export const Fragment = 'Fragment';
    export default { useId, useState, useMemo, useCallback, Fragment };
  `,
  'react/jsx-runtime': "export const jsx = (type, props, key) => ({ type, props, key }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'react-dom': 'export const flushSync = (fn) => fn();',
  'lucide-react': ['CornerUpLeft', 'ExternalLink'].map((name) => `export const ${name} = '${name}';`).join('\n'),
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp' });",
  reader: 'export const useOptionalReader = () => globalThis.__reader ?? null; export const useReader = () => globalThis.__reader;',
};

/**
 * A small hook runtime for useSourceJump: state, refs, callbacks and memos by call order; an effect
 * is queued when its deps changed and runs after the render (the previous cleanup first). The
 * test's render() repeats while a state changed, like React would.
 * @type {Record<string, string>}
 */
const HOOK_STUBS = {
  ...STUBS,
  react: `
    const h = () => globalThis.__hooks;
    const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    export const useState = (initial) => {
      const s = h(); const i = s.i++;
      if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [s.slots[i], (value) => {
        const next = typeof value === 'function' ? value(s.slots[i]) : value;
        if (!Object.is(next, s.slots[i])) { s.slots[i] = next; s.dirty = true; }
      }];
    };
    export const useRef = (value) => { const s = h(); const i = s.i++; if (!(i in s.slots)) s.slots[i] = { current: value }; return s.slots[i]; };
    export const useCallback = (fn, deps) => {
      const s = h(); const i = s.i++; const prev = s.slots[i];
      if (prev && same(prev.deps, deps)) return prev.fn;
      s.slots[i] = { fn, deps };
      return fn;
    };
    export const useMemo = (fn, deps) => {
      const s = h(); const i = s.i++; const prev = s.slots[i];
      if (prev && same(prev.deps, deps)) return prev.value;
      const value = fn(); s.slots[i] = { value, deps };
      return value;
    };
    export const useEffect = (fn, deps) => {
      const s = h(); const i = s.i++; const prev = s.slots[i];
      if (prev && same(prev.deps, deps)) return;
      s.queue.push(() => {
        prev?.cleanup?.();
        const cleanup = fn();
        s.slots[i] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
      });
    };
    export const useId = () => 'uid';
    export const Fragment = 'Fragment';
    export default { useState, useRef, useCallback, useMemo, useEffect, useId, Fragment };
  `,
  // flushSync counts the calls that changed a state (React draws those before it returns).
  'react-dom': `
    export const flushSync = (fn) => {
      const s = globalThis.__hooks;
      const dirty = s.dirty;
      s.dirty = false;
      try {
        return fn();
      } finally {
        if (s.dirty) s.flushed += 1;
        s.dirty = dirty || s.dirty;
      }
    };
  `,
};

/** @param {string} entry @param {Record<string, string>} [stubs] */
async function bundleUi(entry, stubs = STUBS) {
  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    plugins: [{
      name: 'ui-stubs',
      setup(b) {
        /** @param {RegExp} filter @param {string} name */
        const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
        stub(/^react$/, 'react');
        stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
        stub(/^react-dom$/, 'react-dom');
        stub(/^lucide-react$/, 'lucide-react');
        stub(/context\/LanguageContext$/, 'language');
        stub(/\/ReaderContext$/, 'reader');
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js', resolveDir: ROOT }));
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
/** Text content of a rendered tree. @param {any} node @returns {string} */
function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') return textOf(node.props?.children);
  return String(node);
}
/** @param {any} el */
const classesOf = (el) => (typeof el.props?.className === 'string' ? el.props.className.split(/\s+/).filter(Boolean) : []);

/** @type {any} */
let ui = null;
/** @type {any} */
let hooks = null;
before(async () => {
  const code = await bundleUi("export { CiteMarks, LessonSources } from './components/lesson/LessonSources';");
  ui = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const hookCode = await bundleUi("export { useSourceJump } from './components/lesson/useSourceJump';", HOOK_STUBS);
  hooks = await import(`data:text/javascript;base64,${Buffer.from(hookCode).toString('base64')}`);
});

/**
 * @param {any} block
 * @param {{ language?: 'jp' | 'en', reader?: any }} [options]
 */
function renderMarks(block, { language = 'jp', reader } = {}) {
  /** @type {any[]} */
  const calls = [];
  const value = reader === undefined
    ? { sources: lessonSources(LESSON, COURSE), showSource: (/** @type {any[]} */ ...args) => calls.push(args) }
    : reader;
  Object.assign(globalThis, { __language: language, __reader: value });
  try {
    return { tree: expand(ui.CiteMarks({ block })), calls };
  } finally {
    // @ts-ignore test globals
    delete globalThis.__language;
    // @ts-ignore test globals
    delete globalThis.__reader;
  }
}

describe('CiteMarks: the numbers under a block', () => {
  it('links each cited source once, by number, to its place in the list', () => {
    const { tree } = renderMarks(LESSON.sections[1].blocks[0]);
    const links = elements(tree).filter((el) => el.type === 'a');
    assert.deepEqual(links.map((a) => textOf(a)), ['1', '2', '3']);
    assert.deepEqual(links.map((a) => a.props.href), ['#rp-src-b', '#rp-src-course-1', '#rp-src-a']);
    assert.deepEqual(links.map((a) => a.props['data-cite']), ['b', 'course-1', 'a']);
    assert.ok(links.every((a) => classesOf(a).includes('rp-cite-num')));
  });

  it('names each number with its source for screen readers; the visible label is not read twice', () => {
    const { tree } = renderMarks(LESSON.sections[1].blocks[0]);
    const els = elements(tree);
    assert.deepEqual(els.filter((el) => el.type === 'a').map((a) => a.props['aria-label']), [
      '出典 1：Source B', '出典 2：Course source', '出典 3：Source A',
    ]);
    const label = els.find((el) => classesOf(el).includes('rp-cite-label'));
    assert.equal(textOf(label), '出典');
    assert.equal(label.props['aria-hidden'], 'true');
  });

  it('says Source / Sources in English', () => {
    const one = renderMarks(LESSON.sections[0].blocks[1], { language: 'en' });
    const els = elements(one.tree);
    assert.equal(textOf(els.find((el) => classesOf(el).includes('rp-cite-label'))), 'Source');
    assert.equal(els.find((el) => el.type === 'a').props['aria-label'], 'Source 1: Source B');
    const many = renderMarks(LESSON.sections[1].blocks[0], { language: 'en' });
    assert.equal(textOf(elements(many.tree).find((el) => classesOf(el).includes('rp-cite-label'))), 'Sources');
  });

  it('renders nothing without a cite, with only unknown ids, or outside a reader', () => {
    assert.equal(renderMarks(LESSON.sections[0].blocks[0]).tree, null);
    assert.equal(renderMarks(md('x', ['missing'])).tree, null);
    assert.equal(renderMarks(LESSON.sections[1].blocks[0], { reader: null }).tree, null);
  });

  it('a plain click (or Enter) opens the source in the reader; a modified click is left to the browser', () => {
    const block = LESSON.sections[1].blocks[0];
    const { tree, calls } = renderMarks(block);
    const link = elements(tree).find((el) => el.type === 'a');
    let prevented = 0;
    const target = { id: 'the-link' };
    const event = (/** @type {Record<string, unknown>} */ extra) => ({
      button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
      currentTarget: target, preventDefault: () => { prevented += 1; }, ...extra,
    });
    link.props.onClick(event({}));
    assert.equal(prevented, 1);
    assert.deepEqual(calls, [['b', 'm3', target]]);
    for (const extra of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      link.props.onClick(event(extra));
    }
    assert.equal(prevented, 1, 'new-tab and new-window clicks keep their default');
    assert.equal(calls.length, 1);
  });
});

/**
 * @param {{ language?: 'jp' | 'en', open?: boolean, target?: any, sources?: any }} [options]
 */
function renderList({ language = 'jp', open = false, target = null, sources } = {}) {
  /** @type {any[]} */
  const toggles = [];
  /** @type {any[]} */
  const backs = [];
  Object.assign(globalThis, { __language: language });
  try {
    const tree = expand(ui.LessonSources({
      sources: sources ?? lessonSources(LIST_LESSON),
      open,
      onToggle: (/** @type {boolean} */ value) => toggles.push(value),
      target,
      onBack: (/** @type {any} */ value) => backs.push(value),
    }));
    return { tree, toggles, backs };
  } finally {
    // @ts-ignore test globals
    delete globalThis.__language;
  }
}

/** @type {any} */
const LIST_LESSON = {
  ...LESSON,
  sources: [
    { id: 'docs', title: 'Quickstart', url: 'https://code.claude.com/docs/en/quickstart', publisher: 'Anthropic', checkedAt: '2026-10-20' },
    { id: 'script', title: 'A script link', url: 'javascript:alert(1)', publisher: 'Nobody' },
    { id: 'relative', title: 'A relative link', url: '/docs/a', checkedAt: 'last week' },
    { id: 'bare', title: 'Just a title' },
  ],
  sections: [{ id: 's1', title: 'S1', blocks: [md('m1', ['docs', 'script', 'relative', 'bare'])] }],
};

describe('LessonSources: the folded list at the end of the lesson', () => {
  it('renders nothing for a lesson without sources', () => {
    assert.equal(renderList({ sources: lessonSources({ ...LESSON, sources: [], sections: [{ id: 's', title: 'S', blocks: [md('m')] }] }) }).tree, null);
  });

  it('is a region named by its summary, folded unless open, and reports the learner’s toggles', () => {
    const { tree, toggles } = renderList();
    const els = elements(tree);
    const section = els.find((el) => el.type === 'section');
    const details = els.find((el) => el.type === 'details');
    const summary = els.find((el) => el.type === 'summary');
    assert.equal(section.props['aria-labelledby'], summary.props.id);
    assert.ok(summary.props.id, 'the summary has an id');
    assert.equal(details.props.open, false);
    assert.equal(textOf(summary), '出典（4件）');
    details.props.onToggle({ currentTarget: { open: true } });
    assert.deepEqual(toggles, [true]);
    assert.equal(elements(renderList({ open: true }).tree).find((el) => el.type === 'details').props.open, true);
    assert.equal(textOf(elements(renderList({ language: 'en' }).tree).find((el) => el.type === 'summary')), 'Sources (4)');
  });

  it('numbers the items and anchors each one where the numbers under the blocks lead (focusable by script)', () => {
    const els = elements(renderList().tree);
    const items = els.filter((el) => el.type === 'li');
    assert.deepEqual(items.map((li) => li.props.id), ['rp-src-docs', 'rp-src-script', 'rp-src-relative', 'rp-src-bare']);
    assert.ok(items.every((li) => li.props.tabIndex === -1));
    assert.deepEqual(items.map((li) => textOf(elements(li).find((el) => classesOf(el).includes('rp-sources-n')))), ['1', '2', '3', '4']);
  });

  it('opens an http(s) source in a new tab, says so, and links nothing else', () => {
    const items = elements(renderList().tree).filter((el) => el.type === 'li');
    const [docs, script, relative, bare] = items.map((li) => elements(li).filter((el) => el.type === 'a'));
    assert.equal(docs.length, 1);
    assert.equal(docs[0].props.href, 'https://code.claude.com/docs/en/quickstart');
    assert.equal(docs[0].props.target, '_blank');
    assert.equal(docs[0].props.rel, 'noopener noreferrer');
    assert.equal(textOf(docs[0]), 'Quickstart （新しいタブで開きます）', 'a space before the hint, so English reads "Quickstart (opens…"');
    assert.ok(elements(docs[0]).some((el) => el.type === 'ExternalLink' && el.props['aria-hidden'] === 'true'));
    for (const links of [script, relative, bare]) assert.equal(links.length, 0);
    assert.match(textOf(items[1]), /A script link/);
  });

  it('shows the publisher, the host of the link and the day it was checked', () => {
    const items = elements(renderList().tree).filter((el) => el.type === 'li');
    const meta = (/** @type {any} */ li) => textOf(elements(li).find((el) => classesOf(el).includes('rp-sources-meta')));
    assert.equal(meta(items[0]), 'Anthropic · code.claude.com · 2026年10月20日に確認');
    const parts = (/** @type {any} */ li) => elements(li).filter((el) => classesOf(el).includes('rp-sources-meta-part')).map(textOf);
    assert.deepEqual(parts(items[0]), ['Anthropic ·', 'code.claude.com ·', '2026年10月20日に確認'], 'each part wraps as a whole; the dot ends the line before');
    assert.equal(meta(items[1]), 'Nobody', 'no host for a URL that is not linked');
    assert.equal(meta(items[2]), '確認：last week', 'a date that is not ISO is shown as written');
    assert.equal(elements(items[3]).some((el) => classesOf(el).includes('rp-sources-meta')), false);
    const en = elements(renderList({ language: 'en' }).tree).filter((el) => el.type === 'li');
    assert.equal(meta(en[0]), 'Anthropic · code.claude.com · Checked 20 Oct 2026');
    assert.equal(meta(en[2]), 'Checked: last week');
  });

  it('marks the source the learner came to and offers the way back to where they were reading', () => {
    const target = { sourceId: 'relative', blockId: 'm1' };
    const { tree, backs } = renderList({ open: true, target });
    const items = elements(tree).filter((el) => el.type === 'li');
    assert.deepEqual(items.map((li) => li.props['data-target']), [undefined, undefined, true, undefined]);
    const buttons = elements(tree).filter((el) => el.type === 'button');
    assert.equal(buttons.length, 1);
    assert.ok(elements(items[2]).includes(buttons[0]), 'the button sits in the marked item');
    assert.equal(buttons[0].props.type, 'button');
    assert.equal(textOf(buttons[0]), '読んでいた場所に戻る');
    buttons[0].props.onClick();
    assert.deepEqual(backs, [target]);
    assert.equal(elements(renderList({ open: true }).tree).filter((el) => el.type === 'button').length, 0, 'no way back without a jump');
  });
});

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

describe('wiring: the block frame, the reader context and the reader', () => {
  it('every block frame renders its source numbers after the block (all 15 block types)', () => {
    const src = readFile('components/lesson/blocks/registry.tsx');
    assert.match(src, /import \{ CiteMarks \} from '\.\.\/LessonSources';/);
    const frame = src.slice(src.indexOf('export const BlockView'));
    assert.match(frame, /<UnknownBlock block=\{block\} \/>\}\s*<CiteMarks block=\{block\} \/>\s*<\/div>/);
  });

  it('the reader context carries the numbers and the jump', () => {
    const src = readFile('components/lesson/ReaderContext.tsx');
    assert.match(src, /sources: LessonSourceList;/);
    assert.match(src, /showSource: \(sourceId: string, blockId: string, from\?: HTMLElement \| null\) => void;/);
  });

  it('the reader numbers the sources, keeps the list in useSourceJump, holds the resume position after a jump, and places the list after the sections, before the wrap-up', () => {
    const src = readFile('components/lesson/LessonReader.tsx');
    assert.match(src, /const sourceList = useMemo\(\(\) => lessonSources\(lesson, course\), \[lesson, course\]\);/);
    assert.match(src, /const sourceJump = useSourceJump\(\{\s*container,\s*scrollToElement,\s*onScroll: \(\) => \{\s*jumpedAt\.current = Date\.now\(\);\s*\},\s*\}\);/);
    assert.match(src, /trackPosition: trackPosition && !sourceJump\.holding,/);
    assert.match(src, /sources: sourceList,\s*showSource: sourceJump\.show,/);
    assert.match(src, /open=\{sourceJump\.open\}\s*onToggle=\{sourceJump\.toggle\}\s*target=\{sourceJump\.target\}\s*onBack=\{sourceJump\.back\}/);
    const reset = src.slice(src.indexOf('const onLessonReset'), src.indexOf('// --- Tutor'));
    assert.match(reset, /resetSources\(\);/, 'starting the lesson over folds the list');
    const article = src.slice(src.indexOf('<article'), src.indexOf('</article>'));
    const list = article.indexOf('<LessonSources');
    assert.ok(list > article.indexOf('</React.Fragment>'), 'after the sections (outside the remounting fragment)');
    assert.ok(list < article.indexOf('<LessonEnd'), 'before the wrap-up');
  });

  it('a jump to a block (the glossary’s 本文で見る, the tutor’s chip) does not put the focus on its source numbers', () => {
    const src = readFile('components/lesson/LessonReader.tsx');
    const start = src.indexOf('const scrollToBlock = useCallback');
    assert.ok(start > 0);
    const body = src.slice(start, src.indexOf('}, [scrollToElement]);', start));
    const selector = /querySelector<HTMLElement>\('([^']+)'\)/.exec(body)?.[1] ?? '';
    const parts = selector.split(',').map((part) => part.trim());
    assert.ok(parts.includes('a[href]:not(.rp-cite-num)'), selector);
    assert.ok(!parts.includes('a[href]'), selector);
  });

  it('nothing in the sources UI depends on the AI tutor', () => {
    for (const file of ['components/lesson/LessonSources.tsx', 'components/lesson/useSourceJump.ts']) {
      const src = readFile(file);
      const imports = [...src.matchAll(/^import [^;]*;$/gm)].map((m) => m[0]);
      assert.ok(imports.length > 0, file);
      for (const line of imports) assert.doesNotMatch(line, /tutor/i, `${file}: ${line}`);
      assert.doesNotMatch(src, /askTutor|openTutor/, file);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// useSourceJump, on the small hook runtime
// ---------------------------------------------------------------------------------------------

/**
 * A fake page: a 900 px scroll container at the top of the viewport, the list (whose top the test
 * moves), list items rp-src-a and rp-src-b, block b-m3 with the numbers b and a (both 2000 px
 * down), and #main-content. `log` records focus and scrollTo calls.
 * @param {{ blockMarks?: boolean, block?: boolean, listTop?: number }} [options]
 */
function fakePage({ blockMarks = true, block = true, listTop = 3000 } = {}) {
  /** @type {any[]} */
  const log = [];
  /** @type {Record<string, (() => void) | undefined>} */
  const listeners = {};
  /** @type {Record<string, (() => void) | undefined>} */
  const windowListeners = {};
  /** Animation frames run later, as in a browser (the hook's throttle relies on it). @type {Array<() => void>} */
  const frames = [];
  const state = { listTop };
  /** The learner scrolled: the scroll event, then the next frame. */
  const scroll = () => {
    listeners.scroll?.();
    for (const run of frames.splice(0)) run();
  };
  const container = {
    clientHeight: 900,
    scrollTop: 0,
    style: { getPropertyValue: () => '' },
    getBoundingClientRect: () => ({ top: 0, bottom: 900 }),
    addEventListener: (/** @type {string} */ type, /** @type {() => void} */ fn) => { listeners[type] = fn; },
    removeEventListener: (/** @type {string} */ type) => { delete listeners[type]; },
    scrollTo: (/** @type {any} */ options) => log.push(['scrollTo', options]),
  };
  const list = { getBoundingClientRect: () => ({ top: state.listTop, bottom: state.listTop + 800 }) };
  const item = (/** @type {string} */ id) => ({
    id,
    focus: () => log.push(['focus', id]),
    closest: (/** @type {string} */ selector) => (selector === '.rp-sources' ? list : null),
  });
  const mark = (/** @type {string} */ cite) => ({
    dataset: { cite },
    focus: () => log.push(['focus', `mark:${cite}`]),
    getBoundingClientRect: () => ({ top: 2000, height: 24 }),
  });
  /** @type {Record<string, any>} */
  const nodes = {
    'rp-src-a': item('rp-src-a'),
    'rp-src-b': item('rp-src-b'),
    'main-content': { focus: () => log.push(['focus', 'main-content']) },
  };
  if (block) nodes['b-m3'] = { id: 'b-m3', querySelectorAll: () => (blockMarks ? [mark('b'), mark('a')] : []) };
  const doc = { documentElement: {}, getElementById: (/** @type {string} */ id) => nodes[id] ?? null };
  const win = {
    innerHeight: 900,
    requestAnimationFrame: (/** @type {() => void} */ fn) => frames.push(fn),
    cancelAnimationFrame: (/** @type {number} */ id) => { frames[id - 1] = () => {}; },
    matchMedia: () => ({ matches: false }),
    addEventListener: (/** @type {string} */ type, /** @type {() => void} */ fn) => { windowListeners[type] = fn; },
    removeEventListener: (/** @type {string} */ type) => { delete windowListeners[type]; },
  };
  return { container, log, listeners, windowListeners, state, doc, win, scroll };
}

/**
 * Runs `test` with the fake page as `document` and `window`, and a mounted useSourceJump.
 * @param {ReturnType<typeof fakePage>} page
 * @param {(run: { render: () => any, scrolled: string[], marks: { count: number }, runtime: { flushed: number } }) => void} test
 */
function withHook(page, test) {
  const g = /** @type {any} */ (globalThis);
  const before = { document: g.document, window: g.window, hooks: g.__hooks };
  g.document = page.doc;
  g.window = page.win;
  /** @type {string[]} */
  const scrolled = [];
  const marks = { count: 0 };
  const props = {
    container: page.container,
    scrollToElement: (/** @type {any} */ el) => scrolled.push(el.id),
    onScroll: () => { marks.count += 1; },
  };
  const runtime = { i: 0, slots: {}, queue: /** @type {Array<() => void>} */ ([]), dirty: false, flushed: 0 };
  const render = () => {
    for (let pass = 0; pass < 20; pass += 1) {
      runtime.i = 0;
      runtime.dirty = false;
      runtime.queue = [];
      g.__hooks = runtime;
      const api = hooks.useSourceJump(props);
      const queue = runtime.queue;
      runtime.queue = [];
      for (const run of queue) run();
      if (!runtime.dirty) return api;
    }
    throw new Error('the hook kept changing its state');
  };
  try {
    test({ render, scrolled, marks, runtime });
  } finally {
    for (const [key, value] of Object.entries(before)) {
      const name = key === 'hooks' ? '__hooks' : key;
      if (value === undefined) delete g[name];
      else g[name] = value;
    }
  }
}

/** A number 474 px below the container's top, as CiteMarks passes it. */
const CLICKED = { getBoundingClientRect: () => ({ top: 474, height: 24 }) };

describe('useSourceJump: the list, the jump, the way back and the held resume position', () => {
  it('a number unfolds the list, moves to its source below the bar and focuses it; the same number again moves again', () => {
    const page = fakePage();
    withHook(page, ({ render, scrolled, marks }) => {
      let api = render();
      assert.equal(api.open, false);
      assert.equal(api.target, null);
      api.show('a', 'm3', CLICKED);
      api = render();
      assert.equal(api.open, true);
      assert.deepEqual(api.target, { sourceId: 'a', blockId: 'm3' });
      assert.deepEqual(scrolled, ['rp-src-a'], 'scrollToElement (the barExtra-aware helper)');
      assert.deepEqual(page.log.filter(([kind]) => kind === 'focus'), [['focus', 'rp-src-a']]);
      assert.equal(marks.count, 1, 'the reader marks the move as its own');
      api.show('a', 'm3', CLICKED);
      api = render();
      assert.deepEqual(scrolled, ['rp-src-a', 'rp-src-a'], 'the same number moves again');
      api.show('b', 'm3', CLICKED);
      api = render();
      assert.deepEqual(scrolled, ['rp-src-a', 'rp-src-a', 'rp-src-b']);
      assert.deepEqual(api.target, { sourceId: 'b', blockId: 'm3' });
    });
  });

  it('holds the resume position from when the list comes on screen after a jump until the learner scrolls back up into the lesson', () => {
    const page = fakePage();
    withHook(page, ({ render }) => {
      let api = render();
      api.show('a', 'm3', CLICKED);
      api = render();
      assert.equal(api.holding, false, 'on the way: the list is still below the screen');
      page.state.listTop = 300;
      page.scroll();
      api = render();
      assert.equal(api.holding, true, 'the learner reads the list');
      page.state.listTop = -2000;
      page.scroll();
      api = render();
      assert.equal(api.holding, true, 'the wrap-up below the list is still past the lesson');
      page.state.listTop = 899;
      page.scroll();
      api = render();
      assert.equal(api.holding, true, 'the list’s top still on screen');
      page.state.listTop = 900; // at the bottom edge of the 900 px container
      page.scroll();
      api = render();
      assert.equal(api.holding, false, 'scrolled back up into the lesson: the position is saved again');
      assert.equal(page.listeners.scroll, undefined, 'for good: the hold stops watching the scroll');
      page.state.listTop = 300;
      page.scroll();
      api = render();
      assert.equal(api.holding, false, 'back at the end on their own: saved as usual');
    });
  });

  it('the way back ends the hold; folding the list and a way back whose block has gone keep it', () => {
    const page = fakePage({ listTop: 300 });
    withHook(page, ({ render }) => {
      let api = render();
      api.show('a', 'm3', CLICKED);
      api = render();
      assert.equal(api.holding, true);
      api.toggle(false);
      api = render();
      assert.equal(api.target, null, 'folding forgets the jump');
      assert.equal(api.holding, true, 'not the hold: the learner is still at the end of the lesson');
      api.toggle(true);
      api = render();
      assert.equal(api.holding, true);
      api.show('a', 'm3', CLICKED);
      api = render();
      assert.equal(api.holding, true, 'the same number again (the page need not move)');
      api.show('b', 'm3', CLICKED);
      api = render();
      assert.equal(api.holding, true, 'another number at the end of the lesson');
      api.back(api.target);
      api = render();
      assert.equal(api.holding, false, 'the way back ends it');
      assert.equal(page.listeners.scroll, undefined, 'and stops watching the scroll');
    });
    const noBlock = fakePage({ block: false, listTop: 300 });
    withHook(noBlock, ({ render }) => {
      let api = render();
      api.show('a', 'm3', CLICKED);
      api = render();
      api.back(api.target);
      api = render();
      assert.equal(api.holding, true, 'nothing to go back to: still at the list');
    });
  });

  it('holds at once when the list is already on screen; never without a jump', () => {
    const page = fakePage({ listTop: 300 });
    withHook(page, ({ render }) => {
      let api = render();
      assert.equal(api.holding, false, 'an open list without a jump is the end of the lesson: saved as usual');
      api.toggle(true);
      api = render();
      assert.equal(api.holding, false);
      api.show('b', 'm3', CLICKED);
      api = render();
      assert.equal(api.holding, true);
    });
  });

  it('the way back puts the clicked number where it sat on screen and focuses it', () => {
    const page = fakePage();
    withHook(page, ({ render, marks }) => {
      let api = render();
      api.show('a', 'm3', CLICKED);
      api = render();
      page.container.scrollTop = 17000;
      page.log.length = 0;
      api.back(api.target);
      api = render();
      assert.deepEqual(page.log, [
        ['scrollTo', { top: 17000 + 2000 - 474, behavior: 'smooth' }],
        ['focus', 'mark:a'],
      ]);
      assert.equal(marks.count, 2);
      assert.equal(api.target, null);
      assert.equal(api.open, true, 'the list stays open');
    });
  });

  it('without that number it goes to the block and focuses the main area; without the block the focus stays in the list', () => {
    const noMarks = fakePage({ blockMarks: false });
    withHook(noMarks, ({ render, scrolled }) => {
      let api = render();
      api.show('a', 'm3', CLICKED);
      api = render();
      noMarks.log.length = 0;
      api.back(api.target);
      render();
      assert.deepEqual(scrolled, ['rp-src-a', 'b-m3']);
      assert.deepEqual(noMarks.log, [['focus', 'main-content']]);
    });
    const noBlock = fakePage({ block: false });
    withHook(noBlock, ({ render, scrolled }) => {
      let api = render();
      api.show('a', 'm3', CLICKED);
      api = render();
      noBlock.log.length = 0;
      api.back(api.target);
      render();
      assert.deepEqual(scrolled, ['rp-src-a'], 'nothing to scroll to');
      assert.deepEqual(noBlock.log, [['focus', 'rp-src-a']], 'not <body>: the back button goes away');
    });
  });

  it('folding the list forgets the jump; starting over folds it and ends the hold; printing unfolds it before the print dialog takes the page', () => {
    const page = fakePage();
    withHook(page, ({ render, runtime }) => {
      let api = render();
      api.show('a', 'm3', CLICKED);
      api = render();
      api.toggle(false);
      api = render();
      assert.equal(api.open, false);
      assert.equal(api.target, null);
      api.show('a', 'm3', CLICKED);
      api = render();
      page.state.listTop = 300;
      page.scroll();
      api = render();
      assert.equal(api.holding, true);
      api.reset();
      api = render();
      assert.equal(api.open, false);
      assert.equal(api.target, null);
      assert.equal(api.holding, false, 'starting over goes to the top of the lesson');
      assert.equal(runtime.flushed, 0);
      page.windowListeners.beforeprint?.();
      assert.equal(runtime.flushed, 1, 'drawn at once (flushSync): a plain update comes after the print dialog took the page');
      api = render();
      assert.equal(api.open, true);
      assert.equal(api.target, null);
    });
  });
});

describe('the way back: the clicked number returns to where it sat on screen', () => {
  /**
   * A scroll container `top` px below the viewport's top, `height` px tall, scrolled `scrollTop`,
   * with the offline notice's extra bar height `extra` (set inline as OfflineReloadNotice does).
   * @param {{ top?: number, height?: number, scrollTop?: number, extra?: number }} [options]
   */
  function fakeContainer({ top = 0, height = 900, scrollTop = 0, extra = 0 } = {}) {
    /** @type {any[]} */
    const calls = [];
    return {
      calls,
      scrollTop,
      clientHeight: height,
      style: { getPropertyValue: (/** @type {string} */ name) => (name === BAR_EXTRA_PROPERTY && extra ? `${extra}px` : '') },
      getBoundingClientRect: () => ({ top, bottom: top + height }),
      scrollTo(/** @type {any} */ options) { calls.push(options); },
    };
  }
  /** A 24 px number whose top edge is `top` px below the viewport's top. @param {number} top */
  const at = (top) => ({ getBoundingClientRect: () => ({ top, height: 24 }) });
  /** @param {any} value */
  const el = (value) => /** @type {any} */ (value);

  it('measures from the container’s top edge, not the viewport’s', () => {
    assert.equal(offsetInContainer(el(fakeContainer({ top: 50 })), el(at(350))), 300);
  });

  it('scrolls so the number sits at the remembered offset again (after the page moved)', () => {
    const container = fakeContainer({ top: 50, scrollTop: 17000 });
    restoreOffsetInContainer(el(container), el(at(-15000)), 474);
    assert.deepEqual(container.calls, [{ top: 17000 - 15050 - 474, behavior: 'smooth' }]);
  });

  it('never leaves it under the sticky bar, also when the offline notice has made the bar taller', () => {
    const container = fakeContainer({ scrollTop: 500, extra: 40 });
    restoreOffsetInContainer(el(container), el(at(300)), 10);
    assert.deepEqual(container.calls, [{ top: 500 + 300 - (READER_SCROLL_OFFSET + 40), behavior: 'smooth' }]);
  });

  it('never below the bottom (the screen turned or shrank): its own height plus the offset above the bottom', () => {
    const container = fakeContainer({ height: 600, scrollTop: 1000 });
    restoreOffsetInContainer(el(container), el(at(2000)), 820);
    assert.deepEqual(container.calls, [{ top: 1000 + 2000 - (600 - READER_SCROLL_OFFSET - 24), behavior: 'smooth' }]);
    const short = fakeContainer({ height: 120, scrollTop: 1000 });
    restoreOffsetInContainer(el(short), el(at(2000)), 820);
    assert.deepEqual(short.calls, [{ top: 1000 + 2000 - READER_SCROLL_OFFSET, behavior: 'smooth' }], 'too short for both: the top wins');
  });

  it('never scrolls above the top, and moves without animation when asked or when motion is reduced', () => {
    const container = fakeContainer({ scrollTop: 0 });
    restoreOffsetInContainer(el(container), el(at(20)), 400, { smooth: false });
    assert.deepEqual(container.calls, [{ top: 0, behavior: 'auto' }]);
    const g = /** @type {any} */ (globalThis);
    const before = g.window;
    g.window = { matchMedia: () => ({ matches: true }) };
    try {
      const reduced = fakeContainer({ scrollTop: 100 });
      restoreOffsetInContainer(el(reduced), el(at(500)), 200);
      assert.deepEqual(reduced.calls, [{ top: 400, behavior: 'auto' }]);
    } finally {
      if (before === undefined) delete g.window;
      else g.window = before;
    }
  });
});

// ---------------------------------------------------------------------------------------------
// reader.css
// ---------------------------------------------------------------------------------------------

describe('reader.css: the sources rules', () => {
  const css = readFile('components/lesson/reader.css');
  const start = css.indexOf('* Sources (出典と検索 5)');
  const end = css.indexOf('* End of lesson');
  const rules = css.slice(start, end);

  it('has its own part of the file, before the end of the lesson', () => {
    assert.ok(start > 0 && end > start);
  });

  it('uses design tokens only (no colour literals)', () => {
    assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    assert.match(rules, /var\(--rp-fg-3\)/);
  });

  it('hides the way back on paper (the list unfolds before printing)', () => {
    assert.match(rules, /@media print \{\s*\.rp-sources-back \{\s*display: none;\s*\}\s*\}/);
  });

  it('gives the numbers a 24 px target (WCAG 2.5.8)', () => {
    const num = /\.rp-cite-num \{([^}]*)\}/.exec(rules)?.[1] ?? '';
    assert.match(num, /min-width: 24px;/);
    assert.match(num, /min-height: 24px;/);
  });
});

// ---------------------------------------------------------------------------------------------
// AI apps
// ---------------------------------------------------------------------------------------------

describe('AI apps: the tutoring protocol names the cited sources', () => {
  it('asks the agent to name the sources a block cites, and never one the lesson does not list', () => {
    const rule = TUTOR_PROTOCOL.split('\n').find((line) => /\bcite\b/.test(line));
    assert.ok(rule, TUTOR_PROTOCOL);
    assert.match(rule, /sources/);
    assert.match(rule, /title/);
    assert.match(rule, /url/);
    assert.match(rule, /Never name a source that sources does not list/, 'a cited id the view lacks (a course source) is not an invitation to make one up');
  });
});
