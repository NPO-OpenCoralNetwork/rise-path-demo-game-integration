#!/usr/bin/env node
/**
 * Rise Path MCP Server (v2.3.0 — 16 tools incl. request-tts)
 *
 * Exposes learning platform tools and resources via Model Context Protocol.
 * Can be connected from ChatGPT, Claude Desktop, Cursor, or any MCP client.
 *
 * Usage:
 *   node mcp-server/index.js              # stdio transport (Claude Desktop, etc.)
 *   node mcp-server/index.js --sse 3100   # SSE transport (remote/ChatGPT)
 *
 * Environment:
 *   DATABASE_URL_PHASE1  — PostgreSQL connection string
 *   PHASE1_USER_ID       — Default user ID (dev mode)
 *
 * Auth (user scope):
 *   SSE  — syncAuthUserStub at /sse connect (JWT)
 *   stdio — syncAuthUserStub in resolveMcpUserId + registerAgentSession
 *   See doc/architecture_v3_hermes_agent.md §3.2
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// --- Phase 11: Profile filtering & policy ---
import { activeProfile, isToolAllowed, getToolAnnotations } from './profileFilter.js';
import { checkPolicy, auditLog, clearSession } from './policy.js';

// --- Shared business logic ---
import { getProgress, updateProgress } from '../tools/core/learnerState.js';
import { logEntry, getSummary, getRecent, getAdaptationSignals } from '../tools/core/journal.js';
import { searchContent } from '../tools/core/ragSearch.js';
import { getKit, validateIntake, saveDraft } from '../tools/core/curriculum.js';
import { getLatestProfile } from '../tools/core/learnerProfile.js';
import {
    logDaily,
    getRange,
    getAnalysis,
    getAdvice,
    getChatContext,
} from '../tools/core/lifeJournal.js';
import { getAgentChatConsent } from '../tools/core/agentSessionStore.js';
import {
    recallLearnerMemory,
    rememberLearnerMemory,
    getLearnerPersonalContext,
} from '../tools/core/learnerMemory.js';
import { requestTts } from '../tools/core/kokoroTts.js';
import { resolveMcpUserId } from '../tools/core/mcpUserScope.js';
import { verifyMessagesSessionAuth } from './sseMessagesAuth.js';
import { loadEnv } from '../tools/core/env.js';
import { DOMAINS } from '../tools/core/domains.js';

await loadEnv();

// ============================================================
// Shared Utilities (module-scope, shared across all McpServer instances)
// ============================================================

// ============================================================
// Tools
// ============================================================

// ============================================================
// Tool Call Logging
// ============================================================

/**
 * Log tool calls to mcp_tool_calls table if DB is available.
 * Falls back to console.error if DB is not configured.
 */
async function logToolCall({ toolName, startTime, isError, errorType }) {
    const durationMs = Date.now() - startTime;
    const pool = (await import('../server/db.js')).getPool?.();

    if (pool) {
        try {
            await pool.query(
                `INSERT INTO mcp_tool_calls (tool_name, is_error, error_type, duration_ms)
                 VALUES ($1, $2, $3, $4)`,
                [toolName, isError, errorType || null, durationMs]
            );
        } catch { /* ignore logging errors silently */ }
    }

    // Always log to stderr for observability
    const status = isError ? `❌ ${errorType || 'error'}` : '✅';
    console.error(`[MCP] ${toolName} ${status} (${durationMs}ms)`);
}

// Helper: wrap tool result, handling error_type from tools/core/
const toolResult = (data, meta = {}) => {
    if (meta.toolName) {
        logToolCall({ toolName: meta.toolName, startTime: meta.startTime, isError: !!data?.error_type, errorType: data?.error_type });
    }
    if (data?.error_type) {
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
};
const toolError = (err, meta = {}) => {
    if (meta.toolName) {
        logToolCall({ toolName: meta.toolName, startTime: meta.startTime, isError: true, errorType: 'exception' });
    }
    return {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message, error_type: 'exception' }) }],
        isError: true,
    };
};

const USER_ID_DESC = 'ユーザーID。SSE/JWT セッションまたは RISE_PATH_ACTIVE_SESSION_KEY で自動解決されるため LLM 指定は無視されます';

// Session map — populated in SSE mode, empty in stdio mode
// Declared here so resolveToolUserId can access it before SSE section
let sessions = new Map();

// Server lifecycle state (Phase 10)
const startedAt = Date.now();
let isShuttingDown = false;
let httpServer = null;

/**
 * Resolve session-scoped userId or return a toolResult error payload.
 * @returns {Promise<string|object>} userId string, or toolResult-shaped error object
 */
async function requireScopedUser(argsUserId, extra, meta = {}) {
    const result = await resolveMcpUserId({ argsUserId, extra, sessions });
    if (result.error) {
        return toolResult(result, meta);
    }
    return result.userId;
}

// Lazy import helper for PHASE1_USER_ID (avoid circular import in stdio mode)
let _phase1Cache = null;
function await_phase1_userId() {
    if (_phase1Cache) return _phase1Cache;
    // In SSE mode this is already imported; in stdio mode we read from env
    _phase1Cache = { PHASE1_USER_ID: process.env.PHASE1_USER_ID || '00000000-0000-0000-0000-000000000001' };
    return _phase1Cache;
}

// ============================================================
// MCP Server Factory (Phase 6-9: supports multiple SSE clients)
// ============================================================

/**
 * Create a fully-configured McpServer instance.
 * Called once per connection (SSE) or once for stdio.
 * MCP SDK requires 1 Server = 1 Transport, so SSE multi-client
 * needs a fresh instance per connection.
 */
function createMcpServer() {

const server = new McpServer({
    name: 'rise-path-learning',
    version: '2.3.0',
    description: `Rise Path パーソナライズ学習プラットフォームのMCP Server (profile: ${activeProfile})`,
});

// Phase 11: Policy-aware tool wrapper
const policyTool = (name, desc, schema, handler) => {
    if (!isToolAllowed(name)) return; // Profile filter: don't register
    const annotations = getToolAnnotations(name);
    server.tool(name, desc, schema, annotations, async (args, extra) => {
        const sessionId = extra?.sessionId || 'stdio';
        const policy = checkPolicy(name, sessionId);
        if (!policy.allowed) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: policy.message, error_type: policy.reason }) }], isError: true };
        }
        const result = await handler(args, extra);
        if (policy.audit) {
            const scoped = await resolveMcpUserId({ argsUserId: args?.user_id, extra, sessions });
            const userId = scoped.userId || 'unknown';
            let auditPayload = {};
            const auditText = result?.content?.[0]?.text;
            if (auditText) {
                try {
                    auditPayload = JSON.parse(auditText);
                } catch {
                    auditPayload = { raw: auditText };
                }
            }
            auditLog(name, userId, args, auditPayload);
        }
        return result;
    });
};


// --- learner-state ---
policyTool(
    'learner-state-get',
    '学習者の現在の進捗・マスタリーレベルを取得する',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        domain: z.string().optional().describe('学習ドメイン (例: blender-3d)。省略時は全ドメイン'),
    },
    async ({ user_id, domain }, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(user_id, extra, { toolName: 'learner-state-get', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await getProgress({ userId: userId, domain }), { toolName: 'learner-state-get', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'learner-state-get', startTime: t });
        }
    }
);

policyTool(
    'learner-state-update',
    '学習者の進捗を更新する',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        domain: z.string().describe('学習ドメイン'),
        lesson_id: z.string().describe('完了したレッスンID'),
        score: z.number().optional().describe('スコア (0-1)'),
    },
    async ({ user_id, domain, lesson_id, score }, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(user_id, extra, { toolName: 'learner-state-update', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await updateProgress({ userId: userId, domain, lessonId: lesson_id, score }), { toolName: 'learner-state-update', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'learner-state-update', startTime: t });
        }
    }
);

// --- journal ---
policyTool(
    'journal-log',
    '学習ジャーナル (振り返り) を記録する',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        curriculum_id: z.string().describe('カリキュラムID'),
        module_id: z.string().describe('モジュールID'),
        lesson_id: z.string().describe('レッスンID'),
        learned: z.string().optional().describe('学んだこと'),
        difficulty: z.string().optional().describe('難易度の感想'),
        mood: z.enum(['great', 'good', 'okay', 'struggled']).optional(),
        confidence: z.number().min(1).max(5).optional(),
        time_spent_min: z.number().optional(),
    },
    async (args, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(args.user_id, extra, { toolName: 'journal-log', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await logEntry({
                userId: userId,
                curriculumId: args.curriculum_id,
                moduleId: args.module_id,
                lessonId: args.lesson_id,
                learned: args.learned,
                difficulty: args.difficulty,
                mood: args.mood,
                confidence: args.confidence,
                timeSpentMin: args.time_spent_min,
            }), { toolName: 'journal-log', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'journal-log', startTime: t });
        }
    }
);

policyTool(
    'journal-summary',
    'カリキュラムのジャーナル集計を取得する',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        curriculum_id: z.string().optional().describe('カリキュラムID (省略時は全カリキュラム)'),
    },
    async ({ user_id, curriculum_id }, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(user_id, extra, { toolName: 'journal-summary', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await getSummary({ userId: userId, curriculumId: curriculum_id }), { toolName: 'journal-summary', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'journal-summary', startTime: t });
        }
    }
);

policyTool(
    'journal-recent',
    '最近のジャーナルエントリを取得する',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        limit: z.number().optional().describe('取得件数 (デフォルト: 10, 最大: 50)'),
    },
    async ({ user_id, limit }, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(user_id, extra, { toolName: 'journal-recent', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await getRecent({ userId: userId, limit }), { toolName: 'journal-recent', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'journal-recent', startTime: t });
        }
    }
);

// --- rag-search ---
policyTool(
    'rag-search',
    '教育コンテンツをベクトル検索する',
    {
        query: z.string().describe('検索クエリ'),
        domain: z.string().optional().describe('検索対象ドメイン (例: blender-3d)。省略時は全ドメイン'),
        max_results: z.number().optional().describe('最大結果数 (デフォルト: 3)'),
    },
    async ({ query, domain, max_results }) => {
        const t = Date.now();
        try {
            return toolResult(await searchContent({ query, domain, maxResults: max_results }), { toolName: 'rag-search', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'rag-search', startTime: t });
        }
    }
);

// --- curriculum ---
policyTool(
    'get-generation-kit',
    'カリキュラム生成に必要なテンプレート・スキーマ・ルールを取得する',
    {
        portal_id: z.string().optional().describe('学習ポータルID (general, village_welcome, unity, vibe)'),
        template_id: z.string().optional().describe('テンプレートID'),
        locale: z.string().optional().describe('言語 (ja-JP, en)'),
        learning_mode: z.string().optional().describe('学習モード (credential, practice, problem_solving, gentle)'),
        user_id: z.string().optional().describe(USER_ID_DESC),
    },
    async ({ portal_id, template_id, locale, learning_mode, user_id }, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(user_id, extra, { toolName: 'get-generation-kit', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await getKit({
                portalId: portal_id, templateId: template_id, locale, learningMode: learning_mode,
                userId: userId,
            }), { toolName: 'get-generation-kit', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'get-generation-kit', startTime: t });
        }
    }
);

policyTool(
    'validate-intake',
    'LLMが生成した学習要件(intake)をバリデーションする',
    {
        portal_id: z.string().optional().describe('学習ポータルID'),
        learning_mode: z.string().optional().describe('学習モード'),
        intake: z.object({
            target_audience: z.string().optional(),
            goal: z.string().optional(),
            current_level: z.string().optional(),
            duration_weeks: z.number().optional(),
            constraints: z.string().optional(),
            delivery_style: z.string().optional(),
        }).passthrough().describe('LLMが生成した学習要件JSON'),
    },
    async ({ portal_id, learning_mode, intake }) => {
        const t = Date.now();
        try {
            return toolResult(validateIntake({
                portalId: portal_id, learningMode: learning_mode, intake,
            }), { toolName: 'validate-intake', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'validate-intake', startTime: t });
        }
    }
);

policyTool(
    'save-curriculum-draft',
    'LLMが生成したカリキュラムJSONを検証・保存する。生成自体はLLM側が行う',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        portal_id: z.string().optional().describe('学習ポータルID'),
        learning_mode: z.string().optional().describe('学習モード'),
        intake: z.object({}).passthrough().describe('バリデーション済みの学習要件'),
        curriculum: z.object({}).passthrough().describe('LLMが生成したカリキュラムJSON'),
        curriculum_id: z.string().optional().describe('既存カリキュラムの更新時にIDを指定'),
        generation_meta: z.object({
            provider: z.string().optional(),
            model: z.string().optional(),
            session_id: z.string().optional(),
        }).optional().describe('生成メタデータ'),
    },
    async (args, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(args.user_id, extra, { toolName: 'save-curriculum-draft', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await saveDraft({
                portalId: args.portal_id,
                learningMode: args.learning_mode,
                intake: args.intake,
                curriculum: args.curriculum,
                curriculumId: args.curriculum_id,
                userId: userId,
                generationMeta: args.generation_meta,
            }), { toolName: 'save-curriculum-draft', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'save-curriculum-draft', startTime: t });
        }
    }
);

// --- daily-life (Phase 16-6a) ---
policyTool(
    'daily-life-log',
    '日次ライフジャーナル（気分・睡眠・運動・日記）を保存する',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        entry_date: z.string().describe('エントリ日 YYYY-MM-DD（ユーザーのローカル日付）'),
        timezone: z.string().optional().describe('IANA タイムゾーン（例: Asia/Tokyo）'),
        reflection: z.object({}).passthrough().optional().describe('気分・日記・タグ等'),
        lifestyle: z.object({}).passthrough().optional().describe('睡眠・運動・食事等'),
    },
    async ({ user_id, entry_date, timezone, reflection, lifestyle }, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(user_id, extra, { toolName: 'daily-life-log', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await logDaily({
                userId: userId,
                entryDate: entry_date,
                reflection,
                lifestyle,
                timezone,
            }), { toolName: 'daily-life-log', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'daily-life-log', startTime: t });
        }
    }
);

policyTool(
    'daily-life-range',
    '期間内のライフジャーナル日次データを取得する',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        from: z.string().describe('開始日 YYYY-MM-DD'),
        to: z.string().describe('終了日 YYYY-MM-DD'),
        timezone: z.string().optional().describe('IANA タイムゾーン'),
    },
    async ({ user_id, from, to, timezone }, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(user_id, extra, { toolName: 'daily-life-range', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await getRange({
                userId: userId,
                from,
                to,
                timezone,
            }), { toolName: 'daily-life-range', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'daily-life-range', startTime: t });
        }
    }
);

policyTool(
    'daily-life-analysis',
    'ライフジャーナルの決定論的分析（相関・パターン・メトリクス）を取得する',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        from: z.string().describe('開始日 YYYY-MM-DD'),
        to: z.string().describe('終了日 YYYY-MM-DD'),
        timezone: z.string().optional().describe('IANA タイムゾーン'),
        granularity: z.enum(['weekly', 'monthly', 'custom']).optional().describe('集計粒度'),
    },
    async ({ user_id, from, to, timezone, granularity }, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(user_id, extra, { toolName: 'daily-life-analysis', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await getAnalysis({
                userId: userId,
                from,
                to,
                timezone,
                granularity,
            }), { toolName: 'daily-life-analysis', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'daily-life-analysis', startTime: t });
        }
    }
);

policyTool(
    'daily-life-advice',
    'ルールベースの週次ライフ習慣アドバイスを取得する',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        from: z.string().describe('開始日 YYYY-MM-DD'),
        to: z.string().describe('終了日 YYYY-MM-DD'),
        timezone: z.string().optional().describe('IANA タイムゾーン'),
    },
    async ({ user_id, from, to, timezone }, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(user_id, extra, { toolName: 'daily-life-advice', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await getAdvice({
                userId: userId,
                from,
                to,
                timezone,
            }), { toolName: 'daily-life-advice', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'daily-life-advice', startTime: t });
        }
    }
);

policyTool(
    'daily-life-chat-context',
    'LLM チャット用の安全な集計コンテキストを生成する（生データは含めない）',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        from: z.string().describe('開始日 YYYY-MM-DD'),
        to: z.string().describe('終了日 YYYY-MM-DD'),
        timezone: z.string().optional().describe('IANA タイムゾーン'),
        granularity: z.enum(['weekly', 'monthly', 'custom']).optional().describe('集計粒度'),
    },
    async ({ user_id, from, to, timezone, granularity }, extra) => {
        const t = Date.now();
        try {
            const userId = await requireScopedUser(user_id, extra, { toolName: 'daily-life-chat-context', startTime: t });
            if (typeof userId !== 'string') return userId;
            const includeDiaryExcerpts = await getAgentChatConsent(userId);
            return toolResult(await getChatContext({
                userId,
                from,
                to,
                timezone,
                includeDiaryExcerpts,
                granularity,
            }), { toolName: 'daily-life-chat-context', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'daily-life-chat-context', startTime: t });
        }
    }
);

policyTool(
    'learner-personal-context',
    'L1+L2+L3 統合パーソナルコンテキスト（ライフジャーナル集計 + セマンティック記憶）',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        from: z.string().optional().describe('開始日 YYYY-MM-DD（未指定時は直近30日）'),
        to: z.string().optional().describe('終了日 YYYY-MM-DD（未指定時は今日）'),
        timezone: z.string().optional().describe('IANA タイムゾーン（デフォルト Asia/Tokyo）'),
        query: z.string().optional().describe('セマンティック recall 用クエリ（未指定時は汎用クエリ）'),
        include_diary_excerpts: z.boolean().optional().describe('日記抜粋を含める（サーバー側 opt-in 必須）'),
        granularity: z.enum(['weekly', 'monthly', 'custom']).optional().describe('集計粒度'),
    },
    async ({ user_id, from, to, timezone, query, include_diary_excerpts, granularity }, extra) => {
        const t = Date.now();
        try {
            const userId = await requireScopedUser(user_id, extra, { toolName: 'learner-personal-context', startTime: t });
            if (typeof userId !== 'string') return userId;
            return toolResult(await getLearnerPersonalContext({
                userId,
                from,
                to,
                timezone,
                query,
                includeDiaryExcerpts: include_diary_excerpts,
                granularity,
            }), { toolName: 'learner-personal-context', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'learner-personal-context', startTime: t });
        }
    }
);

policyTool(
    'learner-memory-recall',
    '意味検索で学習者のセマンティック記憶を取得する（opt-in 必須）',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        query: z.string().describe('自然言語の検索クエリ'),
        limit: z.number().int().min(1).max(100).optional().describe('最大件数（デフォルト 8）'),
        type: z.array(z.enum([
            'fact', 'preference', 'goal', 'decision', 'artifact', 'learning',
            'event', 'instruction', 'relationship', 'context', 'observation',
            'commitment', 'error',
        ])).optional().describe('記憶タイプでフィルタ'),
        min_similarity: z.number().min(0).max(1).optional().describe('最小類似度（デフォルト 0.35）'),
    },
    async ({ user_id, query, limit, type, min_similarity }, extra) => {
        const t = Date.now();
        try {
            const userId = await requireScopedUser(user_id, extra, { toolName: 'learner-memory-recall', startTime: t });
            if (typeof userId !== 'string') return userId;
            return toolResult(await recallLearnerMemory({
                userId,
                query,
                limit,
                type,
                minSimilarity: min_similarity,
            }), { toolName: 'learner-memory-recall', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'learner-memory-recall', startTime: t });
        }
    }
);

policyTool(
    'learner-memory-remember',
    '学習者のセマンティック記憶を1件保存する（opt-in 必須・原子事実のみ）',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        content: z.string().max(2000).describe('保存する記憶（最大 2000 文字）'),
        type: z.enum([
            'fact', 'preference', 'goal', 'decision', 'artifact', 'learning',
            'event', 'instruction', 'relationship', 'context', 'observation',
            'commitment', 'error',
        ]).optional().describe('記憶タイプ（デフォルト preference）'),
        confidence: z.number().min(0).max(1).optional().describe('確信度（デフォルト 0.9）'),
        tags: z.array(z.string()).optional().describe('タグ'),
        provenance: z.enum([
            'explicit_statement', 'inferred', 'corrected', 'validated', 'observed', 'imported',
        ]).optional().describe('取得元'),
        source: z.string().optional().describe('ソースラベル'),
    },
    async ({ user_id, content, type, confidence, tags, provenance, source }, extra) => {
        const t = Date.now();
        try {
            const userId = await requireScopedUser(user_id, extra, { toolName: 'learner-memory-remember', startTime: t });
            if (typeof userId !== 'string') return userId;
            return toolResult(await rememberLearnerMemory({
                userId,
                content,
                type,
                confidence,
                tags,
                provenance,
                source,
            }), { toolName: 'learner-memory-remember', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'learner-memory-remember', startTime: t });
        }
    }
);

// --- request-tts (Issue #3) ---
policyTool(
    'request-tts',
    'Kokoro-82M ONNX でテキストを音声合成し、音声ファイルのURLを返す',
    {
        text: z.string().describe('読み上げテキスト'),
        language: z.enum(['ja', 'en']).default('ja').describe('言語コード'),
        voice_id: z.string().optional().describe('Kokoro voice_id（省略時は env デフォルト）'),
        lang_code: z.string().optional().describe('Kokoro misaki lang_code（j/a/b 等）'),
        speed: z.number().min(0.5).max(2.0).optional().describe('読み上げ速度'),
        output_format: z.enum(['wav', 'mp3']).optional().describe('出力形式（default mp3）'),
        lesson_id: z.string().optional().describe('キャッシュ名前空間キー'),
    },
    async ({ text, language, voice_id, lang_code, speed, output_format, lesson_id }, extra) => {
        const t = Date.now();
        try {
            let resolvedUserId = null;
            if (!voice_id) {
                const userId = await requireScopedUser(undefined, extra, { toolName: 'request-tts', startTime: t });
                if (typeof userId !== 'string') return userId;
                resolvedUserId = userId;
            } else {
                const scoped = await resolveMcpUserId({ argsUserId: undefined, extra, sessions });
                if (!scoped.error && scoped.userId) {
                    resolvedUserId = scoped.userId;
                }
            }
            return toolResult(await requestTts({
                userId: resolvedUserId,
                text,
                language,
                voice_id,
                lang_code,
                speed,
                output_format,
                lesson_id,
            }), { toolName: 'request-tts', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'request-tts', startTime: t });
        }
    }
);

// --- adaptation (Phase 12) ---
policyTool(
    'learner-adaptation-signals',
    '学習者のジャーナルを分析し、適応シグナル（ペース調整・励まし等）を返す',
    {
        user_id: z.string().optional().describe(USER_ID_DESC),
        curriculum_id: z.string().optional().describe('カリキュラムID（省略時は全カリキュラム）'),
        module_id: z.string().optional().describe('モジュールID（省略時は全モジュール）'),
    },
    async ({ user_id, curriculum_id, module_id }, extra) => {
        const t = Date.now();
        try {            const userId = await requireScopedUser(user_id, extra, { toolName: 'learner-adaptation-signals', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await getAdaptationSignals({
                userId: userId,
                curriculumId: curriculum_id,
                moduleId: module_id,
            }), { toolName: 'learner-adaptation-signals', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'learner-adaptation-signals', startTime: t });
        }
    }
);

// ============================================================
// Resources
// ============================================================

server.resource(
    'content-domains',
    'content://domains',
    { description: '利用可能な学習ドメインの一覧', mimeType: 'application/json' },
    async (uri) => ({
        contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
                domains: DOMAINS.map(d => ({
                    id: d.id, name: d.name, description: d.description, lessons: d.maxStages,
                })),
            }, null, 2),
        }],
    })
);

server.resource(
    'learner-profile',
    'learner://profile/me',
    { description: '認証セッションの学習者プロフィール (診断結果・学習スタイル)', mimeType: 'application/json' },
    async (uri, extra) => {
        const scope = await resolveMcpUserId({ argsUserId: undefined, extra, sessions });
        if (scope.error) {
            return {
                contents: [{
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify(scope, null, 2),
                }],
            };
        }
        const profile = await getLatestProfile({ userId: scope.userId });
        return {
            contents: [{
                uri: uri.href,
                mimeType: 'application/json',
                text: JSON.stringify(profile, null, 2),
            }],
        };
    }
);

// ============================================================
// Prompts
// ============================================================

server.prompt(
    'socratic-tutor',
    'ソクラテス式対話で学習者を導くためのプロンプト',
    { topic: z.string().describe('学習トピック') },
    ({ topic }) => ({
        messages: [{
            role: 'user',
            content: {
                type: 'text',
                text: `あなたはRise Pathの学習コーチ「ルミナ」です。
以下のトピックについて、ソクラテス式対話で学習者を導いてください。

トピック: ${topic}

ルール:
- 答えを直接教えず、質問で導く
- 学習者の理解度を確認しながら進める
- 具体的な例やアナロジーを使う
- 成功したら称賛し、つまずいたら共感する`,
            },
        }],
    })
);

return server;
} // end createMcpServer()

// ============================================================
// Start Server
// ============================================================

const args = process.argv.slice(2);

if (args.includes('--sse')) {
    // SSE transport for remote connections (ChatGPT, etc.)
    const portIdx = args.indexOf('--sse');
    const port = Number(args[portIdx + 1]) || 3100;

    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
    const express = (await import('express')).default;
    const rateLimitMod = await import('express-rate-limit');
    const mcpRateLimit = rateLimitMod.default;
    const { initSupabase, getSupabase, extractBearerToken } = await import('../server/middleware/auth.js');
    const { PHASE1_USER_ID, syncAuthUserStub } = await import('../server/db.js');
    const app = express();

    // Phase 10-8: CORS configuration
    const ALLOWED_ORIGINS = (process.env.MCP_CORS_ORIGINS || '').split(',').filter(Boolean);
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (process.env.NODE_ENV !== 'production' || !origin || ALLOWED_ORIGINS.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin || '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hermes-Session-Key');
            res.setHeader('Access-Control-Max-Age', '86400');
        }
        if (req.method === 'OPTIONS') return res.status(204).end();
        next();
    });

    // Initialize Supabase for JWT validation
    await initSupabase();

    // Rate limit: 30 tool calls/min per session (Phase 8)
    const mcpLimiter = mcpRateLimit({
        windowMs: 60 * 1000,
        max: process.env.NODE_ENV !== 'production' ? 300 : 30,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.params.sessionId || req.ip,
        message: { error: 'MCP rate limit exceeded. Max 30 tool calls/min.' },
        validate: { keyGeneratorIpFallback: false },
    });

    // Resolve user ID from Bearer token or fallback
    // Priority: Bridge Token > Supabase JWT > dev fallback
    // ChatGPT Apps & Connectors uses a fixed token, so Bridge Token is essential.
    async function resolveUserId(req) {
        const token = extractBearerToken(req);
        const bridgeToken = (process.env.RISE_PATH_BRIDGE_TOKEN || '').trim();

        // 1. x-nexloom-bridge-token header (dedicated bridge header)
        if (bridgeToken) {
            const provided = (req.headers['x-nexloom-bridge-token'] || '').trim();
            if (provided && provided === bridgeToken) {
                req.authMethod = 'bridge-header';
                return PHASE1_USER_ID; // Bridge uses shared user
            }
        }

        // 2. Bearer token — check if it's Bridge Token first
        if (token && bridgeToken && token === bridgeToken) {
            req.authMethod = 'bridge-bearer';
            return PHASE1_USER_ID;
        }

        // 3. Bearer token — try Supabase JWT
        if (token) {
            const supabase = getSupabase();
            if (supabase) {
                try {
                    const { data, error } = await supabase.auth.getUser(token);
                    if (!error && data?.user) {
                        req.authMethod = 'supabase-jwt';
                        return data.user.id;
                    }
                } catch { /* fall through */ }
            }
        }

        // 4. Dev mode fallback (disabled in strict auth — see server/middleware/authPolicy.js)
        const { allowDevAuthFallback } = await import('../server/middleware/authPolicy.js');
        if (allowDevAuthFallback()) {
            req.authMethod = 'dev-fallback';
            return PHASE1_USER_ID;
        }

        return null;
    }

    // Use the module-level sessions Map (declared near resolveToolUserId)
    // so that tool handlers can look up authenticated userId by sessionId

    // ── Phase 10: Health Check Endpoint ─────────────────────────
    app.get('/health', async (_req, res) => {
        const { getPool } = await import('../server/db.js');
        const pool = getPool();
        let dbStatus = 'not_configured';
        let dbError = null;

        if (pool) {
            try {
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 3000)
                );
                await Promise.race([pool.query('SELECT 1'), timeout]);
                dbStatus = 'connected';
            } catch (err) {
                dbStatus = err.message === 'timeout' ? 'timeout' : 'disconnected';
                dbError = err.message;
            }
        }

        const status = dbStatus === 'connected' || dbStatus === 'not_configured' ? 'ok' : 'degraded';
        res.json({
            status: isShuttingDown ? 'shutting_down' : status,
            version: '2.3.0',
            profile: activeProfile,
            uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
            active_sessions: Math.floor(sessions.size / 2),
            db: dbStatus,
            ...(dbError && { db_error: dbError }),
            timestamp: new Date().toISOString(),
        });
    });

    app.get('/sse', async (req, res) => {
        // Phase 10: Reject new connections during shutdown
        if (isShuttingDown) {
            return res.status(503).json({ error: 'Server is shutting down' });
        }
        const userId = await resolveUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        await syncAuthUserStub(userId);

        // --- Anti-buffering for Cloudflare Tunnel / nginx reverse proxies ---
        res.setHeader('X-Accel-Buffering', 'no');

        // Disable Nagle's algorithm for minimal SSE latency
        if (res.socket) res.socket.setNoDelay(true);

        // Patch res.write to auto-flush after each SSE chunk.
        const _origWrite = res.write.bind(res);
        res.write = function (...writeArgs) {
            const result = _origWrite(...writeArgs);
            if (typeof res.flush === 'function') res.flush();
            return result;
        };

        const routeSessionId = randomUUID();
        const transport = new SSEServerTransport(`/messages/${routeSessionId}`, res);

        // Create a dedicated McpServer per connection (SDK: 1 Server = 1 Transport)
        const mcpInstance = createMcpServer();

        // Store session by both route sessionId (for Express routing)
        // and transport.sessionId (for MCP SDK extra.sessionId → resolveToolUserId)
        const sessionData = { transport, userId, mcpInstance, activeSessionKey: '' };
        sessions.set(routeSessionId, sessionData);
        sessions.set(transport.sessionId, sessionData); // SDK uses this in extra.sessionId

        // Clean up on disconnect
        res.on('close', async () => {
            sessions.delete(routeSessionId);
            sessions.delete(transport.sessionId);
            clearSession(routeSessionId);
            clearSession(transport.sessionId);
            try { await mcpInstance.close(); } catch { /* ignore */ }
            console.error(`[MCP] Session ${routeSessionId.slice(0, 8)} disconnected (${Math.floor(sessions.size / 2)} active)`);
        });

        console.error(`[MCP] Session ${routeSessionId.slice(0, 8)} connected user=${userId.slice(0, 8)} (${Math.ceil(sessions.size / 2)} active)`);
        await mcpInstance.connect(transport);
    });

    app.post('/messages/:sessionId', mcpLimiter, async (req, res) => {
        const session = sessions.get(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const resolvedUserId = await resolveUserId(req);
        const hermesSessionKey = String(req.headers['x-hermes-session-key'] || '').trim();
        if (hermesSessionKey) {
            session.activeSessionKey = hermesSessionKey;
        }

        const authFailure = verifyMessagesSessionAuth(resolvedUserId, session.userId);
        if (authFailure) {
            if (authFailure.status === 403) {
                console.error(
                    `[MCP] Session ${req.params.sessionId.slice(0, 8)} userId mismatch: token=${resolvedUserId?.slice(0, 8)} session=${session.userId.slice(0, 8)}`,
                );
            }
            return res.status(authFailure.status).json({ error: authFailure.error });
        }

        await session.transport.handlePostMessage(req, res);
    });

    httpServer = app.listen(port, () => {
        console.log(`🚀 Rise Path MCP Server (SSE) running on http://localhost:${port}/sse`);
        console.log(`   Sessions endpoint: POST /messages/:sessionId`);
        console.log(`   Health check: GET /health`);
    });
} else {
    // stdio transport (default, for Claude Desktop / local)
    const mcpInstance = createMcpServer();
    const transport = new StdioServerTransport();
    await mcpInstance.connect(transport);
    console.error(`🚀 Rise Path MCP Server (stdio) started [profile: ${activeProfile}]`);
}

// ============================================================
// Phase 10: Graceful Shutdown
// ============================================================

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.error(`\n[MCP] ${signal} received. Shutting down gracefully...`);

    // Force exit after 10 seconds
    const forceTimer = setTimeout(() => {
        console.error('[MCP] Shutdown timeout (10s). Forcing exit.');
        process.exit(1);
    }, 10_000);
    forceTimer.unref(); // Don't keep process alive just for this timer

    // 1. Close all active MCP sessions
    const sessionCount = Math.floor(sessions.size / 2);
    if (sessionCount > 0) {
        console.error(`[MCP] Closing ${sessionCount} active session(s)...`);
        const closePromises = [];
        const seen = new Set();
        for (const [id, session] of sessions) {
            if (seen.has(session)) continue; // Skip duplicate entries (route + transport)
            seen.add(session);
            closePromises.push(
                session.mcpInstance?.close().catch(() => {})
            );
        }
        await Promise.allSettled(closePromises);
        sessions.clear();
    }

    // 2. Close HTTP server (stop accepting new connections)
    if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
        console.error('[MCP] HTTP server closed.');
    }

    // 3. Close DB pool
    try {
        const { getPool } = await import('./server/db.js').catch(() =>
            import('../server/db.js')
        );
        const pool = getPool?.();
        if (pool) {
            await pool.end();
            console.error('[MCP] DB pool closed.');
        }
    } catch { /* ignore */ }

    console.error('[MCP] Shutdown complete.');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
