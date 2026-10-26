-- Least-privilege Postgres role for the public remote MCP (compose service mcp-public, profile
-- byoa; doc/guides/byoa-setup.ja.md). The api, mcp and migrations keep using risepath_app, which
-- the postgres image makes a superuser; the internet-facing mcp-public must not hold that.
--
-- Run on the VM after the migrations (015 creates mcp_oauth_grants, 016 lesson_progress, 018
-- account_deletions, 020 review_cards and review_log), from deploy/risepath-vm:
--
--   MCP_DB_PASSWORD="$(openssl rand -hex 24)"
--   docker compose --env-file stack.env exec -T db \
--     psql -U risepath_app -d risepath -v ON_ERROR_STOP=1 -v mcp_password="$MCP_DB_PASSWORD" \
--     < sql/mcp_remote_role.sql
--   # then put the same value into mcp-public.env:
--   # DATABASE_URL_PHASE1=postgresql://risepath_mcp_remote:<MCP_DB_PASSWORD>@db:5432/risepath
--
-- Safe to run again (it sets the password again and re-applies the grants). Run it again after a
-- migration adds a table that a learner-remote tool needs, and add that table below first.
--
-- What each grant is for (learner-remote profile, mcp-server/tool-registry.json):
--   auth.users            the user-id stub (server/db.js ensureAuthUser: INSERT … ON CONFLICT DO NOTHING)
--   account_deletions     the stub trigger and the token check: 018's trigger on auth.users reads
--                         user_id and reopened_at as the inserting role (no stub for a deleted
--                         account), and the verifier (mcp-server/oauthVerifier.js) refuses a deleted
--                         account's tokens with deleted_at too. Columns user_id, deleted_at,
--                         reopened_at; never requested_by. 018 grants the same when this role exists.
--   mcp_oauth_grants      the verifier's revocation check and the (user, client) record with
--                         first_seen_at and last_used_at (mcp-server/remote.js): columns user_id,
--                         client_id, revoked_at, first_seen_at, last_used_at; it never writes
--                         revoked_at and never reads client_name
--   user_age, account_consents, ai_safety_events
--                         adults-only check on every call (server/safety/access.js resolveAiAccess),
--                         only the columns it reads or filters on: never ai_safety_events.detail
--                         (learners' report text, admins only) or the consent's guardian details
--   ai_daily_usage        daily caps 'mcp' and 'mcp_write' (server/middleware/dailyCaps.js). Row
--                         level security is on for this table, and the only policies are for this
--                         role and those two kinds, so it cannot read or move the other AI caps.
--                         The table owner (risepath_app, a superuser on the VM) bypasses RLS and
--                         keeps working as before; any other non-owner role would see no rows
--                         until it gets a policy of its own.
--   user_profiles         role lookup only (admins skip the per-user cap): columns user_id, role,
--                         never display_name, big5, learning_style, preferences or history
--   user_progress         learner-state-get, learner-state-update (tools/core/learnerState.js)
--   lesson_progress       the course-* tools (tools/core/lessonProgress.js): read the learner's lesson
--                         progress, record quiz answers and sections read (INSERT … ON CONFLICT DO
--                         NOTHING, then SELECT … FOR UPDATE and UPDATE). No DELETE: only the learner's
--                         delete control in the app removes rows, together with lesson_progress_resets,
--                         which this role cannot read or write (nor lesson_progress_lesson_resets: a
--                         lesson started over in the app reads like an untouched one here).
--                         progress_changed_at (Phase 6) is kept by a trigger; a value this role sends
--                         is ignored
--   review_cards          course-review-due and course-review-grade (tools/core/reviewQueue.js): enter
--                         the cards the learner's lesson_progress rows imply (INSERT … SELECT … ON
--                         CONFLICT DO NOTHING; it reads learned_at to tell a card added to a lesson
--                         after the learner's last change in it), read the queue, grade one card
--                         (SELECT … FOR UPDATE, UPDATE of the memory columns). Column grants: never
--                         entered_at, never SELECT prior_rating, never DELETE (only the learner's
--                         reset and delete controls and account deletion remove rows)
--   review_log            course-review-grade appends one review (insert only, without review_day or
--                         reviewed_at, which the database stamps; never read: the history stays app-only)
--   learning_journal      journal-recent, journal-log, learner-adaptation-signals (tools/core/journal.js)
--   curricula             ownership check for journal-log and journal-recent (read only): columns
--                         id, user_id, title, never the generated course content
--   materials, material_chunks
--                         rag-search over the caller's own uploads (tools/core/ragSearch.js, read
--                         only): materials (id, user_id, status), never the title or storage path;
--                         material_chunks only the columns the search reads
--   mcp_tool_calls        the per-call log (mcp-server/createMcpServer.js, insert only)
-- Nothing else: no life journal, learner memory, learner profiles, agent session bindings,
-- curriculum writes or admin tables. Grants are per table or per column. A table added later is not
-- reachable until it is listed here, but a column added to a table granted whole (auth.users,
-- ai_daily_usage, user_progress, lesson_progress, learning_journal, mcp_tool_calls) is reachable at
-- once, so per-learner state this role must not see goes into its own table (Phase 5:
-- lesson_progress_lesson_resets, xp_awards, learning_days).

\set ON_ERROR_STOP on

-- Stop (exit code 3, nothing changed) without a password of at least 24 characters.
\if :{?mcp_password}
  SELECT length(:'mcp_password') >= 24 AS mcp_password_ok \gset
\else
  \set mcp_password_ok false
\endif
\if :mcp_password_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'mcp_remote_role.sql: pass -v mcp_password=<openssl rand -hex 24> (at least 24 characters)'; END $$;
\endif

BEGIN;

SELECT 'CREATE ROLE risepath_mcp_remote LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'risepath_mcp_remote') \gexec

ALTER ROLE risepath_mcp_remote WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD :'mcp_password';
-- A slow query must not hold a connection for long; tools answer within seconds.
ALTER ROLE risepath_mcp_remote SET statement_timeout = '10s';
ALTER ROLE risepath_mcp_remote SET idle_in_transaction_session_timeout = '30s';

-- Start from nothing, so re-running also removes grants this file no longer lists.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM risepath_mcp_remote;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM risepath_mcp_remote;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM risepath_mcp_remote;
REVOKE ALL ON SCHEMA public FROM risepath_mcp_remote;
REVOKE ALL ON SCHEMA auth FROM risepath_mcp_remote;
SELECT format('REVOKE ALL ON DATABASE %I FROM risepath_mcp_remote', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO risepath_mcp_remote', current_database()) \gexec

GRANT USAGE ON SCHEMA public, auth TO risepath_mcp_remote;

GRANT SELECT, INSERT ON auth.users TO risepath_mcp_remote;

-- Column-level: the endpoint records (user, client) and moves first_seen_at and last_used_at.
-- revoked_at and client_name are written only by the app API
-- (POST /api/v2/user/connected-apps/:id/revoke).
GRANT SELECT (user_id, client_id, revoked_at, first_seen_at, last_used_at) ON mcp_oauth_grants TO risepath_mcp_remote;
GRANT INSERT (user_id, client_id), UPDATE (first_seen_at, last_used_at) ON mcp_oauth_grants TO risepath_mcp_remote;
GRANT SELECT (user_id, birth_ym, declared_by) ON user_age TO risepath_mcp_remote;
GRANT SELECT (user_id, kind, policy_version, given_at, method, relationship, revoked_at) ON account_consents TO risepath_mcp_remote;
GRANT SELECT (user_id, deleted_at, reopened_at) ON account_deletions TO risepath_mcp_remote;
GRANT SELECT (user_id, kind, category, created_at) ON ai_safety_events TO risepath_mcp_remote;
GRANT SELECT (user_id, role) ON user_profiles TO risepath_mcp_remote;

GRANT SELECT, INSERT, UPDATE ON ai_daily_usage TO risepath_mcp_remote;
-- Only the remote kinds. The table owner bypasses RLS, so the api and the stdio mcp (risepath_app)
-- are unaffected. DROP + CREATE keeps a re-run idempotent.
ALTER TABLE ai_daily_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_remote_select ON ai_daily_usage;
DROP POLICY IF EXISTS mcp_remote_insert ON ai_daily_usage;
DROP POLICY IF EXISTS mcp_remote_update ON ai_daily_usage;
CREATE POLICY mcp_remote_select ON ai_daily_usage FOR SELECT TO risepath_mcp_remote
  USING (kind IN ('mcp', 'mcp_write'));
CREATE POLICY mcp_remote_insert ON ai_daily_usage FOR INSERT TO risepath_mcp_remote
  WITH CHECK (kind IN ('mcp', 'mcp_write'));
CREATE POLICY mcp_remote_update ON ai_daily_usage FOR UPDATE TO risepath_mcp_remote
  USING (kind IN ('mcp', 'mcp_write')) WITH CHECK (kind IN ('mcp', 'mcp_write'));

GRANT SELECT, INSERT, UPDATE ON user_progress TO risepath_mcp_remote;
GRANT SELECT, INSERT, UPDATE ON lesson_progress TO risepath_mcp_remote;
GRANT SELECT (user_id, course_slug, lesson_id, card_id, learned_at, due_day, stability, difficulty, reps, lapses, last_rating, last_review_day) ON review_cards TO risepath_mcp_remote;
GRANT INSERT (user_id, course_slug, lesson_id, card_id, learned_at, prior_rating, stability, difficulty, due_day), UPDATE (due_day, stability, difficulty, reps, lapses, last_rating, last_review_day) ON review_cards TO risepath_mcp_remote;
GRANT INSERT (user_id, course_slug, lesson_id, card_id, rating, elapsed_days, interval_days, stability, difficulty, source) ON review_log TO risepath_mcp_remote;
GRANT SELECT, INSERT ON learning_journal TO risepath_mcp_remote;
GRANT SELECT (id, user_id, title) ON curricula TO risepath_mcp_remote;
GRANT SELECT (id, user_id, status) ON materials TO risepath_mcp_remote;
GRANT SELECT (material_id, chunk_index, content, embedding, embedding_model, created_at) ON material_chunks TO risepath_mcp_remote;
GRANT INSERT ON mcp_tool_calls TO risepath_mcp_remote;

COMMIT;

\echo 'risepath_mcp_remote is ready. Put its password into mcp-public.env (DATABASE_URL_PHASE1).'
