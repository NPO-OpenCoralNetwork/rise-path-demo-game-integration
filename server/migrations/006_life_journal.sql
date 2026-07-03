-- Rise Path migration 006: daily reflections, lifestyle logs, analysis snapshots
-- User scope is enforced in Express (JWT); RLS is not used on nexloom-gce Postgres.

CREATE TABLE IF NOT EXISTS daily_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  mood TEXT CHECK (mood IN ('great', 'good', 'okay', 'struggled')),
  energy INT CHECK (energy BETWEEN 1 AND 5),
  focus INT CHECK (focus BETWEEN 1 AND 5),
  stress INT CHECK (stress BETWEEN 1 AND 5),
  confidence INT CHECK (confidence BETWEEN 1 AND 5),
  diary_text TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_reflections_user_date
  ON daily_reflections (user_id, entry_date DESC);

CREATE TABLE IF NOT EXISTS lifestyle_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  sleep_hours NUMERIC(4,2),
  sleep_quality INT CHECK (sleep_quality BETWEEN 1 AND 5),
  bedtime TIME,
  wake_time TIME,
  exercise_min INT CHECK (exercise_min >= 0),
  exercise_intensity TEXT CHECK (exercise_intensity IN ('none', 'light', 'moderate', 'hard')),
  exercise_type TEXT,
  steps INT CHECK (steps >= 0),
  meals JSONB NOT NULL DEFAULT '{}'::jsonb,
  meal_balance INT CHECK (meal_balance BETWEEN 1 AND 5),
  hydration_cups INT CHECK (hydration_cups >= 0),
  caffeine JSONB NOT NULL DEFAULT '{}'::jsonb,
  alcohol BOOLEAN,
  screen_time_before_sleep_min INT CHECK (screen_time_before_sleep_min >= 0),
  health_note TEXT,
  custom_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_lifestyle_logs_user_date
  ON lifestyle_logs (user_id, entry_date DESC);

CREATE TABLE IF NOT EXISTS analysis_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('weekly', 'monthly', 'custom')),
  metrics JSONB NOT NULL,
  correlations JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_quality JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_user_period
  ON analysis_snapshots (user_id, period_start DESC, period_end DESC);

DO $$ BEGIN
  CREATE TRIGGER trg_daily_reflections_updated
    BEFORE UPDATE ON daily_reflections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_lifestyle_logs_updated
    BEFORE UPDATE ON lifestyle_logs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE VIEW daily_learning_metrics AS
SELECT
  user_id,
  (created_at AT TIME ZONE 'UTC')::date AS entry_date,
  COALESCE(SUM(time_spent_min), 0)::int AS total_learning_min,
  COUNT(*)::int AS journal_entries,
  ROUND(AVG(confidence)::numeric, 2) AS avg_confidence,
  ROUND(AVG(
    CASE mood
      WHEN 'great' THEN 5
      WHEN 'good' THEN 4
      WHEN 'okay' THEN 3
      WHEN 'struggled' THEN 2
    END
  )::numeric, 2) AS avg_mood_score
FROM learning_journal
GROUP BY user_id, (created_at AT TIME ZONE 'UTC')::date;