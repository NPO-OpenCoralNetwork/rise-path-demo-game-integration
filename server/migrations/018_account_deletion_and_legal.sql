-- Rise Path migration 018: account deletion, proof of consent, retention (Phase 4,
-- doc/brushup-2026/ai-access-plan.ja.md §8).
--
-- 1. Four foreign keys to auth.users were NO ACTION (001 curriculum_versions.created_by,
--    approvals.decided_by, jobs.user_id; 005 mcp_sessions.user_id) and blocked deleting a
--    learner's auth.users stub (the curricula cascade does not reach created_by before the NO
--    ACTION check). Authors become NULL (SET NULL keeps a version or approval in someone else's
--    curriculum); a learner's own jobs and MCP sessions go with the account (CASCADE). Every FK of
--    those columns to auth.users is dropped by catalog lookup (whatever its name) and added again.
-- 2. account_deletions: one row per deleted Rise Path account (the Supabase login is shared with
--    Nexloom and P-School and is not deleted). No FK: it outlives the stub on purpose.
--    deleted_at: a token whose session signed in (newest JWT amr timestamp) no later than
--    deleted_at + 30 s is refused everywhere (server/middleware/auth.js, mcp-server/sseUserAuth.js,
--    mcp-server/oauthVerifier.js). reopened_at: a later password sign-in to the app started a new,
--    empty account under the same id; its epoch seconds are the account generation (Hermes
--    conversation keys, the Stripe Customer idempotency key). requested_by: 'self' (Settings),
--    'staff' (scripts/delete-account-data.mjs --user), 'orphan' (--orphans: the shared login was
--    deleted outside Rise Path). Deleted 5 years after deleted_at (server/services/retention.js).
--    Every account lock key is 'rp:account:' || <id>::uuid::text (lower case), here and in the app.
-- 3. users_skip_deleted_account: no stub row for a deleted id until it is re-opened, so no stub
--    inserter (server/db.js, tools/core/mcpUserScope.js, mcp-server/remote.js, mcp-server/index.js)
--    can bring a deleted account back. It takes a shared advisory lock that the deletion holds
--    exclusively until COMMIT, then reads the tombstone with a fresh snapshot: a request that passed
--    its token check just before the deletion cannot recreate the stub after it.
--    The inserting role needs SELECT (user_id, reopened_at) on account_deletions, and mcp-public's
--    token check (mcp-server/oauthVerifier.js) deleted_at too: SELECT (user_id, deleted_at,
--    reopened_at) is granted below when risepath_mcp_remote exists, and in
--    deploy/risepath-vm/sql/mcp_remote_role.sql.
-- 4. legal_document_versions: every terms/privacy version an account accepted, with the SHA-256 of
--    its public text (shared/legal/versions.js; released texts in content/legal/archive/).
--    Never updated or deleted (trigger).
-- 5. legal_acceptances: proof that an account accepted a terms version and was shown a privacy
--    version. Only the account id, the versions and the time (owner decision D5). No FK to
--    auth.users: on account deletion account_deleted_at is set and the row stays 5 years, then
--    retention deletes it. Inserted only under the account's shared lock and only while the stub
--    exists (server/routes/legal.js). No IP address, user agent, email or name.
-- 6. account_consent_proofs: the guardian AI consents (account_consents, 014) of a deleted account,
--    copied by the deletion before the cascade: kind, policy version, method, given and revoked
--    times (no relationship, no recorded_by). No FK. Deleted 5 years after the account (D5). The
--    consent texts are archived in content/legal/archive/<policy_version>.ja.md.
-- 7. ai_app_provision_records: which AI app (OAuth client id and name) a deleted account had used,
--    first and last use, revocation; only grants that were used. Kept 3 years in case connecting an
--    AI app counts as provision to a third party (APPI Art. 29, 施行規則 第19条・第21条; lawyer item).
-- 8. Retention index for jobs (every status: a job left 'running' by a stopped worker is also pruned).
-- No grant on 4–7 to risepath_mcp_remote. No row level security (as in 006 and later).

-- 1. Foreign keys
DO $$
DECLARE
  fk  record;
  con record;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('curriculum_versions', 'created_by', 'SET NULL'),
      ('approvals',           'decided_by', 'SET NULL'),
      ('jobs',                'user_id',    'CASCADE'),
      ('mcp_sessions',        'user_id',    'CASCADE')
    ) AS t(tbl, col, action)
  LOOP
    FOR con IN
      SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = fk.col
       WHERE c.contype = 'f'
         AND c.conrelid = format('public.%I', fk.tbl)::regclass
         AND c.confrelid = 'auth.users'::regclass
         AND c.conkey = ARRAY[a.attnum]
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', fk.tbl, con.conname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE %s',
      fk.tbl, fk.tbl || '_' || fk.col || '_fkey', fk.col, fk.action);
  END LOOP;
END $$;

-- 2. Tombstone
CREATE TABLE IF NOT EXISTS account_deletions (
  user_id      uuid        PRIMARY KEY,
  deleted_at   timestamptz NOT NULL,
  requested_by text        NOT NULL CHECK (requested_by IN ('self', 'staff', 'orphan')),
  reopened_at  timestamptz NULL,
  CHECK (reopened_at IS NULL OR reopened_at >= deleted_at)
);
CREATE INDEX IF NOT EXISTS account_deletions_deleted_at_idx ON account_deletions (deleted_at);

-- 3. No stub for a deleted account until a new app sign-in re-opens it
CREATE OR REPLACE FUNCTION public.rp_skip_deleted_account_stub() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('rp:account:' || NEW.id::text, 0));
  IF EXISTS (SELECT 1 FROM public.account_deletions d WHERE d.user_id = NEW.id AND d.reopened_at IS NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  CREATE TRIGGER users_skip_deleted_account
    BEFORE INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.rp_skip_deleted_account_stub();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Version archive (hash; released texts in content/legal/archive/<version>.ja.md)
CREATE TABLE IF NOT EXISTS legal_document_versions (
  version     text        PRIMARY KEY CHECK (version ~ '^(terms|privacy)-(draft-)?[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,2})?$'),
  document    text        NOT NULL CHECK (document IN ('terms', 'privacy')),
  sha256      text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_with(version, document || '-'))
);

CREATE OR REPLACE FUNCTION public.rp_rows_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows never change', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

DO $$ BEGIN
  CREATE TRIGGER legal_document_versions_immutable
    BEFORE UPDATE OR DELETE ON legal_document_versions
    FOR EACH ROW EXECUTE FUNCTION public.rp_rows_immutable();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Proof of acceptance (no FK to auth.users)
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL,
  terms_version      text        NOT NULL REFERENCES legal_document_versions(version) CHECK (starts_with(terms_version, 'terms-')),
  privacy_version    text        NOT NULL REFERENCES legal_document_versions(version) CHECK (starts_with(privacy_version, 'privacy-')),
  accepted_at        timestamptz NOT NULL DEFAULT now(),
  account_deleted_at timestamptz NULL,
  CHECK (account_deleted_at IS NULL OR account_deleted_at >= accepted_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_acceptances_live_uniq
  ON legal_acceptances (user_id, terms_version, privacy_version) WHERE account_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx ON legal_acceptances (user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS legal_acceptances_deleted_idx
  ON legal_acceptances (account_deleted_at) WHERE account_deleted_at IS NOT NULL;

-- 6. Guardian AI consent proof of a deleted account (no FK)
CREATE TABLE IF NOT EXISTS account_consent_proofs (
  consent_id         uuid        PRIMARY KEY,          -- account_consents.id
  user_id            uuid        NOT NULL,
  kind               text        NOT NULL,
  policy_version     text        NOT NULL,
  method             text        NOT NULL,
  given_at           timestamptz NOT NULL,
  revoked_at         timestamptz NULL,
  account_deleted_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS account_consent_proofs_deleted_idx ON account_consent_proofs (account_deleted_at);

-- 7. AI apps a deleted account had used (no FK)
CREATE TABLE IF NOT EXISTS ai_app_provision_records (
  user_id            uuid        NOT NULL,
  client_id          uuid        NOT NULL,
  client_name        text        NULL,
  first_seen_at      timestamptz NULL,
  last_used_at       timestamptz NULL,
  revoked_at         timestamptz NULL,
  account_deleted_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, client_id, account_deleted_at)
);
CREATE INDEX IF NOT EXISTS ai_app_provision_records_deleted_idx ON ai_app_provision_records (account_deleted_at);

-- 8. Retention
CREATE INDEX IF NOT EXISTS jobs_updated_idx ON jobs (updated_at);

-- The trigger runs as the inserting role. Re-running mcp_remote_role.sql keeps this grant.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'risepath_mcp_remote') THEN
    GRANT SELECT (user_id, deleted_at, reopened_at) ON account_deletions TO risepath_mcp_remote;
  END IF;
END $$;
