/**
 * Learner semantic memory bridge — Memanto REST client (Phase 19).
 */
import { getAnalysis } from '../../tools/core/lifeJournal.js';
import { shiftDate } from '../../tools/core/lifeJournalWeekly.js';
import { deriveGenerationRules } from './personalizationDeriver.js';
import { isAiMemoryEnabled, loadAiMemoryPreferences } from './learnerMemoryPrivacy.js';
import { DEFAULT_TIMEZONE, getTodayInTimezone } from './lifeJournalService.js';

export const AGENT_ID_PREFIX = 'rp-user-';
export const CONTENT_MAX_LEN = 2000;
export const DEFAULT_RECALL_LIMIT = 8;
export const DEFAULT_MIN_SIMILARITY = 0.35;

const BLOCKED_WRITE_SOURCES = new Set(['cron', 'subagent', 'scheduled', 'batch']);
const EXPLICIT_CAPTURE_PROVENANCES = new Set([
    'explicit_statement', 'validated', 'corrected', 'imported',
]);
const EXPLICIT_CAPTURE_SOURCES = new Set(['rise-path-ui', 'rise-path', 'habit-sync']);
export const HABIT_SYNC_DAYS = 30;
export const HABIT_SYNC_MAX_MEMORIES = 3;
export const HABIT_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const HABIT_RULE_TAG_PREFIX = 'habit-rule:';

const VALID_MEMORY_TYPES = new Set([
    'fact', 'preference', 'goal', 'decision', 'artifact', 'learning',
    'event', 'instruction', 'relationship', 'context', 'observation',
    'commitment', 'error',
]);

let memantoFetch = globalThis.fetch;
let habitAnalysisProvider = getAnalysis;

export function setMemantoFetchForTests(fetchFn) {
    memantoFetch = fetchFn ?? globalThis.fetch;
}

export function setHabitAnalysisProviderForTests(provider) {
    habitAnalysisProvider = provider ?? getAnalysis;
}

export function buildLearnerAgentId(userId) {
    const id = String(userId || '').trim().toLowerCase();
    if (!id) throw new Error('userId is required');
    return `${AGENT_ID_PREFIX}${id}`;
}

export function isMemantoEnabled() {
    if (process.env.MEMANTO_ENABLED === 'false') return false;
    return Boolean(process.env.MEMANTO_API_URL?.trim());
}

function memantoApiBase() {
    const base = process.env.MEMANTO_API_URL?.trim().replace(/\/$/, '');
    if (!base) return null;
    return `${base}/api/v2`;
}

function sessionTtlMs() {
    const hours = Number(process.env.MEMANTO_SESSION_DURATION_HOURS || 24);
    return Math.max(1, hours) * 60 * 60 * 1000;
}

function minConfidenceWrite() {
    return Number(process.env.MEMANTO_MIN_CONFIDENCE_WRITE || 0.7);
}

function defaultRecallLimit() {
    const n = Number(process.env.MEMANTO_RECALL_LIMIT || DEFAULT_RECALL_LIMIT);
    return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : DEFAULT_RECALL_LIMIT;
}

const sessionCache = new Map();

function cacheSession(userId, sessionToken, expiresAt) {
    sessionCache.set(userId, {
        sessionToken,
        expiresAt: expiresAt ? new Date(expiresAt).getTime() : Date.now() + sessionTtlMs(),
    });
}

function invalidateSession(userId) {
    sessionCache.delete(userId);
}

function getCachedSession(userId) {
    const entry = sessionCache.get(userId);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt - 60_000) {
        invalidateSession(userId);
        return null;
    }
    return entry.sessionToken;
}

function isSessionAuthError(err) {
    return err?.status === 401 || err?.status === 403;
}

async function withSession(agentId, userId, fn) {
    let sessionToken = await activateAgent(agentId, userId);
    try {
        return await fn(sessionToken);
    } catch (err) {
        if (!isSessionAuthError(err)) throw err;
        invalidateSession(userId);
        sessionToken = await activateAgent(agentId, userId);
        return await fn(sessionToken);
    }
}

async function memantoRequest(path, { method = 'GET', body, sessionToken } = {}) {
    const apiBase = memantoApiBase();
    if (!apiBase) {
        const err = new Error('Memanto is not configured');
        err.code = 'memanto_unavailable';
        throw err;
    }

    const headers = { Accept: 'application/json' };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    if (sessionToken) {
        headers['X-Session-Token'] = sessionToken;
    }

    const res = await memantoFetch(`${apiBase}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let payload = null;
    try {
        payload = await res.json();
    } catch {
        payload = null;
    }

    if (!res.ok) {
        const message = payload?.detail?.message
            || payload?.detail
            || payload?.message
            || `Memanto ${method} ${path} failed (${res.status})`;
        const err = new Error(typeof message === 'string' ? message : JSON.stringify(message));
        err.status = res.status;
        err.payload = payload;
        throw err;
    }

    return payload;
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createMemantoAgent(agentId, { retries = 3 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
            await memantoRequest('/agents', {
                method: 'POST',
                body: {
                    agent_id: agentId,
                    pattern: 'support',
                    description: 'Rise Path learner semantic memory',
                },
            });
            return;
        } catch (err) {
            if (err.status === 409) return;
            lastErr = err;
            const retriable = !err.status || err.status >= 500;
            if (retriable && attempt < retries - 1) {
                await sleep(400 * (attempt + 1));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

async function activateAgent(agentId, userId) {
    const cached = getCachedSession(userId);
    if (cached) return cached;

    const payload = await memantoRequest(`/agents/${encodeURIComponent(agentId)}/activate`, {
        method: 'POST',
    });
    cacheSession(userId, payload.session_token, payload.expires_at);
    return payload.session_token;
}

export async function ensureLearnerAgent({ pool, userId }) {
    if (!pool || !userId) {
        return { error: 'userId and pool are required', error_type: 'validation' };
    }

    const agentId = buildLearnerAgentId(userId);

    const existing = await pool.query(
        'SELECT memanto_agent_id FROM learner_memory_meta WHERE user_id = $1',
        [userId],
    );
    if (existing.rowCount) {
        return { ok: true, agent_id: existing.rows[0].memanto_agent_id };
    }

    if (isMemantoEnabled()) {
        try {
            await createMemantoAgent(agentId);
        } catch (err) {
            console.error('[learnerMemoryBridge] create agent failed:', err.message);
            return { error: 'Semantic memory service unavailable', error_type: 'service_unavailable' };
        }
    }

    await pool.query(
        `INSERT INTO learner_memory_meta (user_id, memanto_agent_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, agentId],
    );

    return { ok: true, agent_id: agentId };
}

function normalizeMemory(memory) {
    if (!memory || typeof memory !== 'object') return null;
    return {
        id: memory.id,
        type: memory.type,
        title: memory.title ?? null,
        content: memory.content,
        confidence: memory.confidence,
        tags: memory.tags ?? [],
        score: memory.score ?? null,
        created_at: memory.created_at ?? null,
    };
}

function isBlockedWriteSource(source) {
    const normalized = String(source || '').trim().toLowerCase();
    if (!normalized) return false;
    if (BLOCKED_WRITE_SOURCES.has(normalized)) return true;
    return normalized.includes('subagent') || normalized.includes('cron');
}

function requiresConversationCapture({ provenance, source }) {
    const normalizedProvenance = String(provenance || 'explicit_statement').trim().toLowerCase();
    if (EXPLICIT_CAPTURE_PROVENANCES.has(normalizedProvenance)) return false;

    const normalizedSource = String(source || '').trim().toLowerCase();
    if (EXPLICIT_CAPTURE_SOURCES.has(normalizedSource)) return false;

    return true;
}

export async function rememberForLearner({
    pool,
    userId,
    content,
    type = 'fact',
    confidence = 0.85,
    tags,
    provenance = 'explicit_statement',
    source = 'rise-path',
    title,
}) {
    if (!pool || !userId) {
        return { error: 'userId and pool are required', error_type: 'validation' };
    }

    if (isBlockedWriteSource(source)) {
        return { ok: true, skipped: true, reason: 'context_not_allowed' };
    }

    const text = String(content || '').trim();
    if (!text) {
        return { error: 'content is required', error_type: 'validation' };
    }
    if (text.length > CONTENT_MAX_LEN) {
        return { error: `content exceeds ${CONTENT_MAX_LEN} characters`, error_type: 'validation' };
    }
    if (!VALID_MEMORY_TYPES.has(type)) {
        return { error: `invalid memory type: ${type}`, error_type: 'validation' };
    }
    if (confidence < minConfidenceWrite()) {
        return {
            error: `confidence must be >= ${minConfidenceWrite()}`,
            error_type: 'validation',
        };
    }

    const enabled = await isAiMemoryEnabled(pool, userId);
    if (!enabled) {
        return { error: 'AI memory not allowed', error_type: 'ai_memory_not_allowed' };
    }

    const privacy = await loadAiMemoryPreferences(pool, userId);
    if (!privacy.allow_conversation_capture && requiresConversationCapture({ provenance, source })) {
        return { ok: true, skipped: true, reason: 'conversation_capture_disabled' };
    }

    if (!isMemantoEnabled()) {
        return { error: 'Semantic memory service unavailable', error_type: 'service_unavailable' };
    }

    const agentResult = await ensureLearnerAgent({ pool, userId });
    if (agentResult.error_type) return agentResult;
    const agentId = agentResult.agent_id;

    try {
        const payload = await withSession(agentId, userId, (sessionToken) => memantoRequest(
            `/agents/${encodeURIComponent(agentId)}/remember`,
            {
                method: 'POST',
                sessionToken,
                body: {
                    content: text,
                    type,
                    confidence,
                    tags: tags ?? undefined,
                    provenance,
                    source,
                    title: title ?? undefined,
                },
            },
        ));

        await pool.query(
            `UPDATE learner_memory_meta
             SET memory_count_estimate = memory_count_estimate + 1,
                 updated_at = NOW()
             WHERE user_id = $1`,
            [userId],
        );

        return {
            ok: true,
            agent_id: agentId,
            memory_id: payload.memory_id,
            status: payload.status,
        };
    } catch (err) {
        if (err.code === 'memanto_unavailable') {
            return { error: 'Semantic memory service unavailable', error_type: 'service_unavailable' };
        }
        console.error('[learnerMemoryBridge] remember failed:', err.message);
        return { error: 'Semantic memory service unavailable', error_type: 'service_unavailable' };
    }
}

export async function recallForLearner({
    pool,
    userId,
    query,
    limit,
    type,
    minSimilarity,
}) {
    if (!pool || !userId) {
        return { error: 'userId and pool are required', error_type: 'validation' };
    }

    const agentId = buildLearnerAgentId(userId);
    const enabled = await isAiMemoryEnabled(pool, userId);
    if (!enabled) {
        return {
            ok: true,
            agent_id: agentId,
            count: 0,
            memories: [],
            semantic_memory_status: 'disabled',
        };
    }

    if (!isMemantoEnabled()) {
        return {
            ok: true,
            agent_id: agentId,
            count: 0,
            memories: [],
            semantic_memory_status: 'degraded',
        };
    }

    const q = String(query || '').trim();
    if (!q) {
        return { error: 'query is required', error_type: 'validation' };
    }

    const agentResult = await ensureLearnerAgent({ pool, userId });
    if (agentResult.error_type) {
        return {
            ok: true,
            agent_id: agentId,
            count: 0,
            memories: [],
            semantic_memory_status: 'degraded',
        };
    }

    try {
        const payload = await withSession(agentId, userId, (sessionToken) => memantoRequest(
            `/agents/${encodeURIComponent(agentId)}/recall`,
            {
                method: 'POST',
                sessionToken,
                body: {
                    query: q,
                    limit: limit ?? defaultRecallLimit(),
                    min_similarity: minSimilarity ?? DEFAULT_MIN_SIMILARITY,
                    type: type ?? undefined,
                },
            },
        ));

        const memories = (payload.memories ?? [])
            .map(normalizeMemory)
            .filter(Boolean);

        return {
            ok: true,
            agent_id: agentId,
            count: memories.length,
            memories,
            semantic_memory_status: 'ok',
        };
    } catch (err) {
        console.error('[learnerMemoryBridge] recall failed:', err.message);
        return {
            ok: true,
            agent_id: agentId,
            count: 0,
            memories: [],
            semantic_memory_status: 'degraded',
        };
    }
}

export async function listRecentMemories({ pool, userId, limit = 50, type }) {
    if (!pool || !userId) {
        return { error: 'userId and pool are required', error_type: 'validation' };
    }

    const agentId = buildLearnerAgentId(userId);
    const enabled = await isAiMemoryEnabled(pool, userId);
    if (!enabled) {
        return {
            ok: true,
            agent_id: agentId,
            count: 0,
            memories: [],
            semantic_memory_status: 'disabled',
        };
    }

    if (!isMemantoEnabled()) {
        return {
            ok: true,
            agent_id: agentId,
            count: 0,
            memories: [],
            semantic_memory_status: 'degraded',
        };
    }

    const agentResult = await ensureLearnerAgent({ pool, userId });
    if (agentResult.error_type) {
        return {
            ok: true,
            agent_id: agentId,
            count: 0,
            memories: [],
            semantic_memory_status: 'degraded',
        };
    }

    try {
        const payload = await withSession(agentId, userId, (sessionToken) => memantoRequest(
            `/agents/${encodeURIComponent(agentId)}/recall/recent`,
            {
                method: 'POST',
                sessionToken,
                body: {
                    limit,
                    type: type ?? undefined,
                },
            },
        ));

        const memories = (payload.memories ?? [])
            .map(normalizeMemory)
            .filter(Boolean);

        return {
            ok: true,
            agent_id: agentId,
            count: memories.length,
            memories,
            semantic_memory_status: 'ok',
        };
    } catch (err) {
        console.error('[learnerMemoryBridge] listRecent failed:', err.message);
        return {
            ok: true,
            agent_id: agentId,
            count: 0,
            memories: [],
            semantic_memory_status: 'degraded',
        };
    }
}

export async function deleteLearnerMemory({ pool, userId, memoryId }) {
    if (!pool || !userId || !memoryId) {
        return { error: 'userId, pool, and memoryId are required', error_type: 'validation' };
    }

    const enabled = await isAiMemoryEnabled(pool, userId);
    if (!enabled) {
        return { error: 'AI memory not allowed', error_type: 'ai_memory_not_allowed' };
    }

    if (!isMemantoEnabled()) {
        return { error: 'Semantic memory service unavailable', error_type: 'service_unavailable' };
    }

    const agentId = buildLearnerAgentId(userId);
    const agentResult = await ensureLearnerAgent({ pool, userId });
    if (agentResult.error_type) {
        return { error: 'Semantic memory service unavailable', error_type: 'service_unavailable' };
    }

    try {
        await withSession(agentId, userId, (sessionToken) => memantoRequest(
            `/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(memoryId)}`,
            { method: 'DELETE', sessionToken },
        ));

        await pool.query(
            `UPDATE learner_memory_meta
             SET memory_count_estimate = GREATEST(0, memory_count_estimate - 1),
                 updated_at = NOW()
             WHERE user_id = $1`,
            [userId],
        );

        return { ok: true, agent_id: agentId, memory_id: memoryId, status: 'deleted' };
    } catch (err) {
        if (err.status === 404) {
            return { error: 'Memory not found', error_type: 'not_found' };
        }
        return { error: 'Semantic memory service unavailable', error_type: 'service_unavailable' };
    }
}

export async function purgeLearnerMemories({ pool, userId }) {
    if (!pool || !userId) {
        return { error: 'userId and pool are required', error_type: 'validation' };
    }

    const agentId = buildLearnerAgentId(userId);

    if (isMemantoEnabled()) {
        try {
            await memantoRequest(
                `/agents/${encodeURIComponent(agentId)}?delete-backup-too=true`,
                { method: 'DELETE' },
            );
        } catch (err) {
            if (err.status !== 404) {
                return { error: 'Semantic memory service unavailable', error_type: 'service_unavailable' };
            }
        }
    }

    await pool.query('DELETE FROM learner_memory_meta WHERE user_id = $1', [userId]);
    invalidateSession(userId);

    return { ok: true, agent_id: agentId, status: 'purged' };
}

function formatBigFiveFact(assessmentType, rawProfile) {
    const bf = rawProfile?.big_five ?? {};
    return `Big Five (${assessmentType}): O=${bf.openness} C=${bf.conscientiousness} E=${bf.extraversion} A=${bf.agreeableness} N=${bf.neuroticism}`;
}

function formatDerivedLearningSummary(derivedLearningProfile, rawProfile) {
    const derived = derivedLearningProfile ?? {};
    const axes = Object.entries(derived)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
    const style = rawProfile?.learning_style ?? 'unknown';
    const motivation = rawProfile?.motivation ?? 'unknown';
    const declared = rawProfile?.declared_preferences ?? {};
    const assessmentPref = declared.assessment_preference ?? 'unspecified';
    const explanationStyle = declared.explanation_style ?? 'unspecified';
    return `Prefers ${explanationStyle} explanations; derived axes: ${axes}; learning_style=${style}; motivation=${motivation}; assessment_preference=${assessmentPref}`;
}

function formatGenerationRulesSummary(derivedLearningProfile, rawProfile) {
    const rules = deriveGenerationRules(derivedLearningProfile, rawProfile);
    const weekly = rules.weekly_load_policy ?? {};
    return `Generation rules: explanation_style=${rules.explanation_style}, assessment_style=${rules.assessment_style}, curriculum_voice=${rules.curriculum_voice}, session_length=medium, visual_aids=high, weekly_target_min=${weekly.target_minutes_per_week}`;
}

export function buildAssessmentSeedMemories(profile) {
    const {
        assessmentType = 'big_five_v1',
        rawProfile = {},
        derivedLearningProfile = {},
    } = profile ?? {};

    return [
        {
            content: formatBigFiveFact(assessmentType, rawProfile),
            type: 'fact',
            confidence: 1.0,
            tags: ['assessment', 'big-five'],
            provenance: 'validated',
            source: 'assessment-seed',
        },
        {
            content: formatDerivedLearningSummary(derivedLearningProfile, rawProfile),
            type: 'learning',
            confidence: 0.9,
            tags: ['assessment', 'learning-style'],
            provenance: 'validated',
            source: 'assessment-seed',
        },
        {
            content: formatGenerationRulesSummary(derivedLearningProfile, rawProfile),
            type: 'learning',
            confidence: 0.9,
            tags: ['assessment', 'generation-rules'],
            provenance: 'validated',
            source: 'assessment-seed',
        },
    ];
}

export async function seedAssessmentMemories({ pool, userId, profile }) {
    if (!pool || !userId) {
        return { error: 'userId and pool are required', error_type: 'validation' };
    }

    const enabled = await isAiMemoryEnabled(pool, userId);
    if (!enabled) {
        return { ok: true, skipped: true, reason: 'ai_memory_disabled' };
    }

    if (!isMemantoEnabled()) {
        return { ok: true, skipped: true, reason: 'memanto_unavailable' };
    }

    const profileVersion = Number(profile?.profileVersion);
    if (!Number.isFinite(profileVersion) || profileVersion < 1) {
        return { error: 'profileVersion is required', error_type: 'validation' };
    }

    const meta = await pool.query(
        'SELECT assessment_seed_version FROM learner_memory_meta WHERE user_id = $1',
        [userId],
    );
    const seededVersion = meta.rowCount ? meta.rows[0].assessment_seed_version : null;
    if (seededVersion != null && seededVersion >= profileVersion) {
        return { ok: true, skipped: true, reason: 'already_seeded', profile_version: profileVersion };
    }

    const agentResult = await ensureLearnerAgent({ pool, userId });
    if (agentResult.error_type) return agentResult;

    const memories = buildAssessmentSeedMemories(profile);
    const stored = [];

    for (const item of memories) {
        const result = await rememberForLearner({ pool, userId, ...item });
        if (result.error_type) {
            for (const memoryId of stored) {
                try {
                    await deleteLearnerMemory({ pool, userId, memoryId });
                } catch {
                    // best-effort rollback
                }
            }
            return result;
        }
        if (result.skipped) continue;
        stored.push(result.memory_id);
    }

    await pool.query(
        `UPDATE learner_memory_meta
         SET assessment_seed_version = $2,
             last_assessment_seed_at = NOW(),
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId, profileVersion],
    );

    return {
        ok: true,
        seeded: true,
        profile_version: profileVersion,
        memory_ids: stored,
        count: stored.length,
    };
}

export function habitRuleTag(ruleId) {
    return `${HABIT_RULE_TAG_PREFIX}${ruleId}`;
}

function confidenceFromLabel(label) {
    return label === 'medium' ? 0.75 : 0.7;
}

export function buildHabitInsightMemories(analysis) {
    if (!analysis || analysis.error_type) return [];

    const daysLogged = analysis.summary?.days_logged ?? analysis.metrics?.days_logged ?? 0;
    if (analysis.metrics?.insufficient_data || daysLogged < 7) return [];

    const candidates = [];
    const seenRuleIds = new Set();
    const minConfidence = minConfidenceWrite();

    const pushCandidate = (item) => {
        if (candidates.length >= HABIT_SYNC_MAX_MEMORIES) return;
        if (!item.rule_id || seenRuleIds.has(item.rule_id)) return;
        if (item.confidence < minConfidence) return;
        seenRuleIds.add(item.rule_id);
        candidates.push(item);
    };

    for (const correlation of analysis.correlations ?? []) {
        if (correlation.confidence === 'hidden') continue;
        const ruleId = `correlation:${correlation.x}_${correlation.y}`;
        const label = correlation.label ?? `${correlation.x}×${correlation.y}`;
        pushCandidate({
            rule_id: ruleId,
            type: 'observation',
            content: `${label} correlate (r=${correlation.r}, n=${correlation.sample_size})`,
            confidence: confidenceFromLabel(correlation.confidence),
            tags: ['habit-sync', habitRuleTag(ruleId)],
        });
    }

    for (const advice of analysis.advice ?? []) {
        if (!advice.rule_id) continue;
        const content = advice.evidence
            ? `${advice.title}: ${advice.evidence}`
            : (advice.title || advice.rule_id);
        pushCandidate({
            rule_id: advice.rule_id,
            type: 'learning',
            content,
            confidence: confidenceFromLabel(advice.confidence),
            tags: ['habit-sync', habitRuleTag(advice.rule_id)],
        });
    }

    return candidates;
}

function findMemoryByHabitRule(memories, ruleId) {
    const tag = habitRuleTag(ruleId);
    return (memories ?? []).find((memory) => (memory.tags ?? []).includes(tag)) ?? null;
}

async function shouldRunHabitSync(pool, userId) {
    const result = await pool.query(
        'SELECT last_habit_sync_at FROM learner_memory_meta WHERE user_id = $1',
        [userId],
    );
    if (!result.rowCount) return true;

    const lastSync = result.rows[0].last_habit_sync_at;
    if (!lastSync) return true;

    return Date.now() - new Date(lastSync).getTime() >= HABIT_SYNC_INTERVAL_MS;
}

async function tryClaimHabitSync(pool, userId, force = false) {
    if (force === true) {
        await pool.query(
            `UPDATE learner_memory_meta
             SET last_habit_sync_at = NOW(), updated_at = NOW()
             WHERE user_id = $1`,
            [userId],
        );
        return true;
    }

    const result = await pool.query(
        `UPDATE learner_memory_meta
         SET last_habit_sync_at = NOW(), updated_at = NOW()
         WHERE user_id = $1
           AND (
             last_habit_sync_at IS NULL
             OR last_habit_sync_at < NOW() - INTERVAL '7 days'
           )
         RETURNING user_id`,
        [userId],
    );
    return result.rowCount > 0;
}

export async function syncHabitInsightMemories({
    pool,
    userId,
    timezone,
    force = false,
} = {}) {
    if (!pool || !userId) {
        return { error: 'userId and pool are required', error_type: 'validation' };
    }

    const enabled = await isAiMemoryEnabled(pool, userId);
    if (!enabled) {
        return { ok: true, skipped: true, reason: 'ai_memory_disabled' };
    }

    if (!isMemantoEnabled()) {
        return { ok: true, skipped: true, reason: 'memanto_unavailable' };
    }

    if (!force && !(await shouldRunHabitSync(pool, userId))) {
        return { ok: true, skipped: true, reason: 'sync_not_due' };
    }

    const tz = String(timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
    const today = getTodayInTimezone(tz);
    const from = shiftDate(today, -(HABIT_SYNC_DAYS - 1));

    const analysis = await habitAnalysisProvider({
        userId,
        from,
        to: today,
        timezone: tz,
        granularity: 'custom',
    });
    if (analysis.error_type) return analysis;

    const agentResult = await ensureLearnerAgent({ pool, userId });
    if (agentResult.error_type) return agentResult;

    if (!(await tryClaimHabitSync(pool, userId, force))) {
        return { ok: true, skipped: true, reason: 'sync_in_progress' };
    }

    const candidates = buildHabitInsightMemories(analysis);
    if (candidates.length === 0) {
        return {
            ok: true,
            skipped: true,
            reason: 'no_candidates',
            period: { from, to: today, timezone: tz },
        };
    }

    const listed = await listRecentMemories({ pool, userId, limit: 100 });
    if (listed.error_type) return listed;
    if (listed.semantic_memory_status === 'degraded') {
        return { error: 'Semantic memory service unavailable', error_type: 'service_unavailable' };
    }

    const stored = [];
    const updated = [];

    for (const candidate of candidates) {
        const existing = findMemoryByHabitRule(listed.memories, candidate.rule_id);

        const result = await rememberForLearner({
            pool,
            userId,
            content: candidate.content,
            type: candidate.type,
            confidence: candidate.confidence,
            tags: candidate.tags,
            provenance: existing ? 'corrected' : 'validated',
            source: 'habit-sync',
        });

        if (result.error_type) {
            for (const memoryId of stored) {
                try {
                    await deleteLearnerMemory({ pool, userId, memoryId });
                } catch {
                    // best-effort rollback
                }
            }
            return result;
        }
        if (result.skipped) continue;

        if (existing?.id) {
            const deleted = await deleteLearnerMemory({ pool, userId, memoryId: existing.id });
            if (deleted.error_type) {
                console.error('[learnerMemoryBridge] habit sync stale delete failed:', deleted.error);
            } else {
                updated.push(candidate.rule_id);
            }
        }

        if (result.memory_id) stored.push(result.memory_id);
    }

    return {
        ok: true,
        synced: true,
        period: { from, to: today, timezone: tz },
        count: stored.length,
        memory_ids: stored,
        updated_rule_ids: updated,
    };
}

export function clearSessionCacheForTests() {
    sessionCache.clear();
}