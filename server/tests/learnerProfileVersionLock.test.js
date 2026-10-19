import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import chatgptCurriculumRoutes from '../routes/chatgptCurriculum.js';

const RAW_PROFILE = {
    big_five: { openness: 72, conscientiousness: 48, extraversion: 35, agreeableness: 61, neuroticism: 68 },
    learning_style: 'example_first',
    motivation: 'credential_and_progress',
    lifestyle: { weekly_capacity_min: 90, preferred_session_length_min: 15, best_time: 'night', device: 'mobile' },
    declared_preferences: { assessment_preference: 'quiz_and_practice', explanation_style: 'step_by_step', tone: 'gentle' },
};

/** Mock pg pool that records every statement and answers the learner_profiles save path. */
function createMockPool() {
    const queries = [];
    const run = async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        queries.push({ sql: text, params });
        const lower = text.toLowerCase();
        if (lower.startsWith('select coalesce(max(version)')) return { rowCount: 1, rows: [{ next_version: 3 }] };
        if (lower.startsWith('insert into learner_profiles')) return { rowCount: 1, rows: [{ id: 'profile-1' }] };
        return { rowCount: 0, rows: [] };
    };
    return { queries, query: run, connect: async () => ({ query: run, release: () => {} }) };
}

const post = async (payload) => {
    const app = express();
    app.use(express.json());
    app.use('/api/v2', chatgptCurriculumRoutes);
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/learner-profiles/assessments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return { status: response.status, json: await response.json() };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
};

afterEach(() => resetPoolForTests());

describe('POST /learner-profiles/assessments version numbering', () => {
    it('takes a per-user transaction lock before reading max(version)', async () => {
        const saved = { token: process.env.RISE_PATH_BRIDGE_TOKEN, db: process.env.DATABASE_URL_PHASE1 };
        process.env.RISE_PATH_BRIDGE_TOKEN = '';
        delete process.env.DATABASE_URL_PHASE1;
        const pool = createMockPool();
        setPoolForTests(pool);
        try {
            const { status, json } = await post({ raw_profile: RAW_PROFILE });
            assert.equal(status, 200, JSON.stringify(json));

            const sqls = pool.queries.map((q) => q.sql.toLowerCase());
            const lockAt = sqls.findIndex((s) => s.startsWith('select pg_advisory_xact_lock'));
            const maxAt = sqls.findIndex((s) => s.startsWith('select coalesce(max(version)'));
            assert.ok(lockAt !== -1, 'advisory lock is taken');
            assert.ok(sqls.indexOf('begin') < lockAt && lockAt < maxAt, 'lock sits inside the transaction, before max(version)');
            assert.match(pool.queries[lockAt].params[0], /^learner_profiles:/);

            const insert = pool.queries.find((q) => q.sql.toLowerCase().startsWith('insert into learner_profiles'));
            assert.equal(insert.params[1], 3);
        } finally {
            if (saved.token === undefined) delete process.env.RISE_PATH_BRIDGE_TOKEN;
            else process.env.RISE_PATH_BRIDGE_TOKEN = saved.token;
            if (saved.db === undefined) delete process.env.DATABASE_URL_PHASE1;
            else process.env.DATABASE_URL_PHASE1 = saved.db;
        }
    });
});
