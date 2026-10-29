-- Rise Path migration 014: minor safeguards (Phase 0.5, doc/brushup-2026/ai-access-plan.ja.md §4).
-- Read by server/safety/access.js (age, guardian consent, the safety pause) and the safety routes.
-- None of this lives in user_profiles.preferences or Supabase user_metadata: learners can write both.
--
-- user_age: birth year and month only (the day is always 1; it is never the real birthday). The age
-- is computed per request in Japan time (server/safety/age.js), so no stored age band goes stale.
-- One row per user; the learner sets it once ('self'), later changes come from a guardian on the
-- learner's device or from staff ('guardian', 'staff') through the admin routes.
CREATE TABLE IF NOT EXISTS user_age (
  user_id     uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  birth_ym    date        NOT NULL CHECK (EXTRACT(DAY FROM birth_ym) = 1 AND birth_ym >= DATE '1900-01-01'),
  declared_by text        NOT NULL CHECK (declared_by IN ('self', 'guardian', 'staff')),
  declared_at timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TRIGGER user_age_updated_at
    BEFORE UPDATE ON user_age
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- account_consents: append-only record of consents. 'guardian_ai' is a guardian's consent for a
-- learner under 18 to use the AI features, for one policy_version (CONSENT_POLICY_VERSION in
-- server/safety/access.js; a new version needs a new consent). method: given by the guardian on the
-- learner's device, or a paper form that staff recorded (recorded_by = that admin). No guardian
-- name or contact is stored. Revoking sets revoked_at; rows are never deleted by the app.
CREATE TABLE IF NOT EXISTS account_consents (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind           text        NOT NULL CHECK (kind IN ('guardian_ai')),
  policy_version text        NOT NULL,
  method         text        NOT NULL CHECK (method IN ('guardian_on_device', 'staff_paper_form')),
  relationship   text        NULL CHECK (relationship IN ('parent', 'guardian', 'other')),
  recorded_by    uuid        NULL,
  given_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_account_consents_user_kind_given
  ON account_consents (user_id, kind, given_at DESC);

-- ai_safety_events: blocked inputs and outputs, learner reports, support lines shown, failed
-- checks. A signed-in user's event has user_id set and subject NULL; a guest's has user_id NULL and
-- subject 'ip:<prefix>' (the CHECK allows nothing else in subject, so no user id is ever copied
-- there). detail is set only for 'user_report' ({reason, answer, question, note, context}); blocked
-- events never store learner text. Retention (server/safety, pruned at most hourly per process):
-- report text 90 days, events 365 days. Deleting an account sets user_id to NULL, so the row keeps
-- no account id and only the counts survive (both columns NULL means a deleted account).
CREATE TABLE IF NOT EXISTS ai_safety_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  user_id     uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  subject     text        NULL CHECK (subject IS NULL OR subject LIKE 'ip:%'),
  audience    text        NULL,
  surface     text        NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('input_blocked', 'output_blocked', 'user_report', 'support_shown', 'check_failed')),
  category    text        NULL,
  detail      jsonb       NULL,
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed')),
  reviewed_by uuid        NULL,
  reviewed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_safety_events_created
  ON ai_safety_events (created_at);

CREATE INDEX IF NOT EXISTS idx_ai_safety_events_user_created
  ON ai_safety_events (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_safety_events_kind_status
  ON ai_safety_events (kind, status);
