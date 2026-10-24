// Phase 4 (design §2.5, §8 legalRelease): the legal pages can only be published with a clean text.
// - scripts/legal/check-legal-release.mjs legalReleaseProblems(): today's drafts are refused (draft
//   ids, no effective date, 【要記入】 and 【要確認】 left); a clean released fixture with its archive
//   passes; each broken part of the fixture is reported; the word 下書き in the body is not one.
// - vite.config.ts, resolved with Vite's own resolveConfig (as `vite build` does): the build plugin
//   runs the guard only when VITE_FEATURE_LEGAL_PAGES is exactly 'true' and stops the build with the
//   list; a build whose client gets import.meta.env.DEV = true stops unless
//   LEGAL_DRAFT_PREVIEW_BUILD=true (it would ship the draft text through lazyRoutes.tsx's DEV branch).
// - .github/workflows/ci.yml: the flag-off production build is grepped for the legal text.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legalReleaseProblems } from '../../scripts/legal/check-legal-release.mjs';
import { publicLegalText } from '../../scripts/legal/legalText.mjs';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_NAMES } from '../../shared/legal/versions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const CLEAN_DRAFT = (name) => [
  '> 下書きの注意（公開のページには載りません）',
  '',
  `# ${name}（下書き）`,
  '',
  'この文書の下書きという言葉は、本文にも出てきます。',
  '',
  '（根拠: 公開のページには載りません。）',
  '',
  '## 第 1 条（同意）',
  '',
  '1. 本文です。',
  '<!-- legal:if billing -->',
  '2. 有料の項目。',
  '<!-- legal:end -->',
  '',
].join('\n');

/** A temporary root with clean released texts, their archives and a consent text. */
function cleanFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-legal-release-'));
  const write = (rel, text) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const documents = {};
  for (const name of LEGAL_DOCUMENT_NAMES) {
    const base = LEGAL_DOCUMENTS[name];
    const version = `${name}-2026-12-01`;
    const text = publicLegalText(CLEAN_DRAFT(name), base.include, { document: name, source: base.source });
    write(base.source, CLEAN_DRAFT(name));
    write(base.generated, text);
    write(`content/legal/archive/${version}.ja.md`, text);
    documents[name] = { ...base, version, effectiveDate: '2026-12-01', sha256: sha256(text) };
  }
  write('content/legal/archive/guardian-ai-2026-10.ja.md', '同意の文\n');
  const consentTexts = { 'guardian-ai-2026-10': { sha256: sha256('同意の文\n'), file: 'content/legal/archive/guardian-ai-2026-10.ja.md' } };
  return { root, documents, consentTexts, write };
}

describe('legalReleaseProblems (scripts/legal/check-legal-release.mjs)', () => {
  it('refuses today\'s drafts: draft ids, no effective date, 【要記入】 and 【要確認】 left', async () => {
    const problems = await legalReleaseProblems();
    const text = problems.join('\n');
    for (const name of LEGAL_DOCUMENT_NAMES) {
      assert.match(text, new RegExp(`${name}: the current version ${LEGAL_DOCUMENTS[name].version} is a draft`));
      assert.match(text, new RegExp(`${name}: effectiveDate is not set`));
      assert.match(text, new RegExp(`${LEGAL_DOCUMENTS[name].generated.replace(/\./g, '\\.')}: \\d+ × 【要記入】`));
      assert.match(text, new RegExp(`${LEGAL_DOCUMENTS[name].generated.replace(/\./g, '\\.')}: \\d+ × 【要確認】`));
    }
    // The committed texts are up to date and pinned (legalText.test.js), and the consent archive exists.
    assert.doesNotMatch(text, /out of date|does not match the pinned|consent text/);
  });

  it('passes a clean released fixture; 下書き in the body is not a problem', async () => {
    const { root, documents, consentTexts } = cleanFixture();
    try {
      assert.match(fs.readFileSync(path.join(root, documents.terms.generated), 'utf8'), /下書きという言葉/);
      assert.deepEqual(await legalReleaseProblems({ root, documents, history: [], consentTexts }), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports each broken part of the fixture', async () => {
    const { root, documents, consentTexts, write } = cleanFixture();
    const check = (overrides) => legalReleaseProblems({ root, documents, history: [], consentTexts, ...overrides });
    try {
      // A draft id, or a released id without its date.
      assert.match((await check({ documents: { ...documents, terms: { ...documents.terms, version: 'terms-draft-2026-12-01' } } })).join('\n'), /terms: the current version terms-draft-2026-12-01 is a draft/);
      assert.match((await check({ documents: { ...documents, terms: { ...documents.terms, effectiveDate: '2027-01-01' } } })).join('\n'), /does not carry its effective date 2027-01-01/);
      assert.match((await check({ documents: { ...documents, terms: { ...documents.terms, effectiveDate: null } } })).join('\n'), /terms: effectiveDate is not set/);
      // requiresAcceptance not a boolean.
      assert.match((await check({ documents: { ...documents, privacy: { ...documents.privacy, requiresAcceptance: 'yes' } } })).join('\n'), /privacy: requiresAcceptance must be true or false/);
      // A wrong pin.
      assert.match((await check({ documents: { ...documents, privacy: { ...documents.privacy, sha256: sha256('x') } } })).join('\n'), /privacy: content\/legal\/privacy\.ja\.md does not match the pinned sha256/);
      // A history entry without its archive.
      const history = [{ document: 'terms', version: 'terms-2026-06-01', sha256: sha256('old'), effectiveDate: '2026-06-01', requiresAcceptance: true }];
      assert.match((await check({ history })).join('\n'), /LEGAL_HISTORY terms-2026-06-01: the released version terms-2026-06-01 has no archive file/);
      // A missing consent archive.
      assert.match((await check({ consentTexts: { ...consentTexts, 'guardian-ai-2027-01': { sha256: sha256('y'), file: 'content/legal/archive/guardian-ai-2027-01.ja.md' } } })).join('\n'), /consent text guardian-ai-2027-01: content\/legal\/archive\/guardian-ai-2027-01\.ja\.md is missing/);
      // A changed consent archive.
      write('content/legal/archive/guardian-ai-2026-10.ja.md', '同意の文（直した）\n');
      assert.match((await check({})).join('\n'), /consent text guardian-ai-2026-10: .* does not match its pinned sha256/);
      write('content/legal/archive/guardian-ai-2026-10.ja.md', '同意の文\n');
      // A missing archive of the current version.
      fs.rmSync(path.join(root, 'content/legal/archive/terms-2026-12-01.ja.md'));
      assert.match((await check({})).join('\n'), /terms: the released version terms-2026-12-01 has no archive file content\/legal\/archive\/terms-2026-12-01\.ja\.md/);
      write('content/legal/archive/terms-2026-12-01.ja.md', fs.readFileSync(path.join(root, documents.terms.generated)));
      // A draft edited after generation (out of date), and a marker left in the text.
      write(documents.privacy.source, CLEAN_DRAFT('privacy').replace('本文です。', '本文です。【要確認: 弁護士】'));
      const problems = (await check({})).join('\n');
      assert.match(problems, /privacy: content\/legal\/privacy\.ja\.md is out of date with doc\/legal\/privacy-policy\.draft\.ja\.md/);
      write(documents.privacy.generated, publicLegalText(CLEAN_DRAFT('privacy').replace('本文です。', '本文です。【要確認: 弁護士】'), documents.privacy.include, { document: 'privacy', source: documents.privacy.source }));
      assert.match((await check({})).join('\n'), /content\/legal\/privacy\.ja\.md: 1 × 【要確認】 left to check/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('vite.config.ts legal-release-guard', () => {
  const ENV_KEYS = ['VITE_FEATURE_LEGAL_PAGES', 'NODE_ENV', 'VITE_USER_NODE_ENV', 'LEGAL_DRAFT_PREVIEW_BUILD'];
  const setEnv = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  /**
   * Resolves vite.config.ts the way `vite build` does (command 'build', mode and NODE_ENV
   * 'production' unless NODE_ENV is set; Vite bundles the config with check-legal-release.mjs and
   * calls every plugin's configResolved), then calls the guard's buildStart with a fake plugin
   * context whose error() throws like Rollup's. process.env wins over .env files in loadEnv, so each
   * case sets the flag explicitly; every variable is put back afterwards.
   */
  async function runGuard(value, { nodeEnv, draftPreview } = {}) {
    const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    setEnv('VITE_FEATURE_LEGAL_PAGES', value);
    setEnv('NODE_ENV', nodeEnv);
    setEnv('VITE_USER_NODE_ENV', undefined);
    setEnv('LEGAL_DRAFT_PREVIEW_BUILD', draftPreview);
    try {
      const { resolveConfig } = await import('vite');
      const config = await resolveConfig({ configFile: path.join(ROOT, 'vite.config.ts'), root: ROOT, logLevel: 'silent' }, 'build', 'production', 'production');
      const plugin = config.plugins.find((p) => p && p.name === 'legal-release-guard');
      assert.ok(plugin, 'the plugin is registered');
      assert.equal(plugin.apply, 'build', 'never in the dev server');
      const errors = [];
      try {
        await plugin.buildStart.call({
          error: (message) => {
            errors.push(message);
            throw new Error(message);
          },
        });
      } catch (error) {
        if (!errors.length) throw error;
      }
      return { errors, clientDev: config.env.DEV };
    } finally {
      for (const key of ENV_KEYS) setEnv(key, saved[key]);
    }
  }

  it('stops a build with VITE_FEATURE_LEGAL_PAGES=true while the text is a draft, with the list', async () => {
    const { errors, clientDev } = await runGuard('true');
    assert.equal(clientDev, false, 'a production client');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^VITE_FEATURE_LEGAL_PAGES=true but the legal text is not publishable:\n- /);
    assert.match(errors[0], /terms: the current version terms-draft-[\d.-]+ is a draft/);
    assert.match(errors[0], /× 【要記入】/);
  });

  it('does nothing when the flag is not exactly "true"', async () => {
    for (const value of ['', 'false', 'TRUE', '1']) assert.deepEqual((await runGuard(value)).errors, [], JSON.stringify(value));
  });

  it('stops a build whose client gets import.meta.env.DEV = true, flag or not (round 1, issue 6)', async () => {
    for (const value of [undefined, 'false', 'true']) {
      const { errors, clientDev } = await runGuard(value, { nodeEnv: 'development' });
      assert.equal(clientDev, true, 'NODE_ENV=development gives the client DEV = true (the draft branch of lazyRoutes.tsx)');
      assert.equal(errors.length, 1, JSON.stringify(value));
      assert.match(errors[0], /^This build gives the client import\.meta\.env\.DEV = true \(NODE_ENV=development\), so \/terms and \/privacy would ship the draft legal text\./);
      assert.match(errors[0], /LEGAL_DRAFT_PREVIEW_BUILD=true for a local draft preview/);
    }
    // Only exactly "true" opts in; the opt-in never skips the release check of a flag-on build.
    assert.equal((await runGuard(undefined, { nodeEnv: 'development', draftPreview: '1' })).errors.length, 1);
    assert.deepEqual((await runGuard(undefined, { nodeEnv: 'development', draftPreview: 'true' })).errors, []);
    const flagOn = (await runGuard('true', { nodeEnv: 'development', draftPreview: 'true' })).errors;
    assert.equal(flagOn.length, 1);
    assert.match(flagOn[0], /^VITE_FEATURE_LEGAL_PAGES=true but the legal text is not publishable:/);
  });
});

describe('.github/workflows/ci.yml', () => {
  const ci = read('.github/workflows/ci.yml');

  it('greps the flag-off production build for the legal text and the draft markers', () => {
    const step = ci.slice(ci.indexOf('- name: Fail if draft legal text reached the bundle'));
    assert.ok(step.length > 0 && ci.includes('- name: Fail if draft legal text reached the bundle'));
    const run = step.slice(0, step.indexOf('\n\n') === -1 ? undefined : step.indexOf('\n\n'));
    for (const marker of ["-e 'risepath-legal-text'", "-e '【要確認'", "-e '公開前に専門家'", "-e '（作成メモ:'", "-e '（根拠:'"]) {
      assert.ok(run.includes(marker), marker);
    }
    assert.match(run, /grep -rlF [^\n]*"\$RUNNER_TEMP\/dist"/);
    assert.match(run, /exit 1/);
    assert.ok(!run.includes("'【要記入"), '【要記入 ships through services/billingRules.ts on purpose');
    assert.ok(ci.indexOf('- name: Fail if a sentinel key reached the bundle') < ci.indexOf('- name: Fail if draft legal text reached the bundle'));
  });

  it('builds with the flag unset', () => {
    assert.doesNotMatch(ci, /VITE_FEATURE_LEGAL_PAGES\s*:/);
  });
});
