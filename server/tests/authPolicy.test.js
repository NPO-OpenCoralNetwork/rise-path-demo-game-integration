import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { isStrictAuthMode, allowDevAuthFallback } from '../middleware/authPolicy.js';
import { requireAuth } from '../middleware/auth.js';
import { resetPoolForTests } from '../db.js';

describe('authPolicy', () => {
    const envBackup = { ...process.env };

    afterEach(() => {
        process.env = { ...envBackup };
    });

    it('enables strict mode when VITE_DEMO_MODE=false', () => {
        process.env.NODE_ENV = 'development';
        process.env.VITE_DEMO_MODE = 'false';
        delete process.env.RISEPATH_STRICT_AUTH;
        assert.equal(isStrictAuthMode(), true);
        assert.equal(allowDevAuthFallback(), false);
    });

    it('allows dev fallback in demo mode development', () => {
        process.env.NODE_ENV = 'development';
        process.env.VITE_DEMO_MODE = 'true';
        delete process.env.RISEPATH_STRICT_AUTH;
        assert.equal(isStrictAuthMode(), false);
        assert.equal(allowDevAuthFallback(), true);
    });

    it('enables strict mode when RISEPATH_STRICT_AUTH=true', () => {
        process.env.NODE_ENV = 'development';
        process.env.VITE_DEMO_MODE = 'true';
        process.env.RISEPATH_STRICT_AUTH = 'true';
        assert.equal(isStrictAuthMode(), true);
    });
});

describe('requireAuth strict mode', () => {
    const envBackup = { ...process.env };

    beforeEach(() => {
        resetPoolForTests();
    });

    afterEach(() => {
        process.env = { ...envBackup };
        resetPoolForTests();
    });

    it('returns 401 without token when strict auth is active', async () => {
        process.env.NODE_ENV = 'development';
        process.env.VITE_DEMO_MODE = 'false';
        delete process.env.SUPABASE_URL;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        const app = express();
        app.get('/protected', requireAuth, (req, res) => {
            res.json({ userId: req.userId, authMethod: req.authMethod });
        });

        const server = await new Promise((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        const { port } = server.address();

        try {
            const response = await fetch(`http://127.0.0.1:${port}/protected`);
            assert.equal(response.status, 401);
            const payload = await response.json();
            assert.equal(payload.error, 'Authentication required');
        } finally {
            await new Promise((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        }
    });
});