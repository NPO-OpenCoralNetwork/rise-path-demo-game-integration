-- Rise Path migration 009: learner semantic memory metadata (Phase 19)
-- Memanto stores memory bodies; this table tracks sync state only.

CREATE TABLE IF NOT EXISTS learner_memory_meta (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  memanto_agent_id TEXT NOT NULL,
  assessment_seed_version INT,
  last_assessment_seed_at TIMESTAMPTZ,
  last_habit_sync_at TIMESTAMPTZ,
  memory_count_estimate INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS learner_memory_meta_agent_idx
  ON learner_memory_meta (memanto_agent_id);

DO $$ BEGIN
  CREATE TRIGGER learner_memory_meta_updated_at
    BEFORE UPDATE ON learner_memory_meta
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;