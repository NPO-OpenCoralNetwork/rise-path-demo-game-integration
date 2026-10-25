// Centralized API client with auth header injection.
// Phase 7: Uses Supabase JWT as Bearer token for authentication.
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api/v2';

import { getSupabaseClient } from './supabaseClient';
import { shouldSendLegacyUserIdHeader } from './authPolicy';
import { reportAccountDeleted } from './accountDeletionState';

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
    return res;
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

export const apiGet = async <T = any>(path: string): Promise<T> => {
    const res = await apiFetch(path);
    if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
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
