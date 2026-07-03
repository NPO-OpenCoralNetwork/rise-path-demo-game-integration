/**
 * Shared Business Logic — Learner semantic memory (Phase 19).
 */
import { getPool } from '../../server/db.js';
import {
    rememberForLearner,
    recallForLearner,
    syncHabitInsightMemories,
    CONTENT_MAX_LEN,
    DEFAULT_MIN_SIMILARITY,
} from '../../server/services/learnerMemoryBridge.js';
import { loadAiMemoryPreferences } from '../../server/services/learnerMemoryPrivacy.js';
import { resolveIncludeDiaryExcerpts } from '../../server/services/lifeJournalPrivacyService.js';
import {
    DEFAULT_TIMEZONE,
    getTodayInTimezone,
    validateTimezone,
} from '../../server/services/lifeJournalService.js';
import { getChatContext } from './lifeJournal.js';
import { shiftDate } from './lifeJournalWeekly.js';

export const DEFAULT_PERSONAL_CONTEXT_DAYS = 30;
export const DEFAULT_RECALL_QUERY = 'user learning preferences habits and goals';
export const MCP_DEFAULT_PROVENANCE = 'inferred';

const TRUSTED_EXPLICIT_SOURCES = new Set([
    'rise-path-ui',
    'hermes-explicit',
    'rise-path-mcp-explicit',
]);

export function resolveMcpRememberProvenance({ provenance, source } = {}) {
    const normalizedSource = String(source || 'rise-path-mcp').trim().toLowerCase();
    const normalizedProvenance = String(provenance ?? MCP_DEFAULT_PROVENANCE).trim().toLowerCase();

    if (normalizedProvenance === 'explicit_statement'
        && !TRUSTED_EXPLICIT_SOURCES.has(normalizedSource)) {
        return {
            error: 'explicit_statement requires a trusted source',
            error_type: 'validation',
        };
    }

    return { provenance: normalizedProvenance, source: normalizedSource };
}

const VALID_MEMORY_TYPES = new Set([
    'fact', 'preference', 'goal', 'decision', 'artifact', 'learning',
    'event', 'instruction', 'relationship', 'context', 'observation',
    'commitment', 'error',
]);

function minConfidenceWrite() {
    return Number(process.env.MEMANTO_MIN_CONFIDENCE_WRITE || 0.7);
}

export async function recallLearnerMemory({
    userId,
    query,
    limit,
    type,
    minSimilarity,
}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const q = String(query || '').trim();
    if (!q) {
        return { error: 'query is required', error_type: 'validation' };
    }
    if (q.length > 1000) {
        return { error: 'query exceeds 1000 characters', error_type: 'validation' };
    }

    if (type != null) {
        const types = Array.isArray(type) ? type : [type];
        for (const t of types) {
            if (!VALID_MEMORY_TYPES.has(t)) {
                return { error: `invalid memory type: ${t}`, error_type: 'validation' };
            }
        }
    }

    const parsedLimit = limit == null ? undefined : Number(limit);
    if (parsedLimit != null && (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)) {
        return { error: 'limit must be between 1 and 100', error_type: 'validation' };
    }

    const parsedSimilarity = minSimilarity == null ? undefined : Number(minSimilarity);
    if (parsedSimilarity != null && (!Number.isFinite(parsedSimilarity) || parsedSimilarity < 0 || parsedSimilarity > 1)) {
        return { error: 'min_similarity must be between 0 and 1', error_type: 'validation' };
    }

    return recallForLearner({
        pool,
        userId,
        query: q,
        limit: parsedLimit,
        type: type ?? undefined,
        minSimilarity: parsedSimilarity ?? DEFAULT_MIN_SIMILARITY,
    });
}

export async function rememberLearnerMemory({
    userId,
    content,
    type = 'preference',
    confidence = 0.9,
    tags,
    provenance,
    source = 'rise-path-mcp',
}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const resolved = resolveMcpRememberProvenance({ provenance, source });
    if (resolved.error_type) return resolved;

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

    const parsedConfidence = Number(confidence);
    if (!Number.isFinite(parsedConfidence) || parsedConfidence < minConfidenceWrite() || parsedConfidence > 1) {
        return {
            error: `confidence must be between ${minConfidenceWrite()} and 1`,
            error_type: 'validation',
        };
    }

    if (tags != null) {
        if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
            return { error: 'tags must be an array of strings', error_type: 'validation' };
        }
    }

    return rememberForLearner({
        pool,
        userId,
        content: text,
        type,
        confidence: parsedConfidence,
        tags,
        provenance: resolved.provenance,
        source: resolved.source,
    });
}

export function resolvePersonalContextPeriod({ from, to, timezone } = {}) {
    const tzCheck = validateTimezone(timezone);
    const tz = tzCheck.valid ? tzCheck.normalized : DEFAULT_TIMEZONE;
    const today = getTodayInTimezone(tz);
    const resolvedTo = String(to || '').trim() || today;
    const resolvedFrom = String(from || '').trim()
        || shiftDate(resolvedTo, -(DEFAULT_PERSONAL_CONTEXT_DAYS - 1));

    return { from: resolvedFrom, to: resolvedTo, timezone: tz };
}

export function mergeLearnerPersonalContext(chatContext, recallResult, { aiMemoryEnabled = false } = {}) {
    if (chatContext?.error_type) return chatContext;

    const semanticStatus = recallResult?.semantic_memory_status ?? 'disabled';
    const semanticMemories = (recallResult?.memories ?? []).map((memory) => ({
        type: memory.type,
        content: memory.content,
        confidence: memory.confidence,
        score: memory.score ?? null,
    }));

    const diaryIncluded = chatContext.privacy?.diary_included === true;
    const aiMemoryIncluded = aiMemoryEnabled === true && semanticStatus === 'ok';

    let dataClass = 'aggregated_only';
    if (diaryIncluded && aiMemoryIncluded) {
        dataClass = 'aggregated_with_semantic_memory';
    } else if (diaryIncluded) {
        dataClass = chatContext.privacy?.data_class ?? 'aggregated_with_excerpts';
    } else if (aiMemoryIncluded) {
        dataClass = 'aggregated_with_semantic_memory';
    }

    return {
        ok: true,
        period: chatContext.period,
        metrics_summary: chatContext.metrics_summary ?? {},
        top_correlations: chatContext.top_correlations ?? [],
        rule_advice: chatContext.rule_advice ?? [],
        assessment_profile: chatContext.assessment_profile ?? null,
        assessment_available: chatContext.assessment_available === true,
        semantic_memories: semanticMemories,
        semantic_memory_status: semanticStatus,
        privacy: {
            diary_included: diaryIncluded,
            ai_memory_included: aiMemoryIncluded,
            data_class: dataClass,
        },
    };
}

export async function getLearnerPersonalContext({
    userId,
    from,
    to,
    timezone,
    query,
    includeDiaryExcerpts = false,
    granularity = 'custom',
}) {
    const pool = getPool();
    if (!pool) return { error: 'DB not configured', error_type: 'db_connection' };

    const period = resolvePersonalContextPeriod({ from, to, timezone });
    const aiPrefs = await loadAiMemoryPreferences(pool, userId);

    if (aiPrefs.enabled) {
        syncHabitInsightMemories({
            pool,
            userId,
            timezone: period.timezone,
        }).catch((err) => {
            console.error('[learnerMemory] lazy habit sync failed:', err);
        });
    }

    const includeDiary = await resolveIncludeDiaryExcerpts(pool, userId, includeDiaryExcerpts === true);
    const recallQuery = String(query || '').trim() || DEFAULT_RECALL_QUERY;

    const [chatContext, recallResult] = await Promise.all([
        getChatContext({
            userId,
            from: period.from,
            to: period.to,
            timezone: period.timezone,
            includeDiaryExcerpts: includeDiary,
            granularity,
        }),
        recallForLearner({
            pool,
            userId,
            query: recallQuery,
        }),
    ]);

    return mergeLearnerPersonalContext(chatContext, recallResult, {
        aiMemoryEnabled: aiPrefs.enabled,
    });
}