import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureAuthUser } from '../db.js';

describe('ensureAuthUser', () => {
    it('upserts user id into auth.users stub', async () => {
        const calls = [];
        const pool = {
            query: async (sql, params) => {
                calls.push({ sql, params });
                return { rows: [] };
            },
        };

        await ensureAuthUser(pool, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

        assert.equal(calls.length, 1);
        assert.match(calls[0].sql, /INSERT INTO auth\.users/);
        assert.match(calls[0].sql, /ON CONFLICT/);
        assert.equal(calls[0].params[0], 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });

    it('no-ops when pool or userId is missing', async () => {
        const pool = { query: async () => { throw new Error('should not run'); } };
        await ensureAuthUser(null, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        await ensureAuthUser(pool, null);
        await ensureAuthUser(pool, '');
    });
});