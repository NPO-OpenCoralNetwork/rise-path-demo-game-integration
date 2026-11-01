-- Rise Path migration 022: job training, study time records (doc/brushup-2026/training-plan.ja.md
-- §4.9, owner decisions D2, D3, D9, D10–D13). The counting rule is shared/training/studyTime.js
-- (study-time/v1); the logic is tools/core/trainingTime.js. Like 021, this applies on every
-- deployment: the public Rise Path database gets the tables too, empty (TRAINING_ENABLED unset).
--
-- Configuration history (no account id, never marked by a deletion; 018's rp_rows_immutable refuses
-- UPDATE and DELETE):
--   training_catalog_versions: a course's private unit list with each unit's set time
--     (risepath.training-course/v1, shared/training/courseManifest.js), as loaded by staff
--     (scripts/training-time.mjs, over stdin), named by the sha256 of its canonical JSON.
--   training_time_rule_sets: the private counting rules (shared/training/timeRules.js), the same way.
--     Their values never go into this repository (D9).
--   training_cohort_time_settings: which versions a cohort uses from which Japan-time day. Append
--     only; a day's setting is the row with the latest effective_from on or before it (the larger id
--     on the same day). Never from a day before the row was written (the CHECK; set_at is the
--     insert's own clock). Without a setting for a day, nothing is counted that day (fail closed).
--
-- Evidence (account data; append only, the only UPDATE is a deletion's mark; no trigger):
--   training_time_streams: one row per learner, page chain (one continuous visible stretch of a
--     training page) and Japan-time day of its signals. user_id and the mark live here only.
--   training_time_signals: one narrow row per stored signal: the database clock after the
--     learner's locks (whole milliseconds), the page's sequence number and three flags (1 stop,
--     2 focus, 4 input). No account id: its stream's mark hides it.
-- Derived (account data; append only, the only UPDATE is a deletion's mark):
--   training_time_days: one row per closed day (zero days too) and per later recount, with the rule
--     and catalog versions it was counted with and the sha256 of the evidence it read. A day is
--     closed once; the current value of a day is its newest live row.
--   training_time_unit_days: that day's time per unit. No account id: its day row's mark hides it.
--
-- No FK to auth.users (as 021, D3): an account deletion sets account_deleted_at on the streams and
-- the days (server/services/accountDeletion.js, the tombstone's deleted_at) and keeps the rows.
-- Nothing deletes them on a timer until a retention period is decided (D3). Inserted only under the
-- account's shared lock and only while the auth.users stub exists, so no row outlives a deletion
-- unmarked; the learner's own reads use unmarked rows only, staff reads see marked rows too. The
-- unique indexes cover unmarked rows only, so an id re-opened after a deletion starts again.
--
-- No table is granted to the remote MCP role (scripts/ci/db-checks.sh checks every training_
-- table). No row level security (as in 006 and later): every query is scoped by user_id or cohort.

CREATE TABLE IF NOT EXISTS training_catalog_versions (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_key text        NOT NULL CHECK (course_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  sha256     text        NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  manifest   jsonb       NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  loaded_at  timestamptz NOT NULL DEFAULT now(),
  loaded_by  text        NOT NULL CHECK (length(loaded_by) BETWEEN 1 AND 100),
  note       text        NOT NULL CHECK (length(note) BETWEEN 1 AND 500)
);

CREATE TABLE IF NOT EXISTS training_time_rule_sets (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  algorithm  text        NOT NULL CHECK (algorithm ~ '^study-time/v[1-9][0-9]{0,2}$'),
  sha256     text        NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  params     jsonb       NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  loaded_at  timestamptz NOT NULL DEFAULT now(),
  loaded_by  text        NOT NULL CHECK (length(loaded_by) BETWEEN 1 AND 100),
  note       text        NOT NULL CHECK (length(note) BETWEEN 1 AND 500)
);

CREATE TABLE IF NOT EXISTS training_cohort_time_settings (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cohort_id          uuid        NOT NULL REFERENCES training_cohorts(id),
  catalog_version_id bigint      NOT NULL REFERENCES training_catalog_versions(id),
  rule_set_id        bigint      NOT NULL REFERENCES training_time_rule_sets(id),
  effective_from     date        NOT NULL,
  set_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  set_by             text        NOT NULL CHECK (length(set_by) BETWEEN 1 AND 100),
  reason             text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  CHECK (effective_from >= (set_at AT TIME ZONE 'Asia/Tokyo')::date)
);
CREATE INDEX IF NOT EXISTS training_cohort_time_settings_cohort_idx
  ON training_cohort_time_settings (cohort_id, effective_from, id);

DO $$ BEGIN
  CREATE TRIGGER training_catalog_versions_immutable
    BEFORE UPDATE OR DELETE ON training_catalog_versions
    FOR EACH ROW EXECUTE FUNCTION public.rp_rows_immutable();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER training_time_rule_sets_immutable
    BEFORE UPDATE OR DELETE ON training_time_rule_sets
    FOR EACH ROW EXECUTE FUNCTION public.rp_rows_immutable();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER training_cohort_time_settings_immutable
    BEFORE UPDATE OR DELETE ON training_cohort_time_settings
    FOR EACH ROW EXECUTE FUNCTION public.rp_rows_immutable();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS training_time_streams (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            uuid        NOT NULL,
  cohort_id          uuid        NOT NULL REFERENCES training_cohorts(id),
  unit_key           text        NOT NULL CHECK (unit_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  chain_id           uuid        NOT NULL,
  chain_started_at   timestamptz NOT NULL,
  day                date        NOT NULL,
  started_at         timestamptz NOT NULL,
  account_deleted_at timestamptz NULL,
  CHECK (day = (started_at AT TIME ZONE 'Asia/Tokyo')::date),
  CHECK (chain_started_at <= started_at),
  CHECK (account_deleted_at IS NULL OR account_deleted_at >= started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS training_time_streams_live_uniq
  ON training_time_streams (user_id, chain_id, day) WHERE account_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS training_time_streams_learner_idx
  ON training_time_streams (user_id, cohort_id, day);
CREATE INDEX IF NOT EXISTS training_time_streams_cohort_idx
  ON training_time_streams (cohort_id, day);

-- The 8-byte columns first, so a row has no padding.
CREATE TABLE IF NOT EXISTS training_time_signals (
  stream_id   bigint      NOT NULL REFERENCES training_time_streams(id),
  received_at timestamptz NOT NULL,
  seq         integer     NOT NULL CHECK (seq >= 0),
  flags       smallint    NOT NULL CHECK (flags BETWEEN 0 AND 7),
  PRIMARY KEY (stream_id, seq)
);

CREATE TABLE IF NOT EXISTS training_time_days (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            uuid        NOT NULL,
  cohort_id          uuid        NOT NULL REFERENCES training_cohorts(id),
  day                date        NOT NULL,
  kind               text        NOT NULL CHECK (kind IN ('close', 'recompute')),
  algorithm          text        NOT NULL CHECK (algorithm ~ '^study-time/v[1-9][0-9]{0,2}$'),
  rule_set_id        bigint      NOT NULL REFERENCES training_time_rule_sets(id),
  catalog_version_id bigint      NOT NULL REFERENCES training_catalog_versions(id),
  counted_ms         integer     NOT NULL CHECK (counted_ms BETWEEN 0 AND 86400000),
  over_cap_ms        integer     NOT NULL CHECK (over_cap_ms BETWEEN 0 AND 86400000),
  signals            integer     NOT NULL CHECK (signals >= 0),
  evidence_sha256    text        NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  computed_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  computed_by        text        NOT NULL CHECK (length(computed_by) BETWEEN 1 AND 100),
  account_deleted_at timestamptz NULL,
  CHECK (counted_ms + over_cap_ms <= 86400000),
  CHECK (account_deleted_at IS NULL OR account_deleted_at >= computed_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS training_time_days_close_uniq
  ON training_time_days (user_id, cohort_id, day) WHERE kind = 'close' AND account_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS training_time_days_current_idx
  ON training_time_days (user_id, cohort_id, day, id DESC) WHERE account_deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS training_time_days_cohort_idx
  ON training_time_days (cohort_id, day);

CREATE TABLE IF NOT EXISTS training_time_unit_days (
  day_id      bigint  NOT NULL REFERENCES training_time_days(id),
  unit_key    text    NOT NULL CHECK (unit_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  counted_ms  integer NOT NULL CHECK (counted_ms BETWEEN 0 AND 86400000),
  over_cap_ms integer NOT NULL CHECK (over_cap_ms BETWEEN 0 AND 86400000),
  PRIMARY KEY (day_id, unit_key),
  CHECK (counted_ms > 0 OR over_cap_ms > 0)
);
