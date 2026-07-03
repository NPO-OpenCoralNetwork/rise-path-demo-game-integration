import express from 'express';
import { collectRuntimeHealth } from '../services/runtimeHealth.js';

const router = express.Router();

router.get('/health', async (_req, res) => {
    try {
        const snapshot = await collectRuntimeHealth();
        const status = snapshot.ok ? 200 : 503;
        res.status(status).json({
            ok: snapshot.ok,
            ready_for_prod_data: snapshot.ready_for_prod_data,
            ...snapshot,
        });
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: 'health_check_failed',
            message: err.message,
        });
    }
});

export default router;