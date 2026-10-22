#!/usr/bin/env node
/**
 * Rise Path MCP Server (v2.4.0 — incl. request-tts and the lesson-* authoring tools)
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
 *   RP_LESSON_STORE      — lesson-upsert-draft store: fs (default, content/courses/<slug>/drafts/) or db
 *   RP_CONTENT_DIR       — content/ root for the lesson tools (default: repo content/)
 *   RP_LESSON_FS_WRITE   — 1 allows file drafts on a production SSE server (refused by default)
 *   RISE_PATH_PREVIEW_BASE_URL — base of lesson-preview-url (default http://localhost:3007)
 *
 * Auth (user scope): tools/core/mcpUserScope.js resolveMcpUserId, once per tool call
 *   SSE with a learner's JWT — that learner (syncAuthUserStub at /sse connect)
 *   SSE with the bridge token (Hermes) — the learner bound to the call's rp_turn argument, which
 *     Express mints per chat turn (registerAgentTurn); without one, session_binding_required in
 *     production (development only: the sole chatting learner, else PHASE1_USER_ID)
 *   stdio — RISE_PATH_ACTIVE_SESSION_KEY or rp_turn; PHASE1_USER_ID in development only
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// --- Phase 11: Profile filtering & policy ---
import { activeProfile, isToolAllowed, getToolAnnotations } from './profileFilter.js';
import { checkPolicy, auditLog, clearSession, hasCallLimit } from './policy.js';

// --- Shared business logic ---
import { getProgress, updateProgress } from '../tools/core/learnerState.js';
import { logEntry, getSummary, getRecent, getAdaptationSignals } from '../tools/core/journal.js';
import { searchContent, MAX_SEARCH_RESULTS } from '../tools/core/ragSearch.js';
import { getKit, validateIntake, saveDraft } from '../tools/core/curriculum.js';
import {
    SAFE_SLUG,
    getLessonSchema,
    getLessonJsonSchema,
    validateLessonDraft,
    getLesson,
    upsertLessonDraft,
    previewUrl,
    resolveLessonStore,
    buildAuthorLessonPrompt,
} from '../tools/core/lessons.js';
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
import { resolveMcpUserId, TURN_ARG } from '../tools/core/mcpUserScope.js';
import { verifyMessagesSessionAuth } from './sseMessagesAuth.js';
import { loadEnv } from '../tools/core/env.js';
import { DOMAINS } from '../tools/core/domains.js';

await loadEnv();

// File drafts (lesson-upsert-draft) are for local authoring. A production SSE server refuses
// them unless RP_LESSON_FS_WRITE=1; set RP_LESSON_STORE=db there instead.
const LESSON_FS_WRITE = !process.argv.includes('--sse')
    || process.env.NODE_ENV !== 'production'
    || process.env.RP_LESSON_FS_WRITE === '1';

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
// meta.compact drops indentation for large payloads (lesson schema + exemplar).
const toolResult = (data, meta = {}) => {
    if (meta.toolName) {
        logToolCall({ toolName: meta.toolName, startTime: meta.startTime, isError: !!data?.error_type, errorType: data?.error_type });
    }
    const text = JSON.stringify(data, null, meta.compact ? 0 : 2);
    if (data?.error_type) {
        return { content: [{ type: 'text', text }], isError: true };
    }
    return { content: [{ type: 'text', text }] };
};
// The exception text (driver messages, file paths) goes to stderr only: tool results reach the
// LLM and can be quoted to a learner.
const toolError = (err, meta = {}) => {
    console.error(`[MCP] ${meta.toolName || 'tool'} exception:`, err);
    if (meta.toolName) {
        logToolCall({ toolName: meta.toolName, startTime: meta.startTime, isError: true, errorType: 'exception' });
    }
    return {
        content: [{ type: 'text', text: JSON.stringify({ error: `${meta.toolName || 'tool'} failed (internal error)`, error_type: 'exception' }) }],
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
 * The learner this call acts for. Inside a tool, policyTool resolved it once for the call (with
 * its rp_turn) as extra.resolveScope; resources resolve from the session and request.
 * @returns {Promise<{ userId: string } | { error: string, error_type: string }>}
 */
function resolveScopeFor(extra) {
    return typeof extra?.resolveScope === 'function'
        ? extra.resolveScope()
        : resolveMcpUserId({ extra, sessions });
}

/**
 * Resolve session-scoped userId or return a toolResult error payload. argsUserId (LLM-supplied
 * user_id) is never used.
 * @returns {Promise<string|object>} userId string, or toolResult-shaped error object
 */
async function requireScopedUser(_argsUserId, extra, meta = {}) {
    const result = await resolveScopeFor(extra);
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
    version: '2.4.0',
    description: `Rise Path パーソナライズ学習プラットフォームのMCP Server (profile: ${activeProfile})`,
});

// Every tool takes the turn token Express mints per chat turn (tools/core/mcpUserScope.js).
const turnArgSchema = () => z.string().max(128).optional().describe(
    'このターンの指示で渡された rp_turn をそのまま渡す（学習者の特定に使う） / The rp_turn value given in this turn\'s instructions, passed unchanged; it identifies the learner'
);

// Phase 11: Policy-aware tool wrapper
const policyTool = (name, desc, schema, handler) => {
    if (!isToolAllowed(name)) return; // Profile filter: don't register
    const annotations = getToolAnnotations(name);
    server.tool(name, desc, { ...schema, [TURN_ARG]: turnArgSchema() }, annotations, async (args, extra) => {
        const { [TURN_ARG]: turnToken, ...toolArgs } = args ?? {};
        // One learner per call: the call limit, the handler and the audit line all use it.
        let scope = null;
        const callExtra = {
            ...extra,
            resolveScope: () => (scope ??= resolveMcpUserId({ extra, sessions, turnToken })),
        };
        const sessionId = extra?.sessionId || 'stdio';
        const learner = hasCallLimit(name) ? ((await callExtra.resolveScope()).userId || '') : '';
        const policy = checkPolicy(name, sessionId, learner);
        if (!policy.allowed) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: policy.message, error_type: policy.reason }) }], isError: true };
        }
        const result = await handler(toolArgs, callExtra);
        if (policy.audit) {
            const scoped = await callExtra.resolveScope();
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
            auditLog(name, userId, toolArgs, auditPayload);
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
// Searches only the acting learner's own uploaded materials (there is no shared material).
policyTool(
    'rag-search',
    '学習者本人がアップロードした教材から関連箇所を検索する（他の学習者の教材やコース教材は対象外） / Searches the learner\'s own uploaded materials only',
    {
        query: z.string().describe('検索クエリ'),
        domain: z.string().optional().describe('結果にそのまま付けるラベル。絞り込みには使わない / Label echoed in the results; not a filter'),
        // Not a schema bound: searchContent clamps (an LLM asking for 20 gets 10, not an error).
        max_results: z.number().optional().describe(`最大結果数 1-${MAX_SEARCH_RESULTS} (デフォルト: 3、上限を超える値は ${MAX_SEARCH_RESULTS} 件) / Maximum results, 1-${MAX_SEARCH_RESULTS} (default 3; larger values return ${MAX_SEARCH_RESULTS})`),
    },
    async ({ query, domain, max_results }, extra) => {
        const t = Date.now();
        try {
            const userId = await requireScopedUser(undefined, extra, { toolName: 'rag-search', startTime: t });
            if (typeof userId !== 'string') return userId;

            return toolResult(await searchContent({ query, domain, maxResults: max_results, userId }), { toolName: 'rag-search', startTime: t });
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

// --- lessons (risepath.lesson/v1 authoring; works without DB) ---
const LESSON_SLUG_DESC = '小文字・数字・"-" のみ / lowercase letters, digits and "-"';
const lessonSlug = () => z.string().max(80).regex(SAFE_SLUG, LESSON_SLUG_DESC);
const lessonClientName = () => server.server.getClientVersion()?.name;

policyTool(
    'lesson-schema-get',
    '教材スキーマ（risepath.lesson/v1）、レッスン契約、お手本教材を返す。教材を書く前に最初に呼ぶ / Returns the risepath.lesson/v1 JSON Schema, the lesson contract and an exemplar lesson. Call this before writing a lesson.',
    {
        profile: z.enum(['llm', 'full']).optional().describe('llm（既定。構造化出力向け）または full（検証器と同じ完全版） / llm (default, for structured output) or full (what the validator enforces)'),
        exemplar: z.enum(['excerpt', 'full', 'none']).optional().describe('お手本 vibe-coding/vibe-ch1 をどこまで含めるか（既定 excerpt） / How much of the exemplar lesson to include (default excerpt)'),
    },
    async ({ profile, exemplar }) => {
        const t = Date.now();
        try {
            return toolResult(await getLessonSchema({ profile, exemplar }), { toolName: 'lesson-schema-get', startTime: t, compact: true });
        } catch (err) {
            return toolError(err, { toolName: 'lesson-schema-get', startTime: t });
        }
    }
);

policyTool(
    'lesson-validate',
    '教材を保存せずに検証し、パス付きのエラーと lint 警告を返す（ok:true なら lesson-upsert-draft も通る） / Validates a lesson without saving it. Returns errors with JSON paths and pedagogy lint warnings; ok:true means lesson-upsert-draft will accept it.',
    {
        lesson: z.record(z.string(), z.unknown()).describe('risepath.lesson/v1 の教材 JSON / The lesson JSON (risepath.lesson/v1)'),
        course_slug: lessonSlug().optional().describe('所属コース。next リンクと出典を course.json と照合する / Course slug; checks next links and sources against its course.json'),
    },
    async ({ lesson, course_slug }) => {
        const t = Date.now();
        try {
            return toolResult(await validateLessonDraft(lesson, {
                courseSlug: course_slug, clientName: lessonClientName(),
            }), { toolName: 'lesson-validate', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'lesson-validate', startTime: t });
        }
    }
);

policyTool(
    'lesson-get',
    '教材を読み出す（下書きがあれば下書き、なければ公開版）。更新時に使う hash も返す / Reads a lesson: the draft when one exists, else the published lesson. Returns the hash to pass as base_hash when you update it.',
    {
        course_slug: lessonSlug().describe(`コースのスラッグ（例: vibe-coding） / Course slug, e.g. vibe-coding (${LESSON_SLUG_DESC})`),
        lesson_id: lessonSlug().describe('レッスンID（例: vibe-ch1） / Lesson id, e.g. vibe-ch1'),
        source: z.enum(['auto', 'draft', 'published']).optional().describe('auto（既定: 下書き → 公開版）/ draft / published'),
        curriculum_id: z.string().uuid().optional().describe('DB に保存した下書きを読むときのカリキュラムID / Read this database draft instead of files'),
        user_id: z.string().optional().describe(USER_ID_DESC),
    },
    async ({ course_slug, lesson_id, source, curriculum_id, user_id }, extra) => {
        const t = Date.now();
        try {
            const store = curriculum_id ? 'db' : resolveLessonStore();
            let userId;
            if (store === 'db') {
                // In the db store the caller's own DB draft comes before the files (same user as
                // lesson-upsert-draft, so the returned hash is the one it checks).
                userId = await requireScopedUser(user_id, extra, { toolName: 'lesson-get', startTime: t });
                if (typeof userId !== 'string') return userId;
            }
            return toolResult(await getLesson({
                courseSlug: course_slug, lessonId: lesson_id, source, curriculumId: curriculum_id, userId, store,
            }), { toolName: 'lesson-get', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'lesson-get', startTime: t });
        }
    }
);

policyTool(
    'lesson-upsert-draft',
    '教材を検証して下書きとして保存する（公開はしない）。既存の教材・下書きを置き換えるときは lesson-get の hash を base_hash に渡す。食い違えば conflict / Validates a lesson and saves it as a draft (never publishes). To replace an existing lesson or draft, pass its hash from lesson-get as base_hash; a stale hash returns a conflict.',
    {
        course_slug: lessonSlug().describe(`コースのスラッグ / Course slug (${LESSON_SLUG_DESC})`),
        lesson: z.record(z.string(), z.unknown()).describe('risepath.lesson/v1 の教材 JSON。lesson.id がファイル名になる / The lesson JSON; lesson.id becomes the draft file name'),
        base_hash: z.string().max(64).optional().describe('lesson-get の hash。新規作成では省略 / hash from lesson-get; omit when creating a new lesson'),
        curriculum_id: z.string().uuid().optional().describe('DB の下書きに新しい版を追加するときのカリキュラムID / Add a version to this database draft'),
        user_id: z.string().optional().describe(USER_ID_DESC),
    },
    async ({ course_slug, lesson, base_hash, curriculum_id, user_id }, extra) => {
        const t = Date.now();
        try {
            const store = curriculum_id ? 'db' : resolveLessonStore();
            let userId;
            if (store === 'db') {
                userId = await requireScopedUser(user_id, extra, { toolName: 'lesson-upsert-draft', startTime: t });
                if (typeof userId !== 'string') return userId;
            }
            return toolResult(await upsertLessonDraft({
                courseSlug: course_slug,
                lesson,
                baseHash: base_hash,
                curriculumId: curriculum_id,
                userId,
                store,
                clientName: lessonClientName(),
                allowFsWrite: LESSON_FS_WRITE,
            }), { toolName: 'lesson-upsert-draft', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'lesson-upsert-draft', startTime: t });
        }
    }
);

policyTool(
    'lesson-preview-url',
    '教材のプレビュー URL（開発サーバーの /preview）と公開版の URL を返す / Returns the preview URL (dev server /preview route) and, for published lessons, the /learn URL.',
    {
        course_slug: lessonSlug().describe(`コースのスラッグ / Course slug (${LESSON_SLUG_DESC})`),
        lesson_id: lessonSlug().describe('レッスンID / Lesson id'),
    },
    async ({ course_slug, lesson_id }) => {
        const t = Date.now();
        try {
            return toolResult(await previewUrl({ courseSlug: course_slug, lessonId: lesson_id }), { toolName: 'lesson-preview-url', startTime: t });
        } catch (err) {
            return toolError(err, { toolName: 'lesson-preview-url', startTime: t });
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
                const scoped = await resolveScopeFor(extra);
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
        const scope = await resolveScopeFor(extra);
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

// Lesson schema resources follow the lesson tools' profile exposure.
if (isToolAllowed('lesson-schema-get')) {
    for (const [name, uriText, profile, description] of [
        ['lesson-schema-v1', 'rp://schema/lesson/v1', 'full', 'risepath.lesson/v1 の JSON Schema（完全版） / Full JSON Schema of risepath.lesson/v1'],
        ['lesson-schema-v1-llm', 'rp://schema/lesson/v1/llm', 'llm', 'risepath.lesson/v1 の JSON Schema（LLM 用。再帰なし） / LLM profile of the risepath.lesson/v1 JSON Schema (no recursion)'],
    ]) {
        server.resource(
            name,
            uriText,
            { description, mimeType: 'application/json' },
            async (uri) => ({
                contents: [{
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify(getLessonJsonSchema(profile), null, 2),
                }],
            })
        );
    }
}

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

// author-lesson: the Claude Code skill body (.claude/skills/author-lesson/SKILL.md) when present,
// else a built-in procedure; read at request time so skill edits apply without a restart.
if (isToolAllowed('lesson-upsert-draft')) {
    server.prompt(
        'author-lesson',
        'Rise Path の教材（risepath.lesson/v1）を書いて下書き保存する手順 / Procedure to write a risepath.lesson/v1 lesson and save it as a draft',
        {
            course_slug: z.string().optional().describe('コースのスラッグ（例: vibe-coding） / Course slug, e.g. vibe-coding'),
            lesson_id: z.string().optional().describe('レッスンID（例: vibe-ch1-practice） / Lesson id, e.g. vibe-ch1-practice'),
            brief: z.string().optional().describe('どんな教材にしたいか / What the lesson should teach, and for whom'),
        },
        async ({ course_slug, lesson_id, brief }) => {
            const { source, text } = await buildAuthorLessonPrompt({ courseSlug: course_slug, lessonId: lesson_id, brief });
            return {
                description: `author-lesson (${source})`,
                messages: [{ role: 'user', content: { type: 'text', text } }],
            };
        }
    );
}

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
    const { STATUS_CODES } = await import('node:http');
    const { createMessageRateLimiter } = await import('./messageRateLimit.js');
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

    // Rate limit: 30 calls/min (Phase 8) per learner JWT session, and per learner (rp_turn) on the
    // shared bridge session (mcp-server/messageRateLimit.js).
    const mcpLimiter = createMessageRateLimiter({
        sessions,
        limit: process.env.NODE_ENV !== 'production' ? 300 : 30,
    });
    // An unknown session answers 404 before its body is read.
    const requireKnownSession = (req, res, next) => (
        sessions.has(req.params.sessionId) ? next() : res.status(404).json({ error: 'Session not found' })
    );
    // The body is parsed here (the SDK's own 4 MB limit) so the limiter can read a bridge call's
    // rp_turn; the transport gets it as parsedBody.
    const parseMessageBody = express.json({ limit: '4mb' });

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
    // Unauthenticated on the published port: the body says only whether the database answers.
    // The driver's error text (host, database, role names) goes to stderr.
    app.get('/health', async (_req, res) => {
        const { getPool } = await import('../server/db.js');
        const pool = getPool();
        let dbStatus = 'not_configured';

        if (pool) {
            try {
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 3000)
                );
                await Promise.race([pool.query('SELECT 1'), timeout]);
                dbStatus = 'connected';
            } catch (err) {
                dbStatus = err?.message === 'timeout' ? 'timeout' : 'disconnected';
                console.error('[MCP] /health database check failed:', err?.message || err);
            }
        }

        const status = dbStatus === 'connected' || dbStatus === 'not_configured' ? 'ok' : 'degraded';
        res.json({
            status: isShuttingDown ? 'shutting_down' : status,
            version: '2.4.0',
            profile: activeProfile,
            uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
            active_sessions: Math.floor(sessions.size / 2),
            db: dbStatus,
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
        // and transport.sessionId (for MCP SDK extra.sessionId → resolveMcpUserId)
        const sessionData = { transport, userId, mcpInstance };
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

    app.post('/messages/:sessionId', requireKnownSession, parseMessageBody, mcpLimiter, async (req, res) => {
        const session = sessions.get(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // X-Hermes-Session-Key is not stored on the session: one bridge session carries every
        // learner's calls. resolveMcpUserId reads an rp:turn key from each request's own headers.
        const resolvedUserId = await resolveUserId(req);

        const authFailure = verifyMessagesSessionAuth(resolvedUserId, session.userId);
        if (authFailure) {
            if (authFailure.status === 403) {
                console.error(
                    `[MCP] Session ${req.params.sessionId.slice(0, 8)} userId mismatch: token=${resolvedUserId?.slice(0, 8)} session=${session.userId.slice(0, 8)}`,
                );
            }
            return res.status(authFailure.status).json({ error: authFailure.error });
        }

        await session.transport.handlePostMessage(req, res, req.body);
    });

    // Last: an error no route answered (a body that is not JSON or too large) gets JSON with its
    // status's standard text, never the parser's message or a stack.
    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        const code = err?.status ?? err?.statusCode;
        const status = Number.isInteger(code) && code >= 400 && code < 600 ? code : 500;
        if (status >= 500) console.error(`[MCP] ${req.method} ${req.path} failed:`, err);
        res.status(status).json({ error: STATUS_CODES[status] ?? 'Internal Server Error' });
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
