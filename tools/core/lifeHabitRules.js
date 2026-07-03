// Life habit rule engine — browser + Node safe (Phase 16-4)
import adaptationConfig from '../../server/services/adaptation_config.json' with { type: 'json' };

const PCT_SUFFIX_FIELDS = new Set([
    'sleep_under_6h_days_pct',
    'sleep_under_7h_days_pct',
    'exercise_days_pct',
    'mood_great_good_pct',
    'exercise_mood_great_good_pct',
    'non_exercise_mood_great_good_pct',
    'breakfast_rate',
    'late_meal_rate',
]);

export const evaluateCondition = (cond, metrics) => {
    const actual = metrics[cond.field];
    const expected = cond.value;

    if (actual === null || actual === undefined) {
        if (cond.op === '!=' && expected === null) return true;
        if (cond.op === '==' && expected === null) return false;
        return false;
    }

    switch (cond.op) {
        case '==': return actual === expected;
        case '!=': return actual !== expected;
        case '<':  return actual < expected;
        case '>':  return actual > expected;
        case '<=': return actual <= expected;
        case '>=': return actual >= expected;
        default: return false;
    }
};

export const evaluateAllConditions = (conditions, metrics) => {
    if (!Array.isArray(conditions) || conditions.length === 0) return false;
    return conditions.every((c) => evaluateCondition(c, metrics));
};

const formatMetricValue = (field, value) => {
    if (value == null) return '—';
    if (PCT_SUFFIX_FIELDS.has(field)) return `${Math.round(Number(value) * 100)}`;
    return String(value);
};

export const interpolateTemplate = (template, metrics) =>
    String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (key.endsWith('_pct')) {
            const base = key.slice(0, -4);
            return formatMetricValue(base, metrics[base]);
        }
        return formatMetricValue(key, metrics[key]);
    });

const resolveLifeConflicts = (signals) => {
    const hasConservative = signals.some((s) => s.group === 'conservative');
    const hasProgressive = signals.some((s) => s.group === 'progressive');
    if (hasConservative && hasProgressive) {
        return signals.filter((s) => s.group !== 'progressive');
    }
    return signals;
};

/**
 * Evaluate life_habit_rules from adaptation_config.json against life journal metrics.
 */
export const deriveLifeHabitSignals = (metrics) => {
    if (!metrics || metrics.insufficient_data) {
        return {
            advice: [],
            signals: [],
            insufficient_data: true,
            days_logged: metrics?.days_logged ?? 0,
        };
    }

    const rules = adaptationConfig.life_habit_rules || [];
    const matched = [];

    for (const rule of rules) {
        if (!evaluateAllConditions(rule.conditions, metrics)) continue;
        const advice = rule.advice || {};
        const evidence = interpolateTemplate(advice.evidence_template || '', metrics);
        if (evidence.includes('—') && advice.evidence_template?.includes('{{')) {
            continue;
        }
        matched.push({
            rule_id: rule.id,
            priority: rule.priority,
            group: rule.group,
            title: advice.title || rule.id,
            action: advice.action || '',
            evidence,
            confidence: metrics.sample_size >= 14 ? 'medium' : 'low',
            difficulty: advice.difficulty || 'easy',
        });
    }

    const resolved = resolveLifeConflicts(matched);
    resolved.sort((a, b) => {
        const rank = { high: 0, medium: 1, low: 2 };
        return (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
    });

    return {
        advice: resolved,
        signals: resolved.map((a) => ({
            type: a.rule_id,
            reason: a.evidence,
            priority: a.priority,
            confidence: a.confidence,
            user_message: a.action,
        })),
        insufficient_data: false,
        days_logged: metrics.days_logged,
    };
};