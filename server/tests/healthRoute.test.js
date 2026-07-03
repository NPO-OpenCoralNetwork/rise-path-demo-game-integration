import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import healthRoutes from '../routes/health.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';

const buildApp = () => {
    const app = express();
    app.use('/api/v2', healthRoutes);
    return app;
};

const withServer = async (handler) => {
    const app = buildApp();
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address();
    try {
        await handler(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }
};

describe('GET /api/v2/health', () => {
    const originalDb = process.env.DATABASE_URL_PHASE1;
    const originalSupabaseUrl = process.env.SUPABASE_URL;
    const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const originalDemoMode = process.env.VITE_DEMO_MODE;

    beforeEach(() => {
        delete process.env.DATABASE_URL_PHASE1;
        resetPoolForTests();
        setPoolForTests(null);
    });

    afterEach(() => {
        resetPoolForTests();
        if (originalDb === undefined) delete process.env.DATABASE_URL_PHASE1;
        else process.env.DATABASE_URL_PHASE1 = originalDb;
        if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
        else process.env.SUPABASE_URL = originalSupabaseUrl;
        if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
        if (originalDemoMode === undefined) delete process.env.VITE_DEMO_MODE;
        else process.env.VITE_DEMO_MODE = originalDemoMode;
    });

    it('returns 503 when database and supabase are not configured', async () => {
        delete process.env.SUPABASE_URL;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        process.env.VITE_DEMO_MODE = 'false';

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/v2/health`);
            assert.equal(response.status, 503);
            const payload = await response.json();
            assert.equal(payload.ok, false);
            assert.equal(payload.database.status, 'not_configured');
            assert.equal(payload.supabase.status, 'not_configured');
            assert.equal(payload.ready_for_prod_data, false);
        });
    });

    it('reports ready_for_prod_data when DB is connected and demo mode is off', async () => {
        process.env.SUPABASE_URL = 'https://example.supabase.co';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
        process.env.VITE_DEMO_MODE = 'false';

        const queries = [];
        const mockPool = {
            query: async (sql) => {
                queries.push(sql);
                if (sql.includes('SELECT 1')) return { rows: [{ ok: 1 }] };
                if (sql.includes('schema_migrations')) {
                    return { rows: [{ version: '000_extensions_and_auth.sql' }] };
                }
                if (sql.includes('learning_portals')) return { rows: [{ count: 3 }] };
                if (sql.includes('curricula')) return { rows: [{ count: 0 }] };
                return { rows: [] };
            },
        };
        setPoolForTests(mockPool);

        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/v2/health`);
            const payload = await response.json();
            assert.equal(payload.database.status, 'connected');
            assert.equal(payload.frontend.demo_mode, false);
            assert.equal(payload.checks.production_data_mode, true);
            assert.ok(payload.database.counts.learning_portals >= 0);
        });
    });
});