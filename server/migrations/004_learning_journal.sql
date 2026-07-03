-- Rise Path migration 004: lesson-level learning journal

CREATE TABLE IF NOT EXISTS learning_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  curriculum_id UUID NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  learned TEXT,
  difficulty TEXT,
  mood TEXT CHECK (mood IN ('great', 'good', 'okay', 'struggled')),
  confidence INT CHECK (confidence BETWEEN 1 AND 5),
  time_spent_min INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_journal_user_curriculum
  ON learning_journal (user_id, curriculum_id);

CREATE INDEX IF NOT EXISTS idx_learning_journal_created
  ON learning_journal (user_id, created_at DESC);