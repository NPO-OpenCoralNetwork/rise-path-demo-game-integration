// Lint policy for machine-migrated lessons (owner decision 2026-10-19, option A):
// `lessons:lint --strict` reports their warnings as advisory; drafts and authored lessons stay strict.
// The CLI cases run on fixtures with explicit provenance (built from the lint-clean gallery lesson
// plus one known warning), so reworking or publishing a chapter does not change what they test.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMigratedUnreviewed, isMigrationAuthor, lintLesson, lintPolicy } from '../../shared/lesson/lint.js';
import { parseLintArgs, isDraftFile } from '../../scripts/lessons/lint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const GALLERY = readJson(path.join(ROOT, 'content/examples/blocks-gallery.lesson.json'));
const MIGRATED_FROM = { source: 'data/curricula/vibe_coding/chapter2.ts' };
const MIGRATED = { author: 'migration', migratedFrom: MIGRATED_FROM };
const AUTHORED = { author: 'claude-code' };

/** The gallery lesson with the given provenance and, by default, one banned-phrase warning. */
function fixture(id, provenance, { warn = true, broken = false } = {}) {
  const lesson = structuredClone(GALLERY);
  lesson.id = id;
  lesson.provenance = provenance;
  if (warn) {
    const lead = lesson.sections.flatMap((s) => s.blocks).find((b) => b.id === 'hook-lead');
    lead.md = { ...lead.md, jp: `${lead.md.jp}これは簡単です。` };
  }
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
});

describe('lessons:lint --strict over the repository', () => {
  it('passes; every file it labels advisory is migrated-unreviewed', () => {
    const cli = lint(['--strict', '--format', 'json']);
    const json = JSON.parse(cli.stdout);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.equal(json.ok, true);
    for (const file of json.files) {
      if (file.policy !== 'advisory') continue;
      assert.equal(isMigratedUnreviewed(readJson(path.resolve(ROOT, file.file))), true, file.file);
    }
  });
});
