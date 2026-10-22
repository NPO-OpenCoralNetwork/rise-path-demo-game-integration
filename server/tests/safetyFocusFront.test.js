/**
 * Phase 0.5 front-end regressions that node:test cannot render (no JSX transform here), so they
 * check the source of the components:
 * - AiAccessSetupView: withdrawing consent from a page that opened with consent in place (ready or
 *   paused) moves focus to the consent step heading, not <body>.
 * - AdminSafetyView: after mark reviewed, paper consent, birth month and revoke, focus moves to a
 *   stable target (the reports heading or the "saved" status line, both tabIndex=-1).
 * - TutorPanel: the AI notice and report button show under any assistant text left on screen once
 *   streaming ends, including an answer that failed partway.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The JSX element `<Name ... />` (up to its closing `/>` at the same indent). */
function element(source, name) {
  const start = source.indexOf(`<${name}\n`);
  assert.ok(start >= 0, `<${name}> not found`);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  const end = source.indexOf(`\n${indent}/>`, start);
  assert.ok(end > start, `end of <${name}> not found`);
  return source.slice(start, end);
}

describe('AiAccessSetupView: focus after withdrawing consent', () => {
  const view = read('components/safety/AiAccessSetupView.tsx');

  for (const card of ['ReadyCard', 'PausedCard']) {
    it(`${card} onRevoked lets the consent step take focus`, () => {
      const jsx = element(view, card);
      const handler = jsx.slice(jsx.indexOf('onRevoked='));
      assert.match(handler, /setAdvanced\(true\)/, `${card} onRevoked must call setAdvanced(true)`);
    });
  }

  it('the consent step focuses its heading when advanced', () => {
    assert.match(element(view, 'ConsentStep'), /autoFocus=\{advanced\}/);
  });
});

describe('AdminSafetyView: focus after admin actions', () => {
  const view = read('components/features/admin/AdminSafetyView.tsx');

  it('mark reviewed moves focus to the focusable reports heading', () => {
    const start = view.indexOf('const review = async');
    const review = view.slice(start, view.indexOf('const label = (key', start));
    assert.match(review, /headingRef\.current\?\.focus\(\)/);
    assert.match(view, /<h2 id=\{titleId\} ref=\{headingRef\} tabIndex=\{-1\}/);
  });

  it('every learner save (birth month, paper consent, revoke) focuses the status line', () => {
    const onSaved = view.slice(view.indexOf('const onSaved = (next: AdminUserAiAccess)'));
    assert.match(onSaved.slice(0, onSaved.indexOf('};')), /setSavedCount\(/);
    assert.match(view, /if \(savedCount > 0\) messageRef\.current\?\.focus\(\);/);
    assert.match(view, /<p ref=\{messageRef\} tabIndex=\{-1\} role="status"/);
    for (const form of ['AdminAgeForm', 'PaperConsentForm', 'RevokeConsent']) {
      assert.match(view, new RegExp(`<${form} [^>]*onSaved=\\{onSaved\\}`), `${form} must report through onSaved`);
    }
  });
});

describe('TutorPanel: AI notice under a partial answer', () => {
  const panel = read('components/lesson/TutorPanel.tsx');
  const line = panel.match(/const answered = ([^;]+);/);

  it('shows the notice for any non-streaming turn with text', () => {
    assert.ok(line, 'answered not found');
    // Evaluate the expression for each status the hook can leave a turn in.
    const answered = new Function('turn', `return ${line[1]};`);
    assert.equal(answered({ status: 'done', text: 'A' }), true);
    assert.equal(answered({ status: 'stopped', text: 'A' }), true);
    assert.equal(answered({ status: 'error', text: 'partial answer' }), true);
    assert.equal(answered({ status: 'streaming', text: 'partial' }), false);
    assert.equal(answered({ status: 'error', text: '' }), false);
    assert.equal(answered({ status: 'done', text: '  ' }), false);
  });

  it('the notice is gated on answered', () => {
    assert.match(panel, /\{answered && \(\s*<AiNotice/);
  });

  it('content_blocked still clears the partial text, so it gets no notice', () => {
    assert.match(read('components/lesson/useTutorStream.ts'), /\.\.\.\(blocked \? \{ text: '' \} : \{\}\)/);
  });
});
