// Make a learner's not-yet-reviewed cards due today without faking any clock: move the lesson time back
// two days and set the due day to today, both from PostgreSQL's now() in Japan time. The table forbids
// "learned today, due today" (server/migrations/020_review_queue.sql, review_cards_memory_check), so
// learned_at must move too; F1 first proves that the shortcut is refused (23514), then runs this.
// It is the suite's only data change (design scope guard S-7): no learning day is moved.
export const NUDGE_DUE_TODAY_SQL = `UPDATE review_cards
   SET learned_at = learned_at - interval '2 days',
       due_day = (now() AT TIME ZONE 'Asia/Tokyo')::date
 WHERE user_id = $1 AND reps = 0
RETURNING card_id`;

/** The shortcut the constraint refuses: run inside BEGIN … ROLLBACK, expect SQLSTATE 23514. */
export const SHORTCUT_DUE_TODAY_SQL = `UPDATE review_cards
   SET due_day = (now() AT TIME ZONE 'Asia/Tokyo')::date
 WHERE user_id = $1 AND reps = 0`;
