/**
 * Central auth policy for server-side fallbacks (Phase 15-4).
 *
 * Strict mode disables PHASE1_USER_ID / dev-fallback paths so production
 * and VITE_DEMO_MODE=false stacks require real Supabase JWT (or bridge token).
 */

export function isStrictAuthMode() {
    if (process.env.NODE_ENV === 'production') return true;
    if (process.env.RISEPATH_STRICT_AUTH === 'true') return true;
    if (process.env.VITE_DEMO_MODE === 'false') return true;
    return false;
}

export function allowDevAuthFallback() {
    return !isStrictAuthMode();
}

export function getAuthPolicySnapshot() {
    return {
        strict_auth_mode: isStrictAuthMode(),
        allow_dev_fallback: allowDevAuthFallback(),
        node_env: process.env.NODE_ENV || 'development',
        vite_demo_mode: process.env.VITE_DEMO_MODE !== 'false',
        strict_auth_triggers: {
            node_env_production: process.env.NODE_ENV === 'production',
            risepath_strict_auth: process.env.RISEPATH_STRICT_AUTH === 'true',
            vite_demo_mode_false: process.env.VITE_DEMO_MODE === 'false',
        },
    };
}