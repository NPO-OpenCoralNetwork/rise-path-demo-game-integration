// Life Journal deterministic analysis — Phase 16-4
// Pearson correlation, habit patterns, summary metrics. No LLM.

import { moodToScore } from '../../server/services/lifeJournalService.js';

const POSITIVE_MOODS = new Set(['great', 'good']);
const MIN_CORRELATION_SAMPLE = 7;
const MEDIUM_CONFIDENCE_SAMPLE = 14;
const MAX_CORRELATIONS_SHOWN = 3;

export const CORRELATION_PAIRS = [
    { x: 'sleep_hours', y: 'focus', label: 'Sleep hours vs focus' },
    { x: 'sleep_hours', y: 'energy', label: 'Sleep hours vs energy' },
    { x: 'exercise_min', y: 'focus', label: 'Exercise minutes vs focus' },
    { x: 'meal_balance', y: 'energy', label: 'Meal balance vs energy' },
    { x: 'stress', y: 'focus', label: 'Stress vs focus' },
    { x: 'sleep_hours', y: 'total_learning_min', label: 'Sleep hours vs learning time' },
];

const round = (n, digits = 2) => {
    if (n == null || Number.isNaN(n)) return null;
    const f = 10 ** digits;
    return Math.round(n * f) / f;
};

const avg = (values) => {
    if (!values.length) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
};

const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
};

const hasMealData = (meals) =>
    Boolean(meals && Object.values(meals).some((slot) =>
        slot && (slot.ate || slot.balance != null || slot.late_meal != null
            || (slot.note && String(slot.note).trim()))));

export const isDayLogged = (day) =>
    Boolean(
        day?.mood
        || day?.energy != null
        || day?.focus != null
        || day?.stress != null
        || day?.confidence != null
        || (day?.diary_text && String(day.diary_text).trim())
        || (day?.tags && day.tags.length > 0)
        || day?.sleep_hours != null
        || day?.sleep_quality != null
        || day?.exercise_min != null
        || day?.exercise_intensity
        || day?.exercise_type
        || day?.meal_balance != null
        || day?.hydration_cups != null
        || day?.alcohol != null
        || hasMealData(day?.meals),
    );

const isExerciseDay = (day) =>
    (day?.exercise_min != null && day.exercise_min > 0)
    || (day?.exercise_intensity && day.exercise_intensity !== 'none');

const shiftDate = (date, delta) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
};

export const computeCurrentStreak = (loggedDates, anchorDate) => {
    const dates = loggedDates instanceof Set ? loggedDates : new Set(loggedDates);
    let streak = 0;
    let cursor = anchorDate;
    if (!dates.has(cursor)) cursor = shiftDate(cursor, -1);
    while (dates.has(cursor)) {
        streak += 1;
        cursor = shiftDate(cursor, -1);
    }
    return streak;
};

export const pearsonCorrelation = (xs, ys) => {
    if (xs.length !== ys.length || xs.length < 2) return null;
    const n = xs.length;
    const meanX = avg(xs);
    const meanY = avg(ys);
    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i += 1) {
        const dx = xs[i] - meanX;
        const dy = ys[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    if (den === 0) return null;
    return num / den;
};

export const correlationStrength = (r) => {
    const abs = Math.abs(r);
    if (abs < 0.2) return 'very_weak';
    if (abs < 0.4) return 'weak';
    if (abs < 0.6) return 'moderate';
    if (abs < 0.8) return 'strong';
    return 'very_strong';
};

export const correlationConfidence = (sampleSize) => {
    if (sampleSize < MIN_CORRELATION_SAMPLE) return 'hidden';
    if (sampleSize < MEDIUM_CONFIDENCE_SAMPLE) return 'low';
    return 'medium';
};

const numericValue = (day, field) => {
    if (field === 'mood_score') {
        return moodToScore(day.mood);
    }
    const v = day[field];
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
};

export const computeCorrelations = (days) => {
    const logged = days.filter(isDayLogged);
    const results = [];

    for (const pair of CORRELATION_PAIRS) {
        const xs = [];
        const ys = [];
        for (const day of logged) {
            const x = numericValue(day, pair.x);
            const y = numericValue(day, pair.y);
            if (x != null && y != null) {
                xs.push(x);
                ys.push(y);
            }
        }
        if (xs.length < 2) continue;
        const r = pearsonCorrelation(xs, ys);
        if (r == null) continue;
        const confidence = correlationConfidence(xs.length);
        results.push({
            x: pair.x,
            y: pair.y,
            label: pair.label,
            method: 'pearson',
            r: round(r),
            strength: correlationStrength(r),
            sample_size: xs.length,
            confidence,
        });
    }

    results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    const eligible = results.filter((c) => c.confidence !== 'hidden');
    return eligible.slice(0, MAX_CORRELATIONS_SHOWN);
};

const breakfastAte = (day) => Boolean(day?.meals?.breakfast?.ate);

const dinnerLateMeal = (day) => Boolean(day?.meals?.dinner?.late_meal);

const detectTrend = (values) => {
    if (values.length < 4) return 'insufficient';
    const mid = Math.floor(values.length / 2);
    const first = avg(values.slice(0, mid));
    const second = avg(values.slice(mid));
    if (first == null || second == null) return 'insufficient';
    const delta = second - first;
    if (Math.abs(delta) < 0.15) return 'stable';
    return delta > 0 ? 'increasing' : 'decreasing';
};

export const buildAnalysisMetrics = (days, { from, to } = {}) => {
    const logged = days.filter(isDayLogged);
    const totalDays = days.length;
    const daysLogged = logged.length;
    const anchorDate = to || (days.length ? days[days.length - 1].date : null);

    const sleepValues = logged.map((d) => d.sleep_hours).filter((v) => v != null).map(Number);
    const focusValues = logged.map((d) => d.focus).filter((v) => v != null).map(Number);
    const energyValues = logged.map((d) => d.energy).filter((v) => v != null).map(Number);
    const stressValues = logged.map((d) => d.stress).filter((v) => v != null).map(Number);

    const sleepUnder6 = logged.filter((d) => d.sleep_hours != null && Number(d.sleep_hours) < 6);
    const sleepOver7 = logged.filter((d) => d.sleep_hours != null && Number(d.sleep_hours) >= 7);
    const exerciseDays = logged.filter(isExerciseDay);
    const nonExerciseDays = logged.filter((d) => !isExerciseDay(d));

    const avgFocusUnder6 = avg(sleepUnder6.map((d) => d.focus).filter((v) => v != null).map(Number));
    const avgFocusOver7 = avg(sleepOver7.map((d) => d.focus).filter((v) => v != null).map(Number));
    const focusDelta = (avgFocusOver7 != null && avgFocusUnder6 != null)
        ? round(avgFocusOver7 - avgFocusUnder6)
        : null;

    const moodGreatGood = logged.filter((d) => POSITIVE_MOODS.has(d.mood)).length;
    const exerciseMoodGreatGood = exerciseDays.filter((d) => POSITIVE_MOODS.has(d.mood)).length;
    const nonExerciseMoodGreatGood = nonExerciseDays.filter((d) => POSITIVE_MOODS.has(d.mood)).length;

    const breakfastDays = logged.filter(breakfastAte);
    const lateMealDays = logged.filter(dinnerLateMeal);

    const loggedDates = new Set(logged.map((d) => d.date));
    const recordStreak = anchorDate ? computeCurrentStreak(loggedDates, anchorDate) : 0;

    const tagCounts = {};
    for (const day of logged) {
        for (const tag of day.tags || []) {
            const key = String(tag).trim().toLowerCase();
            if (key) tagCounts[key] = (tagCounts[key] || 0) + 1;
        }
    }
    const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count }));

    return {
        from,
        to,
        total_days: totalDays,
        days_logged: daysLogged,
        missing_days: totalDays - daysLogged,
        avg_sleep_hours: round(avg(sleepValues)),
        median_sleep_hours: round(median(sleepValues)),
        avg_focus: round(avg(focusValues)),
        avg_energy: round(avg(energyValues)),
        avg_stress: round(avg(stressValues)),
        total_learning_min: logged.reduce((s, d) => s + (Number(d.total_learning_min) || 0), 0),
        record_streak: recordStreak,
        sleep_under_6h_days_pct: daysLogged ? round(sleepUnder6.length / daysLogged, 3) : 0,
        sleep_under_7h_days_pct: daysLogged
            ? round(logged.filter((d) => d.sleep_hours != null && Number(d.sleep_hours) < 7).length / daysLogged, 3)
            : 0,
        exercise_days_pct: daysLogged ? round(exerciseDays.length / daysLogged, 3) : 0,
        exercise_days: exerciseDays.length,
        mood_great_good_pct: daysLogged ? round(moodGreatGood / daysLogged, 3) : 0,
        avg_focus_sleep_under_6h: round(avgFocusUnder6),
        avg_focus_sleep_over_7h: round(avgFocusOver7),
        focus_delta_sleep_threshold: focusDelta,
        exercise_mood_great_good_pct: exerciseDays.length
            ? round(exerciseMoodGreatGood / exerciseDays.length, 3)
            : null,
        non_exercise_mood_great_good_pct: nonExerciseDays.length
            ? round(nonExerciseMoodGreatGood / nonExerciseDays.length, 3)
            : null,
        avg_focus_exercise_days: round(avg(exerciseDays.map((d) => d.focus).filter((v) => v != null).map(Number))),
        avg_focus_non_exercise_days: round(avg(nonExerciseDays.map((d) => d.focus).filter((v) => v != null).map(Number))),
        breakfast_rate: daysLogged ? round(breakfastDays.length / daysLogged, 3) : 0,
        late_meal_rate: daysLogged ? round(lateMealDays.length / daysLogged, 3) : 0,
        focus_trend: detectTrend(focusValues),
        sleep_trend: detectTrend(sleepValues),
        top_tags: topTags,
        insufficient_data: daysLogged < MIN_CORRELATION_SAMPLE,
        sample_size: daysLogged,
    };
};

export const detectPatterns = (days, metrics) => {
    const patterns = [];
    const logged = days.filter(isDayLogged);

    if (metrics.exercise_days >= 3
        && metrics.exercise_mood_great_good_pct != null
        && metrics.non_exercise_mood_great_good_pct != null) {
        const exPct = Math.round(metrics.exercise_mood_great_good_pct * 100);
        const nonPct = Math.round(metrics.non_exercise_mood_great_good_pct * 100);
        if (exPct > nonPct + 10) {
            patterns.push({
                type: 'habit_effect',
                id: 'exercise_mood_boost',
                title: 'Exercise days correlate with better mood',
                evidence: `Mood good/great rate: exercise days ${exPct}%, non-exercise days ${nonPct}%`,
                evidence_params: { exercise_pct: exPct, non_exercise_pct: nonPct },
                confidence: metrics.sample_size >= MEDIUM_CONFIDENCE_SAMPLE ? 'medium' : 'low',
            });
        }
    }

    if (metrics.sleep_under_6h_days_pct > 0.3
        && metrics.avg_focus_sleep_under_6h != null
        && metrics.avg_focus_sleep_over_7h != null
        && metrics.avg_focus_sleep_over_7h > metrics.avg_focus_sleep_under_6h + 0.3) {
            patterns.push({
                type: 'threshold_comparison',
                id: 'sleep_focus_threshold',
                title: 'Shorter sleep may link to lower focus',
                evidence: `Focus avg: sleep <6h ${metrics.avg_focus_sleep_under_6h}, sleep ≥7h ${metrics.avg_focus_sleep_over_7h}`,
                evidence_params: {
                    focus_under_6: metrics.avg_focus_sleep_under_6h,
                    focus_over_7: metrics.avg_focus_sleep_over_7h,
                },
                confidence: metrics.sample_size >= MEDIUM_CONFIDENCE_SAMPLE ? 'medium' : 'low',
            });
    }

    if (metrics.avg_focus_exercise_days != null
        && metrics.avg_focus_non_exercise_days != null
        && metrics.exercise_days >= 3
        && metrics.avg_focus_exercise_days > metrics.avg_focus_non_exercise_days + 0.3) {
            patterns.push({
                type: 'habit_effect',
                id: 'exercise_focus_boost',
                title: 'Exercise days show higher focus',
                evidence: `Avg focus: exercise days ${metrics.avg_focus_exercise_days}, non-exercise ${metrics.avg_focus_non_exercise_days}`,
                evidence_params: {
                    focus_exercise: metrics.avg_focus_exercise_days,
                    focus_non_exercise: metrics.avg_focus_non_exercise_days,
                },
                confidence: metrics.sample_size >= MEDIUM_CONFIDENCE_SAMPLE ? 'medium' : 'low',
            });
    }

    if (metrics.breakfast_rate > 0.5 && metrics.avg_energy != null && metrics.avg_energy >= 3.5) {
            patterns.push({
                type: 'meal_habit',
                id: 'breakfast_energy',
                title: 'Breakfast days align with steadier energy',
                evidence: `Breakfast logged on ${Math.round(metrics.breakfast_rate * 100)}% of days; avg energy ${metrics.avg_energy}`,
                evidence_params: {
                    breakfast_rate_pct: Math.round(metrics.breakfast_rate * 100),
                    avg_energy: metrics.avg_energy,
                },
                confidence: 'low',
            });
    }

    if (metrics.late_meal_rate > 0.25) {
            patterns.push({
                type: 'meal_habit',
                id: 'late_meal_frequency',
                title: 'Late dinners appear often this period',
                evidence: `Late dinner flagged on ${Math.round(metrics.late_meal_rate * 100)}% of logged days`,
                evidence_params: { late_meal_rate_pct: Math.round(metrics.late_meal_rate * 100) },
                confidence: 'low',
            });
    }

    if (metrics.top_tags?.length) {
        const top = metrics.top_tags[0];
        if (top.count >= 2) {
            patterns.push({
                type: 'tag_frequency',
                id: 'top_tag',
                title: `Frequent tag: "${top.tag}"`,
                evidence: `Appeared ${top.count} times in ${logged.length} logged days`,
                evidence_params: { tag: top.tag, count: top.count, logged_days: logged.length },
                confidence: 'low',
            });
        }
    }

    return patterns.slice(0, 5);
};

export const analyzeLifeJournal = (days, { from, to, granularity = 'custom' } = {}) => {
    const metrics = buildAnalysisMetrics(days, { from, to });
    const correlations = metrics.insufficient_data ? [] : computeCorrelations(days);
    const patterns = detectPatterns(days, metrics);

    const summary = {
        days_logged: metrics.days_logged,
        avg_sleep_hours: metrics.avg_sleep_hours,
        avg_focus: metrics.avg_focus,
        avg_energy: metrics.avg_energy,
        avg_stress: metrics.avg_stress,
        total_learning_min: metrics.total_learning_min,
        record_streak: metrics.record_streak,
    };

    const dataQuality = {
        sample_size: metrics.sample_size,
        missing_days: metrics.missing_days,
        correlations_shown: correlations.length,
        granularity,
        warning: 'Correlation is directional evidence, not causation.',
        ...(metrics.insufficient_data
            ? { message: 'Keep logging — correlations unlock after 7 logged days.' }
            : {}),
    };

    return {
        ok: true,
        from,
        to,
        granularity,
        summary,
        metrics,
        correlations,
        patterns,
        data_quality: dataQuality,
    };
};