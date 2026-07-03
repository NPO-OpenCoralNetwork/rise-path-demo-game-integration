// Personalization Deriver
// raw_profile -> derived_learning_profile -> generation_rules
// Deterministic, no LLM calls. Priority: declared_preferences > lifestyle > motivation > big_five > default.

import { createRequire } from 'module';

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));

// --- Helpers ---

const traitLevel = (score) => {
    const n = clamp(score, 0, 100);
    if (n >= 65) return 'high';
    if (n >= 35) return 'medium';
    return 'low';
};

const pickFirst = (...values) => {
    for (const v of values) {
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
};

// --- Axis derivers ---
// Each returns { value, rules[] }

const deriveCredentialOrientation = ({ bigFive, motivation, declared }) => {
    const rules = [];
    // declared wins
    if (declared.credential_orientation) {
        rules.push('declared_preferences.credential_orientation used directly');
        return { value: declared.credential_orientation, rules };
    }
    // motivation hints
    const credentialMotivations = ['credential', 'credential_and_progress', 'certification', 'qualification'];
    if (credentialMotivations.some((m) => (motivation || '').toLowerCase().includes(m))) {
        rules.push('motivation includes credential keyword');
        return { value: 'high', rules };
    }
    // big five fallback
    const c = traitLevel(bigFive.conscientiousness);
    if (c === 'high') {
        rules.push('high conscientiousness suggests moderate credential orientation');
        return { value: 'medium', rules };
    }
    rules.push('default credential_orientation');
    return { value: 'low', rules };
};

const deriveProblemSolvingOrientation = ({ declared, learningStyle }) => {
    const rules = [];
    if (declared.assessment_preference) {
        const pref = declared.assessment_preference.toLowerCase();
        if (pref.includes('quiz') || pref.includes('problem') || pref.includes('test')) {
            rules.push('declared_preferences.assessment_preference includes problem-type keyword');
            return { value: 'high', rules };
        }
    }
    if (learningStyle && learningStyle.toLowerCase().includes('problem')) {
        rules.push('learning_style includes problem keyword');
        return { value: 'high', rules };
    }
    rules.push('default problem_solving_orientation');
    return { value: 'medium', rules };
};

const deriveExampleFirstPreference = ({ bigFive, learningStyle, declared }) => {
    const rules = [];
    if (declared.explanation_style) {
        const style = declared.explanation_style.toLowerCase();
        if (style.includes('example') || style.includes('story')) {
            rules.push('declared_preferences.explanation_style prefers examples');
            return { value: 'high', rules };
        }
        if (style.includes('principle') || style.includes('definition')) {
            rules.push('declared_preferences.explanation_style prefers principle-first');
            return { value: 'low', rules };
        }
    }
    if (learningStyle && learningStyle.toLowerCase().includes('example')) {
        rules.push('learning_style is example_first');
        return { value: 'high', rules };
    }
    const o = traitLevel(bigFive.openness);
    if (o === 'high') {
        rules.push('high openness slightly prefers examples and comparisons');
        return { value: 'high', rules };
    }
    rules.push('default example_first_preference');
    return { value: 'medium', rules };
};

const deriveStructureNeed = ({ bigFive, lifestyle }) => {
    const rules = [];
    const c = traitLevel(bigFive.conscientiousness);
    if (c === 'high') {
        rules.push('high conscientiousness increases structure_need');
        return { value: 'high', rules };
    }
    if (c === 'low') {
        // Low conscientiousness still needs structure, but lighter
        if (lifestyle.weekly_capacity_min && lifestyle.weekly_capacity_min < 60) {
            rules.push('low conscientiousness + limited time -> medium structure_need');
            return { value: 'medium', rules };
        }
        rules.push('low conscientiousness -> lower structure_need');
        return { value: 'low', rules };
    }
    rules.push('default structure_need');
    return { value: 'medium', rules };
};

const deriveReassuranceNeed = ({ bigFive, lifestyle }) => {
    const rules = [];
    const n = traitLevel(bigFive.neuroticism);
    if (n === 'high') {
        rules.push('high neuroticism increases reassurance_need');
        return { value: 'high', rules };
    }
    if (lifestyle.device === 'mobile') {
        rules.push('mobile device suggests slightly higher reassurance_need');
        return { value: 'medium', rules };
    }
    rules.push('default reassurance_need');
    return { value: n === 'medium' ? 'medium' : 'low', rules };
};

const derivePracticeIntensity = ({ lifestyle, learningStyle, declared }) => {
    const rules = [];
    if (declared.assessment_preference) {
        const pref = declared.assessment_preference.toLowerCase();
        if (pref.includes('practice') || pref.includes('hands')) {
            rules.push('declared_preferences.assessment_preference includes practice keyword');
            return { value: 'heavy', rules };
        }
    }
    const cap = Number(lifestyle.weekly_capacity_min) || 0;
    const session = Number(lifestyle.preferred_session_length_min) || 0;
    if (cap < 60 || session <= 10) {
        rules.push('limited weekly capacity or short session -> light practice');
        return { value: 'light', rules };
    }
    if (cap >= 180) {
        rules.push('ample weekly capacity -> heavy practice');
        return { value: 'heavy', rules };
    }
    rules.push('default practice_intensity');
    return { value: 'moderate', rules };
};

const derivePacePreference = ({ bigFive, lifestyle }) => {
    const rules = [];
    const cap = Number(lifestyle.weekly_capacity_min) || 0;
    const session = Number(lifestyle.preferred_session_length_min) || 0;
    const c = traitLevel(bigFive.conscientiousness);

    if (cap < 60 || session <= 10 || c === 'low') {
        rules.push('limited time or low conscientiousness -> steady_small_steps');
        return { value: 'steady_small_steps', rules };
    }
    if (cap >= 180 && c === 'high') {
        rules.push('ample time + high conscientiousness -> intensive');
        return { value: 'intensive', rules };
    }
    rules.push('default pace_preference');
    return { value: 'moderate', rules };
};

const deriveSocialLearningPreference = ({ bigFive }) => {
    const rules = [];
    const e = traitLevel(bigFive.extraversion);
    if (e === 'high') {
        rules.push('high extraversion -> higher social_learning_preference');
        return { value: 'high', rules };
    }
    if (e === 'low') {
        rules.push('low extraversion -> low social_learning_preference');
        return { value: 'low', rules };
    }
    rules.push('default social_learning_preference');
    return { value: 'medium', rules };
};

const deriveFeedbackStyle = ({ bigFive, motivation, declared }) => {
    const rules = [];
    if (declared.tone) {
        const tone = declared.tone.toLowerCase();
        if (tone.includes('gentle') || tone.includes('soft') || tone.includes('やさしい')) {
            rules.push('declared_preferences.tone prefers gentle feedback');
            return { value: 'coach_gentle', rules };
        }
        if (tone.includes('strict') || tone.includes('厳密')) {
            rules.push('declared_preferences.tone prefers strict feedback');
            return { value: 'strict', rules };
        }
    }
    const n = traitLevel(bigFive.neuroticism);
    if (n === 'high') {
        rules.push('high neuroticism -> coach_gentle feedback');
        return { value: 'coach_gentle', rules };
    }
    rules.push('default feedback_style');
    return { value: 'coach', rules };
};

// --- Main deriver ---

export const deriveLearningProfile = (rawProfile) => {
    const raw = asObject(rawProfile);
    const bigFive = asObject(raw.big_five);
    const learningStyle = typeof raw.learning_style === 'string' ? raw.learning_style : '';
    const motivation = typeof raw.motivation === 'string' ? raw.motivation : '';
    const lifestyle = asObject(raw.lifestyle);
    const declared = asObject(raw.declared_preferences);

    const ctx = { bigFive, learningStyle, motivation, lifestyle, declared };
    const allRules = [];

    const axes = {};
    const derivers = {
        credential_orientation: deriveCredentialOrientation,
        problem_solving_orientation: deriveProblemSolvingOrientation,
        example_first_preference: deriveExampleFirstPreference,
        structure_need: deriveStructureNeed,
        reassurance_need: deriveReassuranceNeed,
        practice_intensity: derivePracticeIntensity,
        pace_preference: derivePacePreference,
        social_learning_preference: deriveSocialLearningPreference,
        feedback_style: deriveFeedbackStyle,
    };

    for (const [axis, fn] of Object.entries(derivers)) {
        const { value, rules } = fn(ctx);
        axes[axis] = value;
        allRules.push(...rules);
    }

    return { derived_learning_profile: axes, applied_rules: allRules };
};

// --- Generation rules deriver ---

const EXPLANATION_STYLE_MAP = {
    high: 'example_then_principle',
    medium: 'mixed',
    low: 'principle_then_example',
};

const ASSESSMENT_STYLE_MAP = {
    high: 'quiz_and_case',
    medium: 'quiz_and_light_practice',
    low: 'light_practice_only',
};

const VOICE_MAP = {
    coach_gentle: 'gentle_and_reassuring',
    coach: 'encouraging',
    strict: 'direct_and_precise',
};

export const deriveGenerationRules = (derivedProfile, rawProfile) => {
    const dp = asObject(derivedProfile);
    const raw = asObject(rawProfile);
    const lifestyle = asObject(raw.lifestyle);

    const capMin = Number(lifestyle.weekly_capacity_min) || 90;
    // target 2/3 of stated capacity for sustainable pace
    const targetMin = Math.round(capMin * 0.67);
    const maxActions = dp.reassurance_need === 'high' ? 2
        : dp.practice_intensity === 'heavy' ? 5 : 3;

    return {
        explanation_style: EXPLANATION_STYLE_MAP[dp.example_first_preference] || 'mixed',
        assessment_style: ASSESSMENT_STYLE_MAP[dp.problem_solving_orientation] || 'quiz_and_light_practice',
        curriculum_voice: VOICE_MAP[dp.feedback_style] || 'encouraging',
        weekly_load_policy: {
            target_minutes_per_week: targetMin,
            max_actions_per_lesson: maxActions,
        },
    };
};

// --- Static personalization block for generation_kit ---

export const PERSONALIZATION_STATIC = {
    supported_diagnosis: [
        'big_five',
        'learning_style',
        'motivation',
        'lifestyle',
        'declared_preferences',
    ],
    raw_profile_schema: {
        required_slots: ['big_five', 'learning_style', 'motivation'],
        optional_slots: ['lifestyle', 'declared_preferences'],
        field_definitions: {
            big_five: {
                type: 'object',
                description: 'Big Five personality scores (0-100) with keys: openness, conscientiousness, extraversion, agreeableness, neuroticism',
            },
            learning_style: {
                type: 'string',
                description: 'Preferred learning style',
                enum: ['example_first', 'principle_first', 'compare', 'story', 'hands_on'],
            },
            motivation: {
                type: 'string',
                description: 'Primary motivation for learning',
                enum: ['credential_and_progress', 'curiosity', 'practical_use', 'career', 'hobby'],
            },
            lifestyle: {
                type: 'object',
                description: 'Weekly capacity (minutes), session length, best time, device preference',
            },
            declared_preferences: {
                type: 'object',
                description: 'Explicit learner preferences: assessment_preference, explanation_style, tone',
            },
        },
    },
    derived_profile_schema: {
        required_fields: [
            'credential_orientation',
            'problem_solving_orientation',
            'example_first_preference',
            'structure_need',
            'reassurance_need',
            'practice_intensity',
            'pace_preference',
            'feedback_style',
        ],
        field_definitions: {
            credential_orientation: {
                type: 'string',
                description: 'How much the learner values credentials and certifications',
                values: ['high', 'medium', 'low'],
                source_priority: ['declared_preferences', 'motivation', 'big_five'],
            },
            problem_solving_orientation: {
                type: 'string',
                description: 'Preference for quiz / case / problem-based learning',
                values: ['high', 'medium', 'low'],
                source_priority: ['declared_preferences', 'learning_style'],
            },
            example_first_preference: {
                type: 'string',
                description: 'Whether the learner prefers examples before theory',
                values: ['high', 'medium', 'low'],
                source_priority: ['declared_preferences', 'learning_style', 'big_five'],
            },
            structure_need: {
                type: 'string',
                description: 'Need for structured plans, checklists, and clear steps',
                values: ['high', 'medium', 'low'],
                source_priority: ['big_five', 'lifestyle'],
            },
            reassurance_need: {
                type: 'string',
                description: 'Need for gentle tone and anxiety reduction',
                values: ['high', 'medium', 'low'],
                source_priority: ['big_five', 'lifestyle'],
            },
            practice_intensity: {
                type: 'string',
                description: 'How much hands-on practice to include',
                values: ['heavy', 'moderate', 'light'],
                source_priority: ['declared_preferences', 'lifestyle', 'learning_style'],
            },
            pace_preference: {
                type: 'string',
                description: 'Preferred learning pace',
                values: ['intensive', 'moderate', 'steady_small_steps'],
                source_priority: ['lifestyle', 'big_five'],
            },
            feedback_style: {
                type: 'string',
                description: 'Preferred feedback tone',
                values: ['strict', 'coach', 'coach_gentle'],
                source_priority: ['declared_preferences', 'big_five'],
            },
        },
    },
    personalization_axes: {
        credential_orientation: {
            type: 'string',
            description: 'How much the learner values credentials and certifications',
            values: ['high', 'medium', 'low'],
            source_priority: ['declared_preferences', 'motivation', 'big_five'],
        },
        problem_solving_orientation: {
            type: 'string',
            description: 'Preference for quiz / case / problem-based learning',
            values: ['high', 'medium', 'low'],
            source_priority: ['declared_preferences', 'learning_style'],
        },
        example_first_preference: {
            type: 'string',
            description: 'Whether the learner prefers examples before theory',
            values: ['high', 'medium', 'low'],
            source_priority: ['declared_preferences', 'learning_style', 'big_five'],
        },
        structure_need: {
            type: 'string',
            description: 'Need for structured plans, checklists, and clear steps',
            values: ['high', 'medium', 'low'],
            source_priority: ['big_five', 'lifestyle'],
        },
        reassurance_need: {
            type: 'string',
            description: 'Need for gentle tone and anxiety reduction',
            values: ['high', 'medium', 'low'],
            source_priority: ['big_five', 'lifestyle'],
        },
        practice_intensity: {
            type: 'string',
            description: 'How much hands-on practice to include',
            values: ['heavy', 'moderate', 'light'],
            source_priority: ['declared_preferences', 'lifestyle', 'learning_style'],
        },
        pace_preference: {
            type: 'string',
            description: 'Preferred learning pace',
            values: ['intensive', 'moderate', 'steady_small_steps'],
            source_priority: ['lifestyle', 'big_five'],
        },
        social_learning_preference: {
            type: 'string',
            description: 'Preference for social/collaborative vs solo learning',
            values: ['high', 'medium', 'low'],
            source_priority: ['big_five'],
        },
        feedback_style: {
            type: 'string',
            description: 'Preferred feedback tone',
            values: ['strict', 'coach', 'coach_gentle'],
            source_priority: ['declared_preferences', 'big_five'],
        },
    },
    adaptation_rules: [
        { axis: 'credential_orientation', when: 'high', adapts: ['add achievement criteria per lesson', 'add confirmation checklist per module', 'add mock exam at course end'], note: 'Section 10.2' },
        { axis: 'problem_solving_orientation', when: 'high', adapts: ['add quiz or case problem per module', 'explain why, not just what'], note: 'Section 10.2' },
        { axis: 'example_first_preference', when: 'high', adapts: ['order: example -> principle -> application', 'use concrete scenarios before definitions'] },
        { axis: 'reassurance_need', when: 'high', adapts: ['limit practice items to 2 per lesson', 'add "today this is enough" closing', 'pair cautions with reassurance', 'avoid alarming language'] },
        { axis: 'structure_need', when: 'high', adapts: ['include weekly plan with checkboxes', 'add progress milestones', 'provide clear todo list per lesson'] },
        { axis: 'practice_intensity', when: 'heavy', adapts: ['increase practice items to 4-5 per lesson', 'add observation log prompts'] },
        { axis: 'practice_intensity', when: 'light', adapts: ['reduce practice to 1-2 light actions', 'keep actions under 5 minutes each'] },
        { axis: 'pace_preference', when: 'steady_small_steps', adapts: ['shorter lessons', 'micro-progress markers', 'easy resume points'] },
        { axis: 'feedback_style', when: 'coach_gentle', adapts: ['gentle encouraging tone', 'suggest rather than command', 'celebrate small wins'] },
    ],
    quality_rubric: {
        lesson_min_sections: 6,
        lesson_required_blocks: ['overview', 'key_points', 'practice', 'cautions', 'takeaway'],
        lesson_min_explanation_chars: 220,
        lesson_min_practice_items: 2,
        require_cautions: true,
        require_checklist_when_credential_orientation_high: true,
        require_quiz_or_case_when_problem_solving_high: true,
    },
};

// --- Raw profile validation ---

export const validateRawProfile = (rawProfile) => {
    const raw = asObject(rawProfile);
    const errors = [];

    const bigFive = asObject(raw.big_five);
    const requiredTraits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
    for (const trait of requiredTraits) {
        const v = bigFive[trait];
        if (v === undefined || v === null) {
            errors.push(`big_five.${trait} is required`);
        } else if (typeof v !== 'number' || v < 0 || v > 100) {
            errors.push(`big_five.${trait} must be a number between 0 and 100`);
        }
    }

    if (!raw.learning_style || typeof raw.learning_style !== 'string') {
        errors.push('learning_style is required (string)');
    }
    if (!raw.motivation || typeof raw.motivation !== 'string') {
        errors.push('motivation is required (string)');
    }

    return { valid: errors.length === 0, errors };
};

// ============================================================
// Phase 12: Adaptation Signals (Journal patterns → actionable signals)
// Deterministic, no LLM calls.
// ============================================================

const _require = createRequire(import.meta.url);
const adaptationConfig = _require('./adaptation_config.json');

/**
 * Derive adaptation signals from journal patterns.
 * Config-driven: rules defined in adaptation_config.json.
 *
 * @param {Object} patterns - Output of analyzeJournalPatterns()
 * @param {Object} [currentProfile] - Current derived_learning_profile (optional)
 * @returns {Object} signals, generation_rule_overrides, user_messages
 */
export const deriveAdaptationSignals = (patterns, currentProfile = {}) => {
    if (patterns?.insufficient_data) {
        return {
            signals: [],
            generation_rule_overrides: {},
            analysis: { insufficient_data: true, entries_available: patterns.entries_available },
            next_review_after: adaptationConfig.min_entries_for_analysis - (patterns.entries_available || 0),
        };
    }

    // Stale data: suppress signals, return welcome-back only
    if (patterns.staleness === 'stale') {
        return {
            signals: [],
            generation_rule_overrides: {},
            analysis: {
                based_on: patterns.total_entries,
                period_days: patterns.period_days,
                module_id: patterns.module_id,
                confidence_score: patterns.confidence_score,
                staleness: patterns.staleness,
                analyzed_at: new Date().toISOString(),
            },
            welcome_back: 'お帰りなさい！前回の続きから始めましょう。',
            next_review_after: 3,
        };
    }

    // Evaluate all rules from config
    const signals = [];
    for (const rule of adaptationConfig.rules) {
        if (evaluateAllConditions(rule.conditions, patterns)) {
            signals.push({
                type: rule.id,
                reason: buildReason(rule.conditions, patterns),
                priority: rule.priority,
                confidence: patterns.confidence_score,
                user_message: rule.user_message || '',
            });
        }
    }

    // Conflict resolution
    const resolved = resolveConflicts(signals);

    // Merge overrides from matching rules
    const overrides = {};
    for (const sig of resolved) {
        const rule = adaptationConfig.rules.find(r => r.id === sig.type);
        if (rule?.overrides) {
            Object.assign(overrides, rule.overrides);
        }
    }

    return {
        signals: resolved,
        generation_rule_overrides: overrides,
        analysis: {
            based_on: patterns.total_entries,
            period_days: patterns.period_days,
            module_id: patterns.module_id,
            confidence_score: patterns.confidence_score,
            staleness: patterns.staleness,
            analyzed_at: new Date().toISOString(),
        },
        next_review_after: 5,
    };
};

// --- Config-driven rule engine helpers ---

/**
 * Evaluate a single condition against patterns.
 * Supports: ==, !=, <, >, <=, >=
 */
function evaluateCondition(cond, patterns) {
    const actual = patterns[cond.field];
    const expected = cond.value;

    // null check: if actual is null/undefined and op isn't explicitly checking null
    if (actual === null || actual === undefined) {
        if (cond.op === '!=' && expected === null) return true;
        if (cond.op === '==' && expected === null) return false;
        return false; // can't compare null to anything else
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
}

/**
 * All conditions must pass (AND logic).
 */
function evaluateAllConditions(conditions, patterns) {
    if (!Array.isArray(conditions) || conditions.length === 0) return false;
    return conditions.every(c => evaluateCondition(c, patterns));
}

/**
 * Build human-readable reason from matched conditions.
 */
function buildReason(conditions, patterns) {
    return conditions
        .map(c => `${c.field} ${c.op} ${c.value} (actual: ${patterns[c.field]})`)
        .join(', ');
}

/**
 * Conflict resolution: conservative signals win over progressive.
 */
function resolveConflicts(signals) {
    const hasConservative = signals.some(s => {
        const rule = adaptationConfig.rules.find(r => r.id === s.type);
        return rule?.group === 'conservative';
    });
    const hasProgressive = signals.some(s => {
        const rule = adaptationConfig.rules.find(r => r.id === s.type);
        return rule?.group === 'progressive';
    });

    if (hasConservative && hasProgressive) {
        return signals.filter(s => {
            const rule = adaptationConfig.rules.find(r => r.id === s.type);
            return rule?.group !== 'progressive';
        });
    }
    return signals;
}

import { deriveLifeHabitSignals } from '../../tools/core/lifeHabitRules.js';
export { deriveLifeHabitSignals };

/**
 * Compact habit summary for generation-kit (Phase 16-6g).
 * Deterministic — no LLM.
 */
export const buildHabitSignalsForKit = ({ metrics, patterns = [], habitAdvice = null } = {}) => {
    if (!metrics || metrics.insufficient_data) {
        return {
            insufficient_data: true,
            days_logged: metrics?.days_logged ?? 0,
            record_streak: metrics?.record_streak ?? 0,
        };
    }

    const periodWeeks = metrics.total_days > 0 ? metrics.total_days / 7 : 1;
    const exerciseDaysPerWeek = metrics.exercise_days != null
        ? Math.round((metrics.exercise_days / periodWeeks) * 10) / 10
        : null;

    const topPattern = habitAdvice?.advice?.[0]?.rule_id
        ?? patterns[0]?.id
        ?? null;

    const out = {
        avg_sleep_hours: metrics.avg_sleep_hours ?? null,
        record_streak: metrics.record_streak ?? 0,
        days_logged: metrics.days_logged,
        period_days: metrics.total_days,
    };

    if (exerciseDaysPerWeek != null) out.exercise_days_per_week = exerciseDaysPerWeek;
    if (topPattern) out.top_pattern = topPattern;

    return out;
};

/**
 * Merge learning journal signals with optional life habit signals.
 */
export const deriveCombinedAdaptationSignals = (patterns, currentProfile = {}, lifeMetrics = null) => {
    const learning = deriveAdaptationSignals(patterns, currentProfile);
    if (!lifeMetrics) return learning;

    const life = deriveLifeHabitSignals(lifeMetrics);
    return {
        ...learning,
        life_signals: life.signals,
        life_advice: life.advice,
    };
};
