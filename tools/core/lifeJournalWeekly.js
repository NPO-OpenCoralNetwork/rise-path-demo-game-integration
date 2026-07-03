// Weekly life journal advice — Phase 16-5
import { analyzeLifeJournal } from './lifeJournalAnalysis.js';
import { deriveLifeHabitSignals } from './lifeHabitRules.js';

export const ROLLING_WEEK_DAYS = 7;

export const shiftDate = (date, delta) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
};

/** Last N days inclusive ending at anchor (default: today local). */
export const getRollingWeekRange = (anchorDate, days = ROLLING_WEEK_DAYS) => {
    const to = anchorDate;
    const from = shiftDate(to, -(days - 1));
    return { from, to, days };
};

export const buildWeeklyAdviceFromDays = (days, { from, to, timezone } = {}) => {
    const analysis = analyzeLifeJournal(days, {
        from,
        to,
        granularity: 'weekly',
    });
    const habitSignals = deriveLifeHabitSignals(analysis.metrics);
    const totalDays = analysis.metrics?.total_days ?? days.length;
    const daysLogged = analysis.summary?.days_logged ?? 0;

    return {
        ok: true,
        from,
        to,
        timezone,
        summary: {
            ...analysis.summary,
            record_rate_pct: totalDays > 0 ? Math.round((daysLogged / totalDays) * 100) : 0,
            total_days: totalDays,
        },
        advice: habitSignals.advice,
        patterns: analysis.patterns.slice(0, 3),
        metrics: analysis.metrics,
        insufficient_data: habitSignals.insufficient_data,
        days_logged: habitSignals.days_logged,
        data_quality: analysis.data_quality,
    };
};