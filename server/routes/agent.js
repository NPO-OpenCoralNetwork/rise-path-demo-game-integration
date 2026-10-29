/**
 * Agent proxy routes — Phase 16-6d
 * POST /api/v2/agent/chat → Hermes API Server
 *
 * Cost: each chat that reaches Hermes takes one 'agent_chat' unit of the daily caps
 * (server/middleware/dailyCaps.js); the client's no-stream retry is a second paid call and
 * counts again. Validation (422) and diary (403) rejections are never charged; Hermes not
 * configured, a turn whose learner binding could not be written (Hermes is then not called), a
 * connection that never opened, or Hermes refusing our key (401/403) gives the unit back.
 *
 * Errors: the client gets a fixed { error, error_type }, never Hermes's or OpenRouter's own text
 * (that goes to the server log), and never Hermes's own 4xx status (a 401 from Hermes is not the
 * learner's sign-in): any Hermes error answers 502, or 503 when Hermes is down or rate limited.
 */
import express from 'express';
import { getPool } from '../db.js';
import { reserveDailyCap } from '../middleware/dailyCaps.js';
import {
    validateAgentChatBody,
    callHermesResponses,
    streamHermesChatCompletions,
    getHermesConfig,
} from '../services/hermesAgentService.js';
import { resolveIncludeDiaryExcerpts } from '../services/lifeJournalPrivacyService.js';

const router = express.Router();

/**
 * The shared Hermes chat is not offered to learners (Phase 0, doc/brushup-2026/ai-access-plan.ja.md).
 * The server uses the same switch as the front end (config/features.ts): POST /agent/chat runs
 * only when VITE_FEATURE_AGENT_CHAT is exactly "true", so a stack that still runs Hermes does not
 * serve it to a hand-made request. Checked before validation and the daily caps (never charged).
 * @param {Record<string, string | undefined>} [env]
 */
export const isAgentChatEnabled = (env = process.env) => env.VITE_FEATURE_AGENT_CHAT === 'true';

/**
 * Hermes did no work: not configured, the turn's learner binding could not be written (Hermes was
 * not called), the connection never opened (hermesFetchFailure), or it refused our API key
 * (401/403). 'hermes_interrupted' (a timeout or reset after the request was sent) and any other
 * Hermes error stay charged.
 */
const hermesNeverRan = (result) => result.error_type === 'hermes_not_configured'
    || result.error_type === 'agent_session_unavailable'
    || result.error_type === 'hermes_unreachable'
    || (result.error_type === 'hermes_api_error' && (result.status === 401 || result.status === 403));

/** Answer a failed Hermes call: fixed text for the client, the upstream detail in the log only. */
const sendHermesFailure = (res, result) => {
    if (result.detail) console.warn(`[Agent Proxy] ${result.error_type} (${result.status}): ${result.detail}`);
    const status = result.error_type !== 'hermes_api_error'
        ? result.status
        : result.status >= 500 || result.status === 429 ? 503 : 502;
    return res.status(status).json({ error: result.error, error_type: result.error_type });
};

/**
 * Keeps an SSE proxy alive through idle Hermes pauses: every intervalMs with nothing forwarded,
 * writes the comment frame ': ping' (as llm.js does), so the Vercel (120 s) and Cloudflare
 * (125 s) idle windows do not cut the stream. It pings only between events: the text forwarded so
 * far must end with a blank line (or nothing was forwarded yet), so a ping never splits an event.
 * @param {import('express').Response} res
 * @param {{ intervalMs?: number }} [options]
 * @returns {{ write: (text: string) => boolean, stop: () => void }}
 */
export function startSseHeartbeat(res, { intervalMs = 15000 } = {}) {
    let started = false;
    let tail = '';
    let sentSinceTick = false;

    const atEventBoundary = () => !started || tail.endsWith('\n\n') || tail.endsWith('\r\n\r\n');
    const timer = setInterval(() => {
        if (!sentSinceTick && atEventBoundary() && !res.writableEnded) res.write(': ping\n\n');
        sentSinceTick = false;
    }, intervalMs);

    return {
        write(text) {
            if (text) {
                started = true;
                sentSinceTick = true;
                tail = (tail + text).slice(-4);
            }
            return res.write(text);
        },
        stop() {
            clearInterval(timer);
        },
    };
}

router.get('/agent/health', (_req, res) => {
    const cfg = getHermesConfig();
    res.json({
        ok: true,
        hermes_configured: cfg.configured,
        model: cfg.model,
    });
});

router.post('/agent/chat', async (req, res) => {
    if (!isAgentChatEnabled()) {
        return res.status(404).json({ error: 'Agent chat is not offered', error_type: 'agent_chat_off' });
    }
    const validation = validateAgentChatBody(req.body);
    if (!validation.valid) {
        return res.status(422).json({
            error: 'Invalid agent chat request',
            details: validation.errors,
        });
    }

    const { skill, message, context, includeDiaryExcerpts: requestedDiary, stream } = validation.parsed;
    const userId = req.userId;
    // A re-opened account (Phase 4) gets its own Hermes conversation and session keys.
    const generation = req.accountGeneration ?? null;

    const includeDiaryExcerpts = await resolveIncludeDiaryExcerpts(
        getPool(),
        userId,
        requestedDiary,
    );

    if (requestedDiary && !includeDiaryExcerpts) {
        return res.status(403).json({
            error: 'Diary excerpts require opt-in in Settings → Privacy',
            error_type: 'diary_excerpts_not_allowed',
        });
    }

    const cap = await reserveDailyCap(req, res, 'agent_chat');
    if (!cap) return;

    if (stream) {
        const streamResult = await streamHermesChatCompletions({
            userId,
            skill,
            message,
            context,
            includeDiaryExcerpts,
            generation,
        });

        if (!streamResult.ok) {
            if (hermesNeverRan(streamResult)) void cap.refund();
            return sendHermesFailure(res, streamResult);
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Conversation-Key', streamResult.conversation);
        res.flushHeaders?.();
        const heartbeat = startSseHeartbeat(res);
        res.on('close', heartbeat.stop);

        const reader = streamResult.body.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                heartbeat.write(decoder.decode(value, { stream: true }));
            }
            res.end();
        } catch (err) {
            console.error('[Agent Proxy] stream error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Stream interrupted' });
            } else {
                res.end();
            }
        } finally {
            heartbeat.stop();
        }
        return;
    }

    const result = await callHermesResponses({
        userId,
        skill,
        message,
        context,
        includeDiaryExcerpts,
        generation,
    });

    if (!result.ok) {
        if (hermesNeverRan(result)) void cap.refund();
        return sendHermesFailure(res, result);
    }

    return res.json({
        ok: true,
        answer: result.answer,
        skill,
        conversation: result.conversation,
        evidence: result.evidence ?? [],
        caveats: result.caveats ?? [],
        privacy: {
            diary_included: includeDiaryExcerpts,
        },
        hermes_response_id: result.hermes_response_id,
        usage: result.usage,
    });
});

export default router;