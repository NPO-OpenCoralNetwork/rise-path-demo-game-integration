/**
 * The Claude Code PostToolUse hook .claude/hooks/validate-lesson.mjs (WP-06).
 *
 * Contract (PLAN §9 WP-06): an invalid lesson → exit 2 with the errors and their JSON paths on
 * stderr; a valid lesson → exit 0; any other file → exit 0 and silent.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLessonPath, targetFile, formatErrors, runHook } from '../../.claude/hooks/validate-lesson.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'validate-lesson.mjs');
const VALID = path.join(ROOT, 'content', 'courses', 'vibe-coding', 'lessons', 'vibe-ch1.lesson.json');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Runs the hook as Claude Code does: PostToolUse JSON on stdin. */
function runProcess(input, { cwd = ROOT } = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    timeout: 30000,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

const postToolUse = (filePath, extra = {}) => ({
  session_id: 'test',
  hook_event_name: 'PostToolUse',
  tool_name: 'Write',
  tool_input: { file_path: filePath, content: '…' },
  tool_response: { filePath, type: 'create' },
  ...extra,
});

let tmp;
let badLesson;
let badCourse;
let notJson;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-hook-'));
  const drafts = path.join(tmp, 'content', 'courses', 'demo', 'drafts');
  fs.mkdirSync(drafts, { recursive: true });

  // A real lesson with two injected mistakes: an unknown block type and a missing field.
  const lesson = readJson(VALID);
  lesson.id = 'broken';
  lesson.sections[0].blocks[0].type = 'not-a-block';
  delete lesson.objectives;
  badLesson = path.join(drafts, 'broken.lesson.json');
  fs.writeFileSync(badLesson, JSON.stringify(lesson, null, 2));

  badCourse = path.join(tmp, 'content', 'courses', 'demo', 'course.json');
  fs.writeFileSync(badCourse, JSON.stringify({ schema: 'risepath.course/v1', id: 'demo' }));

  notJson = path.join(drafts, 'half-written.lesson.json');
  fs.writeFileSync(notJson, '{ "schema": "risepath.lesson/v1", ');
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('validate-lesson hook (process)', () => {
  it('exits 2 with the file and JSON paths on stderr for an invalid lesson', () => {
    const { code, stderr, stdout } = runProcess(postToolUse(badLesson));
    assert.equal(code, 2, stderr);
    assert.equal(stdout, '');
    assert.match(stderr, /validation failed for .*broken\.lesson\.json/);
    assert.match(stderr, /sections\[0\]\.blocks\[0\]\.type: /);
    assert.match(stderr, /- objectives: /);
    assert.match(stderr, /Fix every error above/);
  });

  it('exits 0 for a valid lesson', () => {
    const { code, stderr } = runProcess(postToolUse(VALID));
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
  });

  it('resolves a relative file_path against the hook input cwd (Edit tool)', () => {
    const rel = path.relative(ROOT, VALID);
    const input = postToolUse(rel, { tool_name: 'Edit', tool_input: { file_path: rel, old_string: 'a', new_string: 'b' }, cwd: ROOT });
    delete input.tool_response;
    assert.equal(runProcess(input, { cwd: os.tmpdir() }).code, 0);
  });

  it('exits 2 for a lesson file that is not valid JSON', () => {
    const { code, stderr } = runProcess(postToolUse(notJson));
    assert.equal(code, 2);
    assert.match(stderr, /half-written\.lesson\.json/);
  });

  it('exits 2 for an invalid course.json under content/courses/<slug>/', () => {
    const { code, stderr } = runProcess(postToolUse(badCourse));
    assert.equal(code, 2);
    assert.match(stderr, /course\.json/);
  });

  it('ignores files that are not lessons or courses', () => {
    for (const file of [path.join(ROOT, 'README.md'), path.join(ROOT, 'package.json'), path.join(ROOT, 'content', 'schema', 'lesson.schema.json')]) {
      const { code, stdout, stderr } = runProcess(postToolUse(file));
      assert.equal(code, 0, file);
      assert.equal(stdout + stderr, '', file);
    }
  });

  it('ignores a lesson path that no longer exists, and input without a file path', () => {
    assert.equal(runProcess(postToolUse(path.join(tmp, 'content', 'gone.lesson.json'))).code, 0);
    assert.equal(runProcess({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }).code, 0);
    assert.equal(runProcess('').code, 0);
  });

  it('exits 1 (non-blocking) when stdin is not JSON', () => {
    const { code, stderr } = runProcess('not json');
    assert.equal(code, 1);
    assert.match(stderr, /not JSON/);
  });
});

describe('validate-lesson hook (functions)', () => {
  it('isLessonPath matches lesson JSON under content/ and course.json under content/courses/<slug>/', () => {
    assert.ok(isLessonPath('/repo/content/courses/vibe-coding/drafts/vibe-ch1.lesson.json'));
    assert.ok(isLessonPath('/repo/content/courses/vibe-coding/lessons/vibe-ch1.lesson.json'));
    assert.ok(isLessonPath('content/examples/blocks-gallery.lesson.json'));
    assert.ok(isLessonPath('/repo/content/courses/vibe-coding/course.json'));
    assert.ok(!isLessonPath('/repo/content/schema/lesson.schema.json'));
    assert.ok(!isLessonPath('/repo/content/courses/vibe-coding/reports/vibe-ch1.pedagogy-reviewer.review.json'));
    assert.ok(!isLessonPath('/repo/data/curricula/vibe/ch1.lesson.json'));
    assert.ok(!isLessonPath('/repo/content/course.json'));
  });

  it('targetFile reads tool_input.file_path, falls back to tool_response.filePath, resolves against cwd', () => {
    assert.equal(targetFile({ tool_input: { file_path: '/abs/a.lesson.json' } }), '/abs/a.lesson.json');
    assert.equal(targetFile({ tool_response: { filePath: '/abs/b.lesson.json' } }), '/abs/b.lesson.json');
    assert.equal(targetFile({ cwd: '/work', tool_input: { file_path: 'content/x.lesson.json' } }), '/work/content/x.lesson.json');
    assert.equal(targetFile({ tool_input: { command: 'ls' } }), null);
    assert.equal(targetFile(null), null);
  });

  it('formatErrors caps the list and points at the CLI for the rest', () => {
    const errors = Array.from({ length: 30 }, (_, i) => ({ path: `sections[${i}].id`, message: 'bad' }));
    const text = formatErrors(path.join(ROOT, 'content', 'courses', 'x', 'drafts', 'y.lesson.json'), errors);
    assert.match(text, /content\/courses\/x\/drafts\/y\.lesson\.json \(30 errors\)/);
    assert.match(text, /sections\[24\]\.id: bad/);
    assert.doesNotMatch(text, /sections\[25\]\.id/);
    assert.match(text, /… and 5 more \(npm run lessons:validate -- content\/courses\/x\/drafts\/y\.lesson\.json\)/);
    assert.match(formatErrors('/x/content/a.lesson.json', [{ path: '', message: 'm' }]), /- \(root\): m/);
  });

  it('runHook returns lint warnings of a valid lesson as PostToolUse additionalContext (exit 0)', async () => {
    const lesson = readJson(VALID);
    lesson.id = 'no-flashcards';
    lesson.sections = lesson.sections.map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.type !== 'flashcards') }));
    const dir = path.join(tmp, 'content', 'courses', 'demo', 'drafts');
    const file = path.join(dir, 'no-flashcards.lesson.json');
    fs.writeFileSync(file, JSON.stringify(lesson));
    const result = await runHook(JSON.stringify(postToolUse(file)));
    assert.equal(result.code, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, /is valid\. Lint: \d+ pedagogy warning/);
    assert.match(out.hookSpecificOutput.additionalContext, /\[flashcards-count\]/);
  });
});
