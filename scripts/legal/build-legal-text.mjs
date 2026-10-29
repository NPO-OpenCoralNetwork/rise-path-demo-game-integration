#!/usr/bin/env node
// @ts-check
/**
 * Writes the public legal texts from the drafts (Phase 4, design §2.2, §3):
 *
 *   doc/legal/terms-of-use.draft.ja.md   → content/legal/terms.ja.md
 *   doc/legal/privacy-policy.draft.ja.md → content/legal/privacy.ja.md
 *
 * with the rules of scripts/legal/legalText.mjs and the `include` of each document in
 * shared/legal/versions.js. The generated files are committed and never edited by hand; only
 * components/features/legal/TermsPage.tsx and PrivacyPage.tsx import them.
 *
 *   node scripts/legal/build-legal-text.mjs            write both files, print each SHA-256; when it
 *                                                      differs from the pinned one, say which version
 *                                                      id and sha256 to put in shared/legal/versions.js
 *   node scripts/legal/build-legal-text.mjs --check    write nothing; exit 1 when a file is out of
 *                                                      date, its hash is not the pinned one, or its
 *                                                      version id is pinned to another text
 *                                                      (LEGAL_PINNED_HASHES)
 *   node scripts/legal/build-legal-text.mjs --archive  for a released current version: write
 *                                                      content/legal/archive/<version>.ja.md (the same
 *                                                      bytes); never overwrites another text
 *
 * Exit: 0 done, 1 drift / refusal / a draft error (the message names file:line).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LegalTextError, publicLegalText } from './legalText.mjs';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_NAMES, LEGAL_PINNED_HASHES, isDraftLegalVersion } from '../../shared/legal/versions.js';

/** @typedef {import('../../shared/legal/versions.js').LegalDocumentEntry} LegalDocumentEntry */
/** @typedef {import('../../shared/legal/versions.js').LegalDocumentName} LegalDocumentName */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ARCHIVE_DIR = 'content/legal/archive';

/** @param {string | Buffer} data */
export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** @param {string} version */
export const archivePathOf = (version) => `${ARCHIVE_DIR}/${version}.ja.md`;

/**
 * The version id to use after a change of the public text: a draft gets the next `.N` under its
 * date; a released text gets its new effective date (unknown here).
 * @param {string} version
 */
export function nextLegalVersion(version) {
  if (!isDraftLegalVersion(version)) return `${version.replace(/-\d{4}-\d{2}-\d{2}(\.\d{1,2})?$/, '')}-<new effective date YYYY-MM-DD>`;
  const match = /^(.*?)(?:\.(\d{1,2}))?$/.exec(version);
  const base = match?.[1] ?? version;
  const next = match?.[2] ? Number(match[2]) + 1 : 2;
  return `${base}.${next}`;
}

/**
 * The message for a public text that does not match its pin.
 * @param {LegalDocumentName} name
 * @param {LegalDocumentEntry} entry
 * @param {string} computed
 */
export function bumpMessage(name, entry, computed) {
  const draft = isDraftLegalVersion(entry.version);
  const nextDraft = draft ? nextLegalVersion(entry.version) : `${name}-draft-<YYYY-MM-DD>`;
  return [
    `The public text of ${name} changed. Give it a new version in shared/legal/versions.js`,
    `(a draft: ${nextDraft}; a released text: the new effective date),`,
    `set sha256 to ${computed}, add the new version and sha256 to LEGAL_PINNED_HASHES, and decide requiresAcceptance.`,
    'For a released version, move the old entry to LEGAL_HISTORY and keep',
    `${draft ? `${ARCHIVE_DIR}/<old>.ja.md` : archivePathOf(entry.version)}.`,
  ].join(' ');
}

/**
 * The message for a version id that LEGAL_PINNED_HASHES does not pin to its sha256 (a reused id,
 * or a new one not added yet), or null when it does.
 * @param {LegalDocumentName} name @param {LegalDocumentEntry} entry @param {Readonly<Record<string, string>>} pinnedHashes
 */
export function pinMapMessage(name, entry, pinnedHashes) {
  const pinned = pinnedHashes[entry.version];
  if (pinned === entry.sha256) return null;
  if (pinned === undefined) return `${name}: ${entry.version} is not in LEGAL_PINNED_HASHES (shared/legal/versions.js): add '${entry.version}': '${entry.sha256}'.`;
  return `${name}: ${entry.version} names another text in LEGAL_PINNED_HASHES (sha256 ${pinned}); a version id names one text forever. `
    + `Give this text a new version (a draft: ${nextLegalVersion(entry.version)}) and add it to LEGAL_PINNED_HASHES.`;
}

/**
 * Regenerates each document and compares it with the committed file and the pin (pinned: the hash
 * is the entry's, and LEGAL_PINNED_HASHES pins the entry's version id to that hash).
 * @param {{ root?: string, documents?: Readonly<Record<LegalDocumentName, Readonly<LegalDocumentEntry>>>, pinnedHashes?: Readonly<Record<string, string>> }} [options]
 */
export function legalTextStatus({ root = REPO_ROOT, documents = LEGAL_DOCUMENTS, pinnedHashes = LEGAL_PINNED_HASHES } = {}) {
  return LEGAL_DOCUMENT_NAMES.map((name) => {
    const entry = documents[name];
    const raw = fs.readFileSync(path.join(root, entry.source), 'utf8');
    const text = publicLegalText(raw, entry.include, { document: name, source: entry.source });
    const generatedFile = path.join(root, entry.generated);
    const committed = fs.existsSync(generatedFile) ? fs.readFileSync(generatedFile, 'utf8') : null;
    const computed = sha256(text);
    return {
      name,
      entry,
      text,
      sha256: computed,
      upToDate: committed === text,
      pinned: computed === entry.sha256 && pinnedHashes[entry.version] === entry.sha256,
      pinMessage: computed === entry.sha256 ? pinMapMessage(name, entry, pinnedHashes) : bumpMessage(name, entry, computed),
    };
  });
}

/**
 * @param {string[]} argv
 * @param {{ root?: string, documents?: Readonly<Record<LegalDocumentName, Readonly<LegalDocumentEntry>>>,
 *   pinnedHashes?: Readonly<Record<string, string>>, out?: (line: string) => void, err?: (line: string) => void }} [deps]
 * @returns {number} exit code
 */
export function run(argv, { root = REPO_ROOT, documents = LEGAL_DOCUMENTS, pinnedHashes = LEGAL_PINNED_HASHES, out = console.log, err = console.error } = {}) {
  const known = new Set(['--check', '--archive']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length) {
    err(`Unknown option ${unknown.join(' ')}. Use --check or --archive (see the top of scripts/legal/build-legal-text.mjs).`);
    return 1;
  }
  const check = argv.includes('--check');
  const archive = argv.includes('--archive');
  if (check && archive) {
    err('Use --check or --archive, not both.');
    return 1;
  }

  /** @type {ReturnType<typeof legalTextStatus>} */
  let status;
  try {
    status = legalTextStatus({ root, documents, pinnedHashes });
  } catch (error) {
    if (error instanceof LegalTextError) {
      err(`Cannot build the legal text: ${error.message}`);
      return 1;
    }
    throw error;
  }

  if (check) {
    let ok = true;
    for (const s of status) {
      if (!s.upToDate) {
        ok = false;
        err(`${s.entry.generated} is out of date with ${s.entry.source}: run node scripts/legal/build-legal-text.mjs.`);
      }
      if (!s.pinned) {
        ok = false;
        err(s.pinMessage ?? bumpMessage(s.name, s.entry, s.sha256));
      }
      if (s.upToDate && s.pinned) out(`${s.name}: ${s.entry.generated} is up to date (${s.entry.version}, sha256 ${s.sha256}).`);
    }
    return ok ? 0 : 1;
  }

  if (archive) {
    let code = 0;
    for (const s of status) {
      const { version, effectiveDate } = s.entry;
      if (isDraftLegalVersion(version) || !effectiveDate) {
        out(`${s.name}: ${version} is not released; drafts are not archived.`);
        continue;
      }
      if (!s.upToDate || !s.pinned) {
        err(`${s.name}: ${s.entry.generated} must be up to date and match the pinned sha256 before it is archived (run node scripts/legal/build-legal-text.mjs).`);
        code = 1;
        continue;
      }
      const target = path.join(root, archivePathOf(version));
      if (fs.existsSync(target)) {
        if (sha256(fs.readFileSync(target)) === s.sha256) {
          out(`${s.name}: ${archivePathOf(version)} is already archived.`);
        } else {
          err(`${s.name}: ${archivePathOf(version)} exists with another text; an archived text is never overwritten. Give the new text a new version.`);
          code = 1;
        }
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, s.text);
      out(`${s.name}: wrote ${archivePathOf(version)} (sha256 ${s.sha256}).`);
    }
    return code;
  }

  for (const s of status) {
    if (!s.upToDate) {
      const target = path.join(root, s.entry.generated);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, s.text);
    }
    out(`${s.name}: ${s.upToDate ? 'unchanged' : 'wrote'} ${s.entry.generated} (sha256 ${s.sha256}).`);
    if (!s.pinned) out(`  ${s.pinMessage ?? bumpMessage(s.name, s.entry, s.sha256)}`);
  }
  return 0;
}

const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) process.exitCode = run(process.argv.slice(2));
