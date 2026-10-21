/**
 * Shared .env loader
 *
 * Used by both server.js and mcp-server/index.js.
 * Reads .env.local from project root without external dependencies.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

/** Always prefer .env.local for MCP/Grok stdio (parent may inject empty placeholders). */
const FORCE_FROM_DOTENV = new Set([
    'RISE_PATH_ACTIVE_SESSION_KEY',
    'MEMANTO_ENABLED',
    'MEMANTO_API_URL',
    'MEMANTO_SECRET_KEY',
    'DATABASE_URL_PHASE1',
]);

function envIsUnset(key) {
    const val = process.env[key];
    return val === undefined || val === null || String(val).trim() === '';
}

/**
 * Loads the first of .env.local and .env found in `dir` into process.env. Variables that are already
 * set (and not empty) keep their value, except the `force` keys.
 * @param {{ dir?: string, force?: Iterable<string> }} [options]
 *   force: keys the file always wins for. The MCP server keeps the default list; the API server
 *   passes [] so the deployment's own environment always wins.
 */
export async function loadEnv({ dir = rootDir, force = FORCE_FROM_DOTENV } = {}) {
    const forced = new Set(force);
    const envFiles = ['.env.local', '.env'];
    for (const envFile of envFiles) {
        try {
            const raw = await fs.readFile(path.join(dir, envFile), 'utf8');
            raw.split(/\r?\n/).forEach((line) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                const norm = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
                const sep = norm.indexOf('=');
                if (sep === -1) return;
                const key = norm.slice(0, sep).trim();
                if (!key) return;
                if (!forced.has(key) && !envIsUnset(key)) return;
                let val = norm.slice(sep + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                process.env[key] = val;
            });
            break; // stop after first found file
        } catch (error) {
            // Missing file: try the next one.
            if (error?.code !== 'ENOENT') console.warn(`Failed to load ${envFile}:`, error.message);
        }
    }
}
