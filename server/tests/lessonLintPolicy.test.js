// Lint policy for machine-migrated lessons (owner decision 2026-10-19, option A):
// `lessons:lint --strict` reports their warnings as advisory; drafts and authored lessons stay strict.
// The steps blocks published without cite before steps-cite existed (KNOWN_UNCITED_STEPS,
// 「出典と検索」 2026-10-30) are a known state too: advisory outside drafts, every other one strict.
// The CLI cases run on fixtures with explicit provenance (built from the lint-clean gallery lesson
// plus one known warning), so reworking or publishing a chapter does not change what they test.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KNOWN_UNCITED_STEPS, blockKey, isMigratedUnreviewed, isMigrationAuthor, lintLesson, lintPolicy, warningPolicy } from '../../shared/lesson/lint.js';
import { parseLintArgs, isDraftFile } from '../../scripts/lessons/lint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const GALLERY = readJson(path.join(ROOT, 'content/examples/blocks-gallery.lesson.json'));
const MIGRATED_FROM = { source: 'data/curricula/vibe_coding/chapter2.ts' };
const MIGRATED = { author: 'migration', migratedFrom: MIGRATED_FROM };
const AUTHORED = { author: 'claude-code' };

/**
 * The gallery lesson with the given provenance and, by default, one banned-phrase warning;
 * `uncited` drops the cite of its steps block (one steps-cite warning).
 */
function fixture(id, provenance, { warn = true, broken = false, uncited = false } = {}) {
  const lesson = structuredClone(GALLERY);
  lesson.id = id;
  lesson.provenance = provenance;
  if (warn) {
    const lead = lesson.sections.flatMap((s) => s.blocks).find((b) => b.id === 'hook-lead');
    lead.md = { ...lead.md, jp: `${lead.md.jp}これは簡単です。` };
  }
  if (uncited) delete lesson.sections.flatMap((s) => s.blocks).find((b) => b.id === 'practice-steps').cite;
  if (broken) lesson.estMinutes = 0;
  return lesson;
}

function lint(args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts/lessons/lint.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
}

describe('isMigratedUnreviewed', () => {
  it('is true for machine-migrated lessons, with or without spot fixes', () => {
    assert.equal(isMigratedUnreviewed({ provenance: MIGRATED }), true);
    assert.equal(isMigratedUnreviewed({ provenance: { ...MIGRATED, author: 'migration+claude-code' } }), true);
    assert.equal(isMigratedUnreviewed({ provenance: { ...MIGRATED, reviewedBy: '  ' } }), true, 'a blank reviewedBy names no reviewer');
  });

  it('is false once a lesson is reworked, reviewed or was never migrated', () => {
    for (const provenance of [
      { author: 'human+claude-code', migratedFrom: MIGRATED_FROM },
      { author: 'claude-code', migratedFrom: MIGRATED_FROM },
      { author: 'migrationbot', migratedFrom: MIGRATED_FROM },
      { author: ' migration', migratedFrom: MIGRATED_FROM },
      { author: 'migration +claude-code', migratedFrom: MIGRATED_FROM },
      { author: 'Migration', migratedFrom: MIGRATED_FROM },
      { author: 'migration', migratedFrom: MIGRATED_FROM, reviewedBy: 'owner' },
      { author: 'migration' },
      { author: 'human' },
    ]) {
      assert.equal(isMigratedUnreviewed({ provenance }), false, JSON.stringify(provenance));
    }
    assert.equal(isMigratedUnreviewed({}), false);
  });

  it('isMigrationAuthor matches exactly "migration" or "migration+…"', () => {
    assert.deepEqual(
      ['migration', 'migration+claude-code', 'migration+human', 'migration+', 'claude-code', 'human+migration', 'migrations', undefined]
        .map(isMigrationAuthor),
      [true, true, true, true, false, false, false, false],
    );
  });

  it('the fixture lesson has exactly the injected warning', () => {
    assert.deepEqual(lintLesson(fixture('fx', AUTHORED, { warn: false })).warnings, []);
    assert.ok(lintLesson(fixture('fx', AUTHORED)).warnings.some((w) => w.rule === 'banned-phrase'));
  });
});

describe('lintPolicy', () => {
  const migrated = { provenance: MIGRATED };
  const authored = { provenance: AUTHORED };

  it('makes migrated-unreviewed lessons advisory and everything else strict', () => {
    assert.equal(lintPolicy(migrated), 'advisory');
    assert.equal(lintPolicy(authored), 'strict');
  });

  it('keeps drafts strict and lets --include-migrated gate migrated lessons', () => {
    assert.equal(lintPolicy(migrated, { draft: true }), 'strict');
    assert.equal(lintPolicy(migrated, { includeMigrated: true }), 'strict');
    assert.equal(lintPolicy(authored, { draft: false, includeMigrated: false }), 'strict');
  });
});

describe('warningPolicy and KNOWN_UNCITED_STEPS', () => {
  /** A one-block lesson whose steps block has the id of a known one (claude-code/cc-03-plan-first#practice-steps). */
  const lesson = (id, provenance = AUTHORED) => ({
    provenance, courseId: 'claude-code', id, sections: [{ id: 's1', blocks: [{ id: 'practice-steps', type: 'steps', items: [] }] }],
  });
  const stepsCite = { rule: 'steps-cite', path: 'sections[0].blocks[0]' };
  const banned = { rule: 'banned-phrase', path: 'sections[0].blocks[0].items[0].title' };

  it('makes the steps-cite warning of a known block advisory, and any other one strict', () => {
    assert.equal(blockKey(lesson('cc-03-plan-first'), stepsCite.path), 'claude-code/cc-03-plan-first#practice-steps');
    assert.equal(warningPolicy(stepsCite, lesson('cc-03-plan-first')), 'advisory');
    assert.equal(warningPolicy(stepsCite, lesson('cc-12-new')), 'strict', 'a new lesson fails, also after publishing');
    assert.equal(warningPolicy(stepsCite, { ...lesson('cc-03-plan-first'), courseId: 'vibe-coding' }), 'strict');
    assert.equal(warningPolicy(stepsCite, { ...lesson('cc-03-plan-first'), courseId: undefined }), 'strict');
    assert.equal(warningPolicy(banned, lesson('cc-03-plan-first')), 'strict');
  });

  it('drafts and --include-migrated make a known block strict too', () => {
    assert.equal(warningPolicy(stepsCite, lesson('cc-03-plan-first'), { draft: true }), 'strict');
    assert.equal(warningPolicy(stepsCite, lesson('cc-03-plan-first'), { includeMigrated: true }), 'strict');
  });

  it('follows lintPolicy for migrated-unreviewed lessons', () => {
    assert.equal(warningPolicy(banned, lesson('cc-12-new', MIGRATED)), 'advisory');
    assert.equal(warningPolicy(stepsCite, lesson('cc-12-new', MIGRATED)), 'advisory');
    assert.equal(warningPolicy(banned, lesson('cc-12-new', MIGRATED), { draft: true }), 'strict');
    assert.equal(warningPolicy(stepsCite, lesson('cc-12-new', MIGRATED), { includeMigrated: true }), 'strict');
  });

  it('lists only published steps blocks that still have no cite', () => {
    for (const key of KNOWN_UNCITED_STEPS) {
      const [, course, id, blockId] = /^([a-z0-9-]+)\/([a-z0-9-]+)#([a-z0-9._-]+)$/.exec(key) || [];
      const file = path.join(ROOT, 'content/courses', course || '-', 'lessons', `${id}.lesson.json`);
      assert.ok(fs.existsSync(file), `${key}: no published lesson ${path.relative(ROOT, file)}`);
      const block = readJson(file).sections.flatMap((s) => s.blocks).find((b) => b.id === blockId);
      assert.equal(block?.type, 'steps', `${key}: no steps block "${blockId}"`);
      assert.ok(!block.cite?.length, `${key} cites its sources now: remove it from KNOWN_UNCITED_STEPS (shared/lesson/lint.js)`);
    }
  });
});

describe('lessons:lint CLI options', () => {
  it('parses --include-migrated next to the validate options', () => {
    const args = parseLintArgs(['a.lesson.json', '--strict', '--include-migrated']);
    assert.deepEqual(args.paths, ['a.lesson.json']);
    assert.equal(args.strict, true);
    assert.equal(args.includeMigrated, true);
    assert.equal(parseLintArgs(['--strict']).includeMigrated, false);
    assert.throws(() => parseLintArgs(['--include-migrate']), /Unknown option/);
  });

  it('treats files directly in a drafts/ folder as drafts', () => {
    assert.equal(isDraftFile('content/courses/vibe-coding/drafts/vibe-ch2.lesson.json'), true);
    assert.equal(isDraftFile('content/courses/vibe-coding/lessons/vibe-ch2.lesson.json'), false);
    assert.equal(isDraftFile('/srv/drafts/repo/content/courses/x/lessons/a.lesson.json'), false);
  });
});

describe('lessons:lint --strict (fixtures)', () => {
  let tmp;
  const write = (dir, lesson) => {
    const file = path.join(tmp, dir, `${lesson.id}.lesson.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(lesson, null, 2)}\n`);
    return file;
  };

  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-lint-policy-')); });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('passes a migrated-unreviewed lesson with warnings, labelled advisory; --include-migrated fails it', () => {
    const file = write('published', fixture('fx-migrated', MIGRATED));
    const cli = lint([file, '--strict']);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.match(cli.stdout, /fx-migrated\.lesson\.json \(\d+ warnings?, advisory: migrated-unreviewed\)/);
    assert.match(cli.stdout, /Advisory: \d+ warnings? in 1 migrated-unreviewed lesson/);
    const strictAll = lint([file, '--strict', '--include-migrated']);
    assert.equal(strictAll.status, 1, strictAll.stdout + strictAll.stderr);
    assert.doesNotMatch(strictAll.stdout, /advisory/);
  });

  it('fails the same lesson in drafts/, after a rework (new author) and once reviewed', () => {
    for (const [dir, provenance] of [
      ['drafts', MIGRATED],
      ['reworked', { ...MIGRATED, author: 'claude-code' }],
      ['reviewed', { ...MIGRATED, reviewedBy: 'owner' }],
    ]) {
      const cli = lint([write(dir, fixture(`fx-${dir}`, provenance)), '--strict']);
      assert.equal(cli.status, 1, `${dir}: ${cli.stdout}${cli.stderr}`);
      assert.doesNotMatch(cli.stdout, /advisory/, dir);
    }
  });

  it('still fails on validation errors in a migrated lesson', () => {
    const cli = lint([write('broken', fixture('fx-broken', MIGRATED, { broken: true })), '--strict']);
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    assert.match(cli.stdout, /✗ .*fx-broken\.lesson\.json/);
  });

  it('a folder with one advisory and one authored lesson fails; JSON and GitHub output say which is which', () => {
    write('mixed', fixture('fx-old', MIGRATED));
    write('mixed', fixture('fx-new', AUTHORED));
    const dir = path.join(tmp, 'mixed');
    assert.equal(lint([dir, '--strict']).status, 1);

    const json = JSON.parse(lint([dir, '--strict', '--format', 'json']).stdout);
    assert.equal(json.ok, false);
    assert.equal(json.includeMigrated, false);
    assert.ok(json.advisoryWarnings > 0);
    const byFile = Object.fromEntries(json.files.map((f) => [path.basename(f.file), f.policy]));
    assert.deepEqual(byFile, { 'fx-new.lesson.json': 'strict', 'fx-old.lesson.json': 'advisory' });

    const github = lint([dir, '--strict', '--format', 'github']).stdout;
    assert.match(github, /^::warning file=[^\n]*fx-old\.lesson\.json[^\n]*title=lessons:lint \(advisory, migrated-unreviewed\)/m);
    assert.match(github, /^::error file=[^\n]*fx-new\.lesson\.json/m);
    assert.doesNotMatch(github, /^::error file=[^\n]*fx-old/m);
  });

  /** The gallery as the known lesson claude-code/cc-03-plan-first, its practice-steps block uncited. */
  const knownLesson = (options = {}) => ({ ...fixture('cc-03-plan-first', AUTHORED, { warn: false, uncited: true, ...options }), courseId: 'claude-code' });

  it('lists the steps-cite warning of a known block as advisory; a new uncited steps block fails, also after publishing', () => {
    const known = write('cite-known', knownLesson());
    const cli = lint([known, '--strict']);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.match(cli.stdout, /cc-03-plan-first\.lesson\.json \(1 warning, 1 advisory: known uncited steps\)/);
    assert.match(cli.stdout, /steps-cite\s+sections\[\d+\]\.blocks\[\d+\]: .*\(advisory\)$/m);
    assert.match(cli.stdout, /Advisory: 1 steps-cite warning on known uncited steps blocks in 1 lesson /);

    const json = JSON.parse(lint([known, '--strict', '--format', 'json']).stdout);
    assert.equal(json.ok, true);
    assert.equal(json.advisoryWarnings, 1);
    assert.equal(json.files[0].policy, 'strict');
    assert.deepEqual(json.files[0].warnings.map((w) => [w.rule, w.policy]), [['steps-cite', 'advisory']]);

    const github = lint([known, '--strict', '--format', 'github']).stdout;
    assert.match(github, /^::warning file=[^\n]*cc-03-plan-first\.lesson\.json,title=lessons:lint \(advisory, known uncited steps\) steps-cite::/m);
    assert.doesNotMatch(github, /^::error/m);

    for (const [label, args] of [
      ['a new lesson', [write('cite-new', fixture('fx-uncited', AUTHORED, { warn: false, uncited: true })), '--strict']],
      ['drafts/', [write('drafts', knownLesson()), '--strict']],
      ['--include-migrated', [known, '--strict', '--include-migrated']],
    ]) {
      const strict = lint(args);
      assert.equal(strict.status, 1, `${label}: ${strict.stdout}${strict.stderr}`);
      assert.doesNotMatch(strict.stdout, /advisory/, label);
      assert.match(lint([...args, '--format', 'github']).stdout, /^::error file=[^\n]*title=lessons:lint steps-cite::/m, label);
    }
  });

  it('a known uncited steps block does not hide another warning of the same lesson', () => {
    const cli = lint([write('cite-mixed', knownLesson({ warn: true })), '--strict', '--format', 'json']);
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    const json = JSON.parse(cli.stdout);
    assert.equal(json.ok, false);
    assert.equal(json.advisoryWarnings, 1);
    assert.deepEqual(json.files[0].warnings.map((w) => [w.rule, w.policy]).sort(), [['banned-phrase', 'strict'], ['steps-cite', 'advisory']]);
  });

  it('a migrated-unreviewed lesson with an uncited steps block: every warning advisory, counted once', () => {
    const file = write('cite-migrated', fixture('fx-migrated-uncited', MIGRATED, { uncited: true }));
    const cli = lint([file, '--strict', '--format', 'json']);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    const json = JSON.parse(cli.stdout);
    assert.equal(json.advisoryWarnings, 2);
    assert.equal(json.files[0].policy, 'advisory');
    assert.deepEqual(json.files[0].warnings.map((w) => [w.rule, w.policy]).sort(), [['banned-phrase', 'advisory'], ['steps-cite', 'advisory']]);
    assert.match(lint([file, '--strict', '--format', 'github']).stdout, /^::warning file=[^\n]*title=lessons:lint \(advisory, migrated-unreviewed\) steps-cite::/m);
  });
});

describe('lessons:lint --strict over the repository', () => {
  it('passes; advisory warnings come only from migrated-unreviewed lessons and KNOWN_UNCITED_STEPS', () => {
    const cli = lint(['--strict', '--format', 'json']);
    const json = JSON.parse(cli.stdout);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.equal(json.ok, true);
    const flagged = new Set();
    for (const file of json.files) {
      const lesson = readJson(path.resolve(ROOT, file.file));
      if (file.policy === 'advisory') {
        assert.equal(isMigratedUnreviewed(lesson), true, file.file);
        continue;
      }
      for (const warning of file.warnings) {
        assert.equal(warning.rule, 'steps-cite', `${file.file}: ${warning.rule} ${warning.path} is advisory`);
        flagged.add(blockKey(lesson, warning.path));
      }
    }
    assert.deepEqual([...flagged].sort(), [...KNOWN_UNCITED_STEPS].sort(), 'the advisory steps-cite warnings are exactly the known blocks');
  });
});
