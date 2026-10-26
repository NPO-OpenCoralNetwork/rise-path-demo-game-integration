/**
 * An in-memory lesson_progress / lesson_progress_resets for tests of tools/core/lessonProgress.js
 * (directly, through the REST routes, and later through the MCP course tools). It answers only
 * the exact statements the module sends (whitespace-collapsed, lower case: SQL below) and throws
 * on any other statement that names these tables, so a changed query fails loudly instead of
 * silently matching a looser mock. Transactions are modelled: BEGIN snapshots the tables,
 * ROLLBACK restores them. The CHECKs of server/migrations/016_lesson_progress.sql are enforced
 * (slugs, state, pct, and the 64 KiB jsonb text, measured with an independent serializer).
 * Phase 4: it also answers the GET's `restarted` read and, for tests of a re-opened deleted
 * account, the deleted-account statements of tools/core/accountDeletions.js (account_deletions
 * and the re-open's epoch write, whose reset_at is the transaction's now(), like reopened_at).
 * Phase 5 (migration 019): the account stub's KEY SHARE lock, the per-lesson generations
 * (lesson_progress_lesson_resets: kept by deleteAll and deleteOne, as in Postgres where no FK ties
 * them to lesson_progress), the XP ledger (xp_awards, with the amount CHECK), learning days (Japan
 * time of the transaction's now()) and the legacy user_progress rows the Blender reconcile reads.
 * Any other statement naming xp_awards, learning_days or user_progress throws, like one naming
 * lesson_progress. `clock` (default: the real clock) gives each transaction its now() (a statement
 * outside a transaction gets the clock at that statement). Stage 2: the achievements read (ledger,
 * days, today) and the learning history (learning_events: the POST and GET of server/routes/user.js;
 * any other statement naming it throws too). The XP lock records the key Postgres hashes ('xp:' and
 * the canonical uuid text, xpLockKeys(); a non-uuid fails 22P02 as the cast does), and any other
 * statement with an 'xp:' key throws.
 * `interleave(when, fn)` runs fn once right before the first statement `when` matches: another
 * connection's write that commits just then (an AI app's MCP write during a delete-all).
 * Phase 6 (migration 020): lesson_progress.progress_changed_at as its trigger keeps it (an insert
 * sets clock_timestamp(), the clock at that statement, not the transaction's now(); an UPDATE moves
 * it, the same way, only when progress changes, compared as jsonb
 * compares, key order aside; otherwise it keeps it, or freezes the row's updated_at into it; no
 * statement of the module sends it), updated_at as now(), and review_cards / review_log in memory
 * with the migration's CHECKs, the log's primary key (one review of a card per Japan-time day) and
 * its composite foreign key (23503; deleting a card deletes its log rows). The queue's statements
 * (tools/core/reviewQueue.js) are evaluated in JavaScript: the entry's CTE (the finished states, the
 * `?` and `->` jsonb operators, the `studied` rule against the statement's snapshot, ON CONFLICT DO
 * NOTHING), the rows with their Japan-time days, the grade's UPDATE with its WHERE guard. Any other
 * statement naming review_cards or review_log throws (PHASE6_TABLES).
 * Not a test file (npm test runs *.test.js).
 */
import { randomUUID } from 'node:crypto';

export const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

/** Every statement tools/core/lessonProgress.js sends, normalized. */
export const SQL = Object.freeze({
    advisoryLock: "select pg_advisory_xact_lock(hashtext('lesson_progress:' || $1))",
    selectEpoch: 'select epoch from lesson_progress_resets where user_id = $1',
    insertPlaceholder: 'insert into lesson_progress (user_id, course_slug, lesson_id, progress, progress_updated_at) values ($1, $2, $3, $4::jsonb, to_timestamp(0)) on conflict (user_id, course_slug, lesson_id) do nothing returning true as created',
    lockRow: 'select progress from lesson_progress where user_id = $1 and course_slug = $2 and lesson_id = $3 for update',
    updateRow: 'update lesson_progress set progress = $4::jsonb, pct = $5, state = $6, content_hash = $7, progress_updated_at = $8 where user_id = $1 and course_slug = $2 and lesson_id = $3',
    selectRows: 'select course_slug, lesson_id, progress, pct, state, content_hash, progress_updated_at from lesson_progress where user_id = $1 order by course_slug, lesson_id',
    selectCourseRows: 'select course_slug, lesson_id, progress, pct, state, content_hash, progress_updated_at from lesson_progress where user_id = $1 and course_slug = $2 order by course_slug, lesson_id',
    selectLessonRows: 'select course_slug, lesson_id, progress, pct, state, content_hash, progress_updated_at from lesson_progress where user_id = $1 and course_slug = $2 and lesson_id = $3 order by course_slug, lesson_id',
    writeBack: 'update lesson_progress set pct = $4, state = $5, content_hash = $6 where user_id = $1 and course_slug = $2 and lesson_id = $3 and content_hash is distinct from $6',
    deleteAll: 'delete from lesson_progress where user_id = $1',
    deleteOne: 'delete from lesson_progress where user_id = $1 and course_slug = $2 and lesson_id = $3',
    upsertEpoch: 'insert into lesson_progress_resets (user_id) values ($1) on conflict (user_id) do update set epoch = gen_random_uuid(), reset_at = now() returning epoch',
    selectRestarted: 'select exists (select 1 from account_deletions d where d.user_id = $1::uuid and d.reopened_at = (select r.reset_at from lesson_progress_resets r where r.user_id = d.user_id)) as restarted',
    // tools/core/accountDeletions.js (Phase 4): the sign-in check and the re-open.
    selectTombstone: 'select deleted_at, reopened_at from account_deletions where user_id = $1::uuid',
    reopenLock: "select pg_advisory_xact_lock_shared(hashtextextended('rp:account:' || $1::uuid::text, 0))",
    reopen: "update account_deletions set reopened_at = now() where user_id = $1::uuid and reopened_at is null and to_timestamp($2::double precision) > deleted_at + interval '30 seconds' returning reopened_at",
    reopenEpoch: 'insert into lesson_progress_resets (user_id) values ($1::uuid) on conflict (user_id) do update set epoch = gen_random_uuid(), reset_at = now()',
    // Phase 5: one-lesson reset (tools/core/lessonProgress.js) and XP (tools/core/achievements.js).
    stubKeyShare: 'select 1 from auth.users where id = $1 for key share',
    selectLessonEpochs: 'select course_slug, lesson_id, lesson_epoch, reset_at from lesson_progress_lesson_resets where user_id = $1',
    selectRowsWithEpochs: 'select p.course_slug, p.lesson_id, p.progress, p.pct, p.state, p.content_hash, p.progress_updated_at, r.lesson_epoch, r.reset_at from lesson_progress p left join lesson_progress_lesson_resets r on r.user_id = p.user_id and r.course_slug = p.course_slug and r.lesson_id = p.lesson_id where p.user_id = $1 order by p.course_slug, p.lesson_id',
    upsertLessonEpoch: 'insert into lesson_progress_lesson_resets (user_id, course_slug, lesson_id) values ($1, $2, $3) on conflict (user_id, course_slug, lesson_id) do update set lesson_epoch = gen_random_uuid(), reset_at = now() returning lesson_epoch, reset_at',
    selectStoredRow: 'select progress, progress_updated_at from lesson_progress where user_id = $1 and course_slug = $2 and lesson_id = $3',
    xpLock: "select pg_advisory_xact_lock(hashtext('xp:' || $1::uuid::text))",
    xpReconcileLessons: "insert into xp_awards (user_id, source, item_key, milestone, xp) select p.user_id, 'lesson', p.course_slug || '/' || p.lesson_id, m.milestone, m.xp from lesson_progress p join (values ('start', 10), ('done', 40)) as m (milestone, xp) on m.milestone = 'start' or p.state in ('read', 'checked', 'mastered') where p.state <> 'not_started' and p.user_id = $1 order by 3, 4 on conflict (user_id, source, item_key, milestone) do nothing",
    deleteLessonsKeepingXp: "with gone as ( delete from lesson_progress where user_id = $1 returning user_id, course_slug, lesson_id, state ), awarded as ( insert into xp_awards (user_id, source, item_key, milestone, xp) select p.user_id, 'lesson', p.course_slug || '/' || p.lesson_id, m.milestone, m.xp from gone p join (values ('start', 10), ('done', 40)) as m (milestone, xp) on m.milestone = 'start' or p.state in ('read', 'checked', 'mastered') where p.state <> 'not_started' order by 3, 4 on conflict (user_id, source, item_key, milestone) do nothing ) select count(*)::int as deleted from gone",
    xpReconcileStages: "insert into xp_awards (user_id, source, item_key, milestone, xp) select distinct u.user_id, 'blender_stage', 'blender/' || s.stage, 'done', 80 from user_progress u cross join lateral unnest(u.completed_stages) as s (stage) where u.course_id = 'blender' and s.stage in ('1', '2', '3', '4') and u.user_id = $1 order by 3 on conflict (user_id, source, item_key, milestone) do nothing returning item_key",
    learningDay: "insert into learning_days (user_id, day) values ($1, (now() at time zone 'asia/tokyo')::date) on conflict (user_id, day) do nothing",
    xpAwards: 'select source, item_key, milestone, xp from xp_awards where user_id = $1 order by source, item_key, milestone',
    selectDays: "select to_char(day, 'yyyy-mm-dd') as day from learning_days where user_id = $1 order by day",
    selectToday: "select to_char((now() at time zone 'asia/tokyo')::date, 'yyyy-mm-dd') as today",
    // The learning history (server/routes/user.js): history only, never XP or a day.
    eventsInsert: 'insert into learning_events (user_id, type, title, description) values ($1, $2, $3, $4) returning id, created_at as timestamp',
    eventsSelect: 'select id, type, title, description, created_at as timestamp from learning_events where user_id = $1 order by created_at desc limit 50',
    // The legacy Blender progress routes (server/routes/user.js), which feed the stage awards.
    legacyProgressUpsert: 'insert into user_progress (user_id, course_id, completed_stages, completed_steps) values ($1, $2, $3, $4) on conflict (user_id, course_id) do update set completed_stages = $3, completed_steps = $4',
    legacyProgressSelect: 'select course_id, completed_stages, completed_steps from user_progress where user_id = $1',
    // Phase 6 (migration 020): the review queue (tools/core/reviewQueue.js) and R4 (lessonProgress.js).
    enterReviewCards: norm(`WITH candidates AS (
      SELECT p.user_id, c.course_slug, c.lesson_id, c.card_id,
             COALESCE(p.progress_changed_at, p.updated_at) AS learned_at,
             CASE WHEN (p.progress -> 'checks' -> c.check_key) = 'false'::jsonb THEN 1 ELSE 3 END AS prior,
             NOT EXISTS (SELECT 1 FROM review_cards x
                          WHERE x.user_id = p.user_id AND x.course_slug = p.course_slug AND x.lesson_id = p.lesson_id
                            AND x.learned_at >= COALESCE(p.progress_changed_at, p.updated_at)) AS studied
        FROM lesson_progress p
        JOIN unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS c (course_slug, lesson_id, check_key, card_id)
          ON c.course_slug = p.course_slug AND c.lesson_id = p.lesson_id
       WHERE p.user_id = $1
         AND (p.state IN ('read', 'checked', 'mastered') OR (p.progress -> 'checks') ? c.check_key)
    )
    INSERT INTO review_cards (user_id, course_slug, lesson_id, card_id, learned_at, prior_rating, stability, difficulty, due_day)
    SELECT user_id, course_slug, lesson_id, card_id,
           CASE WHEN studied THEN learned_at END,
           CASE WHEN studied THEN prior END,
           CASE WHEN NOT studied THEN NULL WHEN prior = 1 THEN $9::float8 ELSE $6::float8 END,
           CASE WHEN NOT studied THEN NULL WHEN prior = 1 THEN $10::float8 ELSE $7::float8 END,
           CASE WHEN NOT studied THEN (now() AT TIME ZONE 'Asia/Tokyo')::date + 1
                ELSE (learned_at AT TIME ZONE 'Asia/Tokyo')::date + CASE WHEN prior = 1 THEN $11::int ELSE $8::int END END
      FROM candidates
     ORDER BY course_slug, lesson_id, card_id
    ON CONFLICT (user_id, course_slug, lesson_id, card_id) DO NOTHING`),
    reviewRows: norm(`SELECT course_slug, lesson_id, card_id, stability, difficulty, reps, last_rating,
           to_char(due_day, 'YYYY-MM-DD') AS due_on,
           (now() AT TIME ZONE 'Asia/Tokyo')::date - COALESCE(last_review_day, (learned_at AT TIME ZONE 'Asia/Tokyo')::date) AS days_since,
           due_day <= (now() AT TIME ZONE 'Asia/Tokyo')::date AS due,
           last_review_day IS NOT DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date AS reviewed_today
      FROM review_cards WHERE user_id = $1 ORDER BY course_slug, lesson_id, card_id`),
    lockReviewCard: norm(`SELECT stability, difficulty, reps, lapses, last_rating,
           to_char(due_day, 'YYYY-MM-DD') AS due_on,
           (now() AT TIME ZONE 'Asia/Tokyo')::date - COALESCE(last_review_day, (learned_at AT TIME ZONE 'Asia/Tokyo')::date) AS days_since,
           due_day <= (now() AT TIME ZONE 'Asia/Tokyo')::date AS due,
           last_review_day IS NOT DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date AS reviewed_today
      FROM review_cards WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3 AND card_id = $4 FOR UPDATE`),
    doneToday: "select count(*)::int as done from review_cards where user_id = $1 and last_review_day = (now() at time zone 'asia/tokyo')::date",
    gradeReviewCard: norm(`UPDATE review_cards
       SET stability = $5, difficulty = $6, reps = reps + 1, lapses = lapses + $7::int, last_rating = $8,
           last_review_day = (now() AT TIME ZONE 'Asia/Tokyo')::date,
           due_day = (now() AT TIME ZONE 'Asia/Tokyo')::date + $9::int
     WHERE user_id = $1 AND course_slug = $2 AND lesson_id = $3 AND card_id = $4
       AND due_day <= (now() AT TIME ZONE 'Asia/Tokyo')::date
       AND last_review_day IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date
    RETURNING to_char(due_day, 'YYYY-MM-DD') AS due_on`),
    insertReviewLog: 'insert into review_log (user_id, course_slug, lesson_id, card_id, rating, elapsed_days, interval_days, stability, difficulty, source) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    deleteLessonReviewCards: 'delete from review_cards where user_id = $1 and course_slug = $2 and lesson_id = $3',
    deleteAllReviewCards: 'delete from review_cards where user_id = $1',
});

/** The new tables a statement may not name unless it is one of SQL above (and the MCP role never sees). */
export const PHASE5_TABLES = /lesson_progress_lesson_resets|xp_awards|learning_days/;

/** Phase 6's tables: a statement naming them must be one of SQL above. */
export const PHASE6_TABLES = /review_cards|review_log/;

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const STATES = new Set(['not_started', 'in_progress', 'read', 'checked', 'mastered']);

/** jsonb's text output (a space after ":" and ","), written independently of the module's estimate. */
export function jsonbText(value) {
    if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}: ${jsonbText(v)}`).join(', ')}}`;
    }
    return JSON.stringify(value);
}

const checkViolation = (constraint, table = 'lesson_progress') => Object.assign(new Error(`new row for relation "${table}" violates check constraint "${constraint}"`), { code: '23514' });

/** migration 019's xp_awards CHECKs, the amount rule included. */
function checkAward(row) {
    if (!['lesson', 'blender_stage'].includes(row.source)) throw checkViolation('xp_awards_source_check', 'xp_awards');
    if (!/^[a-z0-9][a-z0-9-]{0,79}\/[a-z0-9][a-z0-9-]{0,79}$/.test(row.item_key)) throw checkViolation('xp_awards_item_key_check', 'xp_awards');
    if (!['start', 'done'].includes(row.milestone)) throw checkViolation('xp_awards_milestone_check', 'xp_awards');
    const amount = { 'lesson/start': 10, 'lesson/done': 40, 'blender_stage/done': 80 }[`${row.source}/${row.milestone}`];
    if (row.xp !== amount) throw checkViolation('xp_awards_amount_check', 'xp_awards');
}

/** (now() AT TIME ZONE 'Asia/Tokyo')::date as YYYY-MM-DD. @param {Date} at */
export const jstDay = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

const DAY_MS = 86400000;
/** date + n (YYYY-MM-DD). @param {string} day @param {number} n */
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** b − a in whole days (date − date). @param {string} a @param {string} b */
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** JSON text with sorted keys: two values are equal as jsonb exactly when these are equal. */
const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

const DONE_STATES = new Set(['read', 'checked', 'mastered']);
const CARD = /^[a-z0-9][a-z0-9._-]{0,79}$/;

/** migration 020's review_cards CHECKs (column CHECKs, lapses, prior pairing, both memory branches). */
function checkReviewCard(row) {
    const fail = (name) => { throw checkViolation(name, 'review_cards'); };
    if (!SLUG.test(row.course_slug)) fail('review_cards_course_slug_check');
    if (!SLUG.test(row.lesson_id)) fail('review_cards_lesson_id_check');
    if (!CARD.test(row.card_id)) fail('review_cards_card_id_check');
    if (row.prior_rating !== null && ![1, 3].includes(row.prior_rating)) fail('review_cards_prior_rating_check');
    if (row.stability !== null && !(row.stability >= 0.001 && row.stability <= 36500)) fail('review_cards_stability_check');
    if (row.difficulty !== null && !(row.difficulty >= 1 && row.difficulty <= 10)) fail('review_cards_difficulty_check');
    if (!(Number.isInteger(row.reps) && row.reps >= 0)) fail('review_cards_reps_check');
    if (row.last_rating !== null && ![1, 3].includes(row.last_rating)) fail('review_cards_last_rating_check');
    if (!(row.lapses >= 0 && row.lapses <= row.reps)) fail('review_cards_lapses_check');
    if ((row.learned_at === null) !== (row.prior_rating === null)) fail('review_cards_prior_check');
    const learnedDay = row.learned_at === null ? null : jstDay(row.learned_at);
    const fresh = row.reps === 0 && row.last_rating === null && row.last_review_day === null
        && ((learnedDay !== null && row.stability !== null && row.difficulty !== null
            && row.due_day > learnedDay && row.due_day <= addDays(learnedDay, 365))
            || (learnedDay === null && row.stability === null && row.difficulty === null));
    const reviewed = row.reps > 0 && row.stability !== null && row.difficulty !== null && row.last_rating !== null && row.last_review_day !== null
        && (learnedDay === null || learnedDay < row.last_review_day)
        && row.due_day > row.last_review_day && row.due_day <= addDays(row.last_review_day, 365);
    if (!fresh && !reviewed) fail('review_cards_memory_check');
}

/** migration 020's review_log CHECKs. */
function checkReviewLog(row) {
    const fail = (name) => { throw checkViolation(name, 'review_log'); };
    if (![1, 3].includes(row.rating)) fail('review_log_rating_check');
    if (row.elapsed_days !== null && !(Number.isInteger(row.elapsed_days) && row.elapsed_days >= 1)) fail('review_log_elapsed_days_check');
    if (!(Number.isInteger(row.interval_days) && row.interval_days >= 1 && row.interval_days <= 365)) fail('review_log_interval_days_check');
    if (!(row.stability >= 0.001 && row.stability <= 36500)) fail('review_log_stability_check');
    if (!(row.difficulty >= 1 && row.difficulty <= 10)) fail('review_log_difficulty_check');
    if (!['web', 'mcp'].includes(row.source)) fail('review_log_source_check');
}

function checkRow(row) {
    if (!SLUG.test(row.course_slug)) throw checkViolation('lesson_progress_course_slug_check');
    if (!SLUG.test(row.lesson_id)) throw checkViolation('lesson_progress_lesson_id_check');
    if (!row.progress || typeof row.progress !== 'object' || Array.isArray(row.progress)
        || Buffer.byteLength(jsonbText(row.progress), 'utf8') > 65536) throw checkViolation('lesson_progress_progress_check');
    if (!STATES.has(row.state)) throw checkViolation('lesson_progress_state_check');
    if (!(row.pct >= 0 && row.pct <= 100)) throw checkViolation('lesson_progress_pct_check');
}

/**
 * @param {{ rows?: object[], resets?: Record<string, string>, tombstones?: Record<string, { deletedAt: Date | string, reopenedAt?: Date | string | null }>,
 *   lessonResets?: { user_id: string, course_slug: string, lesson_id: string, lesson_epoch: string, reset_at?: Date | string }[],
 *   userProgress?: { user_id: string, course_id: string, completed_stages: string[] }[],
 *   awards?: { user_id: string, source: string, item_key: string, milestone: string, xp: number }[],
 *   days?: { user_id: string, day: string }[], reviewCards?: object[], reviewLog?: object[], clock?: () => Date }} [seed]
 *   rows: { user_id, course_slug, lesson_id, progress, pct?, state?, content_hash?, progress_updated_at? }
 *   resets: user id → epoch
 *   tombstones: user id → account_deletions row (Phase 4)
 *   lessonResets, userProgress, awards, days: Phase 5 rows (migration 019; user_progress from 002)
 *   rows[].progress_changed_at: null (the default) is a row from before migration 020
 *   reviewCards, reviewLog: Phase 6 rows (migration 020; days as YYYY-MM-DD, times as Date or ISO)
 */
export function createLessonProgressPool({ rows = [], resets = {}, tombstones = {}, lessonResets = [], userProgress = [], awards = [], days = [], reviewCards = [], reviewLog = [], clock = () => new Date() } = {}) {
    const key = (user, course, lesson) => `${user}|${course}|${lesson}`;
    function cardKey(user, course, lesson, card) {
        return `${user}|${course}|${lesson}|${card}`;
    }
    const awardKey = (user, source, item, milestone) => `${user}|${source}|${item}|${milestone}`;
    const EVENT_TYPES = new Set(['lesson_start', 'lesson_complete', 'stage_complete', 'course_complete', 'diagnosis_complete', 'course_generated']);
    let state = {
        rows: new Map(rows.map((row) => [key(row.user_id, row.course_slug, row.lesson_id), {
            pct: 0,
            state: 'not_started',
            content_hash: null,
            progress_updated_at: new Date(row.progress?.updatedAt ?? 0),
            progress_changed_at: null,
            created_at: new Date('2026-10-01T00:00:00Z'),
            updated_at: new Date('2026-10-01T00:00:00Z'),
            ...structuredClone(row),
        }])),
        resets: new Map(Object.entries(resets).map(([user, epoch]) => [user, { epoch, reset_at: new Date('2026-10-01T00:00:00Z') }])),
        tombstones: new Map(Object.entries(tombstones).map(([user, t]) => [user, {
            deleted_at: new Date(t.deletedAt),
            reopened_at: t.reopenedAt ? new Date(t.reopenedAt) : null,
        }])),
        lessonResets: new Map(lessonResets.map((r) => [key(r.user_id, r.course_slug, r.lesson_id), {
            lesson_epoch: r.lesson_epoch,
            reset_at: new Date(r.reset_at ?? '2026-10-01T00:00:00Z'),
        }])),
        userProgress: new Map(userProgress.map((u) => [`${u.user_id}|${u.course_id}`, { completed_stages: [...u.completed_stages], completed_steps: {} }])),
        awards: new Map(awards.map((a) => {
            checkAward(a);
            return [awardKey(a.user_id, a.source, a.item_key, a.milestone), { ...a, awarded_at: new Date('2026-10-01T00:00:00Z') }];
        })),
        days: new Set(days.map((d) => `${d.user_id}|${d.day}`)),
        /** learning_events rows, oldest first */
        events: [],
        /** review_cards (Phase 6), by 'user|course|lesson|card' */
        reviewCards: new Map(reviewCards.map((r) => {
            const row = {
                entered_at: new Date('2026-10-01T00:00:00Z'), learned_at: null, prior_rating: null, stability: null, difficulty: null,
                reps: 0, lapses: 0, last_rating: null, last_review_day: null, ...structuredClone(r),
            };
            for (const field of ['entered_at', 'learned_at']) if (row[field] !== null) row[field] = new Date(row[field]);
            checkReviewCard(row);
            return [cardKey(row.user_id, row.course_slug, row.lesson_id, row.card_id), row];
        })),
        /** review_log (Phase 6), by 'user|course|lesson|card|day' */
        reviewLog: new Map(reviewLog.map((r) => {
            const row = { elapsed_days: null, reviewed_at: new Date('2026-10-01T00:00:00Z'), ...structuredClone(r) };
            row.reviewed_at = new Date(row.reviewed_at);
            checkReviewLog(row);
            return [`${cardKey(row.user_id, row.course_slug, row.lesson_id, row.card_id)}|${row.review_day}`, row];
        })),
    };
    let snapshot = null;
    /** now() of the open transaction (one value per transaction, as in Postgres), else null. */
    let txNow = null;
    const now = () => txNow ?? clock();
    const queries = [];
    /** @type {{ when: (text: string) => boolean, fn: () => void } | null} */
    let interleaving = null;
    let failure = null;
    let connectFailure = null;
    const released = [];
    /** The text each XP_LOCK_SQL hashed, in order ($1::uuid::text: lower case). */
    const xpLockKeys = [];

    /** Inserts the lesson awards the given rows earn and the ledger lacks (ORDER BY item, milestone); returns how many. */
    const awardLessons = (user, rowsOf) => {
        const earned = rowsOf
            .filter((row) => row.state !== 'not_started')
            .flatMap((row) => {
                const item = `${row.course_slug}/${row.lesson_id}`;
                const done = ['read', 'checked', 'mastered'].includes(row.state);
                return [{ item, milestone: 'start', xp: 10 }, ...(done ? [{ item, milestone: 'done', xp: 40 }] : [])];
            })
            .sort((a, b) => (a.item === b.item ? a.milestone.localeCompare(b.milestone) : a.item < b.item ? -1 : 1));
        let n = 0;
        for (const { item, milestone, xp } of earned) {
            const k = awardKey(user, 'lesson', item, milestone);
            if (state.awards.has(k)) continue;
            const award = { user_id: user, source: 'lesson', item_key: item, milestone, xp, awarded_at: now() };
            checkAward(award);
            state.awards.set(k, award);
            n += 1;
        }
        return n;
    };

    /** clock_timestamp(): the clock at the statement (now() is the clock at the transaction's BEGIN). */
    const clockTimestamp = () => clock();
    /** migration 020's trigger on UPDATE: clock_timestamp() when progress changes, else kept (or the old updated_at frozen in). */
    const changedAt = (old, progress) => (canonical(progress) !== canonical(old.progress)
        ? clockTimestamp()
        : (old.progress_changed_at ?? old.updated_at));

    /** A review_cards row as REVIEW_ROWS_SQL / LOCK_REVIEW_CARD_SQL read it, today being the transaction's Japan-time day. */
    const reviewView = (row, today) => {
        const base = row.last_review_day ?? (row.learned_at === null ? null : jstDay(row.learned_at));
        return {
            course_slug: row.course_slug, lesson_id: row.lesson_id, card_id: row.card_id, stability: row.stability, difficulty: row.difficulty,
            reps: row.reps, lapses: row.lapses, last_rating: row.last_rating, due_on: row.due_day,
            days_since: base === null ? null : daysBetween(base, today),
            due: row.due_day <= today,
            reviewed_today: row.last_review_day === today,
        };
    };
    const byCardKey = (a, b) => {
        const ka = `${a.course_slug}/${a.lesson_id}/${a.card_id}`;
        const kb = `${b.course_slug}/${b.lesson_id}/${b.card_id}`;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
    };
    /** Deletes cards (and, by the composite foreign key's cascade, their log rows); returns how many cards. */
    const deleteCards = (match) => {
        let n = 0;
        for (const [k, row] of state.reviewCards) {
            if (!match(row)) continue;
            state.reviewCards.delete(k);
            for (const logKey of [...state.reviewLog.keys()]) if (logKey.startsWith(`${k}|`)) state.reviewLog.delete(logKey);
            n += 1;
        }
        return n;
    };

    const run = async (sql, params = [], via = 'pool') => {
        const text = norm(sql);
        queries.push({ sql: text, params, via });
        if (text.startsWith('insert into auth.users')) return { rowCount: 1, rows: [] };
        if (text === 'begin') {
            snapshot = structuredClone(state);
            txNow = clock();
            return { rowCount: null, rows: [] };
        }
        if (text === 'commit') {
            snapshot = null;
            txNow = null;
            return { rowCount: null, rows: [] };
        }
        if (text === 'rollback') {
            if (snapshot) state = snapshot;
            snapshot = null;
            txNow = null;
            return { rowCount: null, rows: [] };
        }
        if (interleaving?.when(text)) {
            const { fn } = interleaving;
            interleaving = null;
            fn();
        }
        if (failure && failure.when(text)) throw Object.assign(new Error(failure.message), failure.code ? { code: failure.code } : {});
        const [p1, p2, p3, p4, p5, p6, p7, p8] = params;
        switch (text) {
            case SQL.advisoryLock:
                return { rowCount: 1, rows: [{ pg_advisory_xact_lock: '' }] };
            case SQL.selectEpoch: {
                const reset = state.resets.get(p1);
                return reset ? { rowCount: 1, rows: [{ epoch: reset.epoch }] } : { rowCount: 0, rows: [] };
            }
            case SQL.upsertEpoch: {
                const epoch = randomUUID();
                state.resets.set(p1, { epoch, reset_at: now() });
                return { rowCount: 1, rows: [{ epoch }] };
            }
            case SQL.selectRestarted: {
                const tombstone = state.tombstones.get(p1);
                const reset = state.resets.get(p1);
                const restarted = Boolean(tombstone?.reopened_at && reset && tombstone.reopened_at.getTime() === reset.reset_at.getTime());
                return { rowCount: 1, rows: [{ restarted }] };
            }
            case SQL.selectTombstone: {
                const tombstone = state.tombstones.get(p1);
                return tombstone ? { rowCount: 1, rows: [{ ...tombstone }] } : { rowCount: 0, rows: [] };
            }
            case SQL.reopenLock:
                return { rowCount: 1, rows: [{}] };
            case SQL.reopen: {
                const tombstone = state.tombstones.get(p1);
                if (!tombstone || tombstone.reopened_at || !(Number(p2) > tombstone.deleted_at.getTime() / 1000 + 30)) return { rowCount: 0, rows: [] };
                tombstone.reopened_at = now();
                return { rowCount: 1, rows: [{ reopened_at: tombstone.reopened_at }] };
            }
            case SQL.reopenEpoch:
                state.resets.set(p1, { epoch: randomUUID(), reset_at: now() });
                return { rowCount: 1, rows: [] };
            case SQL.insertPlaceholder: {
                const k = key(p1, p2, p3);
                if (state.rows.has(k)) return { rowCount: 0, rows: [] };
                const row = {
                    user_id: p1, course_slug: p2, lesson_id: p3, progress: JSON.parse(p4), pct: 0, state: 'not_started',
                    content_hash: null, progress_updated_at: new Date(0), progress_changed_at: clockTimestamp(), created_at: now(), updated_at: now(),
                };
                checkRow(row);
                state.rows.set(k, row);
                return { rowCount: 1, rows: [{ created: true }] };
            }
            case SQL.lockRow: {
                const row = state.rows.get(key(p1, p2, p3));
                return row ? { rowCount: 1, rows: [{ progress: structuredClone(row.progress) }] } : { rowCount: 0, rows: [] };
            }
            case SQL.updateRow: {
                const row = state.rows.get(key(p1, p2, p3));
                if (!row) return { rowCount: 0, rows: [] };
                const progress = JSON.parse(p4);
                const next = { ...row, progress, pct: p5, state: p6, content_hash: p7, progress_updated_at: new Date(p8), progress_changed_at: changedAt(row, progress), updated_at: now() };
                checkRow(next);
                state.rows.set(key(p1, p2, p3), next);
                return { rowCount: 1, rows: [] };
            }
            case SQL.selectRows:
            case SQL.selectCourseRows:
            case SQL.selectLessonRows: {
                const found = [...state.rows.values()]
                    .filter((row) => row.user_id === p1
                        && (text === SQL.selectRows || row.course_slug === p2)
                        && (text !== SQL.selectLessonRows || row.lesson_id === p3))
                    .sort((a, b) => `${a.course_slug}/${a.lesson_id}`.localeCompare(`${b.course_slug}/${b.lesson_id}`))
                    .map((row) => structuredClone({
                        course_slug: row.course_slug, lesson_id: row.lesson_id, progress: row.progress, pct: row.pct,
                        state: row.state, content_hash: row.content_hash, progress_updated_at: row.progress_updated_at,
                    }));
                return { rowCount: found.length, rows: found };
            }
            case SQL.writeBack: {
                const row = state.rows.get(key(p1, p2, p3));
                if (!row || row.content_hash === p6) return { rowCount: 0, rows: [] };
                const next = { ...row, pct: p4, state: p5, content_hash: p6, progress_changed_at: changedAt(row, row.progress), updated_at: now() };
                checkRow(next);
                state.rows.set(key(p1, p2, p3), next);
                return { rowCount: 1, rows: [] };
            }
            case SQL.deleteAll: {
                let n = 0;
                for (const [k, row] of state.rows) {
                    if (row.user_id === p1) {
                        state.rows.delete(k);
                        n += 1;
                    }
                }
                return { rowCount: n, rows: [] };
            }
            case SQL.deleteOne: {
                const had = state.rows.delete(key(p1, p2, p3));
                return { rowCount: had ? 1 : 0, rows: [] };
            }
            // ─── Phase 5 ───
            case SQL.stubKeyShare:
                return { rowCount: 1, rows: [{ '?column?': 1 }] };
            case SQL.selectLessonEpochs: {
                const found = [...state.lessonResets].filter(([k]) => k.startsWith(`${p1}|`))
                    .map(([k, r]) => {
                        const [, course_slug, lesson_id] = k.split('|');
                        return { course_slug, lesson_id, lesson_epoch: r.lesson_epoch, reset_at: new Date(r.reset_at) };
                    });
                return { rowCount: found.length, rows: found };
            }
            case SQL.selectRowsWithEpochs: {
                const found = [...state.rows.values()]
                    .filter((row) => row.user_id === p1)
                    .sort((a, b) => `${a.course_slug}/${a.lesson_id}`.localeCompare(`${b.course_slug}/${b.lesson_id}`))
                    .map((row) => {
                        const gen = state.lessonResets.get(key(row.user_id, row.course_slug, row.lesson_id));
                        return structuredClone({
                            course_slug: row.course_slug, lesson_id: row.lesson_id, progress: row.progress, pct: row.pct,
                            state: row.state, content_hash: row.content_hash, progress_updated_at: row.progress_updated_at,
                            lesson_epoch: gen?.lesson_epoch ?? null, reset_at: gen ? gen.reset_at : null,
                        });
                    });
                return { rowCount: found.length, rows: found };
            }
            case SQL.upsertLessonEpoch: {
                if (!SLUG.test(p2) || !SLUG.test(p3)) throw checkViolation('lesson_progress_lesson_resets_course_slug_check', 'lesson_progress_lesson_resets');
                const gen = { lesson_epoch: randomUUID(), reset_at: now() };
                state.lessonResets.set(key(p1, p2, p3), gen);
                return { rowCount: 1, rows: [{ lesson_epoch: gen.lesson_epoch, reset_at: new Date(gen.reset_at) }] };
            }
            case SQL.selectStoredRow: {
                const row = state.rows.get(key(p1, p2, p3));
                return row
                    ? { rowCount: 1, rows: [structuredClone({ progress: row.progress, progress_updated_at: row.progress_updated_at })] }
                    : { rowCount: 0, rows: [] };
            }
            case SQL.xpLock: {
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(p1))) {
                    throw Object.assign(new Error(`invalid input syntax for type uuid: "${p1}"`), { code: '22P02' });
                }
                xpLockKeys.push(`xp:${String(p1).toLowerCase()}`);
                return { rowCount: 1, rows: [{ pg_advisory_xact_lock: '' }] };
            }
            case SQL.xpReconcileLessons:
                return { rowCount: awardLessons(p1, [...state.rows.values()].filter((row) => row.user_id === p1)), rows: [] };
            case SQL.deleteLessonsKeepingXp: {
                const gone = [];
                for (const [k, row] of state.rows) {
                    if (row.user_id === p1) {
                        state.rows.delete(k);
                        gone.push(row);
                    }
                }
                awardLessons(p1, gone);
                return { rowCount: 1, rows: [{ deleted: gone.length }] };
            }
            case SQL.xpReconcileStages: {
                const stages = state.userProgress.get(`${p1}|blender`)?.completed_stages ?? [];
                const items = [...new Set(stages.filter((stage) => ['1', '2', '3', '4'].includes(stage)).map((stage) => `blender/${stage}`))].sort();
                const inserted = [];
                for (const item of items) {
                    const k = awardKey(p1, 'blender_stage', item, 'done');
                    if (state.awards.has(k)) continue;
                    const award = { user_id: p1, source: 'blender_stage', item_key: item, milestone: 'done', xp: 80, awarded_at: now() };
                    checkAward(award);
                    state.awards.set(k, award);
                    inserted.push({ item_key: item });
                }
                return { rowCount: inserted.length, rows: inserted };
            }
            case SQL.learningDay: {
                const k = `${p1}|${jstDay(now())}`;
                if (state.days.has(k)) return { rowCount: 0, rows: [] };
                state.days.add(k);
                return { rowCount: 1, rows: [] };
            }
            case SQL.xpAwards: {
                const found = [...state.awards.values()].filter((a) => a.user_id === p1)
                    .sort((a, b) => (a.source !== b.source ? (a.source < b.source ? -1 : 1) : a.item_key !== b.item_key ? (a.item_key < b.item_key ? -1 : 1) : a.milestone < b.milestone ? -1 : a.milestone > b.milestone ? 1 : 0))
                    .map((a) => ({ source: a.source, item_key: a.item_key, milestone: a.milestone, xp: a.xp }));
                return { rowCount: found.length, rows: found };
            }
            case SQL.selectDays: {
                const found = [...state.days].filter((d) => d.startsWith(`${p1}|`)).map((d) => d.split('|')[1]).sort().map((day) => ({ day }));
                return { rowCount: found.length, rows: found };
            }
            case SQL.selectToday:
                return { rowCount: 1, rows: [{ today: jstDay(now()) }] };
            case SQL.eventsInsert: {
                if (!EVENT_TYPES.has(p2)) throw checkViolation('learning_events_type_check', 'learning_events');
                const event = { id: randomUUID(), user_id: p1, type: p2, title: JSON.parse(p3), description: JSON.parse(p4), created_at: now() };
                state.events.push(event);
                return { rowCount: 1, rows: [{ id: event.id, timestamp: new Date(event.created_at) }] };
            }
            case SQL.eventsSelect: {
                const found = state.events.filter((e) => e.user_id === p1).slice(-50).reverse()
                    .map((e) => structuredClone({ id: e.id, type: e.type, title: e.title, description: e.description, timestamp: e.created_at }));
                return { rowCount: found.length, rows: found };
            }
            case SQL.legacyProgressUpsert:
                state.userProgress.set(`${p1}|${p2}`, { completed_stages: [...(p3 ?? [])], completed_steps: JSON.parse(p4 ?? '{}') });
                return { rowCount: 1, rows: [] };
            case SQL.legacyProgressSelect: {
                const found = [...state.userProgress].filter(([k]) => k.startsWith(`${p1}|`))
                    .map(([k, u]) => ({ course_id: k.split('|')[1], completed_stages: [...u.completed_stages], completed_steps: structuredClone(u.completed_steps) }));
                return { rowCount: found.length, rows: found };
            }
            // ─── Phase 6 ───
            case SQL.enterReviewCards: {
                const [user, courses, lessons, checkKeys, cardIds, goodS, goodD, goodI, againS, againD, againI] = params;
                if (![courses, lessons, checkKeys, cardIds].every((a) => Array.isArray(a) && a.length === courses.length)) {
                    throw new TypeError('enterReviewCards: $2..$5 must be arrays of one length');
                }
                // The CTE reads the statement's snapshot: rows this statement inserts never count.
                const before = [...state.reviewCards.values()];
                const candidates = [];
                for (let i = 0; i < courses.length; i += 1) {
                    const row = state.rows.get(key(user, courses[i], lessons[i]));
                    if (!row) continue;
                    const checks = row.progress?.checks;
                    const isObject = checks !== null && typeof checks === 'object' && !Array.isArray(checks);
                    const marked = isObject && Object.prototype.hasOwnProperty.call(checks, checkKeys[i]);
                    if (!DONE_STATES.has(row.state) && !marked) continue;
                    const learnedAt = row.progress_changed_at ?? row.updated_at;
                    const prior = marked && checks[checkKeys[i]] === false ? 1 : 3;
                    const studied = !before.some((x) => x.user_id === user && x.course_slug === courses[i] && x.lesson_id === lessons[i]
                        && x.learned_at !== null && x.learned_at.getTime() >= learnedAt.getTime());
                    candidates.push({ course_slug: courses[i], lesson_id: lessons[i], card_id: cardIds[i], learnedAt, prior, studied });
                }
                candidates.sort(byCardKey);
                let n = 0;
                for (const c of candidates) {
                    const k = cardKey(user, c.course_slug, c.lesson_id, c.card_id);
                    if (state.reviewCards.has(k)) continue;
                    const again = c.prior === 1;
                    const row = {
                        user_id: user, course_slug: c.course_slug, lesson_id: c.lesson_id, card_id: c.card_id,
                        entered_at: clockTimestamp(),
                        learned_at: c.studied ? new Date(c.learnedAt) : null,
                        prior_rating: c.studied ? c.prior : null,
                        stability: c.studied ? Number(again ? againS : goodS) : null,
                        difficulty: c.studied ? Number(again ? againD : goodD) : null,
                        due_day: c.studied ? addDays(jstDay(c.learnedAt), Number(again ? againI : goodI)) : addDays(jstDay(now()), 1),
                        reps: 0, lapses: 0, last_rating: null, last_review_day: null,
                    };
                    checkReviewCard(row);
                    state.reviewCards.set(k, row);
                    n += 1;
                }
                return { rowCount: n, rows: [] };
            }
            case SQL.reviewRows: {
                const today = jstDay(now());
                const found = [...state.reviewCards.values()].filter((row) => row.user_id === p1).sort(byCardKey)
                    .map((row) => {
                        const { lapses, ...view } = reviewView(row, today);
                        return view;
                    });
                return { rowCount: found.length, rows: found };
            }
            case SQL.lockReviewCard: {
                const row = state.reviewCards.get(cardKey(p1, p2, p3, p4));
                if (!row) return { rowCount: 0, rows: [] };
                const { course_slug, lesson_id, card_id, ...view } = reviewView(row, jstDay(now()));
                return { rowCount: 1, rows: [view] };
            }
            case SQL.doneToday: {
                const today = jstDay(now());
                const done = [...state.reviewCards.values()].filter((row) => row.user_id === p1 && row.last_review_day === today).length;
                return { rowCount: 1, rows: [{ done }] };
            }
            case SQL.gradeReviewCard: {
                const today = jstDay(now());
                const row = state.reviewCards.get(cardKey(p1, p2, p3, p4));
                if (!row || !(row.due_day <= today) || row.last_review_day === today) return { rowCount: 0, rows: [] };
                const next = {
                    ...row, stability: Number(p5), difficulty: Number(p6), reps: row.reps + 1, lapses: row.lapses + Number(p7), last_rating: Number(p8),
                    last_review_day: today, due_day: addDays(today, Number(params[8])),
                };
                checkReviewCard(next);
                state.reviewCards.set(cardKey(p1, p2, p3, p4), next);
                return { rowCount: 1, rows: [{ due_on: next.due_day }] };
            }
            case SQL.insertReviewLog: {
                const k = cardKey(p1, p2, p3, p4);
                const today = jstDay(now());
                const row = {
                    user_id: p1, course_slug: p2, lesson_id: p3, card_id: p4, review_day: today, reviewed_at: now(),
                    rating: Number(p5), elapsed_days: p6 === null || p6 === undefined ? null : Number(p6), interval_days: Number(p7),
                    stability: Number(p8), difficulty: Number(params[8]), source: params[9],
                };
                checkReviewLog(row);
                if (!state.reviewCards.has(k)) {
                    throw Object.assign(new Error('insert or update on table "review_log" violates foreign key constraint "review_log_card_fkey"'), { code: '23503' });
                }
                if (state.reviewLog.has(`${k}|${today}`)) {
                    throw Object.assign(new Error('duplicate key value violates unique constraint "review_log_pkey"'), { code: '23505' });
                }
                state.reviewLog.set(`${k}|${today}`, row);
                return { rowCount: 1, rows: [] };
            }
            case SQL.deleteLessonReviewCards:
                return { rowCount: deleteCards((row) => row.user_id === p1 && row.course_slug === p2 && row.lesson_id === p3), rows: [] };
            case SQL.deleteAllReviewCards:
                return { rowCount: deleteCards((row) => row.user_id === p1), rows: [] };
            default:
                if (/lesson_progress|account_deletions|xp_awards|learning_days|user_progress|learning_events|review_cards|review_log|'xp:'/.test(text)) {
                    throw new Error(`lessonProgressPool: unexpected statement: ${text} ${JSON.stringify([p1, p2, p3, p5, p6, p7, p8])}`);
                }
                return { rowCount: 0, rows: [] };
        }
    };

    return {
        queries,
        released,
        query: (sql, params) => run(sql, params, 'pool'),
        connect: async () => {
            if (connectFailure) throw connectFailure;
            return { query: (sql, params) => run(sql, params, 'client'), release: (error) => released.push(error ?? false) };
        },
        /** The stored row, or undefined. */
        row: (user, course, lesson) => state.rows.get(key(user, course, lesson)),
        rows: () => [...state.rows.values()],
        epochOf: (user) => state.resets.get(user)?.epoch ?? null,
        /** The account_deletions row (Phase 4), or undefined. */
        tombstoneOf: (user) => state.tombstones.get(user),
        /** A lesson's generation { lesson_epoch, reset_at } (Phase 5), or undefined. */
        lessonResetOf: (user, course, lesson) => state.lessonResets.get(key(user, course, lesson)),
        /** The learner's XP awards as 'source item milestone xp', sorted (Phase 5). */
        awardsOf: (user) => [...state.awards.values()].filter((a) => a.user_id === user)
            .map((a) => `${a.source} ${a.item_key} ${a.milestone} ${a.xp}`).sort(),
        /** The learner's total XP (Phase 5). */
        xpOf: (user) => [...state.awards.values()].filter((a) => a.user_id === user).reduce((n, a) => n + a.xp, 0),
        /** The learner's learning days (YYYY-MM-DD, Japan time), sorted (Phase 5). */
        daysOf: (user) => [...state.days].filter((d) => d.startsWith(`${user}|`)).map((d) => d.split('|')[1]).sort(),
        /** The learner's review_cards rows (copies), by course, lesson and card (Phase 6). */
        reviewRows: (user) => [...state.reviewCards.values()].filter((r) => r.user_id === user).sort(byCardKey).map((r) => structuredClone(r)),
        /** The learner's review_log rows (copies), by card and day (Phase 6). */
        logRows: (user) => [...state.reviewLog.values()].filter((r) => r.user_id === user)
            .sort((a, b) => byCardKey(a, b) || (a.review_day < b.review_day ? -1 : a.review_day > b.review_day ? 1 : 0)).map((r) => structuredClone(r)),
        /** The live review_cards row, or undefined: a test may change it (another connection's write). */
        reviewCard: (user, course, lesson, card) => state.reviewCards.get(cardKey(user, course, lesson, card)),
        /** The key text of every XP lock taken so far, in order (what hashtext hashed). */
        xpLockKeys: () => [...xpLockKeys],
        /** The learner's learning_events rows, oldest first (stage 2). */
        eventsOf: (user) => state.events.filter((e) => e.user_id === user).map((e) => structuredClone(e)),
        /**
         * Statements (normalized) that touch lesson progress, the XP tables or their locks, in
         * order. The sign-in stub upsert (insert into auth.users) is not one of them.
         */
        progressStatements: () => queries.map((q) => q.sql).filter((sql) => /lesson_progress|xp_awards|learning_days|review_cards|review_log|'xp:'|for key share|^begin$|^commit$|^rollback$/.test(sql)),
        /** Makes matching statements throw (`code`: a Postgres error code, or none). */
        fail: ({ code, message = 'relation "lesson_progress" does not exist (host db.internal:5432)', when = (text) => /lesson_progress|xp_awards|learning_days/.test(text) } = {}) => {
            failure = { code, message, when };
        },
        failConnect: (error) => {
            connectFailure = error;
        },
        /**
         * Runs fn once, right before the first statement `when` (normalized SQL) matches: a write of
         * another connection that commits just then. fn may change a stored row through row().
         */
        interleave: (when, fn) => {
            interleaving = { when, fn };
        },
        inTransaction: () => snapshot !== null,
    };
}
