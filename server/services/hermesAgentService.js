/**
 * Hermes Agent proxy — Phase 16-6d
 * Forwards authenticated Web UI chat to Hermes API Server (OpenAI-compatible).
 */
import { setAgentChatConsent } from '../../tools/core/agentSessionStore.js';
import { registerAgentTurn, buildTurnInstruction, TURN_KEY_PREFIX } from '../../tools/core/mcpUserScope.js';
import { DATA_NOT_INSTRUCTIONS, fence, stripTags } from '../llm/prompts/shared.js';

export const ALLOWED_SKILLS = new Set([
    'life-habit-analyst',
    'learning-coach',
    'curriculum-generator',
    'progress-tracker',
    'content-search',
]);

const SKILL_INSTRUCTIONS = {
    'life-habit-analyst': [
        'Use the life-habit-analyst skill.',
        'Call mcp_rise_path_daily_life_chat_context before answering.',
        'Include evidence and caveats. Never claim causation from correlation.',
    ].join(' '),
    'learning-coach': 'Use the learning-coach skill. Be Socratic; do not give full answers immediately.',
    'curriculum-generator': 'Use the curriculum-generator skill for curriculum design workflows.',
    'progress-tracker': 'Use the progress-tracker skill for learning progress guidance.',
    'content-search': 'Use the content-search skill when searching educational materials.',
};

const DEFAULT_INSTRUCTIONS = [
    'You are Lumina (ルミナ), the Rise Path learning coach.',
    'Default language: Japanese unless the user writes in English.',
    'When UI language is provided in the input, respond in that language (en or jp).',
    'Use MCP tools for learner data; do not invent metrics.',
].join(' ');

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

export function getHermesConfig() {
    const baseUrl = (process.env.HERMES_API_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
    const apiKey = cleanString(process.env.HERMES_API_KEY);
    const model = cleanString(process.env.HERMES_MODEL_NAME) || 'hermes-agent';
    return { baseUrl, apiKey, model, configured: Boolean(apiKey) };
}

/**
 * The account generation as a key suffix (Phase 4, tools/core/accountDeletions.js): '' for an
 * account that was never deleted (null: today's keys and stored conversations stay as they are),
 * ':g<epoch seconds of the re-open>' for an account re-opened after a deletion, so its Hermes
 * conversation (stored with store: true) never continues the deleted account's. Anything that is
 * not a positive whole number counts as null.
 * @param {unknown} generation
 */
const generationSuffix = (generation) => (Number.isSafeInteger(generation) && /** @type {number} */ (generation) > 0 ? `:g${generation}` : '');

/** @param {string} userId @param {string} skill @param {number | null} [generation] req.accountGeneration */
export function buildConversationKey(userId, skill, generation = null) {
    return `rp:user:${userId}:${skill}${generationSuffix(generation)}`;
}

/**
 * The X-Hermes-Session-Key Express sends Hermes: stable per learner, because Hermes scopes its own
 * per-channel state by it (a key that changes every turn would start a new scope each time). Hermes
 * does not forward it to the MCP server, and the MCP server ignores rp:user keys from clients; the
 * learner for tool calls comes only from the turn token in `instructions`. A re-opened account
 * (generation set) gets its own scope, as buildConversationKey.
 * @param {string} userId @param {number | null} [generation] req.accountGeneration
 */
export function buildSessionKey(userId, generation = null) {
    return `rp:user:${userId}${generationSuffix(generation)}`;
}

// Lesson context from openTutor() (PLAN §9.1 AskTutorDetail). Every field is learner-controlled,
// so it is bounded, flattened and fenced as data before it reaches Hermes.
export const LESSON_EXCERPT_MAX = 1500;
const LESSON_FIELD_MAX = 200;
const LESSON_ID_MAX = 80;
const LESSON_OBJECTIVES_MAX = 6;
const HIGHLIGHTED_LINES_MAX = 20;
const DATA_TAGS = /<\s*\/?\s*(?:lesson|excerpt)\b[^>]*>/gi;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Untrusted text on one line, without our delimiter tags, at most `max` characters. */
const dataLine = (value, max = LESSON_FIELD_MAX) => (
    typeof value === 'string'
        ? stripTags(value, DATA_TAGS).replace(/\s+/g, ' ').trim().slice(0, max)
        : ''
);

/** Ids and short enums: a conservative character set only. */
const dataId = (value, max = LESSON_ID_MAX) => (
    typeof value === 'string' ? value.replace(/[^\w.:@/-]/g, '').slice(0, max) : ''
);

/**
 * `<lesson>` (course, lesson, title, level, objectives, anchor position) and
 * `<excerpt>` (≤ LESSON_EXCERPT_MAX chars) data blocks, plus mode / learner lines.
 * Returns [] when the request carries no lesson context.
 */
export function buildLessonContextLines(context = {}) {
    const lesson = isPlainObject(context.lesson) ? context.lesson : null;
    const anchor = isPlainObject(context.anchor) ? context.anchor : null;
    const learner = isPlainObject(context.learner) ? context.learner : null;

    const lessonLines = [];
    if (lesson) {
        const courseId = dataId(lesson.courseId);
        const lessonId = dataId(lesson.lessonId);
        const title = dataLine(lesson.title);
        const level = dataLine(lesson.level, 40);
        const objectives = Array.isArray(lesson.objectives)
            ? lesson.objectives.map((o) => dataLine(o)).filter(Boolean).slice(0, LESSON_OBJECTIVES_MAX)
            : [];
        if (courseId) lessonLines.push(`course: ${courseId}`);
        if (lessonId) lessonLines.push(`lesson: ${lessonId}`);
        if (title) lessonLines.push(`title: ${title}`);
        if (level) lessonLines.push(`level: ${level}`);
        if (objectives.length) lessonLines.push('objectives:', ...objectives.map((o) => `- ${o}`));
    }
    if (anchor) {
        const sectionId = dataId(anchor.sectionId);
        const blockId = dataId(anchor.blockId);
        const blockType = dataId(anchor.blockType, 40);
        const codeLang = dataId(anchor.codeLang, 40);
        const lines = Array.isArray(anchor.highlightedLines)
            ? anchor.highlightedLines.filter((n) => Number.isInteger(n) && n > 0 && n < 100000).slice(0, HIGHLIGHTED_LINES_MAX)
            : [];
        if (sectionId) lessonLines.push(`section: ${sectionId}`);
        if (blockId) {
            const kind = [blockType, codeLang].filter(Boolean).join(', ');
            lessonLines.push(`block: ${blockId}${kind ? ` (${kind})` : ''}`);
        }
        if (lines.length) lessonLines.push(`highlighted lines: ${lines.join(', ')}`);
    }

    const excerpt = anchor && typeof anchor.excerpt === 'string'
        ? stripTags(anchor.excerpt, DATA_TAGS).trim().slice(0, LESSON_EXCERPT_MAX)
        : '';

    const out = [];
    if (lessonLines.length) out.push(fence('lesson', lessonLines.join('\n')));
    if (excerpt) out.push(fence('excerpt', excerpt));
    if (!out.length) return out;

    out.unshift(DATA_NOT_INSTRUCTIONS);
    if (context.mode === 'explain' || context.mode === 'socratic') {
        out.push(`Tutor mode: ${context.mode}`);
    }
    if (learner) {
        const facts = [];
        if (Number.isInteger(learner.attemptsOnBlock) && learner.attemptsOnBlock >= 0) {
            facts.push(`attempts on this block: ${Math.min(learner.attemptsOnBlock, 1000)}`);
        }
        const chosen = dataId(learner.chosenOptionId);
        if (chosen) facts.push(`last chosen option: ${chosen}`);
        if (facts.length) out.push(`Learner: ${facts.join('; ')}`);
    }
    return out;
}

export function buildHermesInput({ skill, message, context = {} }) {
    const lines = [`/${skill}`, cleanString(message)];
    if (context.from && context.to) {
        lines.push(`Period: ${context.from} to ${context.to}`);
    }
    if (context.timezone) {
        lines.push(`Timezone: ${context.timezone}`);
    }
    if (context.ui_language === 'en' || context.ui_language === 'jp') {
        lines.push(`UI language: ${context.ui_language}`);
    }
    lines.push(...buildLessonContextLines(context));
    return lines.filter(Boolean).join('\n');
}

export function buildSkillInstructions(skill) {
    const specific = SKILL_INSTRUCTIONS[skill];
    return specific ? `${DEFAULT_INSTRUCTIONS} ${specific}` : DEFAULT_INSTRUCTIONS;
}

export function validateAgentChatBody(body) {
    const errors = [];
    const skill = cleanString(body?.skill);
    const message = cleanString(body?.message);

    if (!skill) errors.push('skill is required');
    else if (!ALLOWED_SKILLS.has(skill)) {
        errors.push(`skill must be one of: ${[...ALLOWED_SKILLS].join(', ')}`);
    }

    if (!message) errors.push('message is required');
    else if (message.length > 4000) errors.push('message must be at most 4000 characters');

    const context = body?.context && typeof body.context === 'object' ? body.context : {};
    if (context.from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(context.from))) {
        errors.push('context.from must be YYYY-MM-DD');
    }
    if (context.to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(context.to))) {
        errors.push('context.to must be YYYY-MM-DD');
    }
    if (context.ui_language !== undefined && context.ui_language !== 'en' && context.ui_language !== 'jp') {
        errors.push('context.ui_language must be en or jp');
    }

    const includeDiaryExcerpts = body?.include_diary_excerpts === true;

    return {
        valid: errors.length === 0,
        errors,
        parsed: {
            skill,
            message,
            context,
            includeDiaryExcerpts,
            stream: body?.stream === true,
        },
    };
}

export function extractAnswerFromHermesResponse(payload) {
    if (!payload || typeof payload !== 'object') return '';

    if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
        return payload.output_text.trim();
    }

    const output = Array.isArray(payload.output) ? payload.output : [];
    const textParts = [];

    for (const item of output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
            for (const part of item.content) {
                if (part?.type === 'output_text' && part.text) textParts.push(part.text);
                else if (typeof part?.text === 'string') textParts.push(part.text);
            }
        }
        if (item?.type === 'output_text' && item.text) textParts.push(item.text);
    }

    if (textParts.length) return textParts.join('\n').trim();

    const choices = payload.choices;
    if (Array.isArray(choices) && choices[0]?.message?.content) {
        return String(choices[0].message.content).trim();
    }

    return '';
}

function appendEvidenceFromPayload(data, evidence) {
    if (!data || typeof data !== 'object') return;

    if (Array.isArray(data.top_correlations)) {
        for (const c of data.top_correlations) {
            if (c?.pair != null && c?.r != null) {
                evidence.push(`${c.pair}: r=${c.r}, n=${c.n ?? '?'}`);
            }
        }
    }

    if (Array.isArray(data.rule_advice)) {
        for (const a of data.rule_advice) {
            if (a?.evidence) evidence.push(String(a.evidence));
        }
    }
}

function tryParseToolPayload(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export function extractEvidenceFromHermesResponse(payload) {
    const evidence = [];
    if (!payload || typeof payload !== 'object') return evidence;

    const output = Array.isArray(payload.output) ? payload.output : [];
    for (const item of output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
            for (const part of item.content) {
                appendEvidenceFromPayload(tryParseToolPayload(part?.text), evidence);
            }
        }
        appendEvidenceFromPayload(tryParseToolPayload(item?.text), evidence);
        appendEvidenceFromPayload(item, evidence);
    }

    return [...new Set(evidence)].slice(0, 10);
}

export function buildResponseCaveats(evidence = []) {
    const caveats = [
        '相関であり因果関係ではありません。',
        '医療・心理診断ではありません。',
    ];
    if (!evidence.length) {
        caveats.push('根拠データがレスポンスに含まれていません。MCP ツール結果を確認してください。');
    }
    return caveats;
}

async function readHermesError(response) {
    try {
        const data = await response.json();
        return data?.error?.message || data?.error || data?.detail || response.statusText;
    } catch {
        return response.statusText || 'Hermes request failed';
    }
}

/**
 * Error codes a fetch can fail with before the request reached Hermes: refused, no DNS answer,
 * no route, connect timeout, bad URL. After any of these Hermes did no work.
 */
const HERMES_CONNECT_CODES = new Set([
    'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_INVALID_URL',
]);

/** Codes on a fetch rejection: its own, its cause's, and an AggregateError's inner errors. */
function fetchErrorCodes(err) {
    const codes = [];
    for (const item of [err, err?.cause]) {
        if (!item) continue;
        if (typeof item.code === 'string') codes.push(item.code);
        if (Array.isArray(item.errors)) {
            for (const inner of item.errors) if (typeof inner?.code === 'string') codes.push(inner.code);
        }
    }
    return codes;
}

/**
 * A rejected fetch to Hermes as a route result. 'hermes_unreachable' only when the connection
 * never opened (HERMES_CONNECT_CODES), so the route can give the daily agent_chat unit back.
 * Anything else ('hermes_interrupted': the headers timeout, a reset or closed socket after the
 * request was sent) may have run the agent, so it stays charged.
 */
export function hermesFetchFailure(err) {
    const codes = fetchErrorCodes(err);
    const neverConnected = codes.length > 0 && codes.every((code) => HERMES_CONNECT_CODES.has(code));
    return neverConnected
        ? { ok: false, status: 503, error: 'Hermes API unreachable', error_type: 'hermes_unreachable', detail: err?.message }
        : { ok: false, status: 503, error: 'Hermes API connection was interrupted', error_type: 'hermes_interrupted', detail: err?.message };
}

/**
 * Everything a Hermes call needs for one chat turn, before Hermes is contacted. Mints the turn
 * token (registerAgentTurn) that tells the MCP server which learner this turn's tool calls act for:
 * Hermes gets it in `instructions` (the rp_turn argument of each tool call). When the binding cannot be written, the turn does not start: the
 * MCP server could not resolve the learner, so Hermes is never called ('agent_session_unavailable',
 * which the route refunds). Then the learner's diary consent for this turn is recorded.
 * @returns {Promise<{ ok: true, conversation: string, input: string, instructions: string, sessionKey: string }
 *   | { ok: false, status: number, error: string, error_type: string }>}
 */
async function beginHermesTurn({ userId, skill, message, context, includeDiaryExcerpts, generation = null }) {
    const turn = await registerAgentTurn(userId);
    if (!turn) {
        return {
            ok: false,
            status: 503,
            error: 'Agent session could not be started',
            error_type: 'agent_session_unavailable',
        };
    }
    await setAgentChatConsent(userId, { includeDiaryExcerpts });
    return {
        ok: true,
        conversation: buildConversationKey(userId, skill, generation),
        input: buildHermesInput({ skill, message, context }),
        instructions: [buildSkillInstructions(skill), buildTurnInstruction(turn)].join('\n'),
        sessionKey: buildSessionKey(userId, generation),
    };
}

export async function callHermesResponses({
    userId,
    skill,
    message,
    context,
    includeDiaryExcerpts,
    generation = null,
    fetchImpl = fetch,
}) {
    const { baseUrl, apiKey, model, configured } = getHermesConfig();
    if (!configured) {
        return {
            ok: false,
            status: 503,
            error: 'Hermes API is not configured (set HERMES_API_KEY)',
            error_type: 'hermes_not_configured',
        };
    }

    const turn = await beginHermesTurn({ userId, skill, message, context, includeDiaryExcerpts, generation });
    if (!turn.ok) return turn;
    const { conversation, input, instructions, sessionKey } = turn;

    let response;
    try {
        response = await fetchImpl(`${baseUrl}/v1/responses`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'X-Hermes-Session-Key': sessionKey,
            },
            body: JSON.stringify({
                model,
                input,
                instructions,
                conversation,
                store: true,
            }),
        });
    } catch (err) {
        return hermesFetchFailure(err);
    }

    if (!response.ok) {
        const detail = await readHermesError(response);
        return {
            ok: false,
            status: response.status >= 500 ? 503 : response.status,
            error: 'Hermes API error',
            error_type: 'hermes_api_error',
            detail,
        };
    }

    const data = await response.json();
    const answer = extractAnswerFromHermesResponse(data);
    const evidence = extractEvidenceFromHermesResponse(data);

    return {
        ok: true,
        status: 200,
        answer,
        evidence,
        caveats: buildResponseCaveats(evidence),
        conversation,
        hermes_response_id: data.id ?? null,
        usage: data.usage ?? null,
        raw: data,
    };
}

export async function streamHermesChatCompletions({
    userId,
    skill,
    message,
    context,
    includeDiaryExcerpts,
    generation = null,
    fetchImpl = fetch,
}) {
    const { baseUrl, apiKey, model, configured } = getHermesConfig();
    if (!configured) {
        return {
            ok: false,
            status: 503,
            error: 'Hermes API is not configured (set HERMES_API_KEY)',
            error_type: 'hermes_not_configured',
        };
    }

    const turn = await beginHermesTurn({ userId, skill, message, context, includeDiaryExcerpts, generation });
    if (!turn.ok) return turn;
    const { conversation, input, instructions, sessionKey } = turn;

    let response;
    try {
        response = await fetchImpl(`${baseUrl}/v1/responses`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'X-Hermes-Session-Key': sessionKey,
            },
            body: JSON.stringify({
                model,
                input,
                instructions,
                conversation,
                store: true,
                stream: true,
            }),
        });
    } catch (err) {
        return hermesFetchFailure(err);
    }

    if (!response.ok) {
        const detail = await readHermesError(response);
        return {
            ok: false,
            status: response.status >= 500 ? 503 : response.status,
            error: 'Hermes API error',
            error_type: 'hermes_api_error',
            detail,
        };
    }

    return {
        ok: true,
        status: 200,
        body: response.body,
        conversation,
    };
}