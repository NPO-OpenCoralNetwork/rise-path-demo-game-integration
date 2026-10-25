/**
 * Deleting one's own Rise Path account from Settings (Phase 4, owner decisions D1–D3, design
 * §5.11): GET and POST /api/v2/user/account/deletion (server/routes/account.js) through apiFetch.
 *
 * deleteAccount() runs the whole flow, in this order (finding 15):
 *   1. markDeletionInFlight() (services/accountDeletionState.ts), before any network call: a
 *      background request of this tab that gets 401 account_deleted after the deletion committed
 *      no longer starts the "deleted elsewhere" flow, whose page change would abort steps 6–7;
 *   2. a password sign-in with an ephemeral client (createReauthClient: nothing stored, not the
 *      app's session), at most REAUTH_SIGN_IN_WAIT_MS (a Supabase that never answers: "can't
 *      delete right now", nothing sent); a wrong password or another account's session stops here;
 *   3. the POST with that sign-in's token (the server wants a password sign-in ≤ 120 s old) and
 *      the names of the AI apps the account used, as Supabase's listGrants shows them
 *      (deletionAppNames: the remote MCP server knows an app only by id, so the kept provision
 *      record would otherwise have no name);
 *   4. the ephemeral session is signed out (scope 'local'), whatever happened;
 *   5. the outcome: 200 → deleted here ('self', with the time); 401 account_deleted to this POST
 *      (a second request after the first one committed) → 'self' too; anything else →
 *      clearDeletionInFlight(), and a signal held meanwhile means the account was deleted
 *      elsewhere at the same time ('other', the app's listener takes over), else the error
 *      ("nothing was deleted" only for the api's own refusals; a 5xx or timeout page without an
 *      api error_type says to reload and check);
 *   6. 'self' only: Rise Path's own MCP clients' grants are revoked at Supabase (best effort, at
 *      most 5 s; never other grants of the shared project; a revoke that throws is ignored);
 *   7. 'self' only: AuthContext.endDeletedAccountSession({ by: 'self', at }).
 */
import { apiFetch } from './apiClient';
import { createReauthClient, getSupabaseClient } from './supabaseClient';
import { clearDeletionInFlight, markDeletionInFlight, type DeletedBy } from './accountDeletionState';
import { listConnectedAppRecords, listSupabaseGrants } from './connectedAppsApi';
import { revocationClientName, type ConnectedAppRecord, type SupabaseGrantLike } from './oauthConsentRules';

const PATH = '/user/account/deletion';
/** The body word server/routes/account.js wants (CONFIRM_WORD). */
export const CONFIRM_WORD = 'delete-my-account';
/**
 * The POST may take a while (Stripe checks before, re-checks after: server/routes/account.js). A
 * request cut off after this long may still have deleted the account: the page says to reload.
 */
export const DELETION_REQUEST_TIMEOUT_MS = 120_000;
/** Revoking the AI apps' grants after a deletion waits at most this long. */
export const GRANT_REVOKE_WAIT_MS = 5_000;
/** Signing the ephemeral session out waits at most this long. */
export const REAUTH_SIGN_OUT_WAIT_MS = 3_000;
/** The password sign-in waits at most this long (well inside the server's 120 s re-auth window). */
export const REAUTH_SIGN_IN_WAIT_MS = 30_000;

/** The waits of steps 2–4 (tests pass short ones). */
export type DeletionWaits = { requestTimeoutMs?: number; signOutWaitMs?: number; signInWaitMs?: number };

/** The most app names sent with the deletion (server/routes/account.js takes as many). */
export const DELETION_APP_NAMES_MAX = 20;
export type DeletionAppName = { clientId: string; clientName: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DeletionSubscription = 'none' | 'renewing' | 'ending';
export type DeletionPreflight = { enabled: boolean; subscription: DeletionSubscription; reauthWindowSeconds: number };
/** 'unavailable': 404 (an api without this route), a network error, 5xx, or an answer of another shape. */
export type PreflightResult = { kind: 'ready'; preflight: DeletionPreflight } | { kind: 'unavailable' };

export type DeletionErrorKind =
  | 'wrong_password'
  | 'reauth_required'
  | 'subscription_active'
  | 'payment_provider_unavailable'
  | 'memory_service_unavailable'
  | 'deletion_disabled'
  | 'rate_limited'
  | 'unavailable'
  | 'connection_lost';

export type DeletionOutcome =
  | { kind: 'self'; deletedAt: string | null }
  | { kind: 'other' }
  | { kind: 'error'; error: DeletionErrorKind; memoryDeleted: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function jsonOf(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** The preflight's answer → what the page shows (pure; server/tests/accountDeletionFront.test.js). */
export function readPreflight(status: number, body: unknown): PreflightResult {
  if (status !== 200 || !isRecord(body) || body.ok !== true || typeof body.enabled !== 'boolean') return { kind: 'unavailable' };
  const subscription = body.subscription;
  if (subscription !== 'none' && subscription !== 'renewing' && subscription !== 'ending') return { kind: 'unavailable' };
  const seconds = Number(body.reauthWindowSeconds);
  return {
    kind: 'ready',
    preflight: { enabled: body.enabled, subscription, reauthWindowSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 120 },
  };
}

export async function getDeletionPreflight(signal?: AbortSignal): Promise<PreflightResult> {
  let res: Response;
  try {
    res = await apiFetch(PATH, { signal });
  } catch {
    return { kind: 'unavailable' };
  }
  return readPreflight(res.status, await jsonOf(res));
}

/** Rise Path's MCP clients this account used (GET /user/connected-apps), or null when unknown. */
export async function getConnectedAppRecords(signal?: AbortSignal): Promise<ConnectedAppRecord[] | null> {
  try {
    return await listConnectedAppRecords(signal);
  } catch {
    return null;
  }
}

/** Supabase's grants of this login (the apps' names), or null when they could not be read. */
export async function getSupabaseGrants(): Promise<SupabaseGrantLike[] | null> {
  try {
    return await listSupabaseGrants();
  } catch {
    return null;
  }
}

/** Records an AI app was really used with (the server keeps those 3 years: ai_app_provision_records). */
export const usedConnectedApps = (records: readonly ConnectedAppRecord[] | null): ConnectedAppRecord[] =>
  (records ?? []).filter((record) => Boolean(record.firstSeenAt || record.lastUsedAt));

/**
 * The names to send with the deletion (pure): for each used record without a stored name (only
 * the revoke route stores one), the name Supabase's listGrants gives that client, trimmed and
 * capped like a revocation's; only Rise Path's own clients (the records), UUID ids, at most
 * DELETION_APP_NAMES_MAX. A stored name wins on the server anyway.
 */
export function deletionAppNames(
  records: readonly ConnectedAppRecord[] | null,
  grants: readonly SupabaseGrantLike[] | null,
): DeletionAppName[] {
  const names = new Map<string, string>();
  for (const grant of grants ?? []) {
    const id = typeof grant?.client?.id === 'string' ? grant.client.id.toLowerCase() : '';
    const name = revocationClientName(grant?.client?.name);
    if (UUID.test(id) && name && !names.has(id)) names.set(id, name);
  }
  const out: DeletionAppName[] = [];
  const seen = new Set<string>();
  for (const record of usedConnectedApps(records)) {
    const id = typeof record.clientId === 'string' ? record.clientId.toLowerCase() : '';
    const name = names.get(id);
    if (!name || seen.has(id) || (typeof record.clientName === 'string' && record.clientName)) continue;
    seen.add(id);
    out.push({ clientId: id, clientName: name });
    if (out.length >= DELETION_APP_NAMES_MAX) break;
  }
  return out;
}

const memoryDeletedOf = (body: unknown) => isRecord(body) && body.memory_deleted === true;
const isoOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** The POST's answer → the outcome before the held signal is looked at (pure). */
export function readDeletionAnswer(status: number, body: unknown): DeletionOutcome {
  const errorType = isRecord(body) && typeof body.error_type === 'string' ? body.error_type : null;
  const memoryDeleted = memoryDeletedOf(body);
  const fail = (error: DeletionErrorKind): DeletionOutcome => ({ kind: 'error', error, memoryDeleted });
  if (status === 200 && isRecord(body) && body.ok === true && body.status === 'deleted') {
    return { kind: 'self', deletedAt: isoOrNull(body.deletedAt) };
  }
  // A second request after the first one committed (a double click, a retry after a timeout).
  if (status === 401 && errorType === 'account_deleted') return { kind: 'self', deletedAt: null };
  switch (errorType) {
    case 'reauth_required':
    case 'subscription_active':
    case 'payment_provider_unavailable':
    case 'memory_service_unavailable':
    case 'deletion_disabled':
    case 'rate_limited':
      return fail(errorType);
    case 'account_busy':
    case 'deletion_unavailable':
    case 'auth_unavailable':
      return fail('unavailable');
    default:
      break;
  }
  if (status === 429) return fail('rate_limited');
  // Not the api's own refusal (no error_type): a 200 that is not its answer, a timeout (408) or any
  // 5xx (a gateway, proxy or CDN page such as Vercel's or Cloudflare's 500, 502, 503, 504, 520,
  // 523). The POST may have reached the api and finished: reload to see. A 4xx without an
  // error_type (404 from an api without the route, a firewall's 403) refused the request before
  // anything ran: nothing was deleted.
  if (status === 200 || (!errorType && (status === 408 || status >= 500))) return fail('connection_lost');
  return fail('unavailable');
}

type AuthErrorLike = { code?: unknown; status?: unknown; message?: unknown } | null | undefined;

/** A failed password sign-in → what to say. */
export function readSignInError(error: AuthErrorLike): DeletionErrorKind {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'invalid_credentials' || (error?.status === 400 && /invalid login credentials/i.test(String(error?.message ?? '')))) {
    return 'wrong_password';
  }
  if (error?.status === 429 || code === 'over_request_rate_limit') return 'rate_limited';
  return 'unavailable';
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const SIGN_IN_TIMED_OUT = Symbol('signInTimedOut');

type DeletionInput = { email: string; userId: string; password: string; apps?: readonly DeletionAppName[] };

async function attempt(
  { email, userId, password, apps = [] }: DeletionInput,
  { requestTimeoutMs, signOutWaitMs, signInWaitMs }: Required<DeletionWaits>,
): Promise<DeletionOutcome> {
  const reauth = createReauthClient();
  if (!reauth) return { kind: 'error', error: 'unavailable', memoryDeleted: false };
  try {
    let token: string | null = null;
    try {
      // A Supabase that takes the connection and never answers (a captive portal, an outage) would
      // keep the dialog busy for good: cut off, nothing was sent.
      const signIn = reauth.auth.signInWithPassword({ email, password });
      let signInTimer: ReturnType<typeof setTimeout> | undefined;
      const signInResult = await Promise.race([
        signIn,
        new Promise<typeof SIGN_IN_TIMED_OUT>((resolve) => {
          signInTimer = setTimeout(() => resolve(SIGN_IN_TIMED_OUT), signInWaitMs);
        }),
      ]).finally(() => clearTimeout(signInTimer));
      if (signInResult === SIGN_IN_TIMED_OUT) {
        // A sign-in that still succeeds later leaves no session behind at Supabase.
        void signIn.then((late) => (late?.data?.session ? reauth.auth.signOut({ scope: 'local' }) : undefined)).catch(() => undefined);
        return { kind: 'error', error: 'unavailable', memoryDeleted: false };
      }
      const { data, error } = signInResult;
      if (error) return { kind: 'error', error: readSignInError(error), memoryDeleted: false };
      // Another account's sign-in (a shared device, the wrong email): never send its token.
      const signedIn = data?.session?.user?.id ?? '';
      if (!signedIn || signedIn.toLowerCase() !== userId.toLowerCase()) {
        return { kind: 'error', error: 'reauth_required', memoryDeleted: false };
      }
      token = data.session?.access_token ?? null;
    } catch {
      return { kind: 'error', error: 'unavailable', memoryDeleted: false };
    }
    if (!token) return { kind: 'error', error: 'unavailable', memoryDeleted: false };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await apiFetch(PATH, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(apps.length ? { confirm: CONFIRM_WORD, apps: apps.slice(0, DELETION_APP_NAMES_MAX) } : { confirm: CONFIRM_WORD }),
        signal: controller.signal,
      });
      return readDeletionAnswer(res.status, await jsonOf(res));
    } catch {
      // Sent, then cut off: it may have finished.
      return { kind: 'error', error: 'connection_lost', memoryDeleted: false };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    // Ends only this one session; errors ignored.
    await Promise.race([reauth.auth.signOut({ scope: 'local' }).catch(() => undefined), wait(signOutWaitMs)]);
  }
}

/** Steps 1–5: the password check and the POST, with the "deleted elsewhere" signal held meanwhile. */
export async function deleteAccountWithPassword(
  input: DeletionInput,
  { requestTimeoutMs = DELETION_REQUEST_TIMEOUT_MS, signOutWaitMs = REAUTH_SIGN_OUT_WAIT_MS, signInWaitMs = REAUTH_SIGN_IN_WAIT_MS }: DeletionWaits = {},
): Promise<DeletionOutcome> {
  markDeletionInFlight();
  let outcome: DeletionOutcome;
  try {
    outcome = await attempt(input, { requestTimeoutMs, signOutWaitMs, signInWaitMs });
  } catch {
    outcome = { kind: 'error', error: 'unavailable', memoryDeleted: false };
  }
  if (outcome.kind === 'self') return outcome;
  // Deleted elsewhere at the same time: the app's listener shows that page now.
  if (clearDeletionInFlight()) return { kind: 'other' };
  return outcome;
}

/** Step 6: Rise Path's own MCP clients only (connected-app records), best effort, at most `waitMs`. */
export async function revokeRisePathGrants(clientIds: readonly string[], waitMs: number = GRANT_REVOKE_WAIT_MS): Promise<void> {
  const supabase = getSupabaseClient();
  const ids = [...new Set(clientIds.filter((id) => UUID.test(id)))];
  if (!supabase || ids.length === 0) return;
  // Each call on its own: one that throws, even synchronously, neither skips the others nor stops
  // the session from ending (deleteAccount step 7).
  const work = Promise.allSettled(ids.map((clientId) => Promise.resolve().then(() => supabase.auth.oauth.revokeGrant({ clientId }))));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); })]);
  clearTimeout(timer);
}

/** The whole flow (steps 1–7). Resolves with the outcome; after 'self' the page is being replaced. */
export async function deleteAccount({
  email,
  userId,
  password,
  apps = [],
  connectedAppIds,
  endSession,
}: {
  email: string;
  userId: string;
  password: string;
  /** The used apps' names from listGrants (deletionAppNames). */
  apps?: readonly DeletionAppName[];
  connectedAppIds: readonly string[];
  endSession: (outcome: { by: DeletedBy; at?: string | null }) => Promise<void>;
}): Promise<DeletionOutcome> {
  const outcome = await deleteAccountWithPassword({ email, userId, password, apps });
  if (outcome.kind !== 'self') return outcome;
  // Best effort: a failed revoke never keeps this device signed in to the deleted account.
  await revokeRisePathGrants(connectedAppIds).catch(() => undefined);
  await endSession({ by: 'self', at: outcome.deletedAt });
  return outcome;
}
