// @ts-check
/**
 * The learner's connected apps (Phase 1, doc/brushup-2026/ai-access-plan.ja.md §5): agents the
 * learner connected to the remote MCP endpoint with Supabase OAuth. Mounted by server.js at
 * /api/v2/user/connected-apps behind requireAuth, so an agent's own OAuth token never reaches it
 * (requireAuth answers 401 oauth_client_token).
 *
 * GET  /                  → { apps: [{ clientId, clientName, firstSeenAt, lastUsedAt, revokedAt }] }
 *                           Rise Path's records (mcp_oauth_grants, written by the remote MCP server),
 *                           most recently used (or revoked) first. firstSeenAt and lastUsedAt are
 *                           null for an app that was revoked before it ever called the endpoint.
 *                           The front merges them with supabase.auth.oauth.listGrants().
 * POST /:clientId/revoke  → { ok: true }. Body (optional): { clientName } — the name the front
 *                           read from listGrants, kept so the page can still name the app once
 *                           Supabase has dropped the grant (trimmed, control characters removed,
 *                           at most CLIENT_NAME_MAX characters; anything else is ignored).
 *                           Sets revoked_at = now() (inserting the row, with no first or last use,
 *                           when the app was never used), so the remote MCP verifier refuses every
 *                           token of that user and client issued before now. The front then calls
 *                           supabase.auth.oauth.revokeGrant({ clientId }), which ends the refresh
 *                           tokens, and POSTs here again so a token refreshed between the two steps
 *                           is refused too. A later consent issues new tokens that pass.
 *
 * Only the caller's own rows are read or written. The database being unavailable answers 503
 * connected_apps_unavailable; a clientId that is not a UUID answers 400 invalid_client_id.
 * Table: server/migrations/015_mcp_oauth_grants.sql.
 */
import express from 'express';
import { getPool } from '../db.js';
import { isUuid } from '../utils/ids.js';

const router = express.Router();

/** At most this many apps are listed (DCR lets anyone register clients; a learner has a few). */
export const CONNECTED_APPS_LIMIT = 100;

/** Longest client name kept, in characters (the name is the client's own, untrusted text). */
export const CLIENT_NAME_MAX = 100;

// Bidirectional marks, overrides and isolates (they could reorder the text around the name on
// the page) are dropped; C0 and C1 controls (newlines and tabs included) become one space.
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const CONTROLS = /[\p{Cc}\s]+/gu;

/**
 * The client name to store, or null when there is none worth keeping.
 * @param {unknown} value
 * @returns {string | null}
 */
export function cleanClientName(value) {
  if (typeof value !== 'string') return null;
  const flat = value.replace(BIDI_CONTROLS, '').replace(CONTROLS, ' ').trim();
  const name = Array.from(flat).slice(0, CLIENT_NAME_MAX).join('').trim();
  return name || null;
}

/** @param {import('express').Request} req */
const userIdOf = (req) => /** @type {string} */ (/** @type {any} */ (req).userId);

/** @param {unknown} value @returns {string | null} */
const iso = (value) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(/** @type {any} */ (value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** @param {import('express').Response} res @param {unknown} [error] */
function unavailable(res, error) {
  if (error) console.error('[ConnectedApps] request failed:', /** @type {any} */ (error)?.code || '', /** @type {any} */ (error)?.message ?? error);
  res.status(503).json({ error: 'Connected apps are unavailable right now. Please try again later.', error_type: 'connected_apps_unavailable' });
}

router.get('/', async (req, res) => {
  const pool = getPool();
  if (!pool) return unavailable(res);
  try {
    const { rows } = await pool.query(
      `SELECT client_id, client_name, first_seen_at, last_used_at, revoked_at
         FROM mcp_oauth_grants
        WHERE user_id = CAST($1 AS uuid)
        ORDER BY COALESCE(last_used_at, revoked_at) DESC NULLS LAST, client_id
        LIMIT ${CONNECTED_APPS_LIMIT}`,
      [userIdOf(req)],
    );
    res.json({
      apps: rows.map((row) => ({
        clientId: String(row.client_id),
        clientName: typeof row.client_name === 'string' && row.client_name ? row.client_name : null,
        firstSeenAt: iso(row.first_seen_at),
        lastUsedAt: iso(row.last_used_at),
        revokedAt: iso(row.revoked_at),
      })),
    });
  } catch (error) {
    unavailable(res, error);
  }
});

router.post('/:clientId/revoke', async (req, res) => {
  const clientId = req.params.clientId;
  if (!isUuid(clientId)) {
    return res.status(400).json({ error: 'clientId must be a UUID.', error_type: 'invalid_client_id' });
  }
  const pool = getPool();
  if (!pool) return unavailable(res);
  try {
    // A row inserted here was never used: first_seen_at and last_used_at stay NULL until the
    // remote MCP server sees the app (after a new consent). A name already stored is kept when
    // this request carries none.
    await pool.query(
      `INSERT INTO mcp_oauth_grants (user_id, client_id, client_name, first_seen_at, last_used_at, revoked_at)
       VALUES (CAST($1 AS uuid), CAST($2 AS uuid), $3, NULL, NULL, now())
       ON CONFLICT (user_id, client_id) DO UPDATE
         SET revoked_at = now(), client_name = COALESCE(EXCLUDED.client_name, mcp_oauth_grants.client_name)`,
      [userIdOf(req), clientId.toLowerCase(), cleanClientName(req.body?.clientName)],
    );
    res.json({ ok: true });
  } catch (error) {
    unavailable(res, error);
  }
});

export default router;
