// @ts-check
/**
 * Versions of the public legal texts (Phase 4, design §3): what the app shows and what people
 * accept. Imported by the browser (the legal pages, later the consent flow), the server
 * (server/routes/legal.js), the scripts in scripts/legal/ and the tests. No imports, no legal text.
 *
 * Version ids: released `<document>-<YYYY-MM-DD>` (the effective date, e.g. terms-2026-12-01);
 * drafts `<document>-draft-<YYYY-MM-DD>` (the draft date); a further change under the same date
 * appends `.N` (terms-draft-2026-10-22.2). The same pattern is the CHECK of
 * legal_document_versions.version (server/migrations/018_account_deletion_and_legal.sql).
 *
 * When the generated text changes (node scripts/legal/build-legal-text.mjs prints both), change
 * version AND sha256, and add the new pair to LEGAL_PINNED_HASHES (append only: a version id names
 * one text forever, so a reused draft id never meets another text in a database that already holds
 * it); server/tests/legalText.test.js and `build-legal-text.mjs --check` fail until all three agree. A released version
 * also needs its archive file (`node scripts/legal/build-legal-text.mjs --archive`), and when it is
 * replaced, its entry moves to LEGAL_HISTORY (append only) and its archive file stays.
 *
 * requiresAcceptance: true only for the first released terms and for terms changes that need
 * agreement again; false for privacy changes (a purpose change beyond 相当の関連性 is the
 * exception: ask the lawyer) and for editorial changes, which get a notice instead.
 *
 * include: which fenced parts of the draft this version shows (`<!-- legal:if billing -->`,
 * `<!-- legal:if byoa -->`). Opening sales or BYOA later is a new version.
 */

/** @typedef {'terms' | 'privacy'} LegalDocumentName */
/** @typedef {{ billing: boolean, byoa: boolean }} LegalInclude */
/**
 * @typedef {{
 *   version: string, sha256: string, effectiveDate: string | null, requiresAcceptance: boolean,
 *   include: Readonly<LegalInclude>, source: string, generated: string,
 * }} LegalDocumentEntry
 */
/**
 * @typedef {{
 *   document: LegalDocumentName, version: string, sha256: string, effectiveDate: string,
 *   requiresAcceptance: boolean,
 * }} LegalHistoryEntry
 */

export const LEGAL_VERSION_PATTERN = /^(terms|privacy)-(draft-)?\d{4}-\d{2}-\d{2}(\.\d{1,2})?$/;

/** @type {readonly LegalDocumentName[]} */
export const LEGAL_DOCUMENT_NAMES = Object.freeze(/** @type {LegalDocumentName[]} */ (['terms', 'privacy']));

/** @type {Readonly<Record<LegalDocumentName, Readonly<LegalDocumentEntry>>>} */
export const LEGAL_DOCUMENTS = Object.freeze({
  terms: Object.freeze({
    version: 'terms-draft-2026-10-22.2',
    sha256: 'c0cdc61708f43945b9bd0d7782124b3da272d3163fa679ffd2292be57d05e81d',
    effectiveDate: null,
    requiresAcceptance: true,
    include: Object.freeze({ billing: false, byoa: false }),
    source: 'doc/legal/terms-of-use.draft.ja.md',
    generated: 'content/legal/terms.ja.md',
  }),
  privacy: Object.freeze({
    version: 'privacy-draft-2026-10-22.3',
    sha256: '059e634bafd05491fdf59a93bf416967e7a9ca6ad4977dd3c8c5e494656b7535',
    effectiveDate: null,
    requiresAcceptance: false,
    include: Object.freeze({ billing: false, byoa: false }),
    source: 'doc/legal/privacy-policy.draft.ja.md',
    generated: 'content/legal/privacy.ja.md',
  }),
});

/**
 * Every version id ever pinned (current, history and earlier drafts), with its text's sha256.
 * Append only: a visible change gets a new id and a new line here, never a new hash for an old id.
 * @type {Readonly<Record<string, string>>}
 */
export const LEGAL_PINNED_HASHES = Object.freeze({
  'terms-draft-2026-10-22.2': 'c0cdc61708f43945b9bd0d7782124b3da272d3163fa679ffd2292be57d05e81d',
  'privacy-draft-2026-10-22.2': '4ff97adbf90a4886a59bbe8022569460e88233cd1e77eef9a6ddf89d5a29122d',
  'privacy-draft-2026-10-22.3': '059e634bafd05491fdf59a93bf416967e7a9ca6ad4977dd3c8c5e494656b7535',
});

/**
 * Released versions that are no longer current, oldest first (append only).
 * @type {readonly Readonly<LegalHistoryEntry>[]}
 */
export const LEGAL_HISTORY = Object.freeze([]);

/**
 * Guardian AI consent texts by account_consents.policy_version (CONSENT_POLICY_VERSION in
 * server/safety/access.js and services/aiAccessRules.ts), archived once by hand from the consent
 * screen copy (components/safety/AiAccessSetupView.tsx) and never edited
 * (server/tests/guardianConsentArchive.test.js). sha256 is the archive file's; copySha256 pins the
 * screen copy itself (its jp string literals from consentTitle to agree, in order, joined by "\n"),
 * so a removed, reordered or reworded line on the screen needs a new policy version too.
 * @type {Readonly<Record<string, Readonly<{ sha256: string, copySha256: string, file: string }>>>}
 */
export const CONSENT_TEXTS = Object.freeze({
  'guardian-ai-2026-10': Object.freeze({
    sha256: 'c6351868022036f82bd34427472cc9bf3b7f4f8ace04e766b707a4d0907f3340',
    copySha256: 'a3f2f862aaa1159047a6440b710b3ba5c81fc8937158c602e47e86d9e45fdcc5',
    file: 'content/legal/archive/guardian-ai-2026-10.ja.md',
  }),
});

/** @param {unknown} version */
export const isDraftLegalVersion = (version) => typeof version === 'string' && version.includes('-draft-');

/**
 * The document a version id belongs to, or null when it does not match LEGAL_VERSION_PATTERN.
 * @param {unknown} version
 * @returns {LegalDocumentName | null}
 */
export function legalVersionDocument(version) {
  if (typeof version !== 'string') return null;
  const match = LEGAL_VERSION_PATTERN.exec(version);
  return match ? /** @type {LegalDocumentName} */ (match[1]) : null;
}

/** The current version of each document. */
export const currentLegalVersions = () => ({ terms: LEGAL_DOCUMENTS.terms.version, privacy: LEGAL_DOCUMENTS.privacy.version });

/**
 * The versions of a document that an acceptance may name and still count: from the newest version
 * (history or current) whose requiresAcceptance is true, up to the current one. null when no version
 * ever required acceptance (then any accepted version counts).
 * @param {LegalDocumentName} document
 * @param {{ documents?: Readonly<Record<LegalDocumentName, Readonly<LegalDocumentEntry>>>, history?: readonly Readonly<LegalHistoryEntry>[] }} [sources]
 * @returns {string[] | null}
 */
export function acceptableLegalVersions(document, { documents = LEGAL_DOCUMENTS, history = LEGAL_HISTORY } = {}) {
  const current = documents[document];
  if (!current) return null;
  const chain = [
    ...history.filter((entry) => entry.document === document).map((entry) => ({ version: entry.version, requiresAcceptance: entry.requiresAcceptance })),
    { version: current.version, requiresAcceptance: current.requiresAcceptance },
  ];
  let start = -1;
  chain.forEach((entry, i) => {
    if (entry.requiresAcceptance === true) start = i;
  });
  return start === -1 ? null : chain.slice(start).map((entry) => entry.version);
}

/**
 * The documents whose last accepted version no longer counts (acceptableLegalVersions), in
 * LEGAL_DOCUMENT_NAMES order: what the re-consent page says changed. [] without a last acceptance
 * (a first agreement). The page may use the bundle's tables: the gate is `unavailable` whenever the
 * server's current versions differ from them.
 * @param {{ termsVersion?: unknown, privacyVersion?: unknown } | null | undefined} lastAccepted
 * @param {{ documents?: Readonly<Record<LegalDocumentName, Readonly<LegalDocumentEntry>>>, history?: readonly Readonly<LegalHistoryEntry>[] }} [sources]
 * @returns {LegalDocumentName[]}
 */
export function documentsToAcceptAgain(lastAccepted, sources) {
  if (!lastAccepted) return [];
  const accepted = { terms: lastAccepted.termsVersion, privacy: lastAccepted.privacyVersion };
  return LEGAL_DOCUMENT_NAMES.filter((document) => {
    const ok = acceptableLegalVersions(document, sources);
    return ok !== null && !ok.includes(/** @type {string} */ (accepted[document]));
  });
}
