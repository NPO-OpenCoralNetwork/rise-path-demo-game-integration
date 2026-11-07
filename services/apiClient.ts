// Centralized API client with auth header injection.
// Phase 7: Uses Supabase JWT as Bearer token for authentication.
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api/v2';

import { getSupabaseClient } from './supabaseClient';
import { shouldSendLegacyUserIdHeader } from './authPolicy';
import { reportAccountDeleted } from './accountDeletionState';
import { notePilotOnly } from './pilotAccess';

// Legacy fallback for Guest users (no Supabase session)
let _getUserId: (() => string | null) = () => null;

export const setAuthProvider = (getUserId: () => string | null) => {
    _getUserId = getUserId;
};

export const isApiAvailable = (): boolean => {
    return Boolean(import.meta.env.VITE_API_ENABLED !== 'false');
};

export const apiFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
    // A FormData body gets no Content-Type here: the browser sets multipart/form-data with its boundary.
    const headers: Record<string, string> = {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers as Record<string, string> || {}),
    };

    // Primary: Supabase JWT as Bearer token, unless the caller already set one (the page-hide
    // progress upload: getSession waits for a lock, and fetch must start before the page is gone).
    const supabase = getSupabaseClient();
    if (supabase && !headers['Authorization']) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.access_token) {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }
        } catch {
            // Supabase session retrieval failed — continue without token
        }
    }

    // Legacy demo-only header (server ignores in strict auth mode)
    if (!headers['Authorization'] && shouldSendLegacyUserIdHeader()) {
        const userId = _getUserId();
        if (userId) {
            headers['x-user-id'] = userId;
        }
    }

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    // Phase 4 (design §5.11): this account was deleted (here or on another device). AuthContext
    // hears the signal and ends the session on this device; callers get the response unchanged.
    if (res.status === 401) await noteAccountDeleted(res);
    // Phase 9 (D1): this account is not on the server's pilot list (403 pilot_only): App.tsx shows
    // the full-page notice for it (services/pilotAccess.ts); callers get the response unchanged.
    if (res.status === 403) await notePilotOnly(res, headers['Authorization']);
    return res;
};

/**
 * Phase 5: the learner this tab's AuthContext shows (the auth provider's id), or null. Another
 * tab can have switched the browser to another learner meanwhile (progressService.ts compares).
 */
export const currentAuthUserId = (): string | null => {
    try {
        return _getUserId() || null;
    } catch {
        return null;
    }
};

/**
 * Phase 5: apiFetch only while the primary Supabase session is `expectedUserId`'s, with that
 * session's token (read once, so the request cannot pick up another learner's session in
 * between). Otherwise nothing is sent and null is returned: data recorded for one learner (legacy
 * Blender progress, learning events) never reaches another learner's account.
 */
export const apiFetchAs = async (expectedUserId: string, path: string, options: RequestInit = {}): Promise<Response | null> => {
    const supabase = getSupabaseClient();
    if (!supabase || !expectedUserId) return null;
    let session: { access_token?: string; user?: { id?: string } } | null = null;
    try {
        ({ data: { session } } = await supabase.auth.getSession());
    } catch {
        return null;
    }
    if (!session?.access_token || session.user?.id !== expectedUserId) return null;
    return apiFetch(path, {
        ...options,
        headers: { ...(options.headers as Record<string, string> || {}), Authorization: `Bearer ${session.access_token}` },
    });
};

/** Reads a 401's error_type from a copy of the body; account_deleted → reportAccountDeleted(). */
async function noteAccountDeleted(res: Response): Promise<void> {
    try {
        const body = await res.clone().json();
        if (body && typeof body === 'object' && (body as { error_type?: unknown }).error_type === 'account_deleted') {
            reportAccountDeleted();
        }
    } catch {
        // Not JSON (a proxy page): not the server's answer.
    }
}

/**
 * A read the API did not answer with 2xx (apiGet). Phase 8 (S5): `termsRequired` when the server's
 * terms check (LEGAL_TERMS_REQUIRED, server/middleware/termsGate.js) refused it: 403 with error_type
 * terms_required. The message stays `API <path>: <status>`.
 */
export class ApiReadError extends Error {
    status: number;
    termsRequired: boolean;
    constructor(path: string, status: number, termsRequired: boolean) {
        super(`API ${path}: ${status}`);
        this.name = 'ApiReadError';
        this.status = status;
        this.termsRequired = termsRequired;
    }
}

/** The error for a read that failed; a 403's error_type is read from a copy of the body. */
export async function apiReadError(path: string, res: Response): Promise<ApiReadError> {
    let termsRequired = false;
    if (res.status === 403) {
        try {
            const body = await res.clone().json();
            termsRequired = Boolean(body && typeof body === 'object' && (body as { error_type?: unknown }).error_type === 'terms_required');
        } catch {
            // Not JSON (a proxy page): not the server's terms check.
        }
    }
    return new ApiReadError(path, res.status, termsRequired);
}

/** Whether a read failed because the server's terms check refused it (Phase 8, S5). */
export const isTermsRefusal = (error: unknown): boolean => error instanceof ApiReadError && error.termsRequired;

export const apiGet = async <T = any>(path: string): Promise<T> => {
    const res = await apiFetch(path);
    if (!res.ok) throw await apiReadError(path, res);
    return res.json();
};

export const apiPost = async <T = any>(path: string, body: any): Promise<T> => {
    const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
    return res.json();
};

export const apiPut = async <T = any>(path: string, body: any): Promise<T> => {
    const res = await apiFetch(path, { method: 'PUT', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
    return res.json();
};
