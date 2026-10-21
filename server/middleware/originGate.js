/**
 * Origin gate: the API answers only its own edge (Vercel → Cloudflare Tunnel → this app).
 *
 * Vercel's routes add `x-origin-secret: <ORIGIN_SECRET>` to every request they proxy to
 * https://api.<domain>. With ORIGIN_SECRET set, every other non-loopback caller gets 403 before
 * any body is read, so direct hits on api.<domain> cost almost nothing. Tailnet callers of port
 * 3006 need the header too (and then count as edge requests, so the bridge token does not work
 * for them). Loopback callers (the compose healthcheck, the container smoke) stay exempt, unless
 * the request came through Cloudflare: a cloudflared or proxy in the api's own network namespace
 * or on the host must not make tunnel traffic look local.
 *
 * With ORIGIN_SECRET unset the gate is off and fails closed on its own: a request that came
 * through Cloudflare (cf-ray, cf-connecting-ip, or a cdn-loop naming cloudflare) gets 403, so a
 * cloudflared left running after a rollback cannot publish an ungated API. Every other request
 * passes as before (tailnet, loopback, local dev). server.js also refuses to start when
 * COMPOSE_PROFILES lists `tunnel` without ORIGIN_SECRET (tunnelProfileWithoutSecret).
 *
 * An accepted edge request is then limited to the paths the edge proxies (/api/*, cached TTS
 * audio, generated images), and req.ip becomes the visitor's address (the first X-Forwarded-For
 * entry, which Vercel sets), so the per-IP limits key on visitors instead of Vercel's egress IPs.
 *
 * ORIGIN_SECRET_PREVIOUS is accepted next to ORIGIN_SECRET during a rotation. Neither value is
 * ever logged; a weak value stops the server at startup with an error that names the variable.
 */
import crypto from 'node:crypto';
import net from 'node:net';

export const ORIGIN_SECRET_HEADER = 'x-origin-secret';

const MIN_SECRET_LENGTH = 32;
const MAX_HEADER_LENGTH = 512;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const EDGE_PATH = /^\/(api\/.+|audio\/cache\/[a-f0-9]{64}[.](mp3|wav)|generated\/img_[a-f0-9]{64}[.](png|jpg|webp))$/;
const ENCODED_SEPARATOR = /%(2f|5c|2e)/i;
const REFUSAL_LOG_INTERVAL_MS = 60 * 1000;

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest();

/**
 * Reads ORIGIN_SECRET (and ORIGIN_SECRET_PREVIOUS during a rotation) and returns their SHA-256
 * digests. [] means the gate is off. Throws on a weak or placeholder value, naming the variable.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Buffer[]}
 */
export function readOriginSecrets(env = process.env) {
    const current = String(env.ORIGIN_SECRET ?? '').trim();
    const previous = String(env.ORIGIN_SECRET_PREVIOUS ?? '').trim();
    if (!current) {
        if (previous) throw new Error('ORIGIN_SECRET_PREVIOUS is set without ORIGIN_SECRET; set ORIGIN_SECRET to the new value.');
        return [];
    }
    const checked = [['ORIGIN_SECRET', current]];
    if (previous) checked.push(['ORIGIN_SECRET_PREVIOUS', previous]);
    return checked.map(([name, value]) => {
        if (value.length < MIN_SECRET_LENGTH) throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters.`);
        if (value.startsWith('$')) throw new Error(`${name} starts with '$': an unexpanded variable reference, not a secret.`);
        if (value.toLowerCase().includes('change-me')) throw new Error(`${name} still holds the 'change-me' placeholder.`);
        return sha256(value);
    });
}

/**
 * True when COMPOSE_PROFILES lists `tunnel` (comma-separated, spaces ignored) and ORIGIN_SECRET is
 * unset, so cloudflared would publish an ungated API; server.js then exits before listening.
 * @param {Record<string, string | undefined>} [env]
 */
export function tunnelProfileWithoutSecret(env = process.env) {
    const profiles = String(env.COMPOSE_PROFILES ?? '').split(',').map((profile) => profile.trim());
    return profiles.includes('tunnel') && readOriginSecrets(env).length === 0;
}

/** True when Cloudflare forwarded the request: cf-ray, cf-connecting-ip, or a cdn-loop naming cloudflare. */
const cameThroughCloudflare = (headers = {}) => headers['cf-ray'] != null
    || headers['cf-connecting-ip'] != null
    || /cloudflare/i.test(String(headers['cdn-loop'] ?? ''));

/** True when the raw path holds an encoded separator or dot, a backslash or a '.'/'..' segment. */
const isAmbiguousPath = (rawPath) => ENCODED_SEPARATOR.test(rawPath)
    || rawPath.includes('\\')
    || rawPath.split('/').some((segment) => segment === '.' || segment === '..');

const refuse = (res, status, error) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.status(status).json({ error });
};

/**
 * Express middleware; mount it first, before CORS, body parsing, logging and the limiters.
 * @param {{ env?: Record<string, string | undefined>, exemptLoopback?: boolean, logger?: Pick<Console, 'warn'> }} [options]
 * @returns {import('express').RequestHandler & { enabled: boolean, acceptedSecrets: number }}
 */
export function createOriginGate({ env = process.env, exemptLoopback = true, logger = console } = {}) {
    const digests = readOriginSecrets(env);

    // Counts only: one line per minute at most, never a header value.
    let refusals = 0;
    let lastLogAt = 0;
    const reason = digests.length > 0 ? 'without a valid origin secret' : 'from Cloudflare while ORIGIN_SECRET is unset';
    const noteRefusal = () => {
        refusals += 1;
        const now = Date.now();
        if (now - lastLogAt < REFUSAL_LOG_INTERVAL_MS) return;
        logger.warn(`[OriginGate] refused ${refusals} request(s) ${reason}`);
        refusals = 0;
        lastLogAt = now;
    };

    if (digests.length === 0) {
        // Off: tunnel traffic is refused, everything else passes through unchanged.
        const off = (req, res, next) => {
            if (!cameThroughCloudflare(req.headers)) return next();
            noteRefusal();
            return refuse(res, 403, 'forbidden');
        };
        return Object.assign(off, { enabled: false, acceptedSecrets: 0 });
    }

    const matches = (provided) => {
        if (typeof provided !== 'string' || provided.length < 1 || provided.length > MAX_HEADER_LENGTH) return false;
        const digest = sha256(provided);
        let matched = false;
        // Every digest is compared, so the timing does not tell which one (if any) matched.
        for (const accepted of digests) {
            if (crypto.timingSafeEqual(digest, accepted)) matched = true;
        }
        return matched;
    };

    const gate = (req, res, next) => {
        if (exemptLoopback && LOOPBACK.has(req.socket?.remoteAddress) && !cameThroughCloudflare(req.headers)) {
            req.originGate = 'loopback';
            return next();
        }

        if (!matches(req.headers[ORIGIN_SECRET_HEADER])) {
            noteRefusal();
            return refuse(res, 403, 'forbidden');
        }
        delete req.headers[ORIGIN_SECRET_HEADER];

        // req.path is the raw (still percent-encoded) path, so encoded traversal is caught here,
        // before express.static would decode and normalize it.
        if (isAmbiguousPath(req.path) || !EDGE_PATH.test(req.path)) return refuse(res, 404, 'not_found');

        req.originGate = 'edge';
        const visitor = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
        if (net.isIP(visitor)) {
            Object.defineProperty(req, 'ip', { value: visitor, configurable: true, enumerable: true });
        }
        return next();
    };
    return Object.assign(gate, { enabled: true, acceptedSecrets: digests.length });
}
