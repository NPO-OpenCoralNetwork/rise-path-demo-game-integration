/**
 * Hermes Agent proxy — Phase 16-6d
 * Forwards authenticated Web UI chat to Hermes API Server (OpenAI-compatible).
 */
import { setAgentChatConsent, registerAgentSession } from '../../tools/core/agentSessionStore.js';
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

export function buildConversationKey(userId, skill) {
    return `rp:user:${userId}:${skill}`;
}

export function buildSessionKey(userId) {
    return `rp:user:${userId}`;
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

export async function callHermesResponses({
    userId,
    skill,
    message,
    context,
    includeDiaryExcerpts,
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

    const conversation = buildConversationKey(userId, skill);
    const sessionKey = buildSessionKey(userId);
    const input = buildHermesInput({ skill, message, context });
    await registerAgentSession(sessionKey, userId);
    await setAgentChatConsent(userId, { includeDiaryExcerpts });

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
                instructions: buildSkillInstructions(skill),
                conversation,
                store: true,
            }),
        });
    } catch (err) {
        return {
            ok: false,
            status: 503,
            error: 'Hermes API unreachable',
            error_type: 'hermes_unreachable',
            detail: err.message,
        };
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

    const conversation = buildConversationKey(userId, skill);
    const sessionKey = buildSessionKey(userId);
    const input = buildHermesInput({ skill, message, context });
    await registerAgentSession(sessionKey, userId);
    await setAgentChatConsent(userId, { includeDiaryExcerpts });

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
                instructions: buildSkillInstructions(skill),
                conversation,
                store: true,
                stream: true,
            }),
        });
    } catch (err) {
        return {
            ok: false,
            status: 503,
            error: 'Hermes API unreachable',
            error_type: 'hermes_unreachable',
            detail: err.message,
        };
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