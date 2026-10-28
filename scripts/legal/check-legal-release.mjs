// @ts-check
/**
 * Release guard for the legal pages (Phase 4, design §2.5). legalReleaseProblems() lists every
 * reason the current legal texts may not be published; an empty list means publishable.
 *
 * vite.config.ts calls it at the start of every production build with VITE_FEATURE_LEGAL_PAGES=true
 * (Vercel included: loadEnv also reads process.env) and fails the build with the list, so a draft
 * can never reach a public page. By hand:
 *
 *   node scripts/legal/check-legal-release.mjs     exit 0 publishable, 1 with the list
 *
 * Problems: a marker left in a generated text (legalTextProblems: 【要記入】, 【要確認】, notes,
 * 根拠, the draft banner, fences, relative links); a generated file missing, out of date with its
 * draft or not matching the pinned sha256; a current version that is a draft, has no or a wrong
 * effective date, or a requiresAcceptance that is not a boolean; a released version (current or in
 * LEGAL_HISTORY) without its archive file or with another hash; a CONSENT_TEXTS entry without its
 * file or with another hash.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LegalTextError, legalTextProblems, publicLegalText } from './legalText.mjs';
import {
  CONSENT_TEXTS,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_NAMES,
  LEGAL_HISTORY,
  isDraftLegalVersion,
  legalVersionDocument,
} from '../../shared/legal/versions.js';

/** @typedef {import('../../shared/legal/versions.js').LegalDocumentEntry} LegalDocumentEntry */
/** @typedef {import('../../shared/legal/versions.js').LegalDocumentName} LegalDocumentName */
/** @typedef {import('../../shared/legal/versions.js').LegalHistoryEntry} LegalHistoryEntry */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {Record<string, string>} */
const PROBLEM_LABELS = {
  to_fill: '【要記入】 left to fill in',
  to_check: '【要確認】 left to check',
  note: '作成メモ left',
  basis: '（根拠 …） left',
  draft_banner: 'the draft banner left',
  fence: 'a fence comment left',
  relative_link: 'a relative link left',
};

/** @param {string | Buffer} data */
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** @param {string} file @returns {Promise<Buffer | null>} */
async function readOrNull(file) {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * @param {{
 *   root?: string,
 *   documents?: Readonly<Record<LegalDocumentName, Readonly<LegalDocumentEntry>>>,
 *   history?: readonly Readonly<LegalHistoryEntry>[],
 *   consentTexts?: Readonly<Record<string, Readonly<{ sha256: string, file: string }>>>,
 * }} [options]
 * @returns {Promise<string[]>}
 */
export async function legalReleaseProblems({
  root = REPO_ROOT,
  documents = LEGAL_DOCUMENTS,
  history = LEGAL_HISTORY,
  consentTexts = CONSENT_TEXTS,
} = {}) {
  /** @type {string[]} */
  const problems = [];

  /**
   * @param {string} label
   * @param {string} version
   * @param {string} pinned
   */
  const checkArchive = async (label, version, pinned) => {
    const file = `content/legal/archive/${version}.ja.md`;
    const bytes = await readOrNull(path.join(root, file));
    if (!bytes) problems.push(`${label}: the released version ${version} has no archive file ${file} (node scripts/legal/build-legal-text.mjs --archive)`);
    else if (sha256(bytes) !== pinned) problems.push(`${label}: ${file} does not match the pinned sha256 of ${version}`);
  };

  for (const name of LEGAL_DOCUMENT_NAMES) {
    const entry = documents[name];
    if (!entry) {
      problems.push(`${name}: no entry in shared/legal/versions.js`);
      continue;
    }
    const { version, effectiveDate } = entry;
    if (legalVersionDocument(version) !== name) problems.push(`${name}: the version id "${version}" does not match the pattern for ${name}`);
    if (isDraftLegalVersion(version)) problems.push(`${name}: the current version ${version} is a draft`);
    if (effectiveDate === null || effectiveDate === undefined) {
      problems.push(`${name}: effectiveDate is not set`);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      problems.push(`${name}: effectiveDate "${effectiveDate}" is not YYYY-MM-DD`);
    } else if (!isDraftLegalVersion(version) && !version.startsWith(`${name}-${effectiveDate}`)) {
      problems.push(`${name}: the released version ${version} does not carry its effective date ${effectiveDate}`);
    }
    if (typeof entry.requiresAcceptance !== 'boolean') problems.push(`${name}: requiresAcceptance must be true or false`);

    const generated = await readOrNull(path.join(root, entry.generated));
    if (!generated) {
      problems.push(`${name}: ${entry.generated} is missing (node scripts/legal/build-legal-text.mjs)`);
      continue;
    }
    const text = generated.toString('utf8');
    for (const { kind, count } of legalTextProblems(text)) {
      problems.push(`${entry.generated}: ${count} × ${PROBLEM_LABELS[kind] ?? kind}`);
    }
    if (sha256(generated) !== entry.sha256) problems.push(`${name}: ${entry.generated} does not match the pinned sha256 of ${version}`);

    const source = await readOrNull(path.join(root, entry.source));
    if (!source) {
      problems.push(`${name}: the draft ${entry.source} is missing`);
    } else {
      try {
        const expected = publicLegalText(source.toString('utf8'), entry.include, { document: name, source: entry.source });
        if (expected !== text) problems.push(`${name}: ${entry.generated} is out of date with ${entry.source} (node scripts/legal/build-legal-text.mjs)`);
      } catch (error) {
        if (!(error instanceof LegalTextError)) throw error;
        problems.push(`${name}: ${error.message}`);
      }
    }

    if (!isDraftLegalVersion(version) && effectiveDate) await checkArchive(name, version, entry.sha256);
  }

  for (const entry of history) {
    const label = `LEGAL_HISTORY ${entry.version}`;
    if (legalVersionDocument(entry.version) !== entry.document || isDraftLegalVersion(entry.version)) {
      problems.push(`${label}: not a released ${entry.document} version id`);
    }
    if (typeof entry.requiresAcceptance !== 'boolean') problems.push(`${label}: requiresAcceptance must be true or false`);
    await checkArchive(label, entry.version, entry.sha256);
  }

  for (const [policyVersion, { sha256: pinned, file }] of Object.entries(consentTexts)) {
    const bytes = await readOrNull(path.join(root, file));
    if (!bytes) problems.push(`consent text ${policyVersion}: ${file} is missing`);
    else if (sha256(bytes) !== pinned) problems.push(`consent text ${policyVersion}: ${file} does not match its pinned sha256`);
  }

  return problems;
}

const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  // No top-level await: vite.config.ts bundles this module into the config.
  legalReleaseProblems().then((problems) => {
    if (problems.length) {
      console.error(`The legal text is not publishable:\n- ${problems.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log('The legal text is publishable.');
    }
  }, (error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
