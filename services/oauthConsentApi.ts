/**
 * The consent step of Supabase's OAuth 2.1 server (Phase 1, doc/brushup-2026/ai-access-plan.ja.md
 * §5): a learner's own agent (Claude Code, Codex, Claude.ai, ChatGPT, …) asks to connect to the
 * Rise Path MCP endpoint, Supabase sends the browser to /oauth/consent?authorization_id=…, and
 * components/features/oauth/OAuthConsentView.tsx shows what is asked and lets an adult approve.
 *
 * Wraps auth-js 2.89 supabase.auth.oauth.{getAuthorizationDetails, approveAuthorization,
 * denyAuthorization}. Approve and deny pass skipBrowserRedirect so the page clears its pending
 * request and checks the redirect before it leaves. Pure rules live in ./oauthConsentRules.ts.
 *
 * Supabase is the source of truth for the grant; who actually connects is recorded by the MCP
 * server (mcp_oauth_grants), not here, because Supabase approves an existing consent on the GET.
 */
import { getSupabaseClient } from './supabaseClient';
import { describeRedirect, displayHost, isAuthorizationId, isSafeRedirectUrl, type RedirectInfo } from './oauthConsentRules';

export * from './oauthConsentRules';

export type OAuthConsentErrorKind =
  /** Unknown, expired, already decided, or opened by another account (Supabase answers 404 for all). */
  | 'not_found'
  /** No Supabase session in this browser. */
  | 'signed_out'
  /** The OAuth server is not configured in this deployment. */
  | 'not_configured'
  /** Network or server error: worth a retry. */
  | 'failed';

export class OAuthConsentError extends Error {
  kind: OAuthConsentErrorKind;
  status?: number;

  constructor(kind: OAuthConsentErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'OAuthConsentError';
    this.kind = kind;
    this.status = status;
  }
}

/** What the consent page shows. client.logo_uri is dropped on purpose (it is never loaded). */
export interface ConsentRequest {
  authorizationId: string;
  client: {
    id: string;
    /** Chosen by whoever registered the app; not verified. */
    name: string | null;
    /** Host of the app's website, display only. */
    uriHost: string | null;
  };
  redirect: RedirectInfo;
  /** The account Supabase bound this request to. */
  userEmail: string | null;
  scope: string;
}

/** Supabase approved during the GET because consent already exists: only redirect. */
export interface AlreadyApproved {
  alreadyApproved: true;
  redirectUrl: string;
}

const oauthApi = () => {
  const supabase = getSupabaseClient();
  if (!supabase) throw new OAuthConsentError('not_configured', 'Supabase is not configured.');
  return supabase.auth.oauth;
};

function toError(error: unknown): OAuthConsentError {
  if (error instanceof OAuthConsentError) return error;
  const record = (error && typeof error === 'object' ? error : {}) as { status?: number; name?: string; message?: string; code?: string };
  const status = typeof record.status === 'number' ? record.status : undefined;
  if (record.name === 'AuthSessionMissingError') return new OAuthConsentError('signed_out', 'Not signed in.', status);
  if (status === 401) return new OAuthConsentError('signed_out', 'Not signed in.', status);
  if (status === 404 || status === 400 || status === 403 || status === 410 || record.code === 'oauth_authorization_not_found') {
    return new OAuthConsentError('not_found', 'This request is no longer valid.', status);
  }
  if (status === 501 || record.code === 'oauth_server_disabled') return new OAuthConsentError('not_configured', 'OAuth server disabled.', status);
  return new OAuthConsentError('failed', record.message || 'Request failed.', status);
}

export async function getConsentRequest(authorizationId: string): Promise<ConsentRequest | AlreadyApproved> {
  if (!isAuthorizationId(authorizationId)) throw new OAuthConsentError('not_found', 'Invalid authorization id.');
  let result;
  try {
    result = await oauthApi().getAuthorizationDetails(authorizationId);
  } catch (error) {
    throw toError(error);
  }
  if (result.error) throw toError(result.error);
  const data = (result.data ?? {}) as Record<string, unknown>;

  // Already consented: Supabase answers only { redirect_url } (the 2.89 type claims more).
  if (!('authorization_id' in data) && isSafeRedirectUrl(data.redirect_url)) {
    return { alreadyApproved: true, redirectUrl: data.redirect_url };
  }
  if (data.authorization_id !== authorizationId) throw new OAuthConsentError('failed', 'Unexpected response.');

  const client = (data.client && typeof data.client === 'object' ? data.client : {}) as Record<string, unknown>;
  const user = (data.user && typeof data.user === 'object' ? data.user : {}) as Record<string, unknown>;
  const name = typeof client.name === 'string' ? client.name.trim().slice(0, 120) : '';
  return {
    authorizationId,
    client: {
      id: typeof client.id === 'string' ? client.id : '',
      name: name || null,
      uriHost: displayHost(client.uri),
    },
    // Not in the 2.89 types, but the auth server sends it (omitempty): read it defensively.
    redirect: describeRedirect(data.redirect_uri),
    userEmail: typeof user.email === 'string' && user.email ? user.email : null,
    scope: typeof data.scope === 'string' ? data.scope : '',
  };
}

async function decide(authorizationId: string, action: 'approve' | 'deny'): Promise<string> {
  if (!isAuthorizationId(authorizationId)) throw new OAuthConsentError('not_found', 'Invalid authorization id.');
  let result;
  try {
    const api = oauthApi();
    result = action === 'approve'
      ? await api.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await api.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  } catch (error) {
    throw toError(error);
  }
  if (result.error) throw toError(result.error);
  const url = result.data?.redirect_url;
  if (!isSafeRedirectUrl(url)) throw new OAuthConsentError('failed', 'No usable redirect.');
  return url;
}

/** Approves and returns the agent's redirect URL (the caller navigates). */
export const approveConsent = (authorizationId: string) => decide(authorizationId, 'approve');
/** Denies and returns the agent's redirect URL (carries error=access_denied). */
export const denyConsent = (authorizationId: string) => decide(authorizationId, 'deny');

/** localStorage, or null when blocked. */
export function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
