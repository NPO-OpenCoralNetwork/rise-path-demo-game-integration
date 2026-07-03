// Learning Journal Service
// Records lesson reflections and provides journal summaries.
// Foundation for Section 18.3 behavior-based re-estimation.

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const cleanString = (v) => (typeof v === 'string' ? v.trim() : '');

const VALID_MOODS = ['great', 'good', 'okay', 'struggled'];

/**
 * Validate a journal entry before saving.
 */
export const validateJournalEntry = (entry) => {
    const e = asObject(entry);
    const errors = [];

    if (!cleanString(e.curriculum_id)) errors.push('curriculum_id is required');
    if (!cleanString(e.module_id)) errors.push('module_id is required');
    if (!cleanString(e.lesson_id)) errors.push('lesson_id is required');

    // At least one reflection field must be present
    const hasContent = cleanString(e.learned) || cleanString(e.difficulty) || e.mood || e.confidence;
    if (!hasContent) errors.push('At least one of learned, difficulty, mood, or confidence is required');

    if (e.mood && !VALID_MOODS.includes(e.mood)) {
        errors.push(`mood must be one of: ${VALID_MOODS.join(', ')}`);
    }
    if (e.confidence !== undefined && e.confidence !== null) {
        const c = Number(e.confidence);
        if (!Number.isInteger(c) || c < 1 || c > 5) {
            errors.push('confidence must be an integer between 1 and 5');
        }
    }
    if (e.time_spent_min !== undefined && e.time_spent_min !== null) {
        const t = Number(e.time_spent_min);
        if (!Number.isInteger(t) || t < 0) {
            errors.push('time_spent_min must be a non-negative integer');
        }
    }

    return { valid: errors.length === 0, errors };
};

/**
 * Build journal summary stats from entries.
 */
export const buildJournalSummary = ({ entries }) => {
    const rows = Array.isArray(entries) ? entries : [];

    if (rows.length === 0) {
        return {
            total_entries: 0,
            mood_distribution: {},
            avg_confidence: null,
            total_time_min: 0,
            recent: [],
        };
    }

    // Mood distribution
    const moodDist = {};
    for (const mood of VALID_MOODS) moodDist[mood] = 0;
    for (const r of rows) {
        if (r.mood && moodDist[r.mood] !== undefined) moodDist[r.mood]++;
    }

    // Average confidence
    const confidenceValues = rows.filter(r => r.confidence != null).map(r => Number(r.confidence));
    const avgConfidence = confidenceValues.length > 0
        ? Math.round((confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length) * 10) / 10
        : null;

    // Total time
    const totalTime = rows.reduce((s, r) => s + (Number(r.time_spent_min) || 0), 0);

    // Recent entries (last 5)
    const recent = rows
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 5)
        .map(r => ({
            lesson_id: r.lesson_id,
            module_id: r.module_id,
            learned: cleanString(r.learned) || null,
            difficulty: cleanString(r.difficulty) || null,
            mood: r.mood || null,
            confidence: r.confidence != null ? Number(r.confidence) : null,
            created_at: r.created_at,
        }));

    return {
        total_entries: rows.length,
        mood_distribution: moodDist,
        avg_confidence: avgConfidence,
        total_time_min: totalTime,
        recent,
    };
};

// ============================================================
// Phase 12: Journal Pattern Analysis (Adaptive Feedback)
// Deterministic, no LLM calls.
// ============================================================

function countLeadingStreak(entries, predicate) {
    let count = 0;
    for (const e of entries) {
        if (predicate(e)) count++;
        else break;
    }
    return count;
}

function countBy(entries, field) {
    const counts = {};
    for (const e of entries) {
        const val = e[field];
        if (val) counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
}

function avgField(entries, field) {
    const values = entries.filter(e => e[field] != null).map(e => Number(e[field]));
    if (values.length === 0) return null;
    return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

function detectTrend(entries, field) {
    const values = entries.filter(e => e[field] != null).map(e => Number(e[field]));
    if (values.length < 3) return 'insufficient';

    let recent, older;
    if (values.length >= 6) {
        // Precise: avg of 3 vs avg of 3
        recent = values.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
        older = values.slice(3, 6).reduce((s, v) => s + v, 0) / 3;
    } else {
        // Rough: newest vs oldest
        recent = values[0];
        older = values[values.length - 1];
    }

    const diff = recent - older;
    if (Math.abs(diff) < 0.3) return 'stable';
    return diff > 0 ? 'increasing' : 'declining';
}

function daysBetween(dateA, dateB) {
    if (!dateA || !dateB) return 0;
    return Math.max(0, Math.round(Math.abs(new Date(dateB) - new Date(dateA)) / (1000 * 60 * 60 * 24)));
}

function computeStaleness(latestCreatedAt) {
    if (!latestCreatedAt) return 'stale';
    const daysAgo = daysBetween(latestCreatedAt, new Date().toISOString());
    if (daysAgo <= 3) return 'fresh';
    if (daysAgo <= 7) return 'recent';
    return 'stale';
}

/**
 * Analyze journal patterns for adaptive feedback.
 *
 * @param {Array} entries - Journal entries (newest first)
 * @param {Object} options
 * @param {string} [options.module_id] - Filter by module
 * @param {number} [options.window] - Number of entries to analyze (default: 10)
 * @returns {Object} Pattern analysis result
 */
export const analyzeJournalPatterns = (entries, options = {}) => {
    const window = options.window || 10;
    const filtered = options.module_id
        ? entries.filter(e => e.module_id === options.module_id)
        : entries;
    const target = filtered.slice(0, window);

    if (target.length < 3) {
        return { insufficient_data: true, entries_available: target.length };
    }

    const moodDist = countBy(target, 'mood');
    const greatGood = (moodDist.great || 0) + (moodDist.good || 0);
    const moodGreatGoodPct = target.length > 0 ? greatGood / target.length : 0;

    return {
        // Streaks
        struggled_streak: countLeadingStreak(target, e => e.mood === 'struggled'),
        low_confidence_streak: countLeadingStreak(target, e => (e.confidence || 3) <= 2),

        // Distributions
        mood_distribution: moodDist,
        mood_great_good_pct: Math.round(moodGreatGoodPct * 100) / 100,

        // Averages
        avg_confidence: avgField(target, 'confidence'),
        avg_time_spent_min: avgField(target, 'time_spent_min'),

        // Trends (recent 3 vs older 3, or rough with 3-5)
        confidence_trend: detectTrend(target, 'confidence'),
        time_trend: detectTrend(target, 'time_spent_min'),

        // Engagement
        lessons_without_learned: countLeadingStreak(target, e => !cleanString(e.learned)),

        // Data quality
        confidence_score: target.length >= 10 ? 1.0 : target.length >= 6 ? 0.7 : 0.4,
        staleness: computeStaleness(target[0]?.created_at),

        // Meta
        total_entries: target.length,
        period_days: daysBetween(target[target.length - 1]?.created_at, target[0]?.created_at),
        module_id: options.module_id || null,
    };
};
