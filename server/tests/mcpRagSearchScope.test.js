/**
 * The MCP rag-search tool searches as the resolved caller, never as "everyone".
 *
 * Runs the real stdio server: without a session key in production the tool refuses with
 * session_binding_required; with a key it reaches searchContent with that user (and, with no DB,
 * stops at db_connection instead of the validation error searchContent gives without a userId).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const USER = '00000000-0000-0000-0000-0000000000aa';

const SESSION_KEY_VARS = ['RISE_PATH_ACTIVE_SESSION_KEY', 'HERMES_ACTIVE_SESSION_KEY', 'X_HERMES_SESSION_KEY'];

const callRagSearch = async (env) => {
    const base = { ...process.env };
    for (const key of SESSION_KEY_VARS) delete base[key];
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(ROOT, 'mcp-server/index.js')],
        cwd: ROOT,
        env: { ...base, RISE_PATH_MCP_PROFILE: 'learner', DATABASE_URL_PHASE1: '', ...env },
        stderr: 'pipe',
    });
    const client = new Client({ name: 'mcp-rag-search-scope-test', version: '1.0.0' });
    await client.connect(transport);
    try {
        const result = await client.callTool({ name: 'rag-search', arguments: { query: 'blender modifiers' } });
        return JSON.parse(result.content[0].text);
    } finally {
        await client.close();
    }
};

describe('MCP rag-search user scope (stdio)', () => {
    it('refuses in production when no user can be resolved', async () => {
        const payload = await callRagSearch({ NODE_ENV: 'production' });
        assert.equal(payload.error_type, 'session_binding_required');
    });

    it('searches as the user from the session key', async () => {
        const payload = await callRagSearch({ NODE_ENV: 'production', RISE_PATH_ACTIVE_SESSION_KEY: `rp:user:${USER}` });
        // A userId reached searchContent: it stops at the missing DB, not at the userId check.
        assert.equal(payload.error_type, 'db_connection');
    });
});
