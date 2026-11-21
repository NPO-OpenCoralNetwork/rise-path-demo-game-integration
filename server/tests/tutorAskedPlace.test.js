// 「出典と検索」 step 6: the AI tutor's chip under an answer says where the learner asked
// (「質問した場所 §n」) instead of 「根拠」 (the server only echoes the question's anchor), and the
// first answer lists the sources that place cites. A jump to a block with nothing to focus gives
// the block itself the focus instead of <body>, also from the glossary sheet.
//
// - askedPlace / askedPlaces (model.ts): the place of each finished answer, and the one answer that
//   lists its sources;
// - focusForVisit (useScrollContainer.ts) on a fake element;
// - the wiring in TutorPanel and LessonReader, and the CSS.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askedPlace, askedPlaces } from '../../components/lesson/model.ts';
import { BLOCK_FOCUS_TARGETS, focusBlock, focusForVisit } from '../../components/lesson/useScrollContainer.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** @param {string} rel */
const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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
  sections: [
    { id: 's1', title: '1-2. はじめる', blocks: [md('m1'), md('m2', ['a'])] },
    { id: 's2', title: { jp: '道具をそろえる', en: 'Get the tools' }, blocks: [md('m3')] },
  ],
};

/** The reader's tx, in Japanese or English. @param {'jp' | 'en'} locale */
const txIn = (locale) => (/** @type {any} */ text) => ({ value: typeof text === 'string' ? text : (text?.[locale] ?? '') });
const tx = txIn('jp');

describe('askedPlace: where the question of an answer was asked', () => {
  it('gives the section number from its title, the title without it, and the block', () => {
    const place = askedPlace(LESSON, { sectionId: 's1', blockId: 'm2' }, tx);
    assert.deepEqual(place, { n: '1-2', title: 'はじめる', block: LESSON.sections[0].blocks[1] });
  });

  it('numbers a section whose title has no number by its place, and reads the title in the reader’s language', () => {
    assert.deepEqual(askedPlace(LESSON, { sectionId: 's2', blockId: 'm3' }, tx), { n: '2', title: '道具をそろえる', block: LESSON.sections[1].blocks[0] });
    assert.equal(askedPlace(LESSON, { sectionId: 's2', blockId: 'm3' }, txIn('en'))?.title, 'Get the tools');
  });

  it('is null without a place, or for a place the lesson on screen does not have (the chip would lead nowhere)', () => {
    assert.equal(askedPlace(LESSON, null, tx), null);
    assert.equal(askedPlace(LESSON, undefined, tx), null);
    assert.equal(askedPlace(LESSON, { sectionId: 's1' }, tx), null, 'no block id');
    assert.equal(askedPlace(LESSON, { sectionId: 'gone', blockId: 'm1' }, tx), null, 'no such section');
    assert.equal(askedPlace(LESSON, { sectionId: 's2', blockId: 'm1' }, tx), null, 'the block is in another section');
    assert.equal(askedPlace(LESSON, { sectionId: 's1', blockId: 'gone' }, tx), null, 'no such block');
  });
});

describe('askedPlaces: the chip under each finished answer, the sources under the first', () => {
  const at = (/** @type {string} */ sectionId, /** @type {string} */ blockId) => ({ sectionId, blockId });
  /** @type {any[]} */
  const TURNS = [
    { id: 'q1', role: 'user', status: 'done', grounding: at('s1', 'm2') },
    { id: 'a1', role: 'assistant', status: 'done', grounding: at('s1', 'm2') },
    { id: 'a2', role: 'assistant', status: 'error', grounding: at('s1', 'm2') },
    { id: 'a3', role: 'assistant', status: 'stopped', grounding: at('s1', 'm2') },
    { id: 'a4', role: 'assistant', status: 'done', grounding: null },
    { id: 'a5', role: 'assistant', status: 'done', grounding: at('s1', 'gone') },
    { id: 'a6', role: 'assistant', status: 'done', grounding: at('s2', 'm3') },
    { id: 'a7', role: 'assistant', status: 'streaming', grounding: at('s2', 'm3') },
  ];

  it('places only finished answers whose place the lesson has', () => {
    const { byTurn } = askedPlaces(LESSON, TURNS, tx);
    assert.deepEqual([...byTurn.keys()], ['a1', 'a6']);
    assert.equal(byTurn.get('a1')?.block.id, 'm2');
    assert.equal(byTurn.get('a6')?.n, '2');
  });

  it('lists the sources once, under the first answer that has a place, and keeps them there as answers follow', () => {
    assert.equal(askedPlaces(LESSON, TURNS, tx).sourcesTurnId, 'a1');
    assert.equal(askedPlaces(LESSON, TURNS.slice(0, 2), tx).sourcesTurnId, 'a1', 'the same answer before the follow-ups came');
    const later = TURNS.filter((turn) => turn.id !== 'a1');
    assert.equal(askedPlaces(LESSON, later, tx).sourcesTurnId, 'a6', 'answers without a place (failed, stopped, no anchor, a gone block) are skipped');
  });

  it('a thread without a place has no chip and no list', () => {
    const { byTurn, sourcesTurnId } = askedPlaces(LESSON, [TURNS[0], TURNS[4]], tx);
    assert.equal(byTurn.size, 0);
    assert.equal(sourcesTurnId, null);
  });
});

describe('focusForVisit: a block with nothing to focus takes the focus itself', () => {
  /** @param {Record<string, string>} [attrs] */
  function fakeElement(attrs = {}) {
    const attributes = new Map(Object.entries(attrs));
    /** @type {any[]} */
    const log = [];
    /** @type {Array<{ type: string, fn: () => void, options: any }>} */
    const listeners = [];
    return {
      attributes,
      log,
      listeners,
      hasAttribute: (/** @type {string} */ name) => attributes.has(name),
      setAttribute: (/** @type {string} */ name, /** @type {string} */ value) => {
        attributes.set(name, String(value));
        log.push(['set', name, String(value)]);
      },
      removeAttribute: (/** @type {string} */ name) => {
        attributes.delete(name);
        log.push(['remove', name]);
      },
      addEventListener: (/** @type {string} */ type, /** @type {() => void} */ fn, /** @type {any} */ options) => listeners.push({ type, fn, options }),
      focus: (/** @type {any} */ options) => log.push(['focus', options]),
    };
  }

  it('gives it tabindex="-1" (never in the Tab order) before focusing it, without scrolling, and keeps it', () => {
    const el = fakeElement();
    focusForVisit(/** @type {any} */ (el));
    assert.deepEqual(el.log, [['set', 'tabindex', '-1'], ['focus', { preventScroll: true }]]);
    assert.equal(el.listeners.length, 0, 'nothing takes it away on blur');
    assert.equal(el.attributes.get('tabindex'), '-1', 'so the browser (back from another window) or a closing dialog can focus it again');
    focusForVisit(/** @type {any} */ (el));
    assert.deepEqual(el.log.slice(2), [['focus', { preventScroll: true }]], 'a second visit only focuses it');
  });

  it('leaves a tabindex the element already has alone', () => {
    const el = fakeElement({ tabindex: '0' });
    focusForVisit(/** @type {any} */ (el));
    assert.deepEqual(el.log, [['focus', { preventScroll: true }]]);
    assert.equal(el.listeners.length, 0);
    assert.equal(el.attributes.get('tabindex'), '0');
  });
});

describe('focusBlock: after a jump, the block’s first control that takes the focus, else the block', () => {
  /**
   * A block whose first match for BLOCK_FOCUS_TARGETS is `target` (or nothing). `takes`: whether the
   * target takes the focus (a button does; an <h3> without a tabindex does not).
   * @param {{ target?: boolean, takes?: boolean }} [options]
   */
  function fakeBlock({ target = true, takes = true } = {}) {
    const doc = { activeElement: /** @type {any} */ (null) };
    /** @type {any[]} */
    const log = [];
    const attributes = new Map();
    const control = {
      focus: (/** @type {any} */ options) => {
        log.push(['control.focus', options]);
        if (takes) doc.activeElement = control;
      },
    };
    const block = {
      ownerDocument: doc,
      querySelector: (/** @type {string} */ selector) => {
        log.push(['query', selector]);
        return target ? control : null;
      },
      hasAttribute: (/** @type {string} */ name) => attributes.has(name),
      setAttribute: (/** @type {string} */ name, /** @type {string} */ value) => attributes.set(name, value),
      focus: (/** @type {any} */ options) => {
        log.push(['block.focus', options]);
        doc.activeElement = block;
      },
    };
    return { block, control, doc, log, attributes };
  }

  it('focuses the first control that takes the focus, and leaves the block alone', () => {
    const page = fakeBlock();
    focusBlock(/** @type {any} */ (page.block));
    assert.deepEqual(page.log, [['query', BLOCK_FOCUS_TARGETS], ['control.focus', { preventScroll: true }]]);
    assert.equal(page.doc.activeElement, page.control);
    assert.equal(page.attributes.has('tabindex'), false);
  });

  it('focuses the block when the first match takes nothing (a card’s <h3>), so the focus does not stay on the chip', () => {
    const page = fakeBlock({ takes: false });
    focusBlock(/** @type {any} */ (page.block));
    assert.deepEqual(page.log.slice(1), [['control.focus', { preventScroll: true }], ['block.focus', { preventScroll: true }]]);
    assert.equal(page.doc.activeElement, page.block);
    assert.equal(page.attributes.get('tabindex'), '-1');
  });

  it('focuses the block when it has nothing to focus (a definitions list)', () => {
    const page = fakeBlock({ target: false });
    focusBlock(/** @type {any} */ (page.block));
    assert.deepEqual(page.log.slice(1), [['block.focus', { preventScroll: true }]]);
    assert.equal(page.doc.activeElement, page.block);
  });
});

describe('wiring: the tutor panel and the reader', () => {
  const panel = readFile('components/lesson/TutorPanel.tsx');
  const reader = readFile('components/lesson/LessonReader.tsx');

  it('the chip says 「質問した場所 §n」 / "Asked about §n", never 「根拠」; its name starts with what it shows (WCAG 2.5.3)', () => {
    assert.match(panel, /asked: \(n: string\) => `質問した場所 §\$\{n\}`,/);
    assert.match(panel, /askedLabel: \(n: string, title: string\) => `質問した場所 §\$\{n\}「\$\{title\}」を本文で表示`,/);
    assert.match(panel, /asked: \(n: string\) => `Asked about §\$\{n\}`,/);
    assert.match(panel, /askedLabel: \(n: string, title: string\) => `Asked about §\$\{n\}, \$\{title\}: show it in the text`,/);
    assert.doesNotMatch(panel, /`根拠|Source §/);
  });

  it('本文で見る in a sheet closes it first and moves to the block on the next frame, as the outline does', () => {
    const margin = readFile('components/lesson/MarginPanel.tsx');
    assert.match(margin, /if \(!onDone\) \{\s*scrollToBlock\(blockId\);\s*return;\s*\}/);
    assert.match(margin, /onDone\(\);\s*window\.requestAnimationFrame\(\(\) => scrollToBlock\(blockId\)\);/);
  });

  it('places the chips with askedPlaces; the chip shows the asked block; one answer (askedPlaces picks it) lists its sources', () => {
    assert.match(panel, /const asked = askedPlaces\(lesson, turns, tx\);/);
    assert.match(panel, /aria-label=\{text\.askedLabel\(place\.n, place\.title\)\}\s*onClick=\{\(\) => onShowAsked\(place\.block\.id\)\}/);
    assert.match(panel, /const place = asked\.byTurn\.get\(turn\.id\) \?\? null;/);
    assert.match(panel, /askedChip=\{place \? askedChip\(place\) : null\}/);
    assert.match(panel, /askedSources=\{place && turn\.id === asked\.sourcesTurnId \? <BlockSources sources=\{citedSources\(place\.block, sources\)\} \/> : null\}/);
  });

  it('an answer shows the chip row, then the sources, then the AI notice', () => {
    const view = panel.slice(panel.indexOf('function TurnView'));
    const chips = view.indexOf('{askedChip}');
    const list = view.indexOf('{askedSources}');
    const notice = view.indexOf('{answered && (');
    assert.ok(chips > 0 && list > chips && notice > list, `${chips} < ${list} < ${notice}`);
  });

  it('the reader passes the jump to the asked block, and a block with nothing to focus takes the focus itself', () => {
    assert.match(reader, /onShowAsked: showAskedBlock,/);
    assert.doesNotMatch(reader, /onShowSource|showTutorSource/);
    const start = reader.indexOf('const scrollToBlock = useCallback');
    const body = reader.slice(start, reader.indexOf('}, [scrollToElement]);', start));
    assert.match(body, /scrollToElement\(el\);\s*(\/\/[^\n]*\n\s*)*focusBlock\(el\);/);
    assert.doesNotMatch(body, /querySelector/, 'the focus target is focusBlock’s (tested above)');
  });
});

describe('reader.css: the focused block and one block’s sources', () => {
  const css = readFile('components/lesson/reader.css');

  it('a focused block shows the ring only for the keyboard, like the section headings', () => {
    assert.match(css, /\.rp-block:focus \{\s*outline: none;\s*\}/);
    assert.match(css, /\.rp-block:focus-visible \{\s*outline: 2px solid var\(--rp-focus\);/);
  });

  it('the block sources use design tokens only', () => {
    const part = css.slice(css.indexOf('.rp-block-sources {'), css.indexOf('End of lesson'));
    assert.ok(part.length > 0);
    assert.match(part, /\.rp-block-sources-list \{[^}]*list-style: none;/);
    assert.match(part, /\.rp-block-sources-item \{\s*display: grid;\s*grid-template-columns: 2em minmax\(0, 1fr\);/, 'room for two digits');
    assert.doesNotMatch(part, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
