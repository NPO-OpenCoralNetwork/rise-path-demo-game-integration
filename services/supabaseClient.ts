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
