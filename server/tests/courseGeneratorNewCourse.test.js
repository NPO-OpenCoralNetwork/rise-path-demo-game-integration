/**
 * The course generator (components/features/ai/CourseGeneratorView.tsx) with a restored draft: the
 * learner continues it (approve, or type a change) or starts a new course with 「新しく始める」.
 * Before, the restore message invited a new topic in the composer, which then went out as a revision
 * of the old draft (sendAiDecision 'revise'): the requirements step rewrote the old draft's intake
 * and the roadmap step regenerated its roadmap. Source checks, as for the view's other rules
 * (materialFailures.test.js); the server side of a new topic (no curriculum_id: a new draft row) is
 * dailyCapsRoutes.test.js's "SQL basics" request.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const view = read('components/features/ai/CourseGeneratorView.tsx');

/** The source from `start` up to (not including) the first `end` after it. */
const slice = (start, end) => {
  const from = view.indexOf(start);
  assert.ok(from >= 0, `found: ${start}`);
  const to = view.indexOf(end, from + start.length);
  assert.ok(to > from, `found after ${start}: ${end}`);
  return view.slice(from, to);
};

const startNewCourse = () => slice('const startNewCourse = () => {', '\n  };');
const approvalCard = () => slice("{!isGenerating && pendingApproval && pendingApproval !== 'none' && (", '{isGenerating && (');
const resetButton = () => slice('<div className="md:mt-auto md:pt-10 text-center">', '{t.resetChat}');

describe('course generator: a restored draft is continued or left for a new course', () => {
  it('the restore message points to 「新しく始める」, not to a new topic in the composer, in both languages', () => {
    assert.match(view, /restoredDraft: \(title: string, stage: 'requirements' \| 'roadmap'\) => `📋 前回の作業を復元しました。「\$\{title\}」の\$\{stage === 'requirements' \? '要件定義' : 'ロードマップ'\}が承認待ちです。\\n\\n続けるときは、下で承認するか、修正点を入力してください。別のテーマで作るときは「新しく始める」を押してください。`,/);
    assert.match(view, /restoredDraft: \(title: string, stage: 'requirements' \| 'roadmap'\) => `📋 Restored your previous session: "\$\{title\}"\. The \$\{stage\} stage is pending approval\.\\n\\nTo continue, approve it below or type the changes you want\. For a course on another topic, choose "Start a new course"\.`,/);
    // The message names the button by its label.
    assert.match(view, /newCourse: '新しく始める',/);
    assert.match(view, /newCourse: 'Start a new course',/);
    assert.doesNotMatch(view, /新しいテーマを入力|type a new topic/);
    assert.match(view, /const stage = latest\.status === 'draft_roadmap' \? 'roadmap' : 'requirements';/);
    assert.match(view, /id: 'restored-draft',\s*role: 'model',\s*text: t\.restoredDraft\(latest\.title, stage\),/);
  });

  it('continuing still approves or revises the restored draft', () => {
    assert.match(view, /setCurriculumId\(latest\.id\);\s*setSessionId\(latest\.id\);\s*setPendingApproval\(stage\);/);
    assert.match(view, /const isRevision = pendingApproval !== null && pendingApproval !== 'none';/);
    assert.match(view, /if \(isRevision && curriculumId && sessionId && pendingApproval\) \{\s*response = await sendAiDecision\(curriculumId, sessionId, pendingApproval, 'revise', sentText, attachments\);\s*\} else \{\s*response = await sendAiChat\(sentText, sessionId \|\| undefined, attachments\);/);
    assert.match(view, /const response = await sendAiDecision\(curriculumId, sessionId, pendingApproval, 'approved'\);/);
  });

  it('「新しく始める」 lets the draft, the conversation and any attached file go, so the next message starts a new draft', () => {
    const body = startNewCourse();
    for (const clear of [
      'setSessionId(null);', 'setCurriculumId(null);', 'setPendingApproval(null);',
      'setSelectedFile(null);', 'setUploadedFile(null);', 'setUploadNotice(null);', 'setError(null);',
      'setAiBlocked(null);', 'setBlockedUntil(null);', "setStatusMessage('');",
    ]) assert.ok(body.includes(clear), clear);
    // Back to the start screen: the welcome message (an app message, no AI notice), so the demo topics show again.
    assert.match(body, /setMessages\(\[\{ id: 'init', role: 'model', text: t\.initialMessage, timestamp: new Date\(\) \}\]\);/);
    // An access refusal is about the learner and stays; a notice about the last call goes.
    assert.match(body, /setAiRefusal\(\(refusal\) => \(refusal\?\.type === 'access' \? refusal : null\)\);/);
    // What is typed stays, to send as the new topic.
    assert.doesNotMatch(body, /setInputValue/);
    assert.match(body, /^const startNewCourse = \(\) => \{\s*if \(isGenerating\) return;/);
    // With no session or pending stage, the next message is a new topic: no curriculum_id goes to the server.
    assert.match(read('services/curriculumApi.ts'), /body: JSON\.stringify\(\{ message, session_id: sessionId, stage: 'requirements', attachments \}\),/);
  });

  it('the composer takes focus afterwards (the pressed button may be gone)', () => {
    assert.match(startNewCourse(), /focusAfterRef\.current = 'input';/);
    assert.match(view, /target\?\.focus\(\);\s*\}, \[aiBlocked, isGenerating, uploadNotice, composerLocked, messages\]\);/);
  });

  it('the approval card offers it at every pending stage, off while generation is locked, in both languages', () => {
    const card = approvalCard();
    assert.match(card, /<p className="text-small text-fg-2">\{t\.newCourseLead\}<\/p>\s*<button\s+type="button"\s+onClick=\{startNewCourse\}\s+disabled=\{composerLocked\}/);
    assert.match(card, /<Plus size=\{16\} aria-hidden="true" \/>\s*\{t\.newCourse\}\s*<\/button>/);
    assert.match(view, /newCourseLead: '別のテーマで作りますか？',/);
    assert.match(view, /newCourseLead: 'Want a course on another topic\?',/);
    // New code uses design tokens only (doc/design/design-system.md §6).
    const row = card.slice(card.indexOf('border-t border-line pt-4'), card.indexOf('{t.newCourse}'));
    assert.ok(row.length > 0, 'the new row');
    assert.doesNotMatch(row, /\[#|rounded-\[|text-\[(9|10|11)px\]|slate-|indigo-/);
  });

  it('the reset button starts a new course the same way, and not while a stage runs', () => {
    assert.match(resetButton(), /onClick=\{startNewCourse\}\s+disabled=\{isGenerating\}/);
    assert.doesNotMatch(view, /resetMessage|id: 'reset'/);
  });

  it('every message the app writes itself is one without an AI notice', () => {
    const ids = [...view.matchAll(/setMessages\(\[\{\s*id: '([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(ids)].sort(), ['init', 'restored-draft']);
    assert.match(view, /const APP_MESSAGE_IDS = new Set\(\['init', 'restored-draft'\]\);/);
  });

  it('the demo topics show on the start screen only: under a restored draft they would revise it', () => {
    assert.match(view, /\{messages\.length === 1 && messages\[0\]\.id === 'init' && !isGenerating && !composerLocked && \(/);
  });

  it('a draft that loads after the learner sent a topic or started over is not put over the conversation', () => {
    assert.match(view, /if \(drafts\.length > 0 && !conversationStartedRef\.current\) \{/);
    assert.match(view, /conversationStartedRef\.current = true;\s*setMessages\(prev => \[\.\.\.prev, userMsg\]\);/);
    assert.match(startNewCourse(), /if \(isGenerating\) return;\s*conversationStartedRef\.current = true;/);
  });
});
