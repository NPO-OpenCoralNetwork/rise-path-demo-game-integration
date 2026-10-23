/**
 * Builds one Rise Path MCP server (tools, resources, prompts) for a profile
 * (mcp-server/tool-registry.json). Used by every transport in mcp-server/index.js: stdio and SSE
 * with the process's active profile, and the remote endpoint (mcp-server/remote.js) with
 * 'learner-remote' and a remote policy, a fresh server per HTTP request.
 *
 * Remote servers (`remote` set) differ in these ways:
 * - The learner is always the user of the verified OAuth access token (tools/core/mcpUserScope.js
 *   step 0); tools take no rp_turn and no user_id argument.
 * - Every tools/call, resources/read and prompts/get first passes remote.gate (adults only,
 *   tools/core/mcpAiAccess.js); every tools/call is charged to the daily caps (remote.charge).
 * - Per-session call counters (policy.js) are not used: a stateless endpoint has no session.
 * - rag-search returns at most REMOTE_RAG_MAX_RESULTS results; learner-state-update accepts only a
 *   known domain (tools/core/domains.js).
 *
 * The course-* tools (course-list, course-lesson-get, course-quiz-check, course-progress-get,
 * course-progress-update) teach the published risepath.lesson/v1 lessons: lessons are read without
 * answers, quiz answers are graded on the server with the reader's attempt rules, and progress is
 * the same lesson_progress record the web reader syncs (tools/core/courseLessons.js and
 * lessonProgress.js). They act for the scoped learner only and return compact JSON.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { activeProfile, getToolAnnotations, isEntryExposed, toolMeta, toolsForProfile } from './profileFilter.js';
import { checkPolicy, auditLog, hasCallLimit } from './policy.js';

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
import { adultDraftRefusal } from '../tools/core/mcpAiAccess.js';
import { DOMAINS, DOMAIN_COURSE_SLUGS } from '../tools/core/domains.js';
import { getCourseLesson, getCourseProgress, listCourses, tutorCourseNote } from '../tools/core/courseLessons.js';
import { applyQuizCheck, markLessonProgress } from '../tools/core/lessonProgress.js';

/** rag-search results per call on the remote endpoint (the stdio/SSE cap is MAX_SEARCH_RESULTS). */
export const REMOTE_RAG_MAX_RESULTS = 5;
/**
 * JSON-RPC code of an adults-only refusal on resources/read and prompts/get: server-defined range,
 * not -32000/-32001 (the SDK's ConnectionClosed/RequestTimeout) nor -32002 (resource not found).
 */
export const REMOTE_ACCESS_REFUSED = -32003;
/** Longest lesson_id learner-state-update stores from a remote call. */
const REMOTE_LESSON_ID_MAX = 128;
const DOMAIN_IDS = new Set(DOMAINS.map((d) => d.id));

/** rag-search max_results on the remote endpoint: 1..REMOTE_RAG_MAX_RESULTS, default 3. */
export function remoteRagResults(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), REMOTE_RAG_MAX_RESULTS) : 3;
}

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

const USER_ID_DESC = 'ユーザーID。指定しても無視されます。学習者はこのターンの rp_turn（または学習者本人の JWT セッション）で決まります / Ignored: the learner comes from this turn\'s rp_turn (or the learner\'s own JWT session)';

/**
 * The remote endpoint's per-call policy (mcp-server/remotePolicy.js).
 * @typedef {object} RemotePolicy
 * @property {(extra: any) => Promise<{ userId: string } | { refusal: Record<string, unknown> }>} gate
 *   the token's user when they may use the endpoint now (adult, ready), else the tool error
 * @property {(userId: string, toolName: string) => Promise<Record<string, unknown> | null>} charge
 *   charge one tools/call to the daily caps; a tool error when a cap refuses it
 */

/**
 * Create a fully-configured McpServer instance.
 * Called once per connection (SSE), once for stdio, or once per HTTP request (remote).
 * MCP SDK requires 1 Server = 1 Transport, so SSE multi-client
 * needs a fresh instance per connection.
 * @param {{
 *   profile?: string,
 *   sessions?: Map<string, any>,
 *   lessonFsWrite?: boolean,
 *   remote?: RemotePolicy | null,
 * }} [options]
 *   profile: tool-registry.json profile (default: the process's active profile);
 *   sessions: the SSE sessions map (mcp-server/index.js), empty for stdio and remote;
 *   lessonFsWrite: whether lesson-upsert-draft may write draft files;
 *   remote: set for the remote OAuth endpoint (see the header)
 */
export function createMcpServer({
    profile = activeProfile,
    sessions = new Map(),
    lessonFsWrite = true,
    remote = null,
} = {}) {
const allowedTools = new Set(toolsForProfile(profile));
const isToolAllowed = (name) => allowedTools.has(name);
const isRemote = Boolean(remote);
const LESSON_FS_WRITE = lessonFsWrite;

/**
 * The learner this call acts for. Inside a tool, policyTool resolved it once for the call (with
 * its rp_turn) as extra.resolveScope; resources resolve from the session and request.
 * @returns {Promise<{ userId: string } | { error: string, error_type: string }>}
 */
function resolveScopeFor(extra) {
    return typeof extra?.resolveScope === 'function'
        ? extra.resolveScope()
        : resolveMcpUserId({ extra, sessions, remote: isRemote });
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

/**
 * Remote resources and prompts: the gate's refusal as a JSON-RPC error (a resource or prompt has
 * no error result), its message in both languages and its error_type in data. A plain Error with
 * code and data, not McpError, whose message would gain an 'MCP error <code>: ' prefix that the
 * client prefixes again; and a server-defined code, so the refusal does not read as a malformed
 * request (-32600).
 */
async function remoteGateOrThrow(extra) {
    if (!remote) return;
    const gate = await remote.gate(extra);
    if ('refusal' in gate) {
        const { error, ...data } = gate.refusal;
        throw Object.assign(new Error(String(error)), { code: REMOTE_ACCESS_REFUSED, data });
    }
}

const server = new McpServer({
    name: 'rise-path-learning',
    version: '2.4.0',
    description: `Rise Path パーソナライズ学習プラットフォームのMCP Server (profile: ${profile})`,
});

// Every tool takes the turn token Express mints per chat turn (tools/core/mcpUserScope.js).
const turnArgSchema = () => z.string().max(128).optional().describe(
    'このターンの指示で渡された rp_turn をそのまま渡す（学習者の特定に使う） / The rp_turn value given in this turn\'s instructions, passed unchanged; it identifies the learner'
);

// Remote: the user is the token's (step 0), so no tool takes rp_turn or user_id. The gate runs
// before anything else, then the daily caps; the audit line names the OAuth client.
const remoteTool = (name, desc, schema, handler) => {
    const { user_id: _userIdArg, ...remoteSchema } = schema;
    server.tool(name, desc, remoteSchema, getToolAnnotations(name), async (args, extra) => {
        const toolArgs = args ?? {};
        const gate = await remote.gate(extra);
        if ('refusal' in gate) return toolResult(gate.refusal, { toolName: name, startTime: Date.now() });
        const capped = await remote.charge(gate.userId, name);
        if (capped) return toolResult(capped, { toolName: name, startTime: Date.now() });
        const callExtra = { ...extra, resolveScope: async () => ({ userId: gate.userId }) };
        const result = await handler(toolArgs, callExtra);
        if (toolMeta.get(name)?.audit) {
            let auditPayload = {};
            const auditText = result?.content?.[0]?.text;
            if (auditText) {
                try {
                    auditPayload = JSON.parse(auditText);
                } catch {
                    auditPayload = { raw: auditText };
                }
            }
            auditLog(name, gate.userId, toolArgs, auditPayload, { clientId: extra?.authInfo?.clientId });
        }
        return result;
    });
};

// Phase 11: Policy-aware tool wrapper
const policyTool = (name, desc, schema, handler) => {
    if (!isToolAllowed(name)) return; // Profile filter: don't register
    if (isRemote) return remoteTool(name, desc, schema, handler);
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
    '科目（ドメイン）ごとの旧形式の進捗とマスタリーを取得する。vibe-coding と claude-code のレッスンの進み具合は course-progress-get で取得する / Legacy per-domain progress and mastery. For the lessons of vibe-coding and claude-code (domains with a course_slug in content://domains), use course-progress-get.',
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
    '旧形式の科目（ドメイン）の進捗に、終えたレッスンを記録する。vibe-coding と claude-code のレッスンには course-progress-update と course-quiz-check を使う（この記録は Web のレッスン画面には反映されない） / Records a finished lesson in a legacy domain\'s progress. For vibe-coding and claude-code lessons use course-progress-update and course-quiz-check: this record does not reach the web lesson reader.',
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
            // Remote agents write only known domains and short lesson ids (stored as given).
            if (isRemote && !DOMAIN_IDS.has(domain)) {
                return toolResult({ error: `Unknown domain. Use one of: ${[...DOMAIN_IDS].join(', ')} (resource content://domains)`, error_type: 'invalid_domain' }, { toolName: 'learner-state-update', startTime: t });
            }
            if (isRemote && (!lesson_id || lesson_id.length > REMOTE_LESSON_ID_MAX)) {
                return toolResult({ error: `lesson_id must be 1-${REMOTE_LESSON_ID_MAX} characters`, error_type: 'invalid_lesson_id' }, { toolName: 'learner-state-update', startTime: t });
            }

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
        max_results: z.number().optional().describe(isRemote
            ? `最大結果数 1-${REMOTE_RAG_MAX_RESULTS} (デフォルト: 3、上限を超える値は ${REMOTE_RAG_MAX_RESULTS} 件) / Maximum results, 1-${REMOTE_RAG_MAX_RESULTS} (default 3; larger values return ${REMOTE_RAG_MAX_RESULTS})`
            : `最大結果数 1-${MAX_SEARCH_RESULTS} (デフォルト: 3、上限を超える値は ${MAX_SEARCH_RESULTS} 件) / Maximum results, 1-${MAX_SEARCH_RESULTS} (default 3; larger values return ${MAX_SEARCH_RESULTS})`),
    },
    async ({ query, domain, max_results }, extra) => {
        const t = Date.now();
        try {
            const userId = await requireScopedUser(undefined, extra, { toolName: 'rag-search', startTime: t });
            if (typeof userId !== 'string') return userId;

            const maxResults = isRemote ? remoteRagResults(max_results) : max_results;
            return toolResult(await searchContent({ query, domain, maxResults, userId }), { toolName: 'rag-search', startTime: t });
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
        try {
            const userId = await requireScopedUser(args.user_id, extra, { toolName: 'save-curriculum-draft', startTime: t });
            if (typeof userId !== 'string') return userId;
            // A learner's own JWT session: outside-AI drafts are adults only (tools/core/mcpAiAccess.js).
            const refusal = await adultDraftRefusal({ extra, sessions });
            if (refusal) return toolResult(refusal, { toolName: 'save-curriculum-draft', startTime: t });

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
                const refusal = await adultDraftRefusal({ extra, sessions });
                if (refusal) return toolResult(refusal, { toolName: 'lesson-upsert-draft', startTime: t });
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

// --- courses (published lessons for learners; tools/core/courseLessons.js, lessonProgress.js) ---
// Named course-* (not lesson-*: those are the authoring tools). Reads need no database; quiz
// checks and progress act for the scoped learner only. Results are compact JSON (a lesson read is
// several thousand tokens).
const courseLocale = () => z.string().max(16).optional().describe('jp または en（ja、en-US も可）。レッスンにない言語なら元の言語 / jp or en (ja, en-US also work); a lesson without that language uses its source language');
const courseItemId = () => z.string().min(1).max(80);
const courseSlugArg = () => lessonSlug().describe(`コースのスラッグ（例: vibe-coding）。course-list の course_slug / Course slug from course-list, e.g. vibe-coding (${LESSON_SLUG_DESC})`);
const courseLessonArg = () => lessonSlug().describe('レッスンID（例: vibe-ch1）。course-list の lessons[].id / Lesson id from course-list, e.g. vibe-ch1');

policyTool(
    'course-list',
    'Rise Path の公開コースと、そのモジュール・レッスン（問題数、確認テストの有無）の一覧 / Lists the published Rise Path courses with their modules and lessons (number of questions, whether there is an exam).',
    {
        locale: courseLocale(),
    },
    async ({ locale }) => {
        const t = Date.now();
        try {
            return toolResult(listCourses({ locale }), { toolName: 'course-list', startTime: t, compact: true });
        } catch (err) {
            return toolError(err, { toolName: 'course-list', startTime: t });
        }
    }
);

policyTool(
    'course-lesson-get',
    'レッスンを読む（クイズの答え・解説・ヒントは含まない。選択肢は "1"〜"n" のラベル）。section_id なしなら目次と、学習者がまだ終えていない最初のセクション。tutor_protocol に従って教える / Reads a lesson without quiz answers, explanations or hints (options are labelled "1".."n"). Without section_id: the outline plus the first section the learner has not finished. Follow the returned tutor_protocol.',
    {
        course_slug: courseSlugArg(),
        lesson_id: courseLessonArg(),
        section_id: courseItemId().optional().describe('読むセクションの id（目次の sections[].id）。"all" でレッスン全体（大きいので、ふつうは1セクションずつ読む） / A section id from the outline, or "all" for the whole lesson (large: prefer one section at a time)'),
        locale: courseLocale(),
    },
    async ({ course_slug, lesson_id, section_id, locale }, extra) => {
        const t = Date.now();
        try {
            // Only the first read (no section_id) looks at progress; a learner who cannot be
            // resolved still gets the lesson, from its first section.
            let userId = null;
            if (section_id === undefined) {
                const scope = await resolveScopeFor(extra);
                if (!scope.error && typeof scope.userId === 'string') userId = scope.userId;
            }
            return toolResult(await getCourseLesson({
                courseSlug: course_slug, lessonId: lesson_id, sectionId: section_id, locale, userId,
            }), { toolName: 'course-lesson-get', startTime: t, compact: true });
        } catch (err) {
            return toolError(err, { toolName: 'course-lesson-get', startTime: t });
        }
    }
);

policyTool(
    'course-quiz-check',
    'クイズの答えを Rise Path で採点し、学習者の解答として記録する。呼ぶたびに学習者自身の解答として残り、取り消せない。学習者が選んだ答えだけを送り、エージェントが選択肢を選んだり試したりしない。reveal は、不正解のあと学習者が答えを見たいと言ったときだけ使う。不正解はエラーではなく通常の結果（フィードバックつき） / Grades a quiz answer on Rise Path and records it as the learner\'s attempt. Each call permanently records the learner\'s own attempt: submit only the learner\'s choice, and never pick or probe options yourself. Use reveal only when the learner asks for the answer after a miss. A wrong answer is a normal result with feedback, not an error.',
    {
        course_slug: courseSlugArg(),
        lesson_id: courseLessonArg(),
        question_id: courseItemId().describe('問題の id（course-lesson-get の questions[].id） / Question id from course-lesson-get'),
        block_id: courseItemId().optional().describe('問題のブロック id（省略可） / The question\'s block id (optional)'),
        choices: z.array(z.union([z.string().max(8), z.number()])).max(12).optional().describe('学習者が選んだ選択肢のラベル（"1"〜"n" または 1〜n）。multiple: true の問題だけ複数 / The option labels the learner chose ("1".."n" or 1..n); several only for multiple: true questions'),
        reveal: z.boolean().optional().describe('不正解のあと学習者が答えを求めたときだけ true（choices は送らない） / true only when the learner asks for the answer after a miss (send no choices)'),
        content_hash: z.string().max(80).optional().describe('course-lesson-get の content_hash。レッスンが変わっていたら採点せず lesson_changed / content_hash from course-lesson-get; if the lesson changed since, nothing is graded (lesson_changed)'),
        locale: courseLocale(),
    },
    async ({ course_slug, lesson_id, question_id, block_id, choices, reveal, content_hash, locale }, extra) => {
        const t = Date.now();
        try {
            const userId = await requireScopedUser(undefined, extra, { toolName: 'course-quiz-check', startTime: t });
            if (typeof userId !== 'string') return userId;
            return toolResult(await applyQuizCheck({
                userId,
                courseSlug: course_slug,
                lessonId: lesson_id,
                questionId: question_id,
                blockId: block_id,
                choices,
                reveal: reveal === true,
                contentHash: content_hash,
                locale,
            }), { toolName: 'course-quiz-check', startTime: t, compact: true });
        } catch (err) {
            return toolError(err, { toolName: 'course-quiz-check', startTime: t });
        }
    }
);

policyTool(
    'course-progress-get',
    'レッスンの進み具合を取得する。lesson_id なし: 公開レッスンごとの pct と state。course_slug と lesson_id あり: セクションごとの進み具合、問題ごとの解答状況（答えは含まない）、再開位置、確認テストの初回正答 / The learner\'s lesson progress. Without lesson_id: pct and state of every published lesson (of course_slug, or of every course). With course_slug and lesson_id: sections done, each question\'s status (no answers), where to resume and the exam first-try score.',
    {
        course_slug: lessonSlug().optional().describe(`コースのスラッグ。省略するとすべてのコース / Course slug; omitted: every course (${LESSON_SLUG_DESC})`),
        lesson_id: lessonSlug().optional().describe('レッスンID（course_slug と一緒に） / Lesson id (with course_slug)'),
        locale: courseLocale(),
    },
    async ({ course_slug, lesson_id, locale }, extra) => {
        const t = Date.now();
        try {
            const userId = await requireScopedUser(undefined, extra, { toolName: 'course-progress-get', startTime: t });
            if (typeof userId !== 'string') return userId;
            return toolResult(await getCourseProgress({
                userId, courseSlug: course_slug, lessonId: lesson_id, locale,
            }), { toolName: 'course-progress-get', startTime: t, compact: true });
        } catch (err) {
            return toolError(err, { toolName: 'course-progress-get', startTime: t });
        }
    }
);

policyTool(
    'course-progress-update',
    '学習者が取り組んだセクションを読み終えたと記録し、再開位置を設定する。学習者が実際に取り組んだセクションだけを記録する。確認問題に答えていないセクションは記録されず skipped に入る（先に course-quiz-check） / Marks sections the learner worked through as read and sets where to resume. Mark only sections the learner actually worked through. A section whose check questions are unanswered is skipped (answer them with course-quiz-check first).',
    {
        course_slug: courseSlugArg(),
        lesson_id: courseLessonArg(),
        read_section_ids: z.array(courseItemId()).max(50).optional().describe('読み終えたセクションの id / Ids of the sections the learner worked through'),
        last_block_id: courseItemId().optional().describe('次に再開するブロックの id / Id of the block to resume at'),
    },
    async ({ course_slug, lesson_id, read_section_ids, last_block_id }, extra) => {
        const t = Date.now();
        try {
            const userId = await requireScopedUser(undefined, extra, { toolName: 'course-progress-update', startTime: t });
            if (typeof userId !== 'string') return userId;
            return toolResult(await markLessonProgress({
                userId,
                courseSlug: course_slug,
                lessonId: lesson_id,
                readSectionIds: read_section_ids,
                lastBlockId: last_block_id,
            }), { toolName: 'course-progress-update', startTime: t, compact: true });
        } catch (err) {
            return toolError(err, { toolName: 'course-progress-update', startTime: t });
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

// Resources and prompts follow registry.resources / registry.prompts (lesson schemas and
// author-lesson follow the lesson tools, below).
if (isEntryExposed('resources', 'content-domains', profile)) server.resource(
    'content-domains',
    'content://domains',
    { description: '利用可能な学習ドメインの一覧（course_slug のあるドメインは course-* ツールで学ぶ） / Learning domains; a domain with a course_slug is taught with the course-* tools', mimeType: 'application/json' },
    async (uri, extra) => {
        await remoteGateOrThrow(extra);
        return {
            contents: [{
                uri: uri.href,
                mimeType: 'application/json',
                text: JSON.stringify({
                    domains: DOMAINS.map(d => ({
                        id: d.id, name: d.name, description: d.description, lessons: d.maxStages,
                        ...(DOMAIN_COURSE_SLUGS[d.id] ? { course_slug: DOMAIN_COURSE_SLUGS[d.id] } : {}),
                    })),
                }, null, 2),
            }],
        };
    }
);

if (isEntryExposed('resources', 'learner-profile', profile)) server.resource(
    'learner-profile',
    'learner://profile/me',
    { description: '認証セッションの学習者プロフィール (診断結果・学習スタイル)', mimeType: 'application/json' },
    async (uri, extra) => {
        await remoteGateOrThrow(extra);
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

// With course_slug (and lesson_id), where the profile has the course tools: the lesson, how to use
// those tools and the tutoring protocol that course-lesson-get also returns.
const tutorTakesCourse = isToolAllowed('course-lesson-get');
if (isEntryExposed('prompts', 'socratic-tutor', profile)) server.prompt(
    'socratic-tutor',
    tutorTakesCourse
        ? 'ソクラテス式対話で学習者を導くためのプロンプト。course_slug と lesson_id を渡すと、そのレッスンを course-* ツールで教える / Prompt to guide the learner with Socratic questions; with course_slug and lesson_id it teaches that lesson with the course-* tools'
        : 'ソクラテス式対話で学習者を導くためのプロンプト',
    {
        topic: z.string().max(500).describe('学習トピック'),
        ...(tutorTakesCourse ? {
            course_slug: lessonSlug().optional().describe('コースのスラッグ（例: vibe-coding） / Course slug, e.g. vibe-coding'),
            lesson_id: lessonSlug().optional().describe('レッスンID（例: vibe-ch1。course_slug と一緒に） / Lesson id, e.g. vibe-ch1 (with course_slug)'),
        } : {}),
    },
    async ({ topic, course_slug, lesson_id }, extra) => {
        await remoteGateOrThrow(extra);
        const course = tutorTakesCourse ? tutorCourseNote({ courseSlug: course_slug, lessonId: lesson_id }) : { text: '' };
        if ('error' in course) {
            // JSON-RPC invalid params (-32602): the named course or lesson is not published.
            throw Object.assign(new Error(course.error), { code: -32602, data: { error_type: course.error_type } });
        }
        return {
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
- 成功したら称賛し、つまずいたら共感する${course.text ? `\n\n${course.text}` : ''}`,
            },
        }],
        };
    }
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
