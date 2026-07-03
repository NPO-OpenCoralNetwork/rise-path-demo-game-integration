/**
 * Life Journal privacy — Phase 16-7
 * Export, delete, and diary excerpt consent (user_profiles.preferences).
 */
import {
    getRangeEntries,
    validateDateRange,
    validateTimezone,
    MAX_RANGE_DAYS,
} from './lifeJournalService.js';
import { buildSemanticMemoriesExportSection } from './learnerMemoryApiService.js';
import { purgeLearnerMemories } from './learnerMemoryBridge.js';

export const EXPORT_SCHEMA_VERSION = '2026-06-24';
export const DELETE_CONFIRM_TOKEN = 'DELETE';

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function extractLifeJournalPrivacyPreferences(preferences) {
    const lifeJournal = asObject(asObject(preferences).privacy).life_journal;
    return {
        allow_diary_excerpts_in_ai: asObject(lifeJournal).allow_diary_excerpts_in_ai === true,
    };
}

export async function loadLifeJournalPrivacyPreferences(pool, userId) {
    if (!pool || !userId) {
        return { allow_diary_excerpts_in_ai: false };
    }

    try {
        const result = await pool.query(
            'SELECT preferences FROM user_profiles WHERE user_id = $1',
            [userId],
        );
        if (!result.rowCount) {
            return { allow_diary_excerpts_in_ai: false };
        }
        return extractLifeJournalPrivacyPreferences(result.rows[0].preferences);
    } catch {
        return { allow_diary_excerpts_in_ai: false };
    }
}

/**
 * Effective diary excerpt flag: request AND persisted user opt-in.
 */
export async function resolveIncludeDiaryExcerpts(pool, userId, requested) {
    if (requested !== true) return false;
    const prefs = await loadLifeJournalPrivacyPreferences(pool, userId);
    return prefs.allow_diary_excerpts_in_ai === true;
}

const dayHasJournalData = (day) => Boolean(
    day?.mood
    || day?.diary_text
    || day?.sleep_hours != null
    || day?.exercise_min != null
    || (day?.tags?.length ?? 0) > 0
    || (day?.total_learning_min ?? 0) > 0,
);

/** Build export JSON from a getRangeEntries result (testable without DB). */
export function buildLifeJournalExportPayload(range) {
    const loggedDays = range.days.filter(dayHasJournalData);

    return {
        ok: true,
        exported_at: new Date().toISOString(),
        schema_version: EXPORT_SCHEMA_VERSION,
        from: range.from,
        to: range.to,
        timezone: range.timezone,
        entry_count: loggedDays.length,
        total_days_in_range: range.days.length,
        days: range.days,
    };
}

export async function exportLifeJournalData({
    pool,
    userId,
    from,
    to,
    timezone,
}) {
    const range = await getRangeEntries({ pool, userId, from, to, timezone });
    const payload = buildLifeJournalExportPayload(range);
    const semanticMemories = await buildSemanticMemoriesExportSection({ pool, userId });
    if (semanticMemories) {
        payload.semantic_memories = semanticMemories;
    }
    return payload;
}

export function validateDeleteLifeJournalBody(body) {
    const errors = [];
    const confirm = typeof body?.confirm === 'string' ? body.confirm.trim() : '';
    if (confirm !== DELETE_CONFIRM_TOKEN) {
        errors.push(`confirm must be "${DELETE_CONFIRM_TOKEN}"`);
    }

    const scope = typeof body?.scope === 'string' ? body.scope.trim().toLowerCase() : 'all';
    if (scope !== 'all' && scope !== 'range') {
        errors.push('scope must be all or range');
    }

    let from = null;
    let to = null;
    if (scope === 'range') {
        const rangeCheck = validateDateRange(body?.from, body?.to);
        if (!rangeCheck.valid) {
            errors.push(...rangeCheck.errors);
        } else {
            from = rangeCheck.from;
            to = rangeCheck.to;
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        parsed: { scope, from, to },
    };
}

export async function deleteLifeJournalData({
    pool,
    userId,
    scope,
    from,
    to,
}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let deletedReflections = 0;
        let deletedLifestyle = 0;
        let deletedSnapshots = 0;

        if (scope === 'all') {
            const dr = await client.query(
                'DELETE FROM daily_reflections WHERE user_id = CAST($1 AS uuid)',
                [userId],
            );
            const dl = await client.query(
                'DELETE FROM lifestyle_logs WHERE user_id = CAST($1 AS uuid)',
                [userId],
            );
            const ds = await client.query(
                'DELETE FROM analysis_snapshots WHERE user_id = CAST($1 AS uuid)',
                [userId],
            );
            await client.query(
                'DELETE FROM agent_chat_consent WHERE user_id = CAST($1 AS uuid)',
                [userId],
            );
            deletedReflections = dr.rowCount ?? 0;
            deletedLifestyle = dl.rowCount ?? 0;
            deletedSnapshots = ds.rowCount ?? 0;
        } else {
            const dr = await client.query(
                `DELETE FROM daily_reflections
                 WHERE user_id = CAST($1 AS uuid)
                   AND entry_date BETWEEN $2::date AND $3::date`,
                [userId, from, to],
            );
            const dl = await client.query(
                `DELETE FROM lifestyle_logs
                 WHERE user_id = CAST($1 AS uuid)
                   AND entry_date BETWEEN $2::date AND $3::date`,
                [userId, from, to],
            );
            const ds = await client.query(
                `DELETE FROM analysis_snapshots
                 WHERE user_id = CAST($1 AS uuid)
                   AND period_start >= $2::date
                   AND period_end <= $3::date`,
                [userId, from, to],
            );
            deletedReflections = dr.rowCount ?? 0;
            deletedLifestyle = dl.rowCount ?? 0;
            deletedSnapshots = ds.rowCount ?? 0;
        }

        await client.query('COMMIT');

        let semanticMemoriesPurged = false;
        let semanticMemoryPurgeError = null;
        if (scope === 'all') {
            const purgeResult = await purgeLearnerMemories({ pool, userId });
            if (purgeResult?.ok) {
                semanticMemoriesPurged = true;
            } else if (purgeResult?.error) {
                semanticMemoryPurgeError = purgeResult.error;
            }
        }

        return {
            ok: true,
            scope,
            from: scope === 'range' ? from : null,
            to: scope === 'range' ? to : null,
            deleted: {
                daily_reflections: deletedReflections,
                lifestyle_logs: deletedLifestyle,
                analysis_snapshots: deletedSnapshots,
                semantic_memories_purged: semanticMemoriesPurged,
            },
            ...(semanticMemoryPurgeError
                ? { semantic_memory_purge_error: semanticMemoryPurgeError }
                : {}),
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export function defaultExportDateRange(timezone = 'UTC') {
    const tzCheck = validateTimezone(timezone);
    const tz = tzCheck.valid ? tzCheck.normalized : 'UTC';
    const to = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());

    const toMs = new Date(`${to}T12:00:00Z`).getTime();
    const fromMs = toMs - (MAX_RANGE_DAYS - 1) * 86400000;
    const from = new Date(fromMs).toISOString().slice(0, 10);

    return { from, to, timezone: tz };
}