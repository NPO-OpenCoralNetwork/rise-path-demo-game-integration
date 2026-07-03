/**
 * Learner memory REST API helpers — Phase 19-3
 */
import {
    deepMergePreferences,
} from './userPreferences.js';
import {
    extractAiMemoryPreferences,
    loadAiMemoryPreferences,
} from './learnerMemoryPrivacy.js';
import {
    rememberForLearner,
    listRecentMemories,
    deleteLearnerMemory,
    purgeLearnerMemories,
    seedAssessmentMemories,
    CONTENT_MAX_LEN,
} from './learnerMemoryBridge.js';
export const MEMORY_EXPORT_SCHEMA_VERSION = '2026-06-24-memory-v1';
export const DELETE_CONFIRM_TOKEN = 'DELETE';

const VALID_MEMORY_TYPES = new Set([
    'fact', 'preference', 'goal', 'decision', 'artifact', 'learning',
    'event', 'instruction', 'relationship', 'context', 'observation',
    'commitment', 'error',
]);

export function validateAiMemoryPrivacyPatch(patch) {
    if (patch === undefined || patch === null) {
        return { valid: false, errors: ['privacy patch is required'] };
    }
    if (typeof patch !== 'object' || Array.isArray(patch)) {
        return { valid: false, errors: ['privacy patch must be an object'] };
    }

    const errors = [];
    if (patch.enabled != null && typeof patch.enabled !== 'boolean') {
        errors.push('enabled must be a boolean');
    }
    if (patch.allow_conversation_capture != null && typeof patch.allow_conversation_capture !== 'boolean') {
        errors.push('allow_conversation_capture must be a boolean');
    }

    return { valid: errors.length === 0, errors };
}

export function validateRememberMemoryBody(body) {
    const errors = [];
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) errors.push('content is required');
    if (content.length > CONTENT_MAX_LEN) {
        errors.push(`content exceeds ${CONTENT_MAX_LEN} characters`);
    }

    const type = body?.type ?? 'preference';
    if (!VALID_MEMORY_TYPES.has(type)) {
        errors.push(`invalid memory type: ${type}`);
    }

    if (body?.confidence != null) {
        const confidence = Number(body.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
            errors.push('confidence must be between 0 and 1');
        }
    }

    if (body?.tags != null) {
        if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string')) {
            errors.push('tags must be an array of strings');
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        parsed: {
            content,
            type,
            confidence: body?.confidence,
            tags: body?.tags,
        },
    };
}

export function validatePurgeLearnerMemoryBody(body) {
    const confirm = typeof body?.confirm === 'string' ? body.confirm.trim() : '';
    if (confirm !== DELETE_CONFIRM_TOKEN) {
        return {
            valid: false,
            errors: [`confirm must be "${DELETE_CONFIRM_TOKEN}"`],
        };
    }
    return { valid: true, errors: [], parsed: { confirm } };
}

export function mapBridgeResultToHttpStatus(result) {
    if (!result?.error_type) return 200;
    switch (result.error_type) {
        case 'ai_memory_not_allowed': return 403;
        case 'not_found': return 404;
        case 'validation': return 422;
        case 'service_unavailable':
        case 'db_connection':
            return 503;
        default:
            return 500;
    }
}

async function loadUserPreferences(pool, userId) {
    const result = await pool.query(
        'SELECT preferences FROM user_profiles WHERE user_id = $1',
        [userId],
    );
    if (!result.rowCount) {
        return {};
    }
    const preferences = result.rows[0].preferences;
    return preferences && typeof preferences === 'object' && !Array.isArray(preferences)
        ? preferences
        : {};
}

async function saveUserPreferences(pool, userId, preferences) {
    await pool.query(
        `INSERT INTO user_profiles (user_id, display_name, preferences)
         VALUES ($1, 'Learner', $2::jsonb)
         ON CONFLICT (user_id) DO UPDATE
         SET preferences = EXCLUDED.preferences, updated_at = NOW()`,
        [userId, JSON.stringify(preferences)],
    );
}

async function fetchLatestLearnerProfileForSeed(pool, userId) {
    const result = await pool.query(
        `SELECT version, assessment_type, raw_profile, derived_learning_profile, applied_rules
         FROM learner_profiles
         WHERE user_id = CAST($1 AS uuid)
         ORDER BY version DESC
         LIMIT 1`,
        [userId],
    );
    if (!result.rowCount) return null;

    const row = result.rows[0];
    return {
        profileVersion: row.version,
        assessmentType: row.assessment_type,
        rawProfile: row.raw_profile,
        derivedLearningProfile: row.derived_learning_profile,
        appliedRules: row.applied_rules,
    };
}

export async function getAiMemoryPrivacySettings(pool, userId) {
    const privacy = await loadAiMemoryPreferences(pool, userId);
    return { ok: true, privacy };
}

export async function updateAiMemoryPrivacySettings(pool, userId, patch) {
    const validation = validateAiMemoryPrivacyPatch(patch);
    if (!validation.valid) {
        return { error: 'Invalid privacy patch', error_type: 'validation', details: validation.errors };
    }

    const previous = await loadAiMemoryPreferences(pool, userId);
    const nextEnabled = patch.enabled ?? previous.enabled;
    const nextCapture = nextEnabled
        ? (patch.allow_conversation_capture ?? previous.allow_conversation_capture)
        : false;

    const existing = await loadUserPreferences(pool, userId);
    const merged = deepMergePreferences(existing, {
        privacy: {
            ai_memory: {
                enabled: nextEnabled,
                allow_conversation_capture: nextCapture,
            },
        },
    });

    await saveUserPreferences(pool, userId, merged);

    const privacy = extractAiMemoryPreferences(merged);
    const seedTriggered = previous.enabled !== true && privacy.enabled === true;

    if (seedTriggered) {
        const profile = await fetchLatestLearnerProfileForSeed(pool, userId);
        if (profile) {
            seedAssessmentMemories({ pool, userId, profile }).catch((err) => {
                console.error('[learnerMemoryApi] lazy assessment seed failed:', err);
            });
        }
    }

    return {
        ok: true,
        privacy,
        seed_triggered: seedTriggered,
    };
}

export async function listLearnerMemoriesForApi({ pool, userId, limit = 50 }) {
    const parsedLimit = Number(limit);
    const effectiveLimit = Number.isFinite(parsedLimit)
        ? Math.min(100, Math.max(1, parsedLimit))
        : 50;

    const result = await listRecentMemories({
        pool,
        userId,
        limit: effectiveLimit,
    });

    if (result.error_type) return result;

    return {
        ok: true,
        count: result.count ?? 0,
        memories: result.memories ?? [],
        semantic_memory_status: result.semantic_memory_status ?? 'disabled',
    };
}

export async function rememberLearnerMemoryForApi({ pool, userId, body }) {
    const validation = validateRememberMemoryBody(body);
    if (!validation.valid) {
        return { error: 'Invalid remember request', error_type: 'validation', details: validation.errors };
    }

    const { content, type, confidence, tags } = validation.parsed;
    return rememberForLearner({
        pool,
        userId,
        content,
        type,
        confidence: confidence ?? 0.9,
        tags,
        provenance: 'explicit_statement',
        source: 'rise-path-ui',
    });
}

export async function deleteLearnerMemoryForApi({ pool, userId, memoryId }) {
    return deleteLearnerMemory({ pool, userId, memoryId });
}

export async function purgeAllLearnerMemoriesForApi({ pool, userId }) {
    return purgeLearnerMemories({ pool, userId });
}

export async function buildSemanticMemoriesExportSection({ pool, userId }) {
    const enabled = await loadAiMemoryPreferences(pool, userId);
    if (!enabled.enabled) {
        return null;
    }

    const listed = await listRecentMemories({ pool, userId, limit: 100 });
    const items = (listed.memories ?? []).map((memory) => ({
        id: memory.id,
        type: memory.type,
        title: memory.title,
        content: memory.content,
        confidence: memory.confidence,
        tags: memory.tags,
        created_at: memory.created_at,
    }));

    return {
        schema_version: MEMORY_EXPORT_SCHEMA_VERSION,
        exported_at: new Date().toISOString(),
        count: items.length,
        items,
        semantic_memory_status: listed.semantic_memory_status ?? 'disabled',
    };
}