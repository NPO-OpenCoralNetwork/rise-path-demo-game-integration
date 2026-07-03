-- Rise Path migration 003: learner diagnosis profiles

CREATE TABLE IF NOT EXISTS learner_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  assessment_type TEXT NOT NULL DEFAULT 'big_five_v1',
  raw_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  derived_learning_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  CREATE TRIGGER learner_profiles_updated_at
    BEFORE UPDATE ON learner_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS learner_profiles_user_idx
  ON learner_profiles (user_id, version DESC);