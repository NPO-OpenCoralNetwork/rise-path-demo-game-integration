-- Rise Path migration 023: job training, recounts of study time (doc/brushup-2026/training-plan.ja.md
-- §4.9, owner decision D12). The logic is tools/core/trainingTimeRecount.js; staff run it with
-- scripts/training-time.mjs --recompute (a dry run shows the differences and the plan's sha256; the
-- same sha256 writes it). Like 021 and 022, this applies on every deployment: the public Rise Path
-- database gets the table and the column too, empty (TRAINING_ENABLED unset).
--
--   training_time_recomputes: one row per recount a staff member confirmed: the cohort, the days the
--     other versions apply to, those versions (NULL: each day's own), the sha256 of the plan the
--     staff member saw (it binds who and why too), who and why. No account id and no learner's value:
--     those are on the day rows, which an account deletion marks. 018's rp_rows_immutable refuses
--     UPDATE and DELETE.
--   training_time_days.recompute_id: the recount that wrote a 'recompute' row, of the same cohort;
--     NULL for a close. A close row and the recount rows of a day all stay; the current value of a day
--     is its newest live row (022).
--
-- ADD COLUMN takes an ACCESS EXCLUSIVE lock on training_time_days until this migration commits: a
-- signal, a GET or a close of the study time, and an account deletion's mark, wait for it.

CREATE TABLE IF NOT EXISTS training_time_recomputes (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cohort_id          uuid        NOT NULL REFERENCES training_cohorts(id),
  from_day           date        NOT NULL,
  to_day             date        NOT NULL,
  rule_set_id        bigint      NULL REFERENCES training_time_rule_sets(id),
  catalog_version_id bigint      NULL REFERENCES training_catalog_versions(id),
  plan_sha256        text        NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  recomputed_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  recomputed_by      text        NOT NULL CHECK (length(recomputed_by) BETWEEN 1 AND 100),
  reason             text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  CHECK (from_day <= to_day),
  CHECK (rule_set_id IS NOT NULL OR catalog_version_id IS NOT NULL),
  UNIQUE (id, cohort_id)
);
CREATE INDEX IF NOT EXISTS training_time_recomputes_cohort_idx
  ON training_time_recomputes (cohort_id, id);

DO $$ BEGIN
  CREATE TRIGGER training_time_recomputes_immutable
    BEFORE UPDATE OR DELETE ON training_time_recomputes
    FOR EACH ROW EXECUTE FUNCTION public.rp_rows_immutable();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE training_time_days ADD COLUMN IF NOT EXISTS recompute_id bigint NULL;

-- A recount row names a recount of its own cohort (a NULL recompute_id is not checked).
DO $$ BEGIN
  ALTER TABLE training_time_days ADD CONSTRAINT training_time_days_recompute_fkey
    FOREIGN KEY (recompute_id, cohort_id) REFERENCES training_time_recomputes (id, cohort_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Every recount row names its recount (who and why), and a close row none.
DO $$ BEGIN
  ALTER TABLE training_time_days ADD CONSTRAINT training_time_days_recompute_check
    CHECK ((kind = 'recompute') = (recompute_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS training_time_days_recompute_idx
  ON training_time_days (recompute_id) WHERE recompute_id IS NOT NULL;
