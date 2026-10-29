-- Rise Path migration 015: connected apps (Phase 1, doc/brushup-2026/ai-access-plan.ja.md §5).
-- An adult connects their own agent (Claude Code, Codex, ChatGPT, …) to the remote MCP endpoint
-- through Supabase's OAuth 2.1 server. Supabase keeps the consent itself; this table is Rise Path's
-- own record of each (learner, OAuth client) pair:
--
-- - The remote MCP server (mcp-server/remote.js) upserts the row on authenticated requests and
--   moves last_used_at forward (at most once a minute per user and client); first_seen_at is set
--   on the first use only. Rows come from the resource server, not the consent page: an
--   already-consented client never shows the page again.
-- - The connected-apps page revokes through POST /api/v2/user/connected-apps/:clientId/revoke
--   (server/routes/connectedApps.js), which sets revoked_at = now() before the front calls
--   supabase.auth.oauth.revokeGrant, and again after it. mcp-server/oauthVerifier.js then refuses
--   every access token of that user and client whose iat is earlier than revoked_at, so revoking
--   takes effect within a few seconds instead of when the token expires (up to an hour). Tokens
--   issued after a new consent pass. Revoking an app that never called the endpoint inserts the
--   row with first_seen_at and last_used_at NULL ("not used yet").
--
-- client_id is Supabase's OAuth client id (auth.oauth_clients lives in Supabase, not here, so no
-- FK). client_name is the name the client registered, as listGrants showed it to the learner
-- (untrusted text, trimmed and capped by the app API). The revoke request stores it, so the page
-- can still name an app after Supabase has dropped its grant.
-- revoked_at and client_name are written only by the app API; the remote MCP server writes
-- first_seen_at and last_used_at only.
CREATE TABLE IF NOT EXISTS mcp_oauth_grants (
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id     uuid        NOT NULL,
  client_name   text        NULL,
  first_seen_at timestamptz NULL DEFAULT now(),
  last_used_at  timestamptz NULL DEFAULT now(),
  revoked_at    timestamptz NULL,
  PRIMARY KEY (user_id, client_id)
);

-- A database created from an earlier draft of this migration had both dates NOT NULL. Dropping
-- NOT NULL is a no-op when the column already allows NULL, so this runs safely every time.
ALTER TABLE mcp_oauth_grants ALTER COLUMN first_seen_at DROP NOT NULL;
ALTER TABLE mcp_oauth_grants ALTER COLUMN last_used_at DROP NOT NULL;
