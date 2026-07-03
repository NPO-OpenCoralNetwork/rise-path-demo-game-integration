/**
 * Hermes Agent proxy — Phase 16-6d
 * Forwards authenticated Web UI chat to Hermes API Server (OpenAI-compatible).
 */
import { setAgentChatConsent, registerAgentSession } from '../../tools/core/agentSessionStore.js';

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