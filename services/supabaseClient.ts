import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const nexloomSupabaseUrl = import.meta.env.VITE_NEXLOOM_SUPABASE_URL as string | undefined;
const nexloomSupabaseAnonKey = import.meta.env.VITE_NEXLOOM_SUPABASE_ANON_KEY as string | undefined;

let _client: SupabaseClient | null = null;
let _nexloomClient: SupabaseClient | null = null;

export type SupabaseConfigStatus = {
    configured: boolean;
    missing: Array<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'>;
};

export const getSupabaseConfigStatus = (): SupabaseConfigStatus => {
    const missing: SupabaseConfigStatus['missing'] = [];
    if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
    if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY');
    return {
        configured: missing.length === 0,
        missing,
    };
};

export const isSupabaseConfigured = (): boolean => getSupabaseConfigStatus().configured;

export const getSupabaseClient = (): SupabaseClient | null => {
    if (_client) return _client;
    if (!supabaseUrl || !supabaseAnonKey) return null;

    _client = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
        },
    });
    return _client;
};

export const getNexloomSupabaseClient = (): SupabaseClient | null => {
    if (_nexloomClient) return _nexloomClient;
    if (!nexloomSupabaseUrl || !nexloomSupabaseAnonKey || nexloomSupabaseAnonKey === 'YOUR_NEXLOOM_SUPABASE_ANON_KEY') return null;

    _nexloomClient = createClient(nexloomSupabaseUrl, nexloomSupabaseAnonKey, {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
        },
    });
    return _nexloomClient;
};

/** The storage key of the re-authentication client (never the main session's key). */
export const REAUTH_STORAGE_KEY = 'rp-reauth';

/**
 * A short-lived client for the password check before an account deletion (Phase 4, design §5.11):
 * nothing is stored, nothing refreshes, and AuthContext never subscribes to it, so its sign-in
 * never becomes the app's session (handleSession and signInProgressSync do not run). The caller
 * signs it out with { scope: 'local' } when done, which ends only that one session.
 */
export const createReauthClient = (): SupabaseClient | null => {
    if (!supabaseUrl || !supabaseAnonKey) return null;
    return createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: REAUTH_STORAGE_KEY,
        },
    });
};
