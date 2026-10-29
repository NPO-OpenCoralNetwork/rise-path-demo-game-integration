-- Rise Path migration 019: Phase 5 (doc/brushup-2026/ai-access-plan.ja.md §9): starting one lesson
-- over, XP earned once per learned item, and the days a learner learned.
--
-- lesson_progress_lesson_resets: one row per learner and lesson they started over with
-- 「このレッスンを最初からやり直す」 (POST /api/v2/user/lesson-progress/lesson-reset,
-- tools/core/lessonProgress.js resetLessonProgress). Each reset empties that lesson's lesson_progress
-- row (a row is written even for a lesson never opened), sets a new lesson_epoch and reset_at, in one
-- transaction under the learner's lesson-progress lock. A save whose record names another
-- lesson_epoch (or none) is refused for that record ('lesson_reset'), so a device that still holds
-- the old record cannot upload it again. reset_at: when (server clock); devices compare it with when
-- a record they started from nothing was born. The rows stay when the learner deletes all lesson
-- progress (a generation stays valid while the account exists) and go only with the account. Written
-- and read only by the app API. No grant to the remote MCP role: its tools read and write
-- lesson_progress only and see a restarted lesson exactly like an untouched one.
--
-- xp_awards: the XP ledger. One row per learner, source, item and milestone, inserted at most once
-- (primary key + INSERT … ON CONFLICT DO NOTHING) by tools/core/achievements.js from the server's
-- own records only: lesson_progress.state (start 10 once the lesson is in progress, done 40 once it
-- is read, checked or mastered) and the Blender course's user_progress.completed_stages (stages 1–4
-- done, 80). Never from learning events (POST /api/v2/user/events is history only). Rows stay when
-- a lesson is started over or the progress is deleted: the XP stays earned and the same item never
-- earns again. They go only with the account. Changing an amount needs a new migration (CHECK below).
--
-- learning_days: the days (Japan time, server clock) on which learning reached the server: a REST
-- save that changed a lesson record's content, or a Blender stage newly done. Only the date is kept.
-- Written by the app API only (tools/core/achievements.js). Source of the streak. Kept like the
-- ledger: until the account is deleted.
--
-- None of the three is granted to the remote MCP role (AI apps see no XP, days or reset state in
-- Phase 5). No row level security (as in 006 and later): every query is scoped by user_id. Account
-- deletion cascades from auth.users.

CREATE TABLE IF NOT EXISTS lesson_progress_lesson_resets (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_slug  text        NOT NULL CHECK (course_slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  lesson_id    text        NOT NULL CHECK (lesson_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  lesson_epoch uuid        NOT NULL DEFAULT gen_random_uuid(),
  reset_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_slug, lesson_id)
);

CREATE TABLE IF NOT EXISTS xp_awards (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source     text        NOT NULL CHECK (source IN ('lesson', 'blender_stage')),
  item_key   text        NOT NULL CHECK (item_key ~ '^[a-z0-9][a-z0-9-]{0,79}/[a-z0-9][a-z0-9-]{0,79}$'),
  milestone  text        NOT NULL CHECK (milestone IN ('start', 'done')),
  xp         smallint    NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, item_key, milestone),
  CONSTRAINT xp_awards_amount_check CHECK (
       (source = 'lesson'        AND milestone = 'start' AND xp = 10)
    OR (source = 'lesson'        AND milestone = 'done'  AND xp = 40)
    OR (source = 'blender_stage' AND milestone = 'done'  AND xp = 80))
);

CREATE TABLE IF NOT EXISTS learning_days (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day     date NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- O3: the XP the server's records already earn, with the runtime rules (tools/core/achievements.js
-- LESSON_XP_SELECT / BLENDER_XP_SELECT; server/tests/migration019.test.js pins that both say the
-- same). XP that exists only in a browser is not carried over.
INSERT INTO xp_awards (user_id, source, item_key, milestone, xp)
SELECT p.user_id, 'lesson', p.course_slug || '/' || p.lesson_id, m.milestone, m.xp
  FROM lesson_progress p
  JOIN (VALUES ('start', 10), ('done', 40)) AS m (milestone, xp)
    ON m.milestone = 'start' OR p.state IN ('read', 'checked', 'mastered')
 WHERE p.state <> 'not_started'
 ORDER BY 1, 3, 4
ON CONFLICT (user_id, source, item_key, milestone) DO NOTHING;

INSERT INTO xp_awards (user_id, source, item_key, milestone, xp)
SELECT DISTINCT u.user_id, 'blender_stage', 'blender/' || s.stage, 'done', 80
  FROM user_progress u
 CROSS JOIN LATERAL unnest(u.completed_stages) AS s (stage)
 WHERE u.course_id = 'blender' AND s.stage IN ('1', '2', '3', '4')
 ORDER BY 1, 3
ON CONFLICT (user_id, source, item_key, milestone) DO NOTHING;

-- The streak's past days, once, approximately: lesson and stage starts and finishes recorded before
-- this release (server time of the event), and each lesson's last change (the earlier of the record
-- clock and the row's last write, so a device clock ahead of time never adds a future day). After
-- this release, days come only from server records (tools/core/achievements.js), never from events.
INSERT INTO learning_days (user_id, day)
SELECT DISTINCT user_id, (created_at AT TIME ZONE 'Asia/Tokyo')::date
  FROM learning_events
 WHERE type IN ('lesson_start', 'lesson_complete', 'stage_complete')
ON CONFLICT (user_id, day) DO NOTHING;

INSERT INTO learning_days (user_id, day)
SELECT DISTINCT user_id, (least(progress_updated_at, updated_at) AT TIME ZONE 'Asia/Tokyo')::date
  FROM lesson_progress
 WHERE state <> 'not_started' AND progress_updated_at > to_timestamp(0)
ON CONFLICT (user_id, day) DO NOTHING;
