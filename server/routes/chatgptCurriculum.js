import express from 'express';
import { getPool } from '../db.js';
import { requireBridgeOrAuth } from '../middleware/bridgeAuth.js';
import {
    buildCurriculumDescription,
    buildCurriculumTitle,
    buildRoadmapSummary,
    getGenerationKit,
    validateCurriculumDraft,
    validateIntakePayload,
    validateQualityRubric,
} from '../services/curriculumGenerationKit.js';
import {
    adaptCurriculumDraftForSave,
    resolveCurriculumUiTemplate,
} from '../services/chatgptCurriculumAdapter.js';
import {
    deriveLearningProfile,
    deriveGenerationRules,
    validateRawProfile,
} from '../services/personalizationDeriver.js';
import { seedAssessmentMemories } from '../services/learnerMemoryBridge.js';
import {
    buildResumeCard,
    adjustWeeklyLoad,
} from '../services/resumeService.js';
import {
    buildSummaryCards,
    buildWeeklyDigest,
    buildMiniEncyclopedia,
} from '../services/artifactService.js';
import { validateGenerationKit } from '../services/schemaValidator.js';
import { validateJournalEntry, buildJournalSummary } from '../services/journalService.js';
import { getAdaptationSignals } from '../../tools/core/journal.js';

const router = express.Router();

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

const asObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
};

// Note: extractBridgeToken removed in Phase 7 — replaced by requireBridgeOrAuth

const bridgeContextFromRequest = (req) => ({
    nexloom_user_id: cleanString(req.headers['x-nexloom-user-id']),
    nexloom_organization_id: cleanString(req.headers['x-nexloom-organization-id']),
    authenticated_via_bridge: Boolean(req.bridgeAuthenticated),
});

const writeAuditLog = (req, eventName, payload = {}) => {
    const auditPayload = {
        event: eventName,
        at: new Date().toISOString(),
        bridge: bridgeContextFromRequest(req),
        payload,
    };
    console.log(`[ChatGPT Curriculum API] ${JSON.stringify(auditPayload)}`);
};

const resolvePolicyVersion = ({ requestedPolicyVersion, kit }) => {
    const effectivePolicyVersion = cleanString(requestedPolicyVersion) || cleanString(kit?.policy_version);
    if (effectivePolicyVersion !== cleanString(kit?.policy_version)) {
        return {
            ok: false,
            error: `policy_version mismatch: expected ${kit?.policy_version}`,
        };
    }
    return { ok: true, policyVersion: effectivePolicyVersion };
};

router.post('/ai/generation-kit', requireBridgeOrAuth, async (req, res) => {
    const portalId = cleanString(req.body?.portal_id);
    const templateId = cleanString(req.body?.template_id);
    const locale = cleanString(req.body?.locale);
    const learnerProfileId = cleanString(req.body?.learner_profile_id);
    const includePersonalization = Boolean(req.body?.include_personalization);
    const learningMode = cleanString(req.body?.learning_mode);
    const kit = getGenerationKit({ portalId, templateId, locale, learningMode });

    // If learner_profile_id provided and personalization requested, enrich the kit
    if (includePersonalization && learnerProfileId) {
        const pool = getPool();
        if (pool) {
            try {
                const result = await pool.query(
                    `select raw_profile, derived_learning_profile from learner_profiles
                     where id = CAST($1 AS uuid) order by version desc limit 1`,
                    [learnerProfileId]
                );
                if (result.rowCount) {
                    const row = result.rows[0];
                    const dp = asObject(row.derived_learning_profile);
                    const rules = deriveGenerationRules(dp, asObject(row.raw_profile));
                    kit.personalization = {
                        ...kit.personalization,
                        derived_learning_profile: dp,
                        generation_rules: rules,
                    };
                }
            } catch (err) {
                console.error('[ChatGPT Curriculum API] Failed to load learner profile for kit:', err.message);
            }
        }
    }

    // Validate kit against schema before sending
    const schemaValidation = validateGenerationKit(kit);
    if (!schemaValidation.valid) {
        console.error('[ChatGPT Curriculum API] generation_kit schema validation failed:', schemaValidation.errors);
    }

    writeAuditLog(req, 'generation_kit_requested', {
        portal_id: kit.portal_id,
        template_id: kit.template_id,
        locale: kit.locale,
        learner_profile_id: learnerProfileId || null,
        include_personalization: includePersonalization,
        schema_valid: schemaValidation.valid,
    });

    res.json({
        ...kit,
        _schema_validation: {
            valid: schemaValidation.valid,
            errors: schemaValidation.errors,
            warnings: schemaValidation.warnings,
        },
    });
});

router.post('/ai/validate-intake', requireBridgeOrAuth, async (req, res) => {
    const portalId = cleanString(req.body?.portal_id);
    const templateId = cleanString(req.body?.template_id);
    const locale = cleanString(req.body?.locale);
    const learnerProfileId = cleanString(req.body?.learner_profile_id);
    const kit = getGenerationKit({ portalId, templateId, locale });
    const policyResolution = resolvePolicyVersion({
        requestedPolicyVersion: req.body?.policy_version,
        kit,
    });
    if (!policyResolution.ok) {
        return res.status(422).json({ error: policyResolution.error });
    }

    const validation = validateIntakePayload({
        intake: req.body?.intake,
        kit,
    });

    // Enrich with personalization summary if profile available
    let normalizedPersonalization = null;
    if (learnerProfileId) {
        const pool = getPool();
        if (pool) {
            try {
                const result = await pool.query(
                    `select derived_learning_profile from learner_profiles
                     where id = CAST($1 AS uuid) order by version desc limit 1`,
                    [learnerProfileId]
                );
                if (result.rowCount) {
                    const dp = asObject(result.rows[0].derived_learning_profile);
                    // Return a summary of high-impact axes
                    normalizedPersonalization = {};
                    for (const [key, value] of Object.entries(dp)) {
                        if (value === 'high' || value === 'heavy' || value === 'steady_small_steps' || value === 'coach_gentle') {
                            normalizedPersonalization[key] = value;
                        }
                    }
                }
            } catch (err) {
                console.error('[ChatGPT Curriculum API] Failed to load learner profile for intake validation:', err.message);
            }
        }
    }

    writeAuditLog(req, 'intake_validated', {
        portal_id: kit.portal_id,
        template_id: kit.template_id,
        valid: validation.valid,
        missing_fields: validation.missing_fields,
        conflicts: validation.conflicts,
    });

    const response = { ...validation, quality_warnings: [] };
    if (normalizedPersonalization) {
        response.normalized_personalization = normalizedPersonalization;
    }
    res.json(response);
});

router.post('/ai/curriculum-drafts', requireBridgeOrAuth, async (req, res) => {
    const portalId = cleanString(req.body?.portal_id);
    const templateId = cleanString(req.body?.template_id);
    const locale = cleanString(req.body?.locale);
    const requestedCurriculumId = cleanString(req.body?.curriculum_id);
    const learnerProfileId = cleanString(req.body?.learner_profile_id);
    const learningMode = cleanString(req.body?.learning_mode);
    const kit = getGenerationKit({ portalId, templateId, locale, learningMode });
    const policyResolution = resolvePolicyVersion({
        requestedPolicyVersion: req.body?.policy_version,
        kit,
    });
    if (!policyResolution.ok) {
        return res.status(422).json({ error: policyResolution.error });
    }

    const intakeValidation = validateIntakePayload({
        intake: req.body?.intake,
        kit,
    });
    if (!intakeValidation.valid) {
        return res.status(422).json({
            error: 'intake validation failed',
            ...intakeValidation,
        });
    }

    const curriculumValidation = validateCurriculumDraft({
        curriculum: req.body?.curriculum,
        kit,
    });
    if (!curriculumValidation.valid) {
        return res.status(422).json({
            error: 'curriculum validation failed',
            conflicts: curriculumValidation.conflicts,
        });
    }

    const pool = getPool();

    // Resolve personalization data
    let personalizationMeta = null;
    let derivedLearningProfile = asObject(req.body?.derived_learning_profile);
    let rawProfileSnapshot = null;
    let generationRulesSnapshot = null;

    if (learnerProfileId && pool) {
        try {
            const lpResult = await pool.query(
                `select id, version, raw_profile, derived_learning_profile, applied_rules
                 from learner_profiles where id = CAST($1 AS uuid) order by version desc limit 1`,
                [learnerProfileId]
            );
            if (lpResult.rowCount) {
                const row = lpResult.rows[0];
                rawProfileSnapshot = asObject(row.raw_profile);
                derivedLearningProfile = asObject(row.derived_learning_profile);
                generationRulesSnapshot = deriveGenerationRules(derivedLearningProfile, rawProfileSnapshot);
                personalizationMeta = {
                    learner_profile_id: row.id,
                    profile_version: row.version,
                    raw_profile_snapshot: rawProfileSnapshot,
                    derived_learning_profile: derivedLearningProfile,
                    generation_rules_snapshot: generationRulesSnapshot,
                    applied_overrides: asObject(rawProfileSnapshot?.declared_preferences),
                };
            }
        } catch (err) {
            console.error('[ChatGPT Curriculum API] Failed to load learner profile for draft:', err.message);
        }
    } else if (Object.keys(derivedLearningProfile).length > 0) {
        // Inline derived profile provided without stored learner_profile
        personalizationMeta = {
            learner_profile_id: null,
            profile_version: null,
            raw_profile_snapshot: null,
            derived_learning_profile: derivedLearningProfile,
            generation_rules_snapshot: null,
            applied_overrides: {},
        };
    }

    // Quality rubric check (warnings, not blocking)
    const { quality_warnings } = validateQualityRubric({
        curriculum: curriculumValidation.normalized_curriculum,
        derivedLearningProfile,
    });
    if (quality_warnings.length > 0) {
        return res.status(422).json({
            error: 'quality rubric validation failed',
            quality_violations: quality_warnings,
        });
    }

    const title = buildCurriculumTitle({
        intake: intakeValidation.normalized_intake,
        curriculum: curriculumValidation.normalized_curriculum,
        portalId: kit.portal_id,
    });
    const description = buildCurriculumDescription({
        intake: intakeValidation.normalized_intake,
        curriculum: curriculumValidation.normalized_curriculum,
    });

    const generationMeta = {
        ...asObject(req.body?.generation_meta),
        provider: cleanString(req.body?.generation_meta?.provider) || 'openai',
        model: cleanString(req.body?.generation_meta?.model) || 'gpt-5',
        source_connector: cleanString(req.body?.generation_meta?.source_connector) || 'chatgpt_mcp',
        session_id: cleanString(req.body?.generation_meta?.session_id),
    };

    const uiTemplateId = resolveCurriculumUiTemplate(kit.template_id);
    const adaptedContentJson = adaptCurriculumDraftForSave({
        curriculum: curriculumValidation.normalized_curriculum,
        curriculumId: requestedCurriculumId || undefined,
        templateId: kit.template_id,
        locale: kit.locale,
        title,
        description,
        learningMode: kit.learning_mode,
        explanationStyle: generationRulesSnapshot?.explanation_style || null,
    });
    const contentJson = {
        ...adaptedContentJson,
        _meta: {
            schema_version: kit.schema_version,
            policy_version: policyResolution.policyVersion,
            portal_id: kit.portal_id,
            template_id: kit.template_id,
            ui_template_id: uiTemplateId,
            locale: kit.locale,
            generation_meta: generationMeta,
            bridge_context: bridgeContextFromRequest(req),
            saved_at: new Date().toISOString(),
            learning_mode: kit.learning_mode,
            source_curriculum: curriculumValidation.normalized_curriculum,
            personalization: personalizationMeta,
        },
    };
    const roadmap = buildRoadmapSummary({
        curriculum: curriculumValidation.normalized_curriculum,
    });
    const uiHints = {
        template_id: kit.template_id,
        ui_template_id: uiTemplateId,
        policy_version: policyResolution.policyVersion,
        portal_id: kit.portal_id,
        locale: kit.locale,
        save_defaults: kit.save_defaults,
        bridge_context: bridgeContextFromRequest(req),
        generation_meta: generationMeta,
    };

    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const client = await pool.connect();
    try {
        // Phase 7: ensurePhase1User removed — JWT users exist in auth.users
        await client.query('BEGIN');

        let curriculumId = requestedCurriculumId;
        let nextVersion = 1;

        if (curriculumId) {
            const existing = await client.query(
                'select id from curricula where id = CAST($1 AS uuid) and user_id = CAST($2 AS uuid)',
                [curriculumId, req.userId]
            );
            if (!existing.rowCount) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Curriculum not found' });
            }

            const versionResult = await client.query(
                'select coalesce(max(version), 0) + 1 as next_version from curriculum_versions where curriculum_id = CAST($1 AS uuid)',
                [curriculumId]
            );
            nextVersion = Number(versionResult.rows[0]?.next_version || 1);
        } else {
            const created = await client.query(
                `insert into curricula (user_id, title, description, ui_template_id)
                 values (CAST($1 AS uuid), $2, $3, $4)
                 returning id`,
                [req.userId, title, description, uiTemplateId]
            );
            curriculumId = created.rows[0].id;
        }
        contentJson.curriculum_id = curriculumId;

        const versionResult = await client.query(
            `insert into curriculum_versions
                (curriculum_id, version, status, content_json, requirements, roadmap, ui_hints, created_by)
             values (CAST($1 AS uuid), $2, 'draft', $3, $4, $5, $6, CAST($7 AS uuid))
             returning id, status, created_at`,
            [
                curriculumId,
                nextVersion,
                JSON.stringify(contentJson),
                JSON.stringify(intakeValidation.normalized_intake),
                JSON.stringify(roadmap),
                JSON.stringify(uiHints),
                req.userId,
            ]
        );

        const curriculumVersionId = versionResult.rows[0].id;

        await client.query(
            `update curricula
             set title = $1,
                 description = $2,
                 current_version_id = CAST($3 AS uuid),
                 total_lessons = $4,
                 ui_template_id = $5
             where id = CAST($6 AS uuid)`,
            [
                title,
                description,
                curriculumVersionId,
                curriculumValidation.lesson_count,
                uiTemplateId,
                curriculumId,
            ]
        );

        await client.query('COMMIT');

        writeAuditLog(req, 'curriculum_draft_saved', {
            curriculum_id: curriculumId,
            curriculum_version_id: curriculumVersionId,
            lesson_count: curriculumValidation.lesson_count,
            portal_id: kit.portal_id,
            template_id: kit.template_id,
        });

        return res.json({
            ok: true,
            curriculum_id: curriculumId,
            curriculum_version_id: curriculumVersionId,
            ui_template_id: uiTemplateId,
            status: versionResult.rows[0].status,
            saved_at: versionResult.rows[0].created_at,
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[ChatGPT Curriculum API] Save draft error:', error);
        return res.status(500).json({ error: 'Failed to save curriculum draft', detail: error.message });
    } finally {
        client.release();
    }
});

// --- Personalization APIs ---

// POST /api/v2/ai/personalization/derive
// Preview: raw_profile -> derived_learning_profile (no DB save)
router.post('/ai/personalization/derive', requireBridgeOrAuth, async (req, res) => {
    const rawProfile = asObject(req.body?.raw_profile);
    const profileValidation = validateRawProfile(rawProfile);
    if (!profileValidation.valid) {
        return res.status(422).json({ error: 'Invalid raw_profile', details: profileValidation.errors });
    }

    const { derived_learning_profile, applied_rules } = deriveLearningProfile(rawProfile);

    writeAuditLog(req, 'personalization_derived', { axes: Object.keys(derived_learning_profile) });

    res.json({ ok: true, derived_learning_profile, applied_rules });
});

// POST /api/v2/learner-profiles/assessments
// Save diagnosis + derive profile
router.post('/learner-profiles/assessments', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const assessmentType = cleanString(req.body?.assessment_type) || 'big_five_v1';
    const rawProfile = asObject(req.body?.raw_profile);
    const profileValidation = validateRawProfile(rawProfile);
    if (!profileValidation.valid) {
        return res.status(422).json({ error: 'Invalid raw_profile', details: profileValidation.errors });
    }

    const { derived_learning_profile, applied_rules } = deriveLearningProfile(rawProfile);

    const client = await pool.connect();
    try {
        // Phase 7: ensurePhase1User removed
        await client.query('BEGIN');

        // Determine next version for this user
        const versionResult = await client.query(
            `select coalesce(max(version), 0) + 1 as next_version
             from learner_profiles where user_id = CAST($1 AS uuid)`,
            [req.userId]
        );
        const nextVersion = Number(versionResult.rows[0]?.next_version || 1);

        const insertResult = await client.query(
            `insert into learner_profiles
                (user_id, version, assessment_type, raw_profile, derived_learning_profile, applied_rules)
             values (CAST($1 AS uuid), $2, $3, $4, $5, $6)
             returning id`,
            [
                req.userId,
                nextVersion,
                assessmentType,
                JSON.stringify(rawProfile),
                JSON.stringify(derived_learning_profile),
                JSON.stringify(applied_rules),
            ]
        );

        await client.query('COMMIT');

        const learnerProfileId = insertResult.rows[0].id;

        writeAuditLog(req, 'learner_profile_saved', {
            learner_profile_id: learnerProfileId,
            profile_version: nextVersion,
            assessment_type: assessmentType,
        });

        seedAssessmentMemories({
            pool,
            userId: req.userId,
            profile: {
                profileVersion: nextVersion,
                assessmentType,
                rawProfile,
                derivedLearningProfile: derived_learning_profile,
                appliedRules: applied_rules,
            },
        }).catch((seedErr) => {
            console.error('[ChatGPT Curriculum API] Assessment memory seed error:', seedErr);
        });

        res.json({
            ok: true,
            learner_profile_id: learnerProfileId,
            profile_version: nextVersion,
            derived_learning_profile,
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[ChatGPT Curriculum API] Save assessment error:', error);
        res.status(500).json({ error: 'Failed to save learner profile', detail: error.message });
    } finally {
        client.release();
    }
});

// GET /api/v2/learner-profiles/latest
// Retrieve the latest learner profile for the current user
router.get('/learner-profiles/latest', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    try {
        const result = await pool.query(
            `select id, version, assessment_type, raw_profile, derived_learning_profile, applied_rules, created_at
             from learner_profiles
             where user_id = CAST($1 AS uuid)
             order by version desc limit 1`,
            [req.userId]
        );
        if (!result.rowCount) {
            return res.status(404).json({ error: 'No learner profile found' });
        }
        const row = result.rows[0];
        res.json({
            ok: true,
            learner_profile_id: row.id,
            profile_version: row.version,
            assessment_type: row.assessment_type,
            raw_profile: row.raw_profile,
            derived_learning_profile: row.derived_learning_profile,
            applied_rules: row.applied_rules,
            created_at: row.created_at,
        });
    } catch (error) {
        console.error('[ChatGPT Curriculum API] Get latest profile error:', error);
        res.status(500).json({ error: 'Failed to retrieve learner profile', detail: error.message });
    }
});

// GET /api/v2/curricula/:id/resume
// Returns a resume card with next action and gap analysis
router.get('/curricula/:id/resume', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const curriculumId = cleanString(req.params.id);

    try {
        // Fetch progress
        const progressResult = await pool.query(
            `select module_id, lesson_id, status, doc_completed_at, updated_at
             from curriculum_progress
             where curriculum_id = CAST($1 AS uuid) and user_id = CAST($2 AS uuid)
             order by module_id, lesson_id`,
            [curriculumId, req.userId]
        );

        // Fetch curriculum content for lesson resolution
        const curriculumResult = await pool.query(
            `select cv.content_json
             from curricula c
             join curriculum_versions cv on cv.id = c.current_version_id
             where c.id = CAST($1 AS uuid)`,
            [curriculumId]
        );
        if (!curriculumResult.rowCount) {
            return res.status(404).json({ error: 'Curriculum not found' });
        }

        const curriculum = asObject(curriculumResult.rows[0].content_json);
        const resumeCard = buildResumeCard({
            progress: progressResult.rows,
            curriculum,
        });

        writeAuditLog(req, 'resume_card_requested', {
            curriculum_id: curriculumId,
            resume_type: resumeCard.type,
        });

        res.json({ ok: true, ...resumeCard });
    } catch (error) {
        console.error('[ChatGPT Curriculum API] Resume card error:', error);
        res.status(500).json({ error: 'Failed to build resume card', detail: error.message });
    }
});

// POST /api/v2/curricula/:id/weekly-load
// Returns adjusted weekly load based on progress and learner profile
router.post('/curricula/:id/weekly-load', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const curriculumId = cleanString(req.params.id);
    const learnerProfileId = cleanString(req.body?.learner_profile_id);

    try {
        // Fetch progress
        const progressResult = await pool.query(
            `select module_id, lesson_id, status, doc_completed_at, updated_at
             from curriculum_progress
             where curriculum_id = CAST($1 AS uuid) and user_id = CAST($2 AS uuid)`,
            [curriculumId, req.userId]
        );

        // Fetch learner profile for personalization-aware adjustment
        let derivedLearningProfile = {};
        let baseLoadMinutes = Number(req.body?.base_minutes) || 60;
        if (learnerProfileId) {
            const lpResult = await pool.query(
                `select derived_learning_profile, raw_profile from learner_profiles
                 where id = CAST($1 AS uuid) order by version desc limit 1`,
                [learnerProfileId]
            );
            if (lpResult.rowCount) {
                derivedLearningProfile = asObject(lpResult.rows[0].derived_learning_profile);
                const lifestyle = asObject(asObject(lpResult.rows[0].raw_profile).lifestyle);
                if (lifestyle.weekly_capacity_min) {
                    baseLoadMinutes = Math.round(Number(lifestyle.weekly_capacity_min) * 0.67);
                }
            }
        }

        const loadResult = adjustWeeklyLoad({
            progress: progressResult.rows,
            derivedLearningProfile,
            baseLoadMinutes,
        });

        writeAuditLog(req, 'weekly_load_adjusted', {
            curriculum_id: curriculumId,
            adjustment: loadResult.adjustment,
        });

        res.json({ ok: true, ...loadResult });
    } catch (error) {
        console.error('[ChatGPT Curriculum API] Weekly load error:', error);
        res.status(500).json({ error: 'Failed to adjust weekly load', detail: error.message });
    }
});

// GET /api/v2/curricula/:id/summary-cards
// Returns key-point summary cards per lesson
router.get('/curricula/:id/summary-cards', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const curriculumId = cleanString(req.params.id);
    try {
        const result = await pool.query(
            `select cv.content_json from curricula c
             join curriculum_versions cv on cv.id = c.current_version_id
             where c.id = CAST($1 AS uuid)`,
            [curriculumId]
        );
        if (!result.rowCount) return res.status(404).json({ error: 'Curriculum not found' });

        const cards = buildSummaryCards({ curriculum: asObject(result.rows[0].content_json) });
        res.json({ ok: true, cards });
    } catch (error) {
        console.error('[ChatGPT Curriculum API] Summary cards error:', error);
        res.status(500).json({ error: 'Failed to build summary cards', detail: error.message });
    }
});

// GET /api/v2/curricula/:id/weekly-digest
// Returns weekly digest with stats and next actions
router.get('/curricula/:id/weekly-digest', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const curriculumId = cleanString(req.params.id);
    const weekNumber = Number(req.query?.week) || 1;

    try {
        const [currResult, progressResult] = await Promise.all([
            pool.query(
                `select cv.content_json from curricula c
                 join curriculum_versions cv on cv.id = c.current_version_id
                 where c.id = CAST($1 AS uuid)`,
                [curriculumId]
            ),
            pool.query(
                `select module_id, lesson_id, status, doc_completed_at, updated_at
                 from curriculum_progress
                 where curriculum_id = CAST($1 AS uuid) and user_id = CAST($2 AS uuid)`,
                [curriculumId, req.userId]
            ),
        ]);
        if (!currResult.rowCount) return res.status(404).json({ error: 'Curriculum not found' });

        const digest = buildWeeklyDigest({
            curriculum: asObject(currResult.rows[0].content_json),
            progress: progressResult.rows,
            weekNumber,
        });
        res.json({ ok: true, ...digest });
    } catch (error) {
        console.error('[ChatGPT Curriculum API] Weekly digest error:', error);
        res.status(500).json({ error: 'Failed to build weekly digest', detail: error.message });
    }
});

// GET /api/v2/curricula/:id/encyclopedia
// Returns mini encyclopedia (ミニ図鑑) overview of the curriculum
router.get('/curricula/:id/encyclopedia', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const curriculumId = cleanString(req.params.id);
    try {
        const result = await pool.query(
            `select cv.content_json from curricula c
             join curriculum_versions cv on cv.id = c.current_version_id
             where c.id = CAST($1 AS uuid)`,
            [curriculumId]
        );
        if (!result.rowCount) return res.status(404).json({ error: 'Curriculum not found' });

        const encyclopedia = buildMiniEncyclopedia({ curriculum: asObject(result.rows[0].content_json) });
        res.json({ ok: true, ...encyclopedia });
    } catch (error) {
        console.error('[ChatGPT Curriculum API] Encyclopedia error:', error);
        res.status(500).json({ error: 'Failed to build encyclopedia', detail: error.message });
    }
});

// ===================== Learning Journal =====================

// POST /api/v2/curricula/:id/journal
// Save a lesson reflection
router.post('/curricula/:id/journal', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const curriculumId = cleanString(req.params.id);
    const entry = {
        curriculum_id: curriculumId,
        module_id: cleanString(req.body?.module_id),
        lesson_id: cleanString(req.body?.lesson_id),
        learned: cleanString(req.body?.learned),
        difficulty: cleanString(req.body?.difficulty),
        mood: cleanString(req.body?.mood) || null,
        confidence: req.body?.confidence != null ? Number(req.body.confidence) : null,
        time_spent_min: req.body?.time_spent_min != null ? Number(req.body.time_spent_min) : null,
    };

    const validation = validateJournalEntry(entry);
    if (!validation.valid) {
        return res.status(422).json({ error: 'Invalid journal entry', details: validation.errors });
    }

    try {
        // Phase 7: ensurePhase1User removed
        const result = await pool.query(
            `insert into learning_journal
                (user_id, curriculum_id, module_id, lesson_id, learned, difficulty, mood, confidence, time_spent_min)
             values (CAST($1 AS uuid), CAST($2 AS uuid), $3, $4, $5, $6, $7, $8, $9)
             returning id, created_at`,
            [req.userId, curriculumId, entry.module_id, entry.lesson_id,
             entry.learned || null, entry.difficulty || null, entry.mood,
             entry.confidence, entry.time_spent_min]
        );
        res.json({ ok: true, journal_entry_id: result.rows[0].id, created_at: result.rows[0].created_at });
    } catch (error) {
        console.error('[ChatGPT Curriculum API] Journal save error:', error);
        res.status(500).json({ error: 'Failed to save journal entry', detail: error.message });
    }
});

// GET /api/v2/curricula/:id/journal
// Get journal entries and summary for a curriculum
router.get('/curricula/:id/journal', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const curriculumId = cleanString(req.params.id);
    try {
        const result = await pool.query(
            `select module_id, lesson_id, learned, difficulty, mood, confidence, time_spent_min, created_at
             from learning_journal
             where curriculum_id = CAST($1 AS uuid) and user_id = CAST($2 AS uuid)
             order by created_at desc`,
            [curriculumId, req.userId]
        );
        const summary = buildJournalSummary({ entries: result.rows });
        res.json({ ok: true, ...summary });
    } catch (error) {
        console.error('[ChatGPT Curriculum API] Journal fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch journal', detail: error.message });
    }
});

// GET /api/v2/journal/recent
// Get recent journal entries across all curricula
router.get('/journal/recent', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const limit = Math.min(Number(req.query?.limit) || 10, 50);
    try {
        const result = await pool.query(
            `select j.curriculum_id, j.module_id, j.lesson_id, j.learned, j.difficulty,
                    j.mood, j.confidence, j.time_spent_min, j.created_at,
                    c.title as curriculum_title
             from learning_journal j
             left join curricula c on c.id = j.curriculum_id
             where j.user_id = CAST($1 AS uuid)
             order by j.created_at desc limit $2`,
            [req.userId, limit]
        );
        res.json({ ok: true, entries: result.rows });
    } catch (error) {
        console.error('[ChatGPT Curriculum API] Recent journal error:', error);
        res.status(500).json({ error: 'Failed to fetch recent journal', detail: error.message });
    }
});

// GET /api/v2/adaptation
// Get adaptive learning signals for the current user
router.get('/adaptation', requireBridgeOrAuth, async (req, res) => {
    try {
        const signals = await getAdaptationSignals({
            userId: req.userId,
            curriculumId: cleanString(req.query?.curriculum_id) || undefined,
            moduleId: cleanString(req.query?.module_id) || undefined,
        });
        if (signals.error) {
            return res.status(503).json({ ok: false, error: signals.error });
        }
        res.json({ ok: true, ...signals });
    } catch (error) {
        console.error('[ChatGPT Curriculum API] Adaptation signals error:', error);
        res.status(500).json({ error: 'Failed to get adaptation signals', detail: error.message });
    }
});

router.post('/curricula/:id/publish', requireBridgeOrAuth, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB not configured' });

    const curriculumId = cleanString(req.params.id);
    const curriculumVersionId = cleanString(req.body?.curriculum_version_id);
    if (!curriculumVersionId) {
        return res.status(400).json({ error: 'curriculum_version_id required' });
    }

    const client = await pool.connect();
    try {
        // Phase 7: ensurePhase1User removed
        await client.query('BEGIN');

        const existing = await client.query(
            `select c.id as curriculum_id, v.id as curriculum_version_id
             from curricula c
             join curriculum_versions v on v.curriculum_id = c.id
             where c.id = CAST($1 AS uuid)
               and v.id = CAST($2 AS uuid)
               and c.user_id = CAST($3 AS uuid)`,
            [curriculumId, curriculumVersionId, req.userId]
        );
        if (!existing.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Curriculum version not found' });
        }

        await client.query(
            `update curriculum_versions
             set status = case when id = CAST($1 AS uuid) then 'published'
                               when curriculum_id = CAST($2 AS uuid) and status = 'published' then 'approved'
                               else status end,
                 updated_at = now()
             where curriculum_id = CAST($2 AS uuid)`,
            [curriculumVersionId, curriculumId]
        );

        const published = await client.query(
            `update curricula
             set current_version_id = CAST($1 AS uuid),
                 updated_at = now()
             where id = CAST($2 AS uuid)
             returning updated_at`,
            [curriculumVersionId, curriculumId]
        );

        await client.query('COMMIT');

        const publishedAt = published.rows[0]?.updated_at || new Date().toISOString();
        writeAuditLog(req, 'curriculum_published', {
            curriculum_id: curriculumId,
            curriculum_version_id: curriculumVersionId,
        });

        return res.json({
            ok: true,
            status: 'published',
            published_at: publishedAt,
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[ChatGPT Curriculum API] Publish error:', error);
        return res.status(500).json({ error: 'Failed to publish curriculum', detail: error.message });
    } finally {
        client.release();
    }
});

export default router;
