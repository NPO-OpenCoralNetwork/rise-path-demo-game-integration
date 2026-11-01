// @ts-check
/**
 * The pilot list (Phase 9, owner decision D1; doc/guides/first-launch.ja.md 10.1–10.4): during the
 * closed pilot only the Supabase accounts on PILOT_ACCOUNT_IDS may use the app API. The Supabase
 * project is shared with Nexloom and P-School (children included), so closing the app's sign-up
 * alone would still let every one of their logins sign in; the list is what keeps D1's "staff and
 * adult testers only".
 *
 *   PILOT_ACCOUNT_IDS unset or empty  → off (every session as before; the local dev server, CI).
 *   PILOT_ACCOUNT_IDS set             → on, fail closed: comma-separated, each entry trimmed; an entry
 *                                        that is not a UUID (server/utils/ids.js UUID_RE) is ignored
 *                                        and counted (the startup line names its position, never its
 *                                        text). Set but no valid id → every Supabase session refused.
 *
 * Who is checked: every Supabase session (req.authMethod 'supabase-jwt'), an anonymous Supabase
 * user included (refused while the list is on, even if its id were listed: an anonymous user is
 * nobody's pilot account). Never checked: the bridge token (PHASE1_USER_ID), the dev fallbacks and
 * callers without a token (guests). No route is exempt.
 *
 * Refusal: 403 { error, error_type: 'pilot_only' } (403, never 401: the browser and the lesson sync
 * read 401 as sign-in trouble); the app shows a full-page notice (components/common/PilotOnlyView.tsx).
 *
 * Where: the three auth middlewares (requireAuth and optionalAuth in auth.js, requireBridgeOrAuth in
 * bridgeAuth.js) ask pilotRefuses() as soon as Supabase named the user, before anything is written
 * for that account: no account check that may re-open a deleted account (which writes the auth.users
 * stub and a progress epoch, tools/core/accountDeletions.js reopenAccount: a former tester whose data
 * was deleted signs in again), and no stub (server/db.js syncAuthUserStub). They answer 403
 * PILOT_ONLY_REFUSAL; optionalAuth too (never a silent downgrade to guest). requireAuth and
 * requireBridgeOrAuth first make one read-only lookup (auth.js refusePilotSession): a session that
 * signed in before its account's deletion still gets 401 account_deleted, as without the list, so a
 * former tester's old device forgets the deleted account (Phase 4 §5.11; final review, finding 19).
 *
 * Not checked here: the SSE MCP on :3100 (mcp-server/sseUserAuth.js; Tailscale only, never behind
 * the tunnel) and the remote MCP (byoa, off at the first launch; preflight V4 refuses byoa with the
 * list). The list is read from process.env on every request (tests change it; the VM restarts the
 * api on every deploy).
 */
import { UUID_RE } from '../utils/ids.js';

/** The stack.env name (deploy/risepath-vm; scripts/deploy/preflight-rules.mjs KNOWN_KEYS, V1–V4). */
export const PILOT_ENV = 'PILOT_ACCOUNT_IDS';

/** The 403 body for a Supabase session that is not on the pilot list. */
export const PILOT_ONLY_REFUSAL = Object.freeze({
    error: 'This account is not part of the current trial.',
    error_type: 'pilot_only',
});

/**
 * @typedef {{ on: boolean, ids: ReadonlySet<string>, ignored: readonly number[] }} PilotList
 *   ids are lower case; ignored holds the 1-based positions of the entries that are not UUIDs.
 */

/**
 * Reads PILOT_ACCOUNT_IDS.
 * @param {Record<string, string | undefined>} [env]
 * @returns {PilotList}
 */
export function readPilotList(env = process.env) {
    const raw = env[PILOT_ENV];
    if (typeof raw !== 'string' || raw.trim() === '') return { on: false, ids: new Set(), ignored: [] };
    /** @type {Set<string>} */
    const ids = new Set();
    /** @type {number[]} */
    const ignored = [];
    raw.split(',').forEach((entry, index) => {
        const value = entry.trim();
        if (UUID_RE.test(value)) ids.add(value.toLowerCase());
        else ignored.push(index + 1);
    });
    return { on: true, ids, ignored };
}

/**
 * Whether the list refuses this Supabase user (false while the list is off).
 * @param {{ id?: unknown, isAnonymous?: boolean }} user the user Supabase named for the token
 * @param {Record<string, string | undefined>} [env]
 */
export function pilotRefuses({ id, isAnonymous }, env = process.env) {
    const list = readPilotList(env);
    if (!list.on) return false;
    if (isAnonymous === true) return true;
    return !(typeof id === 'string' && list.ids.has(id.toLowerCase()));
}

/**
 * Startup lines for server.js: '[Pilot] off', or the count of accounts and, when some entries were
 * ignored, their positions. Never an id.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function pilotStartupLines(env = process.env) {
    const list = readPilotList(env);
    if (!list.on) return ['[Pilot] off'];
    const lines = [`[Pilot] on: ${list.ids.size} account${list.ids.size === 1 ? '' : 's'}`];
    if (list.ignored.length > 0) {
        lines.push(`[Pilot] ignored: ${list.ignored.length} entr${list.ignored.length === 1 ? 'y' : 'ies'} (position${list.ignored.length === 1 ? '' : 's'} ${list.ignored.join(', ')})`);
    }
    if (list.ids.size === 0) lines.push('[Pilot] no valid account id: every signed-in session is refused (403 pilot_only)');
    return lines;
}
