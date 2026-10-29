-- Rise Path migration 021: job training, cohorts and memberships (doc/brushup-2026/training-plan.ja.md
-- §4.3, owner decisions D1, D3, D5, D7). A separate section: the lesson reader, lesson progress, XP,
-- reviews and the MCP tools never read these tables. The api answers /api/v2/training only with
-- TRAINING_ENABLED (server/routes/training.js); this migration applies on every deployment, so the
-- public Rise Path database gets the two tables too, empty.
--
-- training_cohorts: one row per cohort (期). Written only by the staff script
-- (scripts/training-admin.mjs). No account id: a cohort holds no personal data.
--
-- training_memberships: who is in which cohort, and as what (D7: user_profiles.role is not used).
-- No FK to auth.users (as legal_acceptances, 018): on account deletion account_deleted_at is set in
-- the deletion's transaction (server/services/accountDeletion.js, the tombstone's deleted_at) and
-- the row stays. Nothing deletes them on a timer until a retention period is decided (D3). Inserted
-- only under the account's shared lock and only while the auth.users stub exists (as
-- server/routes/legal.js), so no row outlives a deletion unmarked. The learner's own reads use
-- unmarked rows only; staff lists and exports read marked rows too. One live row per (cohort,
-- account): the unique index covers unmarked rows only (as legal_acceptances_live_uniq), so an id
-- re-opened after a deletion can be added again. Rows change only when the deletion marks them; no
-- trigger stops UPDATE (018's rp_rows_immutable would roll every deletion back).
--
-- Neither table is granted to the remote MCP role (scripts/ci/db-checks.sh checks it). No row level
-- security (as in 006 and later): every query is scoped by user_id or the cohort id.

CREATE TABLE IF NOT EXISTS training_cohorts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  starts_on  date        NULL,
  ends_on    date        NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS training_memberships (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id          uuid        NOT NULL REFERENCES training_cohorts(id),
  user_id            uuid        NOT NULL,
  role               text        NOT NULL CHECK (role IN ('learner', 'instructor', 'examiner', 'staff')),
  added_at           timestamptz NOT NULL DEFAULT now(),
  account_deleted_at timestamptz NULL,
  CHECK (account_deleted_at IS NULL OR account_deleted_at >= added_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS training_memberships_live_uniq
  ON training_memberships (cohort_id, user_id) WHERE account_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS training_memberships_user_idx
  ON training_memberships (user_id) WHERE account_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS training_memberships_cohort_idx
  ON training_memberships (cohort_id, added_at);
