// supabase.js - Supabase設定ファイル
import { createClient } from '@supabase/supabase-js'

const runtimeEnv = typeof import.meta !== 'undefined' ? import.meta.env || {} : {};
const processEnv = typeof process !== 'undefined' ? process.env || {} : {};

// Prefer Vite envs, but keep legacy keys as a fallback.
const supabaseUrl =
  runtimeEnv.VITE_SUPABASE_URL ||
  runtimeEnv.SUPABASE_URL ||
  processEnv.VITE_SUPABASE_URL ||
  processEnv.SUPABASE_URL;
const supabaseAnonKey =
  runtimeEnv.VITE_SUPABASE_ANON_KEY ||
  runtimeEnv.SUPABASE_ANON_KEY ||
  processEnv.VITE_SUPABASE_ANON_KEY ||
  processEnv.SUPABASE_ANON_KEY;

let supabaseClient;

// 環境変数の存在確認
if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your_supabase_project_url')) {
  console.warn('⚠️ Supabaseの環境変数が設定されていないか、デフォルト値のままです。');
  console.warn('⚠️ デモモード（モック）で動作します。バックエンド機能は制限されます。');
  
  // モッククライアントの作成
  supabaseClient = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async ({ email, password }) => {
        console.log('🧪 [Demo] Mock login for:', email);
        return {
          data: {
            user: {
              id: 'demo-user-id-' + Date.now(),
              email: email,
              user_metadata: { username: email.split('@')[0] }
            },
            session: { access_token: 'mock-token' }
          },
          error: null
        };
      },
      signUp: async ({ email, password, options }) => {
        console.log('🧪 [Demo] Mock signup for:', email);
        return {
            data: {
                user: {
                    id: 'demo-user-id-' + Date.now(),
                    email: email,
                    user_metadata: options?.data || {}
                },
                session: null // Email confirmation required simulation
            },
            error: null
        };
      },
      signOut: async () => {
        console.log('🧪 [Demo] Mock logout');
        return { error: null };
      },
      onAuthStateChange: (callback) => {
        return { data: { subscription: { unsubscribe: () => {} } } };
      }
    },
    from: (table) => {
      console.log(`🧪 [Demo] DB Access to table: ${table}`);
      return {
        select: (columns) => {
           const queryBuilder = {
             eq: (column, value) => {
               return {
                 single: async () => {
                   if (table === 'profiles') {
                     return {
                       data: {
                         username: 'Demo Player',
                         level: 1,
                         xp: 0,
                         gold: 100,
                         current_stage: 1,
                         unlocked_stages: 1,
                         trophies: []
                       },
                       error: null
                     };
                   }
                   return { data: null, error: null };
                 },
                 maybeSingle: async () => ({ data: null, error: null })
               };
             },
             insert: async (data) => ({ data: data, error: null }),
             update: async (data) => ({ data: data, error: null })
           };
           return queryBuilder;
        },
        update: (data) => ({
          eq: (column, value) => Promise.resolve({ data: data, error: null })
        }),
        insert: (data) => ({
            select: () => ({
                single: async () => ({ data: data[0] || data, error: null })
            })
        })
      };
    }
  };
} else {
  // Supabaseクライアントを作成
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  });
  console.log('✅ Supabaseクライアント初期化完了 (環境変数から読み込み)');
}

export const supabase = supabaseClient;
