/**
 * The remote MCP endpoint in process for tests (mcp-server/remote.js + createMcpServer with the
 * learner-remote profile and mcp-server/remotePolicy.js): on a free 127.0.0.1 port, verifying
 * tokens against a fake Supabase (helpers/fakeSupabase.js), with in-memory daily caps
 * (createDailyCaps without a pool) and an MCP SDK client helper. The database is whatever
 * setPoolForTests installed. Not a test file (npm test runs *.test.js).
 */
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createDailyCaps } from '../../middleware/dailyCaps.js';
import { createOAuthVerifier } from '../../../mcp-server/oauthVerifier.js';
import { createRemoteApp, readRemoteConfig } from '../../../mcp-server/remote.js';
import { createRemotePolicy } from '../../../mcp-server/remotePolicy.js';
import { createMcpServer } from '../../../mcp-server/createMcpServer.js';

/** The one browser origin the test endpoint allows (MCP_ALLOWED_ORIGINS). */
export const ALLOWED_ORIGIN = 'https://inspector.example.org';

/**
 * Start the endpoint on a free port; the resource URL carries that port.
 * @param {{
 *   fake: { url: string },
 *   logger: { log: Function, warn: Function, error: Function },
 *   env?: Record<string, string>,
 *   limits?: { userPerMinute: number, unauthenticatedPerMinute: number },
 *   capsEnv?: Record<string, string>,
 *   policyEnv?: Record<string, string>,
 *   reserveCap?: Function,
 * }} options  capsEnv: AI_CAP_* values for the in-memory daily caps; policyEnv: more of the policy's
 *   environment (Phase 8: LEGAL_TERMS_REQUIRED turns the terms check on); reserveCap: in place of
 *   the in-memory caps' reserveFor (to count what is charged)
 */
export async function startRemoteEndpoint({ fake, logger, env = {}, limits, capsEnv = {}, policyEnv = {}, reserveCap }) {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const config = readRemoteConfig({
        MCP_REMOTE_TEST: '1',
        MCP_PUBLIC_RESOURCE_URL: `http://127.0.0.1:${port}/mcp`,
        SUPABASE_URL: fake.url,
        SUPABASE_ANON_KEY: 'anon-key-for-tests',
        MCP_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
        ...env,
    });
    const supabase = createClient(fake.url, 'anon-key-for-tests', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const verifier = createOAuthVerifier({ issuer: config.issuer, resource: config.resource, supabase, logger });
    const caps = createDailyCaps({ env: capsEnv, getPool: () => null, logger });
    const policy = createRemotePolicy({ env: { APP_PUBLIC_URL: 'https://app.example.org', ...policyEnv }, reserveCap: reserveCap ?? caps.reserveFor });
    const app = createRemoteApp({
        config,
        verifier,
        logger,
        limits: limits ?? { userPerMinute: 1000, unauthenticatedPerMinute: 1000 },
        createServer: () => createMcpServer({ profile: 'learner-remote', remote: policy }),
    });
    server.on('request', app);
    return { port, resource: config.resource, config, close: () => new Promise((resolve) => server.close(resolve)) };
}

/**
 * An MCP SDK client of the endpoint, authenticated with `token`.
 * @param {{ resource: string }} endpoint
 * @param {string} token
 */
export async function connectRemoteClient(endpoint, token) {
    const client = new Client({ name: 'remote-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.resource), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    return client;
}
