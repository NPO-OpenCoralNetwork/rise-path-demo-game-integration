/**
 * A fake Supabase Auth on 127.0.0.1 for the remote MCP tests: an ES256 JWKS made with node:crypto
 * at /auth/v1/.well-known/jwks.json, and /auth/v1/user. Every request is counted, so a test can
 * assert that a bad token never reached Supabase. Tokens are signed locally (sign / accessToken).
 * Not a test file (npm test runs *.test.js).
 */
import http from 'node:http';
import { createHmac, generateKeyPairSync, randomUUID, sign as cryptoSign } from 'node:crypto';

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** A fresh P-256 key pair and its public JWK. */
export function makeEs256Key(kid) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' } };
}

/**
 * A compact JWS. alg ES256 (with `key`) or HS256 (with `secret`); kid omitted when null.
 * @param {Record<string, unknown>} payload
 * @param {{ key?: ReturnType<typeof makeEs256Key>, kid?: string | null, alg?: string, secret?: string }} options
 */
export function signJwt(payload, { key, kid = key?.kid ?? null, alg = 'ES256', secret = 'shh' } = {}) {
    const header = { alg, typ: 'JWT', ...(kid ? { kid } : {}) };
    const data = `${b64(header)}.${b64(payload)}`;
    let signature;
    if (alg === 'HS256') signature = createHmac('sha256', secret).update(data).digest();
    else signature = cryptoSign('sha256', Buffer.from(data), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
    return `${data}.${signature.toString('base64url')}`;
}

/**
 * Start the fake. `calls` counts requests per path; `jwksDown` makes the JWKS answer 503.
 * @param {{ keys?: ReturnType<typeof makeEs256Key>[] }} [options]
 */
export async function startFakeSupabase({ keys } = {}) {
    const signing = makeEs256Key('test-key-1');
    const published = keys ?? [signing];
    const state = { jwksDown: false, calls: { jwks: 0, user: 0, other: 0 }, published };
    const server = http.createServer((req, res) => {
        const path = (req.url ?? '').split('?')[0];
        if (path === '/auth/v1/.well-known/jwks.json') {
            state.calls.jwks += 1;
            if (state.jwksDown) {
                res.writeHead(503, { 'content-type': 'application/json' });
                return res.end('{"message":"down"}');
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ keys: state.published.map((k) => k.jwk) }));
        }
        if (path === '/auth/v1/user') {
            state.calls.user += 1;
            res.writeHead(401, { 'content-type': 'application/json' });
            return res.end('{"code":401,"error_code":"bad_jwt","msg":"invalid JWT"}');
        }
        state.calls.other += 1;
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const issuer = `${url}/auth/v1`;

    return {
        url,
        issuer,
        signing,
        state,
        calls: state.calls,
        resetCalls() {
            state.calls.jwks = 0;
            state.calls.user = 0;
            state.calls.other = 0;
        },
        /** Calls that reached Supabase at all. */
        totalCalls: () => state.calls.jwks + state.calls.user + state.calls.other,
        /**
         * An OAuth access token as Supabase issues it with our hook: claims overridable, `null`
         * removes a claim.
         * @param {{ resource: string, sub: string, clientId?: string }} who
         * @param {Record<string, unknown>} [overrides]
         * @param {Parameters<typeof signJwt>[1]} [signOptions]
         */
        accessToken({ resource, sub, clientId = 'c1c1c1c1-0000-4000-8000-000000000001' }, overrides = {}, signOptions = {}) {
            const now = Math.floor(Date.now() / 1000);
            const claims = {
                iss: issuer,
                aud: resource,
                sub,
                exp: now + 3600,
                iat: now - 5,
                role: 'authenticated',
                aal: 'aal1',
                session_id: randomUUID(),
                email: 'learner@example.org',
                is_anonymous: false,
                client_id: clientId,
                scope: 'email',
                ...overrides,
            };
            for (const [k, v] of Object.entries(claims)) if (v === null) delete claims[k];
            return signJwt(claims, { key: signing, ...signOptions });
        },
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}
