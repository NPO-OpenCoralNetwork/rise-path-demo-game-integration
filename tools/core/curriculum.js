/**
 * Shared Business Logic — Curriculum Generation
 *
 * Wraps curriculumGenerationKit.js for MCP/Express dual use.
 * Three tools: get-generation-kit, validate-intake, save-curriculum-draft
 */
import { getPool, PHASE1_USER_ID } from '../../server/db.js';
import { classifyDbError } from './dbErrors.js';
import {
    getGenerationKit,
    validateIntakePayload,
    validateCurriculumDraft,
    validateQualityRubric,
    buildCurriculumTitle,
    buildCurriculumDescription,
    buildRoadmapSummary,
    normalizeIntake,
} from '../../server/services/curriculumGenerationKit.js';

import { getAdaptationSignals } from './journal.js';
import { getAnalysis } from './lifeJournal.js';
import {
    buildHabitSignalsForKit,
    deriveGenerationRules,
    deriveLifeHabitSignals,
} from '../../server/services/personalizationDeriver.js';

const shiftIsoDate = (isoDate, deltaDays) => {
    const d = new Date(`${isoDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
};

/**
 * Load last-30-day life journal summary for generation-kit injection (Phase 16-6g).
 */
export async function loadHabitSignalsForKit(userId, { timezone = 'UTC', lookbackDays = 29 } = {}) {
    const to = new Date().toISOString().slice(0, 10);
    const from = shiftIsoDate(to, -lookbackDays);
    const analysis = await getAnalysis({
        userId,
        from,
        to,
        timezone,
        granularity: 'monthly',
    });

    if (analysis?.error) return null;

    const habitAdvice = deriveLifeHabitSignals(analysis.metrics);
    return buildHabitSignalsForKit({
        metrics: analysis.metrics,
        patterns: analysis.patterns,
        habitAdvice,
    });
}

/**
 * Suggest the best learning_mode from a derived learning profile.
 * Priority: gentle > credential > problem_solving > practice > default
 * @param {Object} dp - derived_learning_profile (9 axes)
 * @returns {string} suggested learning mode
 */
export function suggestLearningMode(dp) {
    if (!dp || typeof dp !== 'object') return 'default';
    if (dp.reassurance_need === 'high') return 'gentle';
    if (dp.credential_orientation === 'high') return 'credential';
    if (dp.problem_solving_orientation === 'high') return 'problem_solving';
    if (dp.practice_intensity === 'heavy') return 'practice';
    return 'default';
}

/**
 * Load the latest learner profile from DB.
 * @param {string} userId
 * @returns {Object|null} { raw_profile, derived_learning_profile } or null
 */
async function loadLearnerProfile(userId) {
    const pool = getPool();
    if (!pool) return null;
    try {
        const result = await pool.query(
            `SELECT raw_profile, derived_learning_profile
             FROM learner_profiles
             WHERE user_id = CAST($1 AS uuid)
             ORDER BY version DESC LIMIT 1`,
            [userId]
        );
        if (!result.rowCount) return null;
        const row = result.rows[0];
        return {
            raw_profile: row.raw_profile || {},
            derived_learning_profile: row.derived_learning_profile || {},
        };
    } catch {
        return null;
    }
}

/**
 * Get the generation kit (template, schema, rules) for curriculum creation.
 * When userId is provided:
 *   - Learner profile (9 axes + generation_rules) auto-injected
 *   - Adaptation signals auto-injected
 *   - habit_signals from life journal (16-6g)
 *   - Suggested learning mode calculated
 *   - Adaptation overrides merged over profile rules
 * @param {Function} [habitSignalsLoader] - test override; defaults to loadHabitSignalsForKit
 */
export async function getKit({
    portalId,
    templateId,
    locale,
    learningMode,
    userId,
    habitSignalsLoader = loadHabitSignalsForKit,
}) {
    try {
        const kit = getGenerationKit({ portalId, templateId, locale, learningMode });

        if (userId) {
            // Phase 12.5 / 16-6g: Parallel fetch — profile + adaptation + habit_signals
            const [profile, adaptResult, habitSignals] = await Promise.all([
                loadLearnerProfile(userId).catch(() => null),
                getAdaptationSignals({ userId }).catch(() => null),
                habitSignalsLoader(userId).catch(() => null),
            ]);

            // Inject profile
            if (profile?.derived_learning_profile && Object.keys(profile.derived_learning_profile).length > 0) {
                const dp = profile.derived_learning_profile;
                const baseRules = deriveGenerationRules(dp, profile.raw_profile || {});

                // Merge: adaptation overrides win over profile rules
                const adaptOverrides = adaptResult?.generation_rule_overrides || {};
                const mergedRules = { ...baseRules, ...adaptOverrides };

                kit.personalization = {
                    ...kit.personalization,
                    derived_learning_profile: dp,
                    generation_rules: mergedRules,
                    suggested_learning_mode: suggestLearningMode(dp),
                };
            }

            // Inject adaptation signals
            if (adaptResult?.signals?.length > 0 || adaptResult?.welcome_back) {
                kit.personalization = {
                    ...kit.personalization,
                    adaptation: {
                        signals: adaptResult.signals,
                        generation_rule_overrides: adaptResult.generation_rule_overrides,
                        welcome_back: adaptResult.welcome_back || null,
                        analysis: adaptResult.analysis,
                    },
                };
            }

            // Phase 16-6g: life journal habit_signals (deterministic)
            if (habitSignals) {
                kit.personalization = {
                    ...kit.personalization,
                    habit_signals: habitSignals,
                };
            }
        }

        return kit;
    } catch (err) {
        return { error: `Failed to build generation kit: ${err.message}`, error_type: 'validation' };
    }
}

/**
 * Validate LLM-generated intake (learning requirements) against kit rules.
 * Pure validation — no DB access needed.
 */
export function validateIntake({ portalId, templateId, locale, learningMode, intake }) {
    try {
        const kit = getGenerationKit({ portalId, templateId, locale, learningMode });
        const result = validateIntakePayload({ intake, kit });
        return result;
    } catch (err) {
        return { error: `Intake validation failed: ${err.message}`, error_type: 'validation' };
    }
}

/**
 * Validate and save a curriculum draft to the database.
 * Performs structural validation + quality rubric check before persisting.
 *
 * @param {Object} params
 * @param {string} params.portalId
 * @param {string} [params.policyVersion]
 * @param {object} params.intake - Validated intake requirements
 * @param {object} params.curriculum - LLM-generated curriculum JSON
 * @param {string} [params.curriculumId] - Existing curriculum ID for update
 * @param {string} [params.userId]
 * @param {object} [params.generationMeta] - { provider, model, session_id }
 * @param {string} [params.learningMode]
 */
export async function saveDraft({
    portalId, policyVersion, intake, curriculum,
    curriculumId, userId, generationMeta, learningMode,
}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const effectiveUserId = userId || PHASE1_USER_ID;

    try {
        // 1. Get kit for validation context
        const kit = getGenerationKit({ portalId, learningMode });

        // 2. Structural validation
        const draftValidation = validateCurriculumDraft({ curriculum, kit });
        if (!draftValidation.valid) {
            return {
                error: 'Curriculum draft validation failed',
                error_type: 'validation',
                conflicts: draftValidation.conflicts,
            };
        }

        // 3. Quality rubric check
        const qualityResult = validateQualityRubric({
            curriculum: draftValidation.normalized_curriculum,
            derivedLearningProfile: {},
        });

        // 4. Build metadata
        const title = buildCurriculumTitle({ intake, curriculum, portalId });
        const description = buildCurriculumDescription({ intake, curriculum });
        const roadmap = buildRoadmapSummary({ curriculum: draftValidation.normalized_curriculum });

        // 5. Save to database
        const normalizedIntake = normalizeIntake(intake);
        const curriculumData = {
            ...draftValidation.normalized_curriculum,
            schema_version: kit.schema_version,
            policy_version: policyVersion || kit.policy_version,
        };

        if (curriculumId) {
            // Update existing
            const updateResult = await pool.query(
                `UPDATE curricula SET
                    title = $1, description = $2, intake = $3, curriculum_data = $4,
                    generation_meta = $5, status = 'draft', updated_at = NOW()
                 WHERE id = CAST($6 AS uuid) AND user_id = CAST($7 AS uuid)`,
                [title, description, JSON.stringify(normalizedIntake),
                 JSON.stringify(curriculumData), JSON.stringify(generationMeta || {}),
                 curriculumId, effectiveUserId]
            );

            if (!updateResult.rowCount) {
                return {
                    error: `Curriculum ${curriculumId} not found or not owned by user`,
                    error_type: 'not_found',
                };
            }

            return {
                curriculum_id: curriculumId,
                action: 'updated',
                title,
                lesson_count: draftValidation.lesson_count,
                roadmap,
                quality_warnings: qualityResult.quality_warnings,
            };
        } else {
            // Insert new
            const result = await pool.query(
                `INSERT INTO curricula (user_id, title, description, intake, curriculum_data, generation_meta, status)
                 VALUES (CAST($1 AS uuid), $2, $3, $4, $5, $6, 'draft')
                 RETURNING id, created_at`,
                [effectiveUserId, title, description, JSON.stringify(normalizedIntake),
                 JSON.stringify(curriculumData), JSON.stringify(generationMeta || {})]
            );

            return {
                curriculum_id: result.rows[0].id,
                action: 'created',
                title,
                lesson_count: draftValidation.lesson_count,
                roadmap,
                quality_warnings: qualityResult.quality_warnings,
                created_at: result.rows[0].created_at,
            };
        }
    } catch (err) {
        return classifyDbError(err, 'saveDraft');
    }
}
