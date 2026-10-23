/**
 * Pure rules for the agent-connection pages (Phase 1, doc/brushup-2026/ai-access-plan.ja.md §5):
 * /oauth/consent and /settings/connected-apps. No network, no React and no import.meta, so
 * server/tests/oauthConsentFront.test.js can load this file with node --experimental-strip-types.
 *
 * Supabase's OAuth 2.1 server sends the browser to /oauth/consent?authorization_id=<id>. The
 * pending authorization lives 10 minutes on Supabase's side, so the page keeps the id in
 * localStorage with the time it first saw it. That survives sign-in, and sign-up with email
 * confirmation in another tab (sessionStorage would not).
 */
import type { AiAccessStatus } from './aiAccessRules';

export const OAUTH_CONSENT_PATH = '/oauth/consent';
export const CONNECTED_APPS_PATH = '/settings/connected-apps';

/** localStorage key for the authorization request waiting for sign-in. */
export const OAUTH_PENDING_KEY = 'rp:oauthPending';
/** Supabase's AuthorizationTTL: a pending authorization expires 10 minutes after it was created. */
export const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;

/** The subset of Storage these helpers use (tests pass an in-memory one). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface PendingAuthorization {
  id: string;
  /** Epoch ms when this browser first saw the id. */
  savedAt: number;
}

/**
 * Supabase issues 32 alphanumeric characters. The id goes into a URL path
 * (/oauth/authorizations/<id>), so anything outside a plain token alphabet is refused.
 */
export function isAuthorizationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

export function consentPathFor(id: string): string {
  return `${OAUTH_CONSENT_PATH}?authorization_id=${encodeURIComponent(id)}`;
}

/** authorization_id from a location.search string, or null. */
export function authorizationIdFromSearch(search: string): string | null {
  try {
    const id = new URLSearchParams(search).get('authorization_id');
    return isAuthorizationId(id) ? id : null;
  } catch {
    return null;
  }
}

export function readPendingAuthorization(storage: KeyValueStorage | null | undefined): PendingAuthorization | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(OAUTH_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingAuthorization>;
    if (!isAuthorizationId(parsed?.id) || typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) {
      storage.removeItem(OAUTH_PENDING_KEY);
      return null;
    }
    return { id: parsed.id, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

/**
 * Remembers `id`. A second visit with the same id keeps the first time, so reopening an old link
 * still counts as expired; a different id replaces the old one.
 */
export function savePendingAuthorization(
  storage: KeyValueStorage | null | undefined,
  id: string,
  now: number = Date.now(),
): PendingAuthorization {
  const existing = readPendingAuthorization(storage);
  const pending = existing && existing.id === id && existing.savedAt <= now ? existing : { id, savedAt: now };
  try {
    storage?.setItem(OAUTH_PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Storage blocked: the page still works within this tab.
  }
  return pending;
}

export function clearPendingAuthorization(storage: KeyValueStorage | null | undefined): void {
  try {
    storage?.removeItem(OAUTH_PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function isPendingFresh(pending: PendingAuthorization | null, now: number = Date.now()): boolean {
  if (!pending) return false;
  const age = now - pending.savedAt;
  return age >= 0 && age < OAUTH_PENDING_TTL_MS;
}

/** Milliseconds left before the pending request expires (0 when expired). */
export function pendingRemainingMs(pending: PendingAuthorization | null, now: number = Date.now()): number {
  if (!isPendingFresh(pending, now)) return 0;
  return OAUTH_PENDING_TTL_MS - (now - (pending as PendingAuthorization).savedAt);
}

/** Where to go after sign-in when nothing else asked: back to a fresh consent request, else null. */
export function pendingConsentReturnPath(storage: KeyValueStorage | null | undefined, now: number = Date.now()): string | null {
  const pending = readPendingAuthorization(storage);
  return isPendingFresh(pending, now) ? consentPathFor((pending as PendingAuthorization).id) : null;
}

// --- who may approve -----------------------------------------------------------------------------

export type ConsentEligibility = 'allowed' | 'needs_age' | 'minor' | 'paused' | 'unavailable';

/**
 * Only an adult whose AI access is ready may approve. Everything else, including a status that
 * could not be loaded, offers Deny only. The MCP server checks again on every request.
 */
export function consentEligibility(access: AiAccessStatus | null | undefined): ConsentEligibility {
  if (!access) return 'unavailable';
  if (access.audience === 'minor') return 'minor';
  if (access.status === 'needs_age') return 'needs_age';
  if (access.status === 'needs_guardian_consent') return 'minor';
  if (access.status === 'paused') return 'paused';
  if (access.status === 'ready' && access.audience === 'adult') return 'allowed';
  return 'unavailable';
}

// --- where the agent sends the user back ---------------------------------------------------------

export type RedirectKind = 'known' | 'web' | 'insecure' | 'loopback' | 'app' | 'missing' | 'invalid';

export interface RedirectInfo {
  kind: RedirectKind;
  /** Host (with port for loopback) or the custom scheme; null when missing or unreadable. */
  host: string | null;
}

/**
 * Hosts of agent services whose OAuth callbacks are common for MCP (Claude, ChatGPT, VS Code,
 * Cursor, Antigravity). Matching only says "a well-known service"; the page still shows the host.
 */
export const KNOWN_AGENT_HOSTS: readonly string[] = [
  'claude.ai',
  'claude.com',
  'chatgpt.com',
  'chat.openai.com',
  'vscode.dev',
  'insiders.vscode.dev',
  'cursor.com',
  'antigravity.google',
];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:']);

export function describeRedirect(uri: unknown): RedirectInfo {
  if (typeof uri !== 'string' || !uri.trim()) return { kind: 'missing', host: null };
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return { kind: 'invalid', host: null };
  }
  const scheme = url.protocol.toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) return { kind: 'invalid', host: null };
  if (scheme === 'http:' || scheme === 'https:') {
    const hostname = url.hostname.toLowerCase();
    if (LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost')) return { kind: 'loopback', host: url.host.toLowerCase() };
    if (scheme === 'http:') return { kind: 'insecure', host: url.host.toLowerCase() };
    const known = KNOWN_AGENT_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
    return { kind: known ? 'known' : 'web', host: url.host.toLowerCase() };
  }
  // A custom scheme (cursor://…, vscode://…) opens an app installed on this device.
  return { kind: 'app', host: scheme.replace(/:$/, '') };
}

/** Supabase's redirect after approve or deny: anything a browser can follow except script and data URLs. */
export function isSafeRedirectUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return !BLOCKED_SCHEMES.has(url.protocol.toLowerCase());
  } catch {
    return false;
  }
}

/** Host of an http(s) URL for display (never rendered as a link or image), or null. */
export function displayHost(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.host.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** A client name an app registered for itself that claims to be Rise Path. */
export function claimsToBeRisePath(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const plain = name.toLowerCase().replace(/[\s_\-・.]/g, '');
  return plain.includes('risepath') || plain.includes('ライズパス');
}

// --- connected apps ------------------------------------------------------------------------------

/** One row of GET /api/v2/user/connected-apps (server/routes/connectedApps.js). */
export interface ConnectedAppRecord {
  clientId: string;
  clientName: string | null;
  firstSeenAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The parts of auth-js 2.89 OAuthGrant the page uses. */
export interface SupabaseGrantLike {
  client?: { id?: string; name?: string; uri?: string } | null;
  granted_at?: string | null;
}

export interface ConnectedApp {
  clientId: string;
  name: string | null;
  /** Host of the app's website, for display only. */
  uriHost: string | null;
  grantedAt: string | null;
  firstSeenAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** Supabase still holds a grant (the app can get new tokens until revoked). */
  hasGrant: boolean;
  /** Connected now: a grant exists and was not revoked after it was given. */
  active: boolean;
}

const time = (iso: string | null | undefined) => {
  if (!iso) return NaN;
  return new Date(iso).getTime();
};

/** A display name: trimmed text, or null when there is none. */
const nameOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * First and last use as the page shows them. A row the revoke API inserted for an app that never
 * called the MCP endpoint carries no use: the server sends null, and an older row whose dates are
 * only the column defaults (both equal to revoked_at) counts as never used too.
 */
function usageOf(record: ConnectedAppRecord): { firstSeenAt: string | null; lastUsedAt: string | null } {
  const first = record.firstSeenAt ?? null;
  const last = record.lastUsedAt ?? null;
  if (!first || !last) return { firstSeenAt: first, lastUsedAt: last };
  const revoked = time(record.revokedAt);
  if (!Number.isNaN(revoked) && time(first) === revoked && time(last) === revoked) {
    return { firstSeenAt: null, lastUsedAt: null };
  }
  return { firstSeenAt: first, lastUsedAt: last };
}

/**
 * Merges Rise Path's records (who used the MCP endpoint, and revocations) with Supabase's grants
 * (who may get tokens). A grant given after our revoked_at is a new consent and counts as active.
 * Active apps first, then by last use.
 */
export function mergeConnectedApps(
  records: readonly ConnectedAppRecord[],
  grants: readonly SupabaseGrantLike[],
  /** false when listGrants failed: records not revoked, or used after the revoke, then stay revocable. */
  grantsKnown = true,
): ConnectedApp[] {
  const byId = new Map<string, ConnectedApp>();
  for (const record of records) {
    if (!record || typeof record.clientId !== 'string') continue;
    const id = record.clientId.toLowerCase();
    const usage = usageOf(record);
    byId.set(id, {
      clientId: id,
      name: nameOf(record.clientName),
      uriHost: null,
      grantedAt: null,
      firstSeenAt: usage.firstSeenAt,
      lastUsedAt: usage.lastUsedAt,
      revokedAt: record.revokedAt ?? null,
      // Without Supabase's list, an app still counts as holding a grant when it was never revoked,
      // or when the MCP server saw it after the revoke (a new consent, or a revokeGrant that failed).
      hasGrant: !grantsKnown && (!record.revokedAt || time(usage.lastUsedAt) > time(record.revokedAt)),
      active: false,
    });
  }
  for (const grant of grants) {
    const id = typeof grant?.client?.id === 'string' ? grant.client.id.toLowerCase() : null;
    if (!id) continue;
    const existing = byId.get(id);
    byId.set(id, {
      clientId: id,
      // Supabase's name while the grant exists; afterwards the one our record kept at revocation.
      name: nameOf(grant.client?.name) ?? existing?.name ?? null,
      uriHost: displayHost(grant.client?.uri),
      grantedAt: grant.granted_at ?? null,
      firstSeenAt: existing?.firstSeenAt ?? null,
      lastUsedAt: existing?.lastUsedAt ?? null,
      revokedAt: existing?.revokedAt ?? null,
      hasGrant: true,
      active: false,
    });
  }
  const apps = [...byId.values()].map((app) => {
    const revoked = time(app.revokedAt);
    const granted = time(app.grantedAt);
    const active = app.hasGrant && (Number.isNaN(revoked) || (!Number.isNaN(granted) && granted > revoked));
    return { ...app, active };
  });
  return apps.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const la = time(a.lastUsedAt ?? a.grantedAt);
    const lb = time(b.lastUsedAt ?? b.grantedAt);
    return (Number.isNaN(lb) ? 0 : lb) - (Number.isNaN(la) ? 0 : la);
  });
}

// --- disconnecting ------------------------------------------------------------------------------

/** Longest app name sent with a revocation (the server caps it as well). */
export const CLIENT_NAME_MAX = 100; // same cap as server/routes/connectedApps.js

/** The app's name for our record, trimmed and capped; null when there is none. */
export function revocationClientName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, CLIENT_NAME_MAX).trim();
  return trimmed || null;
}

export interface RevokeTarget {
  clientId: string;
  /** Kept on our record, so the app still has a name after Supabase drops the grant. */
  name?: string | null;
}

export interface RevokeResult {
  /** Supabase revokeGrant succeeded: the app can no longer get new tokens. */
  supabaseRevoked: boolean;
  /**
   * revoked_at was written again after revokeGrant, so no token the app refreshed in between
   * still works. false when supabaseRevoked is false, or when that last write failed (retry it
   * with confirmRevocation).
   */
  confirmed: boolean;
}

export interface RevokeDeps {
  /** POST /user/connected-apps/:id/revoke; throws when it fails. */
  postRevoke: (clientId: string, clientName: string | null) => Promise<void>;
  /** supabase.auth.oauth.revokeGrant; true on success. null when Supabase is not configured. */
  revokeGrant: ((clientId: string) => Promise<boolean>) | null;
}

/** Writes revoked_at again. Tries twice; false when both tries failed. */
export async function confirmRevocationWith(target: RevokeTarget, postRevoke: RevokeDeps['postRevoke']): Promise<boolean> {
  const clientName = revocationClientName(target.name);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await postRevoke(target.clientId, clientName);
      return true;
    } catch {
      // One more try, then report.
    }
  }
  return false;
}

/**
 * Disconnects an app in three steps:
 *   1. our revoked_at (the MCP server refuses, within a few seconds, every token issued before it);
 *      a failure here throws, and nothing is revoked;
 *   2. Supabase revokeGrant (no new tokens);
 *   3. our revoked_at again, only after step 2 succeeded. An app that refreshed between steps 1
 *      and 2 holds an access token issued after the first revoked_at, which would otherwise work
 *      until it expires (up to an hour). The second write is later than that token.
 */
export async function revokeConnectedAppWith(target: RevokeTarget, deps: RevokeDeps): Promise<RevokeResult> {
  await deps.postRevoke(target.clientId, revocationClientName(target.name));
  if (!deps.revokeGrant) return { supabaseRevoked: false, confirmed: false };
  let supabaseRevoked = false;
  try {
    supabaseRevoked = await deps.revokeGrant(target.clientId);
  } catch {
    supabaseRevoked = false;
  }
  if (!supabaseRevoked) return { supabaseRevoked: false, confirmed: false };
  return { supabaseRevoked: true, confirmed: await confirmRevocationWith(target, deps.postRevoke) };
}
