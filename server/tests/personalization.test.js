import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    deriveLearningProfile,
    deriveGenerationRules,
    validateRawProfile,
    buildHabitSignalsForKit,
    PERSONALIZATION_STATIC,
} from '../services/personalizationDeriver.js';
import {
    getGenerationKit,
    validateQualityRubric,
    SUPPORTED_LEARNING_MODES,
} from '../services/curriculumGenerationKit.js';
import { validateGenerationKit } from '../services/schemaValidator.js';
import { getKit } from '../../tools/core/curriculum.js';

// --- Spec example profile (Section 7.1) ---
const SPEC_RAW_PROFILE = {
    big_five: { openness: 72, conscientiousness: 48, extraversion: 35, agreeableness: 61, neuroticism: 68 },
    learning_style: 'example_first',
    motivation: 'credential_and_progress',
    lifestyle: { weekly_capacity_min: 90, preferred_session_length_min: 15, best_time: 'night', device: 'mobile' },
    declared_preferences: { assessment_preference: 'quiz_and_practice', explanation_style: 'step_by_step', tone: 'gentle' },
};

// ===================== validateRawProfile =====================

describe('validateRawProfile', () => {
    it('accepts valid profile', () => {
        const result = validateRawProfile(SPEC_RAW_PROFILE);
        assert.equal(result.valid, true);
        assert.equal(result.errors.length, 0);
    });

    it('rejects missing big_five traits', () => {
        const result = validateRawProfile({ big_five: { openness: 50 }, learning_style: 'x', motivation: 'y' });
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('conscientiousness')));
    });

    it('rejects out of range big_five', () => {
        const result = validateRawProfile({
            big_five: { openness: 150, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 },
            learning_style: 'x',
            motivation: 'y',
        });
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('openness')));
    });

    it('rejects missing learning_style', () => {
        const result = validateRawProfile({
            big_five: { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 },
            motivation: 'y',
        });
        assert.equal(result.valid, false);
    });
});

// ===================== deriveLearningProfile =====================

describe('deriveLearningProfile', () => {
    it('matches spec expected values (Section 7.2)', () => {
        const { derived_learning_profile: dp } = deriveLearningProfile(SPEC_RAW_PROFILE);
        assert.equal(dp.credential_orientation, 'high');
        assert.equal(dp.example_first_preference, 'high');
        assert.equal(dp.reassurance_need, 'high');
        assert.equal(dp.feedback_style, 'coach_gentle');
    });

    it('returns applied_rules array', () => {
        const { applied_rules } = deriveLearningProfile(SPEC_RAW_PROFILE);
        assert.ok(Array.isArray(applied_rules));
        assert.ok(applied_rules.length > 0);
    });

    it('respects declared_preferences over big_five', () => {
        const profile = {
            big_five: { openness: 30, conscientiousness: 80, extraversion: 80, agreeableness: 50, neuroticism: 20 },
            learning_style: 'principle_first',
            motivation: 'hobby',
            declared_preferences: { tone: 'gentle' },
        };
        const { derived_learning_profile: dp } = deriveLearningProfile(profile);
        // Despite low neuroticism, declared tone=gentle -> coach_gentle
        assert.equal(dp.feedback_style, 'coach_gentle');
    });

    it('uses system defaults when no data', () => {
        const { derived_learning_profile: dp } = deriveLearningProfile({
            big_five: { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 },
            learning_style: 'neutral',
            motivation: 'curiosity',
        });
        assert.ok(dp.credential_orientation);
        assert.ok(dp.feedback_style);
    });
});

// ===================== deriveGenerationRules =====================

describe('deriveGenerationRules', () => {
    it('produces generation rules from derived profile', () => {
        const { derived_learning_profile: dp } = deriveLearningProfile(SPEC_RAW_PROFILE);
        const rules = deriveGenerationRules(dp, SPEC_RAW_PROFILE);
        assert.equal(rules.explanation_style, 'example_then_principle');
        assert.equal(rules.curriculum_voice, 'gentle_and_reassuring');
        assert.ok(rules.weekly_load_policy.target_minutes_per_week > 0);
        assert.ok(rules.weekly_load_policy.max_actions_per_lesson > 0);
    });

    it('limits actions when reassurance_need is high', () => {
        const dp = { reassurance_need: 'high', example_first_preference: 'medium', problem_solving_orientation: 'medium', feedback_style: 'coach' };
        const rules = deriveGenerationRules(dp, {});
        assert.equal(rules.weekly_load_policy.max_actions_per_lesson, 2);
    });
});

// ===================== getGenerationKit =====================

describe('getGenerationKit', () => {
    it('returns personalization block', () => {
        const kit = getGenerationKit({});
        assert.ok(kit.personalization);
        assert.ok(kit.personalization.supported_diagnosis.includes('big_five'));
        assert.ok(kit.personalization.quality_rubric);
        assert.ok(kit.personalization.personalization_axes);
    });

    it('has correct schema version', () => {
        const kit = getGenerationKit({});
        assert.equal(kit.schema_version, '2026-03-10');
        assert.equal(kit.policy_version, '2026-03-10.a');
    });

    it('returns supported_learning_modes', () => {
        const kit = getGenerationKit({});
        assert.ok(kit.supported_learning_modes.includes('credential'));
        assert.ok(kit.supported_learning_modes.includes('gentle'));
    });

    it('default mode returns all 8 section_order entries', () => {
        const kit = getGenerationKit({});
        assert.equal(kit.learning_mode, 'default');
        assert.equal(kit.content_blueprint.lesson_template.section_order.length, 8);
    });
});

// ===================== Learning Modes =====================

describe('Learning Mode switching', () => {
    it('credential mode reorders sections and adds writing rules', () => {
        const kit = getGenerationKit({ learningMode: 'credential' });
        assert.equal(kit.learning_mode, 'credential');
        const order = kit.content_blueprint.lesson_template.section_order;
        assert.ok(order.indexOf('checklist') < order.indexOf('practice'));
        assert.ok(kit.content_blueprint.writing_rules.length > 5); // base(5) + extra
        assert.ok(kit.ui_emphasis.show_completion_badge);
    });

    it('gentle mode limits section_order', () => {
        const kit = getGenerationKit({ learningMode: 'gentle' });
        assert.equal(kit.learning_mode, 'gentle');
        const order = kit.content_blueprint.lesson_template.section_order;
        assert.ok(order.indexOf('examples') < order.indexOf('key_points'));
        assert.ok(kit.ui_emphasis.show_reassurance);
        assert.equal(kit.ui_emphasis.limit_actions, 2);
    });

    it('problem_solving mode has quiz rules', () => {
        const kit = getGenerationKit({ learningMode: 'problem_solving' });
        assert.equal(kit.learning_mode, 'problem_solving');
        assert.ok(kit.content_blueprint.writing_rules.some((r) => r.includes('problem or question')));
    });

    it('invalid mode falls back to default', () => {
        const kit = getGenerationKit({ learningMode: 'nonexistent' });
        assert.equal(kit.learning_mode, 'default');
    });
});

// ===================== Quality Rubric =====================

describe('validateQualityRubric', () => {
    it('warns on thin lessons', () => {
        const curriculum = {
            modules: [{
                title: 'M1', goal: 'Learn',
                lessons: [{ title: 'L1', objective: 'Understand' }],
            }],
        };
        const { quality_warnings } = validateQualityRubric({ curriculum, derivedLearningProfile: {} });
        assert.ok(quality_warnings.length > 0);
        assert.ok(quality_warnings.some((w) => w.includes('minimum is 6')));
    });

    it('warns on credential_orientation=high without checklist', () => {
        const curriculum = {
            modules: [{
                title: 'M1', goal: 'Learn',
                lessons: [{
                    title: 'L1', objective: 'x',
                    explanation: 'a'.repeat(250),
                    key_points: ['a', 'b', 'c'],
                    practice: ['p1', 'p2'],
                    cautions: ['c1'],
                    takeaway: 'done',
                }],
            }],
        };
        const { quality_warnings } = validateQualityRubric({
            curriculum,
            derivedLearningProfile: { credential_orientation: 'high' },
        });
        assert.ok(quality_warnings.some((w) => w.includes('credential_orientation')));
    });

    it('passes with rich lessons and no special axes', () => {
        const curriculum = {
            modules: [{
                title: 'M1', goal: 'Learn',
                lessons: [{
                    title: 'L1', objective: 'x',
                    explanation: 'a'.repeat(250),
                    key_points: ['a', 'b', 'c'],
                    examples: ['e1'],
                    practice: ['p1', 'p2'],
                    checklist: ['c1'],
                    cautions: ['w1'],
                    reflection: ['r1'],
                    takeaway: 'done',
                }],
            }],
        };
        const { quality_warnings } = validateQualityRubric({ curriculum, derivedLearningProfile: {} });
        assert.equal(quality_warnings.length, 0);
    });
});

// ===================== PERSONALIZATION_STATIC =====================

describe('PERSONALIZATION_STATIC', () => {
    it('has all required schema fields', () => {
        const p = PERSONALIZATION_STATIC;
        assert.ok(p.supported_diagnosis.length >= 3);
        assert.ok(p.raw_profile_schema.required_slots.length >= 3);
        assert.ok(p.derived_profile_schema.required_fields.length >= 8);
        assert.ok(Object.keys(p.personalization_axes).length >= 9);
        assert.ok(p.adaptation_rules.length >= 5);
        assert.ok(p.quality_rubric.lesson_min_sections >= 1);
    });
});

// ===================== Schema Validator =====================

describe('validateGenerationKit', () => {
    it('passes for default generation kit', () => {
        const kit = getGenerationKit({});
        const result = validateGenerationKit(kit);
        assert.equal(result.valid, true, `Errors: ${result.errors.join(', ')}`);
        assert.equal(result.errors.length, 0);
    });

    it('passes for all learning modes', () => {
        for (const mode of SUPPORTED_LEARNING_MODES) {
            const kit = getGenerationKit({ learningMode: mode });
            const result = validateGenerationKit(kit);
            assert.equal(result.valid, true, `Mode ${mode} failed: ${result.errors.join(', ')}`);
        }
    });

    it('fails for empty object', () => {
        const result = validateGenerationKit({});
        assert.equal(result.valid, false);
        assert.ok(result.errors.length >= 10);
    });

    it('fails for null', () => {
        const result = validateGenerationKit(null);
        assert.equal(result.valid, false);
        assert.ok(result.errors[0].includes('must be an object'));
    });

    it('reports warnings for missing optional personalization fields', () => {
        const kit = getGenerationKit({});
        const result = validateGenerationKit(kit);
        // Default kit has no derived_learning_profile or generation_rules
        assert.ok(result.warnings.length >= 1);
        assert.ok(result.warnings.some(w => w.includes('derived_learning_profile')));
    });
});

// ===================== buildHabitSignalsForKit (Phase 16-6g) =====================

describe('buildHabitSignalsForKit', () => {
    it('returns insufficient_data shape when metrics are sparse', () => {
        const result = buildHabitSignalsForKit({
            metrics: { insufficient_data: true, days_logged: 3, record_streak: 2 },
        });
        assert.equal(result.insufficient_data, true);
        assert.equal(result.days_logged, 3);
        assert.equal(result.record_streak, 2);
        assert.equal(result.avg_sleep_hours, undefined);
    });

    it('builds compact summary from metrics and patterns', () => {
        const result = buildHabitSignalsForKit({
            metrics: {
                insufficient_data: false,
                total_days: 30,
                days_logged: 21,
                avg_sleep_hours: 6.8,
                exercise_days: 12,
                record_streak: 5,
            },
            patterns: [{ id: 'exercise_mood_boost' }],
        });
        assert.equal(result.avg_sleep_hours, 6.8);
        assert.equal(result.exercise_days_per_week, 2.8);
        assert.equal(result.record_streak, 5);
        assert.equal(result.top_pattern, 'exercise_mood_boost');
        assert.equal(result.days_logged, 21);
        assert.equal(result.period_days, 30);
    });

    it('falls back to habit advice rule_id when patterns are empty', () => {
        const result = buildHabitSignalsForKit({
            metrics: {
                insufficient_data: false,
                total_days: 14,
                days_logged: 10,
                exercise_days: 4,
                record_streak: 1,
            },
            patterns: [],
            habitAdvice: {
                advice: [{ rule_id: 'sleep_focus_drop' }],
            },
        });
        assert.equal(result.top_pattern, 'sleep_focus_drop');
    });

    it('prefers priority-sorted habit advice over detectPatterns order', () => {
        const result = buildHabitSignalsForKit({
            metrics: {
                insufficient_data: false,
                total_days: 30,
                days_logged: 21,
                exercise_days: 12,
                record_streak: 5,
            },
            patterns: [{ id: 'exercise_mood_boost' }],
            habitAdvice: {
                advice: [{ rule_id: 'sleep_focus_drop' }],
            },
        });
        assert.equal(result.top_pattern, 'sleep_focus_drop');
    });
});

// ===================== getKit habit_signals injection (Phase 16-6g) =====================

describe('getKit habit_signals', () => {
    it('injects habit_signals when loader returns data', async () => {
        const habitSignals = {
            avg_sleep_hours: 7,
            record_streak: 2,
            days_logged: 10,
            period_days: 30,
            top_pattern: 'sleep_focus_drop',
        };
        const kit = await getKit({
            userId: '00000000-0000-0000-0000-000000000001',
            habitSignalsLoader: async () => habitSignals,
        });
        assert.deepEqual(kit.personalization.habit_signals, habitSignals);
    });

    it('omits habit_signals when loader returns null', async () => {
        const kit = await getKit({
            userId: '00000000-0000-0000-0000-000000000001',
            habitSignalsLoader: async () => null,
        });
        assert.equal(kit.personalization.habit_signals, undefined);
    });
});
