// Centralized API client with auth header injection.
// Phase 7: Uses Supabase JWT as Bearer token for authentication.
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api/v2';

import { getSupabaseClient } from './supabaseClient';
import { shouldSendLegacyUserIdHeader } from './authPolicy';

// Legacy fallback for Guest users (no Supabase session)
let _getUserId: (() => string | null) = () => null;

export const setAuthProvider = (getUserId: () => string | null) => {
    _getUserId = getUserId;
};

export const isApiAvailable = (): boolean => {
    return Boolean(import.meta.env.VITE_API_ENABLED !== 'false');
};

export const apiFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
    };

    // Primary: Supabase JWT as Bearer token
    const supabase = getSupabaseClient();
    if (supabase) {
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

    return fetch(`${API_BASE}${path}`, { ...options, headers });
};

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
