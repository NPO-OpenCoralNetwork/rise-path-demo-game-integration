// @ts-check
/**
 * What the api's request logger and its last-resort 5xx line may print about a request (Phase 4,
 * owner decision D4; server.js). The docker logs on the VM are kept for a while (compose
 * x-logging: about 50 MB per container), so they get the shape of a request, not the person:
 *   - the query string and the hash are dropped (search terms, filters, tokens), except the edge
 *     smoke id (scripts/smoke-public-edge.mjs check 8: smoke=<12 hex characters>, random, no
 *     personal data), kept so the owner's `logs api | grep smoke=<id>` shows the query arrived
 *   - a UUID keeps its first 8 characters (admin paths name learners by id)
 *   - a date becomes :date (diary entries are addressed by day)
 *   - a path segment with an @ (or %40) becomes :email
 *   - an upload's file name becomes <13 digits>-:name (the learner's own file name)
 *   - any other run of 32 or more id characters becomes :token
 *   - at most 200 characters
 * Method, status, duration and auth= stay; no IP address is logged.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * @param {unknown} url req.originalUrl (any value; not a string → '')
 * @returns {string}
 */
export function redactUrl(url) {
    const raw = String(url ?? '').split('#')[0];
    const path = raw.split('?')[0]; // query strings are never logged…
    // …except the edge smoke id: exactly 12 lower-case hex characters, nothing else of the query.
    const smoke = /[?&]smoke=([0-9a-f]{12})(?:&|$)/.exec(raw);
    return path
        .replace(UUID, (id) => `${id.slice(0, 8)}…`)
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ':date')
        .replace(/[^/]*(?:@|%40)[^/]*/gi, ':email')
        .replace(/\b(\d{13})-[^/]+/g, '$1-:name')
        .replace(/[A-Za-z0-9_-]{32,}/g, ':token')
        .slice(0, 200) + (smoke ? `?smoke=${smoke[1]}` : '');
}

/**
 * What the last-resort 5xx line may print: never the error object (pg errors carry `detail` with
 * values, e.g. the full id of a foreign key refusal). Name, code and message only, each capped.
 * @param {unknown} err
 * @returns {string}
 */
export function describeError(err) {
    const e = /** @type {any} */ (err);
    const name = String(e?.name ?? 'Error').slice(0, 40);
    const code = e?.code ? ` ${String(e.code).slice(0, 20)}` : '';
    return `${name}${code}: ${String(e?.message ?? '').slice(0, 300)}`;
}
