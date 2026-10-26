-- Rise Path migration 020: Phase 6 (doc/brushup-2026/ai-access-plan.ja.md §10): the review queue. A
-- lesson's flashcards come back when the learner is about to forget them (FSRS-6,
-- shared/review/fsrs.js). Written only through tools/core/reviewQueue.js and the lesson reset and
-- delete in tools/core/lessonProgress.js.
--
-- lesson_progress.progress_changed_at: when the row's progress last changed (server clock). A
-- trigger keeps it: an INSERT, or an UPDATE that changes progress, sets clock_timestamp(), the time
-- of the write (after any row lock it waited for), not now(): a write in a transaction that began
-- before another write of the row committed still gets the later time, so the review entry never
-- dates a later change before an earlier one. Any other UPDATE (the pct/state write-back of a read, a
-- save that changes nothing) keeps it, and a value sent for it is ignored. Rows from before this
-- migration have NULL until their first update, which freezes their updated_at into it. It dates
-- when a lesson's cards were learned; updated_at also moves on writes that are not learning.
--
-- review_cards: one row per learner and card in their queue, keyed by (course_slug, lesson_id,
-- card_id): card ids are unique per lesson only, and the flashcards block id is not part of the key
-- (a block rename keeps the memory). A row is inserted only from the server's own lesson_progress
-- row of that lesson, under the learner's lesson-progress lock: when its state is read, checked or
-- mastered (the learner finished it), or when its record holds the learner's mark on that card
-- ('card:<block>/<card>' in progress.checks, either button). Never from a client's or an AI app's
-- claim. The lesson counts as the card's first rating: learned_at is the lesson row's
-- progress_changed_at, prior_rating 1 when the learner's latest mark on the card is 「もう一度」, else
-- 3, stability and difficulty FSRS-6's first-rating memory for it, due_day the Japan-time day of
-- learned_at plus FSRS's interval (1 or 2 days). A card added to the lesson after the learner's last
-- change in it was never studied: learned_at, prior_rating and the memory are NULL, due_day the day
-- after it entered. reps, lapses, last_rating and last_review_day count reviews in the queue (0 and
-- NULL before the first). A card is reviewed at most once a day: after a review, due_day is 1 to 365
-- days later (CHECK), and the review's UPDATE only matches a card due today and not reviewed today.
-- entered_at is the insert time (clock_timestamp(), after the learner lock; the roll-forward repair
-- compares it with reset times). Card text is never stored (it is read from the published lessons):
-- a text edit keeps the memory; a card removed from its lesson, or a lesson no longer published, is
-- hidden, not deleted. Starting a lesson over deletes its rows; "delete my lesson progress" deletes
-- all of them; account deletion cascades from auth.users.
--
-- review_log: append only, one row per review in the queue: the card, the day and time (database
-- clock), the rating (1 「もう一度」, 3 「覚えた」), the whole days since the previous rating (the
-- lesson for the first review; NULL when the card had none), the interval and memory it produced,
-- and where ('web', or 'mcp' for an AI app). The primary key allows one review of a card per
-- Japan-time day. With review_cards.learned_at and prior_rating it is the card's full rating history,
-- kept for a later scheduler; nothing reads it yet. Its only foreign key is its card row (CASCADE): a
-- review holds that row's lock while it inserts here, and a foreign key to auth.users would wait for
-- the account stub that an account deletion holds while it waits for the same row (40P01).
--
-- No backfill (card ids live in the lesson files): the first review read of each learner enters the
-- cards of lessons finished before Phase 6. In-lesson marks are never turned into reviews (no log
-- row); only the latest mark picks a card's first-rating memory. No grant here:
-- deploy/risepath-vm/sql/mcp_remote_role.sql grants the remote MCP role the columns its two review
-- tools need (the owner re-runs it). No row level security (as in 006 and later): every query is
-- scoped by user_id.

-- Order: the two tables first, then lesson_progress. Their foreign keys take auth.users' SHARE ROW
-- EXCLUSIVE lock; the ALTER takes lesson_progress's ACCESS EXCLUSIVE lock. An account deletion inside
-- its DELETE FROM auth.users holds auth.users and then needs lesson_progress (the cascade), so the
-- other order could deadlock with it (40P01); in this order one of the two waits for the other
-- (scripts/db/verify-phase6.mjs P1).

CREATE TABLE IF NOT EXISTS review_cards (
  user_id         uuid             NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_slug     text             NOT NULL CHECK (course_slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  lesson_id       text             NOT NULL CHECK (lesson_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  card_id         text             NOT NULL CHECK (card_id ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  entered_at      timestamptz      NOT NULL DEFAULT clock_timestamp(),
  learned_at      timestamptz      NULL,
  prior_rating    smallint         NULL CHECK (prior_rating IN (1, 3)),
  due_day         date             NOT NULL,
  stability       double precision NULL CHECK (stability BETWEEN 0.001 AND 36500),
  difficulty      double precision NULL CHECK (difficulty BETWEEN 1 AND 10),
  reps            integer          NOT NULL DEFAULT 0 CHECK (reps >= 0),
  lapses          integer          NOT NULL DEFAULT 0,
  last_rating     smallint         NULL CHECK (last_rating IN (1, 3)),
  last_review_day date             NULL,
  PRIMARY KEY (user_id, course_slug, lesson_id, card_id),
  CONSTRAINT review_cards_lapses_check CHECK (lapses BETWEEN 0 AND reps),
  CONSTRAINT review_cards_prior_check CHECK ((learned_at IS NULL) = (prior_rating IS NULL)),
  CONSTRAINT review_cards_memory_check CHECK (
       (reps = 0 AND last_rating IS NULL AND last_review_day IS NULL
        AND (   (learned_at IS NOT NULL AND stability IS NOT NULL AND difficulty IS NOT NULL
                 AND due_day >  (learned_at AT TIME ZONE 'Asia/Tokyo')::date
                 AND due_day <= (learned_at AT TIME ZONE 'Asia/Tokyo')::date + 365)
             OR (learned_at IS NULL AND stability IS NULL AND difficulty IS NULL)))
    OR (reps > 0 AND stability IS NOT NULL AND difficulty IS NOT NULL AND last_rating IS NOT NULL AND last_review_day IS NOT NULL
        AND (learned_at IS NULL OR (learned_at AT TIME ZONE 'Asia/Tokyo')::date < last_review_day)
        AND due_day > last_review_day AND due_day <= last_review_day + 365))
);

CREATE TABLE IF NOT EXISTS review_log (
  user_id       uuid             NOT NULL,
  course_slug   text             NOT NULL,
  lesson_id     text             NOT NULL,
  card_id       text             NOT NULL,
  review_day    date             NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Tokyo')::date),
  reviewed_at   timestamptz      NOT NULL DEFAULT now(),
  rating        smallint         NOT NULL CHECK (rating IN (1, 3)),
  elapsed_days  integer          NULL CHECK (elapsed_days >= 1),
  interval_days integer          NOT NULL CHECK (interval_days BETWEEN 1 AND 365),
  stability     double precision NOT NULL CHECK (stability BETWEEN 0.001 AND 36500),
  difficulty    double precision NOT NULL CHECK (difficulty BETWEEN 1 AND 10),
  source        text             NOT NULL CHECK (source IN ('web', 'mcp')),
  PRIMARY KEY (user_id, course_slug, lesson_id, card_id, review_day),
  CONSTRAINT review_log_card_fkey FOREIGN KEY (user_id, course_slug, lesson_id, card_id)
    REFERENCES review_cards (user_id, course_slug, lesson_id, card_id) ON DELETE CASCADE
);

ALTER TABLE lesson_progress ADD COLUMN IF NOT EXISTS progress_changed_at timestamptz NULL;

CREATE OR REPLACE FUNCTION set_lesson_progress_changed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.progress_changed_at := clock_timestamp();
  ELSIF NEW.progress IS DISTINCT FROM OLD.progress THEN
    NEW.progress_changed_at := clock_timestamp();
  ELSE
    NEW.progress_changed_at := COALESCE(OLD.progress_changed_at, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER lesson_progress_changed_at
    BEFORE INSERT OR UPDATE ON lesson_progress
    FOR EACH ROW EXECUTE FUNCTION set_lesson_progress_changed_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
