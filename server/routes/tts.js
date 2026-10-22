import { Router } from 'express';
import { checkKokoroHealth, requestTts } from '../../tools/core/kokoroTts.js';

const router = Router();

export async function ttsHealthHandler(req, res) {
    const health = await checkKokoroHealth();
    if (!health.ok) {
        return res.status(503).json({
            status: 'unavailable',
            engine: health.engine || 'kokoro-82m-onnx',
            models_ready: health.models_ready ?? false,
        });
    }
    return res.json({
        status: 'ok',
        engine: health.engine || 'kokoro-82m-onnx',
        models_ready: health.models_ready ?? true,
    });
}

router.post('/tts/synthesize', async (req, res) => {
    try {
        const {
            text,
            language = 'ja',
            voice_id,
            lang_code,
            speed,
            output_format = 'mp3',
            lesson_id,
        } = req.body || {};

        if (!text || !String(text).trim()) {
            return res.status(400).json({ error: 'text is required', error_type: 'validation' });
        }

        const result = await requestTts({
            userId: req.userId || null,
            text,
            language,
            voice_id,
            lang_code,
            speed,
            output_format,
            lesson_id,
        });

        if (result.error_type === 'validation') return res.status(400).json(result);
        // requestTts logged the sidecar's error and body; its answer carries neither.
        if (result.error_type) return res.status(503).json({ error: result.error, error_type: result.error_type });

        const { buffer, cache_key: _cacheKey, ...payload } = result;
        return res.json(payload);
    } catch (err) {
        console.error('[TTS API] synthesize error:', err.message);
        return res.status(500).json({ error: 'TTS synthesis failed', error_type: 'internal' });
    }
});

export default router;