/**
 * The learner's connected AI apps (Phase 1, doc/brushup-2026/ai-access-plan.ja.md §5), for
 * /settings/connected-apps.
 *
 * Two sources, merged by mergeConnectedApps (./oauthConsentRules.ts):
 *   - GET /api/v2/user/connected-apps (server/routes/connectedApps.js): what the MCP server saw
 *     (first and last use) and our revocations.
 *   - supabase.auth.oauth.listGrants(): which apps may still get tokens.
 *
 * Revoking writes our revoked_at first (the MCP server then refuses, within a few seconds, every
 * token issued before it, including access tokens that would otherwise live up to an hour), then
 * calls supabase.auth.oauth.revokeGrant({ clientId }), which ends the refresh tokens, and then writes
 * revoked_at again: a token the app refreshed between the first write and revokeGrant has an iat
 * after the first revoked_at, and only the second write is later than it.
 */
import { apiFetch } from './apiClient';
import { getSupabaseClient } from './supabaseClient';
import {
  confirmRevocationWith,
  mergeConnectedApps,
  revokeConnectedAppWith,
  type ConnectedApp,
  type ConnectedAppRecord,
  type RevokeResult,
  type RevokeTarget,
  type SupabaseGrantLike,
} from './oauthConsentRules';

export type { ConnectedApp, RevokeResult, RevokeTarget } from './oauthConsentRules';

export class ConnectedAppsError extends Error {
  status: number;
  errorType?: string;

  constructor(message: string, status: number, errorType?: string) {
    super(message);
    this.name = 'ConnectedAppsError';
    this.status = status;
    this.errorType = errorType;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readError(res: Response): Promise<ConnectedAppsError> {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await res.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    // Not JSON.
  }
  const message = typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
  return new ConnectedAppsError(message, res.status, typeof body.error_type === 'string' ? body.error_type : undefined);
}

export async function listConnectedAppRecords(signal?: AbortSignal): Promise<ConnectedAppRecord[]> {
  const res = await apiFetch('/user/connected-apps', { signal });
  if (!res.ok) throw await readError(res);
  const body = (await res.json()) as { apps?: unknown };
  return Array.isArray(body?.apps) ? (body.apps as ConnectedAppRecord[]) : [];
}

/** Supabase's grants; null when they could not be read (the page then shows our records only). */
export async function listSupabaseGrants(): Promise<SupabaseGrantLike[] | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.oauth.listGrants();
    if (error || !Array.isArray(data)) return null;
    return data as SupabaseGrantLike[];
  } catch {
    return null;
  }
}

export interface ConnectedAppsResult {
  apps: ConnectedApp[];
  /** listGrants failed: apps may be missing or shown as disconnected. */
  grantsUnavailable: boolean;
}

export async function listConnectedApps(signal?: AbortSignal): Promise<ConnectedAppsResult> {
  const [records, grants] = await Promise.all([listConnectedAppRecords(signal), listSupabaseGrants()]);
  return { apps: mergeConnectedApps(records, grants ?? [], grants !== null), grantsUnavailable: grants === null };
}

async function postRevoke(clientId: string, clientName: string | null): Promise<void> {
  const res = await apiFetch(`/user/connected-apps/${encodeURIComponent(clientId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify(clientName ? { clientName } : {}),
  });
  if (!res.ok) throw await readError(res);
}

function checkClientId(clientId: string): void {
  if (!UUID.test(clientId)) throw new ConnectedAppsError('clientId must be a UUID.', 400, 'invalid_client_id');
}

/** Writes revoked_at again (after revokeGrant succeeded). Returns false when both tries failed. */
export async function confirmRevocation(target: RevokeTarget): Promise<boolean> {
  checkClientId(target.clientId);
  return confirmRevocationWith(target, postRevoke);
}

/**
 * Disconnects an app: our record, then Supabase revokeGrant, then our record again (see
 * revokeConnectedAppWith). Throws when the first write failed (nothing is revoked then).
 */
export async function revokeConnectedApp(target: RevokeTarget): Promise<RevokeResult> {
  checkClientId(target.clientId);
  const supabase = getSupabaseClient();
  return revokeConnectedAppWith(target, {
    postRevoke,
    revokeGrant: supabase
      ? async (clientId) => {
          const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
          return !error;
        }
      : null,
  });
}
