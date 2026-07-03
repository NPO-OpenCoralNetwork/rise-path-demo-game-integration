import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from '../db.js';
import { getSupabase } from '../middleware/auth.js';
import { getAuthPolicySnapshot } from '../middleware/authPolicy.js';
import { getHermesConfig } from './hermesAgentService.js';
import { checkKokoroHealth } from '../../tools/core/kokoroTts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

function isSet(name) {
    const value = process.env[name];
    return typeof value === 'string' && value.trim().length > 0;
}

export function getFrontendRuntimeFlags() {
    return {
        demo_mode: process.env.VITE_DEMO_MODE !== 'false',
        api_enabled: process.env.VITE_API_ENABLED !== 'false',
        api_base_url: process.env.VITE_API_BASE_URL || '/api/v2',
        supabase_configured: isSet('VITE_SUPABASE_URL') && isSet('VITE_SUPABASE_ANON_KEY'),
    };
}

async function listMigrationFiles() {
    const entries = await fs.readdir(MIGRATIONS_DIR);
    return entries.filter((name) => /^\d+_.+\.sql$/i.test(name)).sort();
}

async function getMigrationStatus(pool) {
    const files = await listMigrationFiles();
    if (!pool) {
        return {
            total: files.length,
            applied: 0,
            pending: files.length,
            ok: false,
            pending_versions: files,
        };
    }

    try {
        const { rows: tableRows } = await pool.query(
            `SELECT to_regclass('public.schema_migrations') AS reg`,
        );
        if (!tableRows[0]?.reg) {
            return {
                total: files.length,
                applied: 0,
                pending: files.length,
                ok: false,
                pending_versions: files,
            };
        }

        const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
        const appliedSet = new Set(rows.map((row) => row.version));
        const pending = files.filter((file) => !appliedSet.has(path.basename(file, '.sql')));
        return {
            total: files.length,
            applied: appliedSet.size,
            pending: pending.length,
            ok: pending.length === 0,
            pending_versions: pending,
        };
    } catch (err) {
        return {
            total: files.length,
            applied: 0,
            pending: files.length,
            ok: false,
            error: err.message,
            pending_versions: files,
        };
    }
}

async function probeDatabase() {
    const pool = getPool();
    if (!pool) {
        return {
            status: 'not_configured',
            ok: false,
            message: 'DATABASE_URL_PHASE1 is not set',
        };
    }

    try {
        const ping = await pool.query('SELECT 1 AS ok');
        const migrations = await getMigrationStatus(pool);

        let learning_portals = null;
        let curricula = null;
        try {
            const portals = await pool.query(
                'SELECT COUNT(*)::int AS count FROM learning_portals WHERE is_active = true',
            );
            learning_portals = portals.rows[0]?.count ?? 0;
        } catch {
            learning_portals = null;
        }
        try {
            const courses = await pool.query('SELECT COUNT(*)::int AS count FROM curricula');
            curricula = courses.rows[0]?.count ?? 0;
        } catch {
            curricula = null;
        }

        return {
            status: 'connected',
            ok: migrations.ok,
            ping: ping.rows[0]?.ok === 1,
            migrations,
            counts: {
                learning_portals,
                curricula,
            },
        };
    } catch (err) {
        return {
            status: 'error',
            ok: false,
            message: err.message,
        };
    }
}

function probeSupabaseAuth() {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const client = getSupabase();

    if (!url || !serviceKey) {
        return {
            status: 'not_configured',
            ok: false,
            jwt_validation: false,
        };
    }

    return {
        status: client ? 'configured' : 'init_failed',
        ok: Boolean(client),
        jwt_validation: Boolean(client),
    };
}

async function probeHermes() {
    const cfg = getHermesConfig();
    return {
        status: cfg.configured ? 'configured' : 'not_configured',
        ok: cfg.configured,
        model: cfg.model || null,
    };
}

async function probeKokoro() {
    try {
        const health = await checkKokoroHealth();
        return {
            status: health.ok ? 'healthy' : 'unavailable',
            ok: health.ok,
            engine: health.engine || 'kokoro-82m-onnx',
            models_ready: health.models_ready ?? false,
        };
    } catch (err) {
        return {
            status: 'unavailable',
            ok: false,
            message: err.message,
        };
    }
}

/**
 * Build the production readiness snapshot used by /api/v2/health.
 * @param {{ includeOptional?: boolean }} [options]
 */
export async function collectRuntimeHealth(options = {}) {
    const includeOptional = options.includeOptional !== false;
    const [database, hermes, kokoro] = await Promise.all([
        probeDatabase(),
        includeOptional ? probeHermes() : Promise.resolve(null),
        includeOptional ? probeKokoro() : Promise.resolve(null),
    ]);

    const supabase = probeSupabaseAuth();
    const frontend = getFrontendRuntimeFlags();
    const auth_policy = getAuthPolicySnapshot();

    const checks = {
        database: database.ok,
        supabase_auth: supabase.ok,
        production_data_mode: !frontend.demo_mode,
        strict_auth_mode: auth_policy.strict_auth_mode,
        dev_auth_fallback_disabled: !auth_policy.allow_dev_fallback,
    };
    if (includeOptional && hermes) checks.hermes = hermes.ok;
    if (includeOptional && kokoro) checks.kokoro = kokoro.ok;

    const requiredOk = checks.database && checks.supabase_auth;
    const readyForProdData = requiredOk && checks.production_data_mode;

    return {
        ok: requiredOk,
        ready_for_prod_data: readyForProdData,
        node_env: process.env.NODE_ENV || 'development',
        checks,
        frontend,
        auth_policy,
        database,
        supabase,
        hermes,
        kokoro,
        timestamp: new Date().toISOString(),
    };
}

export async function logStartupDiagnostics() {
    const health = await collectRuntimeHealth();
    const { frontend, database, supabase } = health;

    console.log('[Startup] Runtime configuration');
    console.log(`  NODE_ENV=${health.node_env}`);
    console.log(`  VITE_DEMO_MODE=${frontend.demo_mode ? 'true (demo courses)' : 'false (API/DB)'}`);
    console.log(`  VITE_API_ENABLED=${frontend.api_enabled}`);
    console.log(`  Database: ${database.status}${database.counts ? ` (portals=${database.counts.learning_portals}, curricula=${database.counts.curricula})` : ''}`);
    console.log(`  Supabase JWT: ${supabase.status}`);
    console.log(`  Strict auth: ${health.auth_policy.strict_auth_mode} (dev fallback ${health.auth_policy.allow_dev_fallback ? 'allowed' : 'disabled'})`);
    if (database.migrations && database.migrations.pending > 0) {
        console.warn(`[Startup] ${database.migrations.pending} pending migration(s). Run: npm run db:migrate`);
    }
    if (!health.ready_for_prod_data) {
        console.warn('[Startup] Not ready for production data mode — see npm run env:check');
    } else {
        console.log('[Startup] Production data mode prerequisites look OK');
    }
}