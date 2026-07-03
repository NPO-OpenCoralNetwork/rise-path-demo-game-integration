/**
 * Agent proxy routes — Phase 16-6d
 * POST /api/v2/agent/chat → Hermes API Server
 */
import express from 'express';
import { getPool } from '../db.js';
import {
    validateAgentChatBody,
    callHermesResponses,
    streamHermesChatCompletions,
    getHermesConfig,
} from '../services/hermesAgentService.js';
import { resolveIncludeDiaryExcerpts } from '../services/lifeJournalPrivacyService.js';

const router = express.Router();

router.get('/agent/health', (_req, res) => {
    const cfg = getHermesConfig();
    res.json({
        ok: true,
        hermes_configured: cfg.configured,
        model: cfg.model,
    });
});

router.post('/agent/chat', async (req, res) => {
    const validation = validateAgentChatBody(req.body);
    if (!validation.valid) {
        return res.status(422).json({
            error: 'Invalid agent chat request',
            details: validation.errors,
        });
    }

    const { skill, message, context, includeDiaryExcerpts: requestedDiary, stream } = validation.parsed;
    const userId = req.userId;

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

    if (stream) {
        const streamResult = await streamHermesChatCompletions({
            userId,
            skill,
            message,
            context,
            includeDiaryExcerpts,
        });

        if (!streamResult.ok) {
            return res.status(streamResult.status).json({
                error: streamResult.error,
                error_type: streamResult.error_type,
                detail: streamResult.detail,
            });
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Conversation-Key', streamResult.conversation);
        res.flushHeaders?.();

        const reader = streamResult.body.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(decoder.decode(value, { stream: true }));
            }
            res.end();
        } catch (err) {
            console.error('[Agent Proxy] stream error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Stream interrupted' });
            } else {
                res.end();
            }
        }
        return;
    }

    const result = await callHermesResponses({
        userId,
        skill,
        message,
        context,
        includeDiaryExcerpts,
    });

    if (!result.ok) {
        return res.status(result.status).json({
            error: result.error,
            error_type: result.error_type,
            detail: result.detail,
        });
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