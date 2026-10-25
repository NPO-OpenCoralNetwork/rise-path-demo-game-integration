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
 * lesson_progress. `clock` (default: the real clock) gives each transaction its now().
 * `interleave(when, fn)` runs fn once right before the first statement `when` matches: another
 * connection's write that commits just then (an AI app's MCP write during a delete-all).
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
    xpLock: "select pg_advisory_xact_lock(hashtext('xp:' || $1))",
    xpReconcileLessons: "insert into xp_awards (user_id, source, item_key, milestone, xp) select p.user_id, 'lesson', p.course_slug || '/' || p.lesson_id, m.milestone, m.xp from lesson_progress p join (values ('start', 10), ('done', 40)) as m (milestone, xp) on m.milestone = 'start' or p.state in ('read', 'checked', 'mastered') where p.state <> 'not_started' and p.user_id = $1 order by 3, 4 on conflict (user_id, source, item_key, milestone) do nothing",
    deleteLessonsKeepingXp: "with gone as ( delete from lesson_progress where user_id = $1 returning user_id, course_slug, lesson_id, state ), awarded as ( insert into xp_awards (user_id, source, item_key, milestone, xp) select p.user_id, 'lesson', p.course_slug || '/' || p.lesson_id, m.milestone, m.xp from gone p join (values ('start', 10), ('done', 40)) as m (milestone, xp) on m.milestone = 'start' or p.state in ('read', 'checked', 'mastered') where p.state <> 'not_started' order by 3, 4 on conflict (user_id, source, item_key, milestone) do nothing ) select count(*)::int as deleted from gone",
    xpReconcileStages: "insert into xp_awards (user_id, source, item_key, milestone, xp) select distinct u.user_id, 'blender_stage', 'blender/' || s.stage, 'done', 80 from user_progress u cross join lateral unnest(u.completed_stages) as s (stage) where u.course_id = 'blender' and s.stage in ('1', '2', '3', '4') and u.user_id = $1 order by 3 on conflict (user_id, source, item_key, milestone) do nothing returning item_key",
    learningDay: "insert into learning_days (user_id, day) values ($1, (now() at time zone 'asia/tokyo')::date) on conflict (user_id, day) do nothing",
    // The legacy Blender progress routes (server/routes/user.js), which feed the stage awards.
    legacyProgressUpsert: 'insert into user_progress (user_id, course_id, completed_stages, completed_steps) values ($1, $2, $3, $4) on conflict (user_id, course_id) do update set completed_stages = $3, completed_steps = $4',
    legacyProgressSelect: 'select course_id, completed_stages, completed_steps from user_progress where user_id = $1',
});

/** The new tables a statement may not name unless it is one of SQL above (and the MCP role never sees). */
export const PHASE5_TABLES = /lesson_progress_lesson_resets|xp_awards|learning_days/;

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
 *   days?: { user_id: string, day: string }[], clock?: () => Date }} [seed]
 *   rows: { user_id, course_slug, lesson_id, progress, pct?, state?, content_hash?, progress_updated_at? }
 *   resets: user id → epoch
 *   tombstones: user id → account_deletions row (Phase 4)
 *   lessonResets, userProgress, awards, days: Phase 5 rows (migration 019; user_progress from 002)
 */
export function createLessonProgressPool({ rows = [], resets = {}, tombstones = {}, lessonResets = [], userProgress = [], awards = [], days = [], clock = () => new Date() } = {}) {
    const key = (user, course, lesson) => `${user}|${course}|${lesson}`;
    const awardKey = (user, source, item, milestone) => `${user}|${source}|${item}|${milestone}`;
    let state = {
        rows: new Map(rows.map((row) => [key(row.user_id, row.course_slug, row.lesson_id), {
            pct: 0,
            state: 'not_started',
            content_hash: null,
            progress_updated_at: new Date(row.progress?.updatedAt ?? 0),
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
    };
    let snapshot = null;
    /** now() of the open transaction (one value per transaction, as in Postgres), else null. */
    let txNow = null;
    const now = () => txNow ?? new Date();
    const queries = [];
    /** @type {{ when: (text: string) => boolean, fn: () => void } | null} */
    let interleaving = null;
    let failure = null;
    let connectFailure = null;
    const released = [];

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
                    content_hash: null, progress_updated_at: new Date(0), created_at: new Date(), updated_at: new Date(),
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
                const next = { ...row, progress: JSON.parse(p4), pct: p5, state: p6, content_hash: p7, progress_updated_at: new Date(p8), updated_at: new Date() };
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
                const next = { ...row, pct: p4, state: p5, content_hash: p6, updated_at: new Date() };
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
            case SQL.xpLock:
                return { rowCount: 1, rows: [{ pg_advisory_xact_lock: '' }] };
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
            case SQL.legacyProgressUpsert:
                state.userProgress.set(`${p1}|${p2}`, { completed_stages: [...(p3 ?? [])], completed_steps: JSON.parse(p4 ?? '{}') });
                return { rowCount: 1, rows: [] };
            case SQL.legacyProgressSelect: {
                const found = [...state.userProgress].filter(([k]) => k.startsWith(`${p1}|`))
                    .map(([k, u]) => ({ course_id: k.split('|')[1], completed_stages: [...u.completed_stages], completed_steps: structuredClone(u.completed_steps) }));
                return { rowCount: found.length, rows: found };
            }
            default:
                if (/lesson_progress|account_deletions|xp_awards|learning_days|user_progress/.test(text)) {
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
        /**
         * Statements (normalized) that touch lesson progress, the XP tables or their locks, in
         * order. The sign-in stub upsert (insert into auth.users) is not one of them.
         */
        progressStatements: () => queries.map((q) => q.sql).filter((sql) => /lesson_progress|xp_awards|learning_days|'xp:'|for key share|^begin$|^commit$|^rollback$/.test(sql)),
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
