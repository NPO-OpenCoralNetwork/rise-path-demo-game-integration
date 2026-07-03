import { isSupabaseConfigured } from './supabaseClient';

/**
 * Frontend mirror of server/middleware/authPolicy.js (Phase 15-4).
 * Keeps guest/mock login and x-user-id off when running production data mode.
 */
export function isStrictAuthMode(): boolean {
    if (import.meta.env.PROD) return true;
    if (import.meta.env.VITE_STRICT_AUTH === 'true') return true;
    if (import.meta.env.VITE_DEMO_MODE === 'false') return true;
    return false;
}

export function allowGuestLogin(): boolean {
    if (isStrictAuthMode()) return false;
    return !isSupabaseConfigured();
}

export function allowMockLogin(): boolean {
    return !isSupabaseConfigured() && !isStrictAuthMode();
}

export function shouldSendLegacyUserIdHeader(): boolean {
    return !isStrictAuthMode();
}

export function isStoredAuthUserAllowed(user: { isGuest?: boolean; id?: string } | null): boolean {
    if (!user) return false;
    if (!isStrictAuthMode()) return true;
    if (user.isGuest) return false;
    if (typeof user.id === 'string' && user.id.startsWith('mock_')) return false;
    return isSupabaseConfigured();
}