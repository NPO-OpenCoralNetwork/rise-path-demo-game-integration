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
});

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

const checkViolation = (constraint) => Object.assign(new Error(`new row for relation "lesson_progress" violates check constraint "${constraint}"`), { code: '23514' });

function checkRow(row) {
    if (!SLUG.test(row.course_slug)) throw checkViolation('lesson_progress_course_slug_check');
    if (!SLUG.test(row.lesson_id)) throw checkViolation('lesson_progress_lesson_id_check');
    if (!row.progress || typeof row.progress !== 'object' || Array.isArray(row.progress)
        || Buffer.byteLength(jsonbText(row.progress), 'utf8') > 65536) throw checkViolation('lesson_progress_progress_check');
    if (!STATES.has(row.state)) throw checkViolation('lesson_progress_state_check');
    if (!(row.pct >= 0 && row.pct <= 100)) throw checkViolation('lesson_progress_pct_check');
}

/**
 * @param {{ rows?: object[], resets?: Record<string, string>, tombstones?: Record<string, { deletedAt: Date | string, reopenedAt?: Date | string | null }> }} [seed]
 *   rows: { user_id, course_slug, lesson_id, progress, pct?, state?, content_hash?, progress_updated_at? }
 *   resets: user id → epoch
 *   tombstones: user id → account_deletions row (Phase 4)
 */
export function createLessonProgressPool({ rows = [], resets = {}, tombstones = {} } = {}) {
    const key = (user, course, lesson) => `${user}|${course}|${lesson}`;
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
    };
    let snapshot = null;
    /** now() of the open transaction (one value per transaction, as in Postgres), else null. */
    let txNow = null;
    const now = () => txNow ?? new Date();
    const queries = [];
    let failure = null;
    let connectFailure = null;
    const released = [];

    const run = async (sql, params = [], via = 'pool') => {
        const text = norm(sql);
        queries.push({ sql: text, params, via });
        if (text.startsWith('insert into auth.users')) return { rowCount: 1, rows: [] };
        if (text === 'begin') {
            snapshot = structuredClone(state);
            txNow = new Date();
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
            default:
                if (text.includes('lesson_progress') || text.includes('account_deletions')) throw new Error(`lessonProgressPool: unexpected statement: ${text} ${JSON.stringify([p1, p2, p3, p5, p6, p7, p8])}`);
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
        /** Statements (normalized) that touch lesson_progress tables, in order. */
        progressStatements: () => queries.map((q) => q.sql).filter((sql) => /lesson_progress|^begin$|^commit$|^rollback$/.test(sql)),
        /** Makes matching statements throw (`code`: a Postgres error code, or none). */
        fail: ({ code, message = 'relation "lesson_progress" does not exist (host db.internal:5432)', when = (text) => text.includes('lesson_progress') } = {}) => {
            failure = { code, message, when };
        },
        failConnect: (error) => {
            connectFailure = error;
        },
        inTransaction: () => snapshot !== null,
    };
}
