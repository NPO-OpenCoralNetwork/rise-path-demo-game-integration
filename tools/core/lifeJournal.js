/**
 * Shared Business Logic — Life Journal (daily)
 * Re-exports lifeJournalService for MCP/Express dual use.
 */
import { getPool } from '../../server/db.js';
import { classifyDbError } from './dbErrors.js';
import {
    validateDailyPayload,
    validateEntryDate,
    validateWritableEntryDate,
    validateDateRange,
    validateTimezone,
    upsertDailyEntry,
    getDailyEntry,
    getRangeEntries,
} from '../../server/services/lifeJournalService.js';
import { analyzeLifeJournal } from '../../server/services/lifeJournalAnalysisService.js';
import { deriveLifeHabitSignals } from '../../server/services/personalizationDeriver.js';
import { buildWeeklyAdviceFromDays } from './lifeJournalWeekly.js';
import { getLatestProfile } from './learnerProfile.js';

const EXCERPT_MAX_LEN = 160;
const MAX_DIARY_EXCERPTS = 3;

export {
    validateDailyPayload,
    validateEntryDate,
    validateWritableEntryDate,
    validateDateRange,
    validateTimezone,
};

export async function logDaily({
    userId,
    entryDate,
    reflection,
    lifestyle,
    timezone,
}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const tzCheck = validateTimezone(timezone);
    if (!tzCheck.valid) {
        return { error: 'Invalid timezone', error_type: 'validation', details: tzCheck.errors };
    }

    const dateCheck = validateWritableEntryDate(entryDate, tzCheck.normalized);
    if (!dateCheck.valid) {
        return { error: 'Invalid date', error_type: 'validation', details: dateCheck.errors };
    }

    const payloadCheck = validateDailyPayload({ reflection, lifestyle });
    if (!payloadCheck.valid) {
        return { error: 'Invalid life journal entry', error_type: 'validation', details: payloadCheck.errors };
    }

    try {
        const entry = await upsertDailyEntry({
            pool,
            userId,
            entryDate: dateCheck.normalized,
            reflection,
            lifestyle,
            timezone: tzCheck.normalized,
        });
        return { ok: true, date: dateCheck.normalized, entry };
    } catch (err) {
        return classifyDbError(err, 'logDaily');
    }
}

export async function getDaily({
    userId,
    entryDate,
    timezone,
}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const dateCheck = validateEntryDate(entryDate);
    if (!dateCheck.valid) {
        return { error: 'Invalid date', error_type: 'validation', details: dateCheck.errors };
    }

    const tzCheck = validateTimezone(timezone);
    if (!tzCheck.valid) {
        return { error: 'Invalid timezone', error_type: 'validation', details: tzCheck.errors };
    }

    try {
        const entry = await getDailyEntry({
            pool,
            userId,
            entryDate: dateCheck.normalized,
            timezone: tzCheck.normalized,
        });
        return { ok: true, ...entry };
    } catch (err) {
        return classifyDbError(err, 'getDaily');
    }
}

export async function getRange({
    userId,
    from,
    to,
    timezone,
}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const rangeCheck = validateDateRange(from, to);
    if (!rangeCheck.valid) {
        return {
            error: 'Invalid date range',
            error_type: 'validation',
            details: rangeCheck.errors,
        };
    }

    const tzCheck = validateTimezone(timezone);
    if (!tzCheck.valid) {
        return { error: 'Invalid timezone', error_type: 'validation', details: tzCheck.errors };
    }

    try {
        const range = await getRangeEntries({
            pool,
            userId,
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });
        return { ok: true, ...range };
    } catch (err) {
        return classifyDbError(err, 'getRange');
    }
}

export async function getAnalysis({
    userId,
    from,
    to,
    timezone,
    granularity = 'custom',
}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const rangeCheck = validateDateRange(from, to);
    if (!rangeCheck.valid) {
        return {
            error: 'Invalid date range',
            error_type: 'validation',
            details: rangeCheck.errors,
        };
    }

    const tzCheck = validateTimezone(timezone);
    if (!tzCheck.valid) {
        return { error: 'Invalid timezone', error_type: 'validation', details: tzCheck.errors };
    }

    try {
        const range = await getRangeEntries({
            pool,
            userId,
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });
        const analysis = analyzeLifeJournal(range.days, {
            from: rangeCheck.from,
            to: rangeCheck.to,
            granularity,
        });
        const habitSignals = deriveLifeHabitSignals(analysis.metrics);
        return {
            ...analysis,
            advice: habitSignals.advice,
            life_signals: habitSignals.signals,
        };
    } catch (err) {
        return classifyDbError(err, 'getAnalysis');
    }
}

export function buildDiaryExcerpts(days) {
    return (days ?? [])
        .filter((d) => d?.diary_text && String(d.diary_text).trim())
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, MAX_DIARY_EXCERPTS)
        .map((d) => ({
            date: d.date,
            excerpt: String(d.diary_text).trim().slice(0, EXCERPT_MAX_LEN),
        }));
}

export function extractAssessmentProfile(profileResult) {
    if (!profileResult?.found) return null;
    const raw = profileResult.raw_profile;
    const bigFive = raw?.big_five ?? raw?.bigFive ?? null;
    if (!bigFive || typeof bigFive !== 'object') return null;
    const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
    const out = {};
    for (const trait of traits) {
        if (bigFive[trait] != null) out[trait] = bigFive[trait];
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Build LLM-safe chat context from pre-fetched analysis (no raw day rows).
 */
export function buildChatContext({
    from,
    to,
    timezone,
    analysis,
    adviceResult,
    assessmentProfile,
    includeDiaryExcerpts = false,
    days = [],
}) {
    const metrics = analysis?.metrics ?? {};
    const topCorrelations = (analysis?.correlations ?? []).slice(0, 3).map((c) => ({
        pair: c.label ?? `${c.x}×${c.y}`,
        r: c.r,
        n: c.n,
        confidence: c.confidence,
        strength: c.strength,
    }));

    const ruleAdvice = (adviceResult?.advice ?? analysis?.advice ?? []).map((a) => ({
        rule_id: a.rule_id,
        title: a.title,
        action: a.action,
        evidence: a.evidence,
        confidence: a.confidence,
        difficulty: a.difficulty,
    }));

    return {
        ok: true,
        period: {
            from,
            to,
            recorded_days: analysis?.summary?.days_logged ?? metrics.days_logged ?? 0,
            timezone,
        },
        metrics_summary: {
            avg_sleep_hours: analysis?.summary?.avg_sleep_hours ?? metrics.avg_sleep_hours,
            avg_focus: analysis?.summary?.avg_focus ?? metrics.avg_focus,
            avg_energy: analysis?.summary?.avg_energy ?? metrics.avg_energy,
            avg_stress: analysis?.summary?.avg_stress ?? metrics.avg_stress,
            total_learning_min: analysis?.summary?.total_learning_min ?? metrics.total_learning_min,
            exercise_days: metrics.exercise_days,
            record_streak: analysis?.summary?.record_streak ?? metrics.record_streak,
        },
        top_correlations: topCorrelations,
        matched_patterns: (analysis?.patterns ?? []).map((p) => p.id),
        patterns_detail: (analysis?.patterns ?? []).slice(0, 5),
        rule_advice: ruleAdvice,
        assessment_profile: assessmentProfile,
        assessment_available: assessmentProfile != null,
        diary_excerpts: includeDiaryExcerpts ? buildDiaryExcerpts(days) : [],
        data_quality: analysis?.data_quality ?? null,
        privacy: {
            diary_included: Boolean(includeDiaryExcerpts),
            data_class: includeDiaryExcerpts ? 'aggregated_with_excerpts' : 'aggregated_only',
        },
    };
}

export async function getChatContext({
    userId,
    from,
    to,
    timezone,
    includeDiaryExcerpts = false,
    granularity = 'custom',
}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const rangeCheck = validateDateRange(from, to);
    if (!rangeCheck.valid) {
        return {
            error: 'Invalid date range',
            error_type: 'validation',
            details: rangeCheck.errors,
        };
    }

    const tzCheck = validateTimezone(timezone);
    if (!tzCheck.valid) {
        return { error: 'Invalid timezone', error_type: 'validation', details: tzCheck.errors };
    }

    try {
        const range = await getRangeEntries({
            pool,
            userId,
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });

        const analysis = analyzeLifeJournal(range.days, {
            from: rangeCheck.from,
            to: rangeCheck.to,
            granularity,
        });
        const habitSignals = deriveLifeHabitSignals(analysis.metrics);
        analysis.advice = habitSignals.advice;

        const adviceResult = buildWeeklyAdviceFromDays(range.days, {
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });

        const profileResult = await getLatestProfile({ userId });
        const assessmentProfile = extractAssessmentProfile(profileResult);

        return buildChatContext({
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
            analysis,
            adviceResult,
            assessmentProfile,
            includeDiaryExcerpts: Boolean(includeDiaryExcerpts),
            days: range.days,
        });
    } catch (err) {
        return classifyDbError(err, 'getChatContext');
    }
}

export async function getAdvice({
    userId,
    from,
    to,
    timezone,
}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const rangeCheck = validateDateRange(from, to);
    if (!rangeCheck.valid) {
        return {
            error: 'Invalid date range',
            error_type: 'validation',
            details: rangeCheck.errors,
        };
    }

    const tzCheck = validateTimezone(timezone);
    if (!tzCheck.valid) {
        return { error: 'Invalid timezone', error_type: 'validation', details: tzCheck.errors };
    }

    try {
        const range = await getRangeEntries({
            pool,
            userId,
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });
        return buildWeeklyAdviceFromDays(range.days, {
            from: rangeCheck.from,
            to: rangeCheck.to,
            timezone: tzCheck.normalized,
        });
    } catch (err) {
        return classifyDbError(err, 'getAdvice');
    }
}