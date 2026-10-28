import express from 'express';
import { collectRuntimeHealth } from '../services/runtimeHealth.js';

const router = express.Router();

router.get('/health', async (req, res) => {
    // Through the public edge (originGate.js): only ok/status, and no Hermes or Kokoro probes.
    // Loopback and gate-off callers (compose healthcheck, container smoke) keep the full snapshot.
    if (req.originGate === 'edge') {
        try {
            const { ok } = await collectRuntimeHealth({ includeOptional: false });
            res.status(ok ? 200 : 503).json({ ok, status: ok ? 'ok' : 'degraded' });
        } catch {
            res.status(500).json({ ok: false, error: 'health_check_failed' });
        }
        return;
    }
    try {
        const snapshot = await collectRuntimeHealth();
        const status = snapshot.ok ? 200 : 503;
        res.status(status).json({
            ok: snapshot.ok,
            ready_for_prod_data: snapshot.ready_for_prod_data,
            ...snapshot,
        });
    } catch (err) {
        console.error('[Health] snapshot failed:', err?.message);
        res.status(500).json({ ok: false, error: 'health_check_failed' });
    }
});

export default router;