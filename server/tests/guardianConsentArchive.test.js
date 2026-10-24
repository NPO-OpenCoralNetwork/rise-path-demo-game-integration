// Phase 4 (design §3, §8 guardianConsentArchive; finding 16): the guardian AI consent proof keeps
// only the policy version after an account is deleted, so the text of each version must stay
// findable. content/legal/archive/<CONSENT_POLICY_VERSION>.ja.md holds the Japanese consent screen
// text of components/safety/AiAccessSetupView.tsx (the jp copy from consentTitle to agree).
// - Every string literal of that slice appears verbatim in the archive of the current version, in
//   the same order, and the literals (joined by "\n") have the SHA-256 pinned as CONSENT_TEXTS
//   copySha256: the consent copy cannot change (a line added, removed, reordered or reworded) without
//   a new policy version and a new archive file.
// - The archive's SHA-256 is the one in shared/legal/versions.js CONSENT_TEXTS (never edited).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { CONSENT_POLICY_VERSION } from '../safety/access.js';
import { CONSENT_TEXTS } from '../../shared/legal/versions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SCREEN = 'components/safety/AiAccessSetupView.tsx';
const BUMP = 'The guardian consent text changed. Bump CONSENT_POLICY_VERSION (server/safety/access.js and services/aiAccessRules.ts), add content/legal/archive/<new>.ja.md and its hash in CONSENT_TEXTS (sha256, and copySha256 as printed here).';
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** The jp copy of the consent screen, from the `consentTitle:` line to the end of the `agree:` line. */
export function consentSlice(source) {
  const jp = source.indexOf('\n  jp: {');
  assert.ok(jp > 0, `${SCREEN} has a jp copy block`);
  const start = source.indexOf('consentTitle:', jp);
  const agree = source.indexOf('agree:', start);
  assert.ok(start > jp && agree > start, 'the jp copy has consentTitle … agree');
  const end = source.indexOf('\n', agree);
  return source.slice(start, end);
}

/** Every string literal (quotes, or a template without substitutions) of a TypeScript fragment. */
export function stringLiterals(fragment) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, fragment);
  const out = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.StringLiteral || token === ts.SyntaxKind.NoSubstitutionTemplateLiteral) out.push(scanner.getTokenValue());
    if (token === ts.SyntaxKind.TemplateHead) throw new Error('a template with ${…} in the consent copy: archive its parts by hand and extend this test');
  }
  return out;
}

describe('the guardian consent text archive', () => {
  const entry = CONSENT_TEXTS[CONSENT_POLICY_VERSION];

  it('the current policy version has an archive entry, the same in the server and the browser', () => {
    assert.ok(entry, `CONSENT_TEXTS has ${CONSENT_POLICY_VERSION}. ${BUMP}`);
    assert.equal(entry.file, `content/legal/archive/${CONSENT_POLICY_VERSION}.ja.md`);
    assert.match(read('services/aiAccessRules.ts'), new RegExp(`CONSENT_POLICY_VERSION = '${CONSENT_POLICY_VERSION}'`));
  });

  it('every string of the consent screen copy appears verbatim in the archive, in the same order', () => {
    const literals = stringLiterals(consentSlice(read(SCREEN)));
    assert.ok(literals.includes('私はこのお子さまの保護者です。上の内容を読み、お子さまが AI 機能を使うことに同意します。'));
    const archive = read(entry.file);
    const missing = literals.filter((text) => !archive.includes(text));
    assert.deepEqual(missing, [], `${BUMP} Missing from ${entry.file}: ${missing.join(' / ')}`);
    let at = 0;
    const outOfOrder = [];
    for (const text of literals) {
      const found = archive.indexOf(text, at);
      if (found === -1) outOfOrder.push(text);
      else at = found + text.length;
    }
    assert.deepEqual(outOfOrder, [], `${BUMP} Not in the archive's order: ${outOfOrder.join(' / ')}`);
  });

  it('the screen copy is the one pinned for this version: nothing removed, reordered or reworded (round 1, issue 5)', () => {
    const literals = stringLiterals(consentSlice(read(SCREEN)));
    const computed = sha256(literals.join('\n'));
    assert.match(entry.copySha256 ?? '', /^[0-9a-f]{64}$/, `CONSENT_TEXTS['${CONSENT_POLICY_VERSION}'].copySha256`);
    assert.equal(computed, entry.copySha256, `${BUMP} The ${literals.length} strings now hash to ${computed}.`);
  });

  it('the archive file has the pinned hash (written once, never edited)', () => {
    const bytes = fs.readFileSync(path.join(ROOT, entry.file));
    assert.equal(sha256(bytes), entry.sha256, BUMP);
  });

  it('the scanner sees the screen\'s literals, quotes and escapes included', () => {
    assert.deepEqual(stringLiterals("a: 'x\\'y', b: \"z\", c: `w`, d: [ '1', '2' ]"), ["x'y", 'z', 'w', '1', '2']);
  });
});
