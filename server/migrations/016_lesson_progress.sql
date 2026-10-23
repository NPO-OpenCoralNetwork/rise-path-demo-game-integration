-- Rise Path migration 016: lesson progress on the server (Phase 2, doc/brushup-2026/ai-access-plan.ja.md §6).
-- The risepath.lesson/v1 reader's progress (components/lesson/progressStore.ts, record shape in
-- shared/lesson/progress.js), synced across a signed-in learner's devices, plus the MCP course-*
-- tools' graded answers. Written only through tools/core/lessonProgress.js:
--
-- lesson_progress: one row per learner and published lesson (course folder slug + lesson id, the
-- same keys as the browser's rp:progress:<course>:<lesson>). Both ids follow the one id rule:
-- lowercase letters, digits and "-", at most 80 characters (tools/core/courseCatalog.js leaves out
-- any lesson that breaks it, so a stored record never fails these CHECKs).
-- - progress: the merged record ({v, seen, answers, checks, lastBlockId, updatedAt, editedAt?,
--   ratings?}), never a client's record as sent: the server sanitizes and merges it into the row
--   it locked (shared/lesson/progressMerge.js). At most 64 KiB of jsonb text.
-- - pct, state: derived with shared/lesson/progress.js against the published lesson whose hash
--   is content_hash (shared/lesson/hash.js lessonHash); recomputed when the lesson changes.
-- - progress_updated_at: the record's own updatedAt (the learner's last change, by the device's
--   clock, at most 5 minutes ahead of the server's). updated_at: the row's last write.
-- The app API writes every column. The remote MCP role (deploy/risepath-vm/sql/mcp_remote_role.sql)
-- may SELECT, INSERT and UPDATE, never DELETE: only the learner's delete control removes rows.
--
-- lesson_progress_resets: one row per learner who has used "delete my lesson progress". The delete
-- removes the learner's lesson_progress rows and sets a new epoch in the same transaction; a save
-- that carries another epoch is refused (409 progress_reset), so a device that still holds the old
-- records cannot upload them again. Written and read only by the app API (no grant to the remote
-- MCP role). No row means the learner never deleted (epoch null in the API).
--
-- No row level security (as in 006 and later): every query is scoped by user_id. Account deletion
-- cascades from auth.users.
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_slug         text        NOT NULL CHECK (course_slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  lesson_id           text        NOT NULL CHECK (lesson_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  progress            jsonb       NOT NULL CHECK (jsonb_typeof(progress) = 'object' AND octet_length(progress::text) <= 65536),
  pct                 smallint    NOT NULL DEFAULT 0 CHECK (pct BETWEEN 0 AND 100),
  state               text        NOT NULL DEFAULT 'not_started' CHECK (state IN ('not_started', 'in_progress', 'read', 'checked', 'mastered')),
  content_hash        text        NULL CHECK (content_hash IS NULL OR length(content_hash) <= 80),
  progress_updated_at timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_slug, lesson_id)
);

DO $$ BEGIN
  CREATE TRIGGER lesson_progress_updated_at
    BEFORE UPDATE ON lesson_progress
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS lesson_progress_resets (
  user_id  uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  epoch    uuid        NOT NULL DEFAULT gen_random_uuid(),
  reset_at timestamptz NOT NULL DEFAULT now()
);
