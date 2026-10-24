/**
 * Accepting the terms of use in the browser (Phase 4, design §4.2–§4.4): GET and POST
 * /api/v2/user/legal (server/routes/legal.js) through apiFetch, and the sign-up marker.
 *
 * The sign-up marker: the sign-up form's checkbox is ticked before the account exists, and the
 * server records an acceptance only for a real session. So at submit (VITE_FEATURE_LEGAL_PAGES on)
 * AuthContext.signUp calls rememberSignupAcceptance(email) before supabase.auth.signUp. It keeps
 * { emailHash, terms, privacy, at } in localStorage: a SHA-256 of the normalised email, never the
 * email itself (a shared device keeps no other person's address). When the first session of that
 * email on this device finds no acceptance, the gate (components/legal/legalGateClient.ts) records
 * it at once instead of asking again: right after sign-up when confirmation is off, after
 * /auth/callback when it is on. Another device has no marker, so the person is asked once there.
 * The marker counts for 7 days and only for the versions it names. Every storage access is in
 * try/catch (a blocked storage only means the person is asked once more).
 */
import { apiFetch } from './apiClient';
import { normalizeAuthEmail } from './authFormValidation.ts';
import { currentLegalVersions } from '../shared/legal/versions.js';

const PATH = '/user/legal';
export const SIGNUP_ACCEPTANCE_KEY = 'rp:legal:signupAcceptance';
/** A sign-up marker older than this is ignored (and removed). */
export const SIGNUP_ACCEPTANCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type LegalVersions = { terms: string; privacy: string };
export type LegalNotice = { document: 'terms' | 'privacy'; version: string; effectiveDate: string | null };
export type LegalLastAccepted = { termsVersion: string; privacyVersion: string; acceptedAt: string | null };
export type LegalStatus = {
  published: boolean;
  current: LegalVersions;
  accepted: boolean;
  acceptedAt: string | null;
  lastAccepted: LegalLastAccepted | null;
  notice: LegalNotice[];
};
/** 'unavailable': a network error, 404 (an api without this route), 5xx, 401 for another reason, or an answer of another shape. */
export type LegalStatusResult = { kind: 'ok'; status: LegalStatus } | { kind: 'account_deleted' } | { kind: 'unavailable' };
export type AcceptanceResult =
  | { kind: 'accepted'; acceptedAt: string | null }
  | { kind: 'version_mismatch' }
  | { kind: 'not_published' }
  | { kind: 'account_deleted' }
  | { kind: 'failed' };
export type SignupAcceptance = { emailHash: string; terms: string; privacy: string; at: number };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Subtle = Pick<SubtleCrypto, 'digest'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isDocument = (value: unknown): value is 'terms' | 'privacy' => value === 'terms' || value === 'privacy';

function localStorageOrNull(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function subtleOrNull(): Subtle | null {
  try {
    return globalThis.crypto?.subtle ?? null;
  } catch {
    return null;
  }
}

async function jsonOf(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** hex(SHA-256(normalised email)), or null without SubtleCrypto (an insecure context). */
export async function hashEmail(email: string, subtle: Subtle | null = subtleOrNull()): Promise<string | null> {
  if (!subtle || typeof TextEncoder === 'undefined') return null;
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(normalizeAuthEmail(email)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** Writes the sign-up marker for `email` and the current versions. Never throws. */
export async function rememberSignupAcceptance(
  email: string,
  { storage = localStorageOrNull(), now = Date.now(), subtle = subtleOrNull(), versions = currentLegalVersions() }: {
    storage?: StorageLike | null;
    now?: number;
    subtle?: Subtle | null;
    versions?: LegalVersions;
  } = {},
): Promise<void> {
  const emailHash = await hashEmail(email, subtle);
  if (!storage || !emailHash) return;
  const marker: SignupAcceptance = { emailHash, terms: versions.terms, privacy: versions.privacy, at: now };
  try {
    storage.setItem(SIGNUP_ACCEPTANCE_KEY, JSON.stringify(marker));
  } catch {
    // Storage full or blocked: the person is asked once after signing in.
  }
}

/** The marker when it is well formed and at most 7 days old; anything else is removed. */
export function readSignupAcceptance(storage: StorageLike | null = localStorageOrNull(), now = Date.now()): SignupAcceptance | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(SIGNUP_ACCEPTANCE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (
    isRecord(parsed) &&
    isString(parsed.emailHash) &&
    /^[0-9a-f]{64}$/.test(parsed.emailHash) &&
    isString(parsed.terms) &&
    isString(parsed.privacy) &&
    typeof parsed.at === 'number' &&
    Number.isFinite(parsed.at) &&
    parsed.at <= now + 60_000 &&
    now - parsed.at <= SIGNUP_ACCEPTANCE_MAX_AGE_MS
  ) {
    return { emailHash: parsed.emailHash, terms: parsed.terms, privacy: parsed.privacy, at: parsed.at };
  }
  forgetSignupAcceptance(storage);
  return null;
}

/**
 * Supabase's answer to a sign-up with an address that is already registered (email confirmation on):
 * a made-up user with no identities and no session, so nobody can test which addresses have an
 * account. No account was made, so the sign-up marker must go (AuthContext.signUp).
 */
export function signUpMadeNoAccount(user: unknown): boolean {
  return isRecord(user) && Array.isArray(user.identities) && user.identities.length === 0;
}

export function forgetSignupAcceptance(storage: StorageLike | null = localStorageOrNull()): void {
  try {
    storage?.removeItem(SIGNUP_ACCEPTANCE_KEY);
  } catch {
    // Blocked storage: nothing to remove.
  }
}

function readNotice(value: unknown): LegalNotice[] | null {
  if (!Array.isArray(value)) return null;
  const out: LegalNotice[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isDocument(item.document) || !isString(item.version)) return null;
    out.push({ document: item.document, version: item.version, effectiveDate: isString(item.effectiveDate) ? item.effectiveDate : null });
  }
  return out;
}

/** The GET answer → a result (pure; server/tests/legalConsentFront.test.js). */
export function readLegalStatus(httpStatus: number, body: unknown): LegalStatusResult {
  if (httpStatus === 401 && isRecord(body) && body.error_type === 'account_deleted') return { kind: 'account_deleted' };
  if (httpStatus !== 200 || !isRecord(body) || body.ok !== true) return { kind: 'unavailable' };
  const current = body.current;
  const notice = readNotice(body.notice);
  if (!isRecord(current) || !isString(current.terms) || !isString(current.privacy) || typeof body.accepted !== 'boolean' || !notice) {
    return { kind: 'unavailable' };
  }
  const last = body.lastAccepted;
  const lastAccepted: LegalLastAccepted | null =
    isRecord(last) && isString(last.termsVersion) && isString(last.privacyVersion)
      ? { termsVersion: last.termsVersion, privacyVersion: last.privacyVersion, acceptedAt: isString(last.acceptedAt) ? last.acceptedAt : null }
      : null;
  return {
    kind: 'ok',
    status: {
      published: body.published === true,
      current: { terms: current.terms, privacy: current.privacy },
      accepted: body.accepted,
      acceptedAt: isString(body.acceptedAt) ? body.acceptedAt : null,
      lastAccepted,
      notice,
    },
  };
}

/** The POST answer → a result (pure). */
export function readAcceptanceAnswer(httpStatus: number, body: unknown): AcceptanceResult {
  const type = isRecord(body) ? body.error_type : undefined;
  if ((httpStatus === 200 || httpStatus === 201) && isRecord(body) && body.ok === true && body.accepted === true) {
    return { kind: 'accepted', acceptedAt: isString(body.acceptedAt) ? body.acceptedAt : null };
  }
  if (httpStatus === 409 && type === 'legal_version_mismatch') return { kind: 'version_mismatch' };
  if (httpStatus === 409 && type === 'legal_not_published') return { kind: 'not_published' };
  if (httpStatus === 401 && type === 'account_deleted') return { kind: 'account_deleted' };
  return { kind: 'failed' };
}

export async function getLegalStatus(): Promise<LegalStatusResult> {
  try {
    const res = await apiFetch(PATH);
    return readLegalStatus(res.status, await jsonOf(res));
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Records that the person accepted `versions` (the ones they were shown). */
export async function postLegalAcceptance(versions: LegalVersions): Promise<AcceptanceResult> {
  try {
    const res = await apiFetch(`${PATH}/acceptance`, {
      method: 'POST',
      body: JSON.stringify({ termsVersion: versions.terms, privacyVersion: versions.privacy }),
    });
    return readAcceptanceAnswer(res.status, await jsonOf(res));
  } catch {
    return { kind: 'failed' };
  }
}
