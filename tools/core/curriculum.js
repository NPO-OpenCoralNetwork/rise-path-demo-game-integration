/**
 * Shared Business Logic — Curriculum Generation
 *
 * Wraps curriculumGenerationKit.js for MCP/Express dual use.
 * Three tools: get-generation-kit, validate-intake, save-curriculum-draft
 * writeCurriculumVersion is also the DB path of the lesson-upsert-draft tool (tools/core/lessons.js).
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
import {
    adaptCurriculumDraftForSave,
    resolveCurriculumUiTemplate,
} from '../../server/services/chatgptCurriculumAdapter.js';

import { getAdaptationSignals } from './journal.js';
import { getAnalysis } from './lifeJournal.js';
import { isUuid } from './ids.js';
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
 * The content of a curriculum's current version (`current_version_id`, usually the latest saved
 * draft), only if the curriculum belongs to `userId`. Throws on database errors.
 *
 * @param {Object} params
 * @param {string} params.curriculumId - curricula.id from the request
 * @param {string} params.userId - the authenticated caller
 * @returns {Promise<object | null>} content_json, or null when not found, not owned, without a
 *   current version, or the id is malformed
 */
export async function getOwnedCurriculumContent({ curriculumId, userId }) {
    const pool = getPool();
    if (!pool || !isUuid(curriculumId) || !isUuid(userId)) return null;
    const result = await pool.query(
        `select cv.content_json
         from curricula c
         join curriculum_versions cv on cv.id = c.current_version_id
         where c.id = CAST($1 AS uuid) and c.user_id = CAST($2 AS uuid)`,
        [curriculumId, userId]
    );
    return result.rowCount ? result.rows[0].content_json : null;
}

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
 * Write a draft version of a curriculum inside the caller's transaction: create the
 * curricula row when curriculumId is empty, insert curriculum_versions (status 'draft',
 * content in content_json) and point curricula.current_version_id at it.
 * Same write path as POST /api/v2/ai/curriculum-drafts (server/routes/chatgptCurriculum.js).
 * The caller checks ownership of an existing curriculumId before calling.
 * For an existing curriculumId this locks the curricula row (FOR UPDATE) before it reads
 * max(version), so concurrent saves of one curriculum queue up instead of picking the same
 * number and failing on UNIQUE (curriculum_id, version). Every caller runs inside BEGIN/COMMIT,
 * which the lock needs to last until the insert is committed.
 *
 * @param {import('pg').PoolClient} client - connection with an open transaction
 * @param {Object} params
 * @param {string} [params.curriculumId] - existing curriculum to add a version to
 * @param {string} params.userId
 * @param {string} params.title
 * @param {string} [params.description]
 * @param {string} params.uiTemplateId
 * @param {object|Function} params.content - content_json, or (curriculumId) => content_json
 * @param {object} [params.requirements]
 * @param {object} [params.roadmap]
 * @param {object} [params.uiHints]
 * @param {number} [params.totalLessons]
 * @param {string} [params.modelUsed]
 * @returns {Promise<{ curriculumId: string, curriculumVersionId: string, version: number, status: string, createdAt: string }>}
 */
export async function writeCurriculumVersion(client, {
    curriculumId, userId, title, description = '', uiTemplateId, content,
    requirements = null, roadmap = null, uiHints = null, totalLessons = 0, modelUsed = null,
}) {
    let id = curriculumId;
    let version = 1;

    if (id) {
        // A no-op when the caller already locked the row for its ownership check.
        const locked = await client.query(
            'select id from curricula where id = CAST($1 AS uuid) for update',
            [id]
        );
        if (!locked.rowCount) throw new Error(`Curriculum ${id} not found`);
        const versionResult = await client.query(
            'select coalesce(max(version), 0) + 1 as next_version from curriculum_versions where curriculum_id = CAST($1 AS uuid)',
            [id]
        );
        version = Number(versionResult.rows[0]?.next_version || 1);
    } else {
        const created = await client.query(
            `insert into curricula (user_id, title, description, ui_template_id)
             values (CAST($1 AS uuid), $2, $3, $4)
             returning id`,
            [userId, title, description, uiTemplateId]
        );
        id = created.rows[0].id;
    }

    const contentJson = typeof content === 'function' ? content(id) : content;
    const toJson = (value) => (value == null ? null : JSON.stringify(value));
    const inserted = await client.query(
        `insert into curriculum_versions
            (curriculum_id, version, status, content_json, requirements, roadmap, ui_hints, created_by)
         values (CAST($1 AS uuid), $2, 'draft', $3, $4, $5, $6, CAST($7 AS uuid))
         returning id, status, created_at`,
        [id, version, JSON.stringify(contentJson), toJson(requirements), toJson(roadmap), toJson(uiHints), userId]
    );
    const row = inserted.rows[0];

    await client.query(
        `update curricula
         set title = $1,
             description = $2,
             current_version_id = CAST($3 AS uuid),
             total_lessons = $4,
             ui_template_id = $5,
             model_used = coalesce($6, model_used)
         where id = CAST($7 AS uuid)`,
        [title, description, row.id, totalLessons, uiTemplateId, modelUsed || null, id]
    );

    return {
        curriculumId: id,
        curriculumVersionId: row.id,
        version,
        status: row.status,
        createdAt: row.created_at,
    };
}

/**
 * Validate and save a curriculum draft to the database.
 * Performs structural validation + quality rubric check before persisting.
 * Each save adds a draft row to curriculum_versions (content_json) and makes it current.
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
    let client = null;

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
        const normalizedIntake = normalizeIntake(intake);
        const meta = generationMeta || {};
        const resolvedPolicyVersion = policyVersion || kit.policy_version;
        const uiTemplateId = resolveCurriculumUiTemplate(kit.template_id);

        // 5. Save to database (reader-ready content in curriculum_versions.content_json)
        client = await pool.connect();
        await client.query('BEGIN');

        if (curriculumId) {
            const existing = await client.query(
                'select id from curricula where id = CAST($1 AS uuid) and user_id = CAST($2 AS uuid) for update',
                [curriculumId, effectiveUserId]
            );
            if (!existing.rowCount) {
                await client.query('ROLLBACK');
                return {
                    error: `Curriculum ${curriculumId} not found or not owned by user`,
                    error_type: 'not_found',
                };
            }
        }

        const saved = await writeCurriculumVersion(client, {
            curriculumId,
            userId: effectiveUserId,
            title,
            description,
            uiTemplateId,
            content: (id) => ({
                ...adaptCurriculumDraftForSave({
                    curriculum: draftValidation.normalized_curriculum,
                    curriculumId: id,
                    templateId: kit.template_id,
                    title,
                    description,
                    learningMode: kit.learning_mode,
                    explanationStyle: null,
                }),
                _meta: {
                    schema_version: kit.schema_version,
                    policy_version: resolvedPolicyVersion,
                    portal_id: kit.portal_id,
                    template_id: kit.template_id,
                    ui_template_id: uiTemplateId,
                    locale: kit.locale,
                    generation_meta: meta,
                    saved_at: new Date().toISOString(),
                    learning_mode: kit.learning_mode,
                    source_curriculum: draftValidation.normalized_curriculum,
                    source: 'mcp',
                },
            }),
            requirements: normalizedIntake,
            roadmap,
            uiHints: {
                template_id: kit.template_id,
                ui_template_id: uiTemplateId,
                policy_version: resolvedPolicyVersion,
                portal_id: kit.portal_id,
                locale: kit.locale,
                save_defaults: kit.save_defaults,
                generation_meta: meta,
            },
            totalLessons: draftValidation.lesson_count,
            modelUsed: typeof meta.model === 'string' ? meta.model : null,
        });

        await client.query('COMMIT');

        return {
            curriculum_id: saved.curriculumId,
            curriculum_version_id: saved.curriculumVersionId,
            version: saved.version,
            status: saved.status,
            action: curriculumId ? 'updated' : 'created',
            title,
            lesson_count: draftValidation.lesson_count,
            roadmap,
            quality_warnings: qualityResult.quality_warnings,
            created_at: saved.createdAt,
        };
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return classifyDbError(err, 'saveDraft');
    } finally {
        client?.release();
    }
}
