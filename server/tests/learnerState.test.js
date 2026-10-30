// @ts-check
// Phase 8 (S7, design p8 §7): the MCP tool learner-state-get (tools/core/learnerState.js getProgress)
// returns no streak. It used to answer `streak: 0` for every learner (a placeholder, never read
// from anywhere). The learning days (learning_days) are app-only: the remote MCP role has no grant
// on them (deploy/risepath-vm/sql/mcp_remote_role.sql), and this change grants none, so the key is
// left out rather than faked. The tool description says why; the rest of the shape is unchanged.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { getProgress } from '../../tools/core/learnerState.js';
import { calculateMastery } from '../../tools/core/domains.js';
import { createMcpServer } from '../../mcp-server/createMcpServer.js';

const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const BLENDER = 'blender-3d';

/**
 * A pool that answers every query with the given user_progress rows and records the statements.
 * @param {Array<Record<string, unknown>>} rows
 */
function progressPool(rows) {
    /** @type {Array<{ sql: string, params: unknown[] }>} */
    const queries = [];
    const pool = {
        /** @param {string} sql @param {unknown[]} params */
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows, rowCount: rows.length };
        },
    };
    setPoolForTests(/** @type {any} */ (pool));
    return queries;
}

/** Every key at any depth of a JSON value. @param {unknown} value @returns {string[]} */
const keysDeep = (value) => (value && typeof value === 'object'
    ? Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)])
    : []);

describe('learner-state-get: no streak (tools/core/learnerState.js getProgress)', () => {
    afterEach(() => resetPoolForTests());

    it('one domain, no row: stage 0, mastery 0, last_lesson null and the domain; no streak key', async () => {
        progressPool([]);
        const result = await getProgress({ userId: U1, domain: BLENDER });
        assert.deepEqual(result, { stage: 0, mastery: 0, last_lesson: null, domain: BLENDER });
        assert.ok(!('streak' in result), 'the learning days are not readable here: no fake 0');
    });

    it('one domain with a row: the same fields as before, without streak', async () => {
        const stages = ['basics', 'modeling'];
        const steps = { [BLENDER]: ['intro-viewport'] };
        progressPool([{ course_id: BLENDER, completed_stages: stages, completed_steps: steps }]);
        const result = await getProgress({ userId: U1, domain: BLENDER });
        assert.deepEqual(result, {
            domain: BLENDER,
            stage: 2,
            mastery: calculateMastery(2, BLENDER),
            last_lesson: null,
            completed_stages: stages,
            completed_steps: steps,
        });
        assert.ok(!('streak' in result));
    });

    it('all domains: the shape is unchanged (stage, mastery, stages, steps per domain) and names no streak', async () => {
        progressPool([
            { course_id: BLENDER, completed_stages: ['basics'], completed_steps: { [BLENDER]: ['intro-viewport'] } },
            { course_id: 'python', completed_stages: null, completed_steps: null },
        ]);
        const result = await getProgress({ userId: U1 });
        assert.deepEqual(result, {
            [BLENDER]: { stage: 1, mastery: calculateMastery(1, BLENDER), completed_stages: ['basics'], completed_steps: { [BLENDER]: ['intro-viewport'] } },
            python: { stage: 0, mastery: 0, completed_stages: [], completed_steps: {} },
        });
        assert.ok(!keysDeep(result).includes('streak'));
    });

    it('reads user_progress only, for the learner it was given (no learning days, XP or history table)', async () => {
        const queries = progressPool([]);
        await getProgress({ userId: U1, domain: BLENDER });
        await getProgress({ userId: U1 });
        assert.equal(queries.length, 2);
        for (const { sql } of queries) {
            assert.match(sql, /FROM user_progress WHERE user_id = \$1/);
            assert.doesNotMatch(sql, /learning_days|xp_awards|learning_events|lesson_progress/);
        }
        assert.deepEqual(queries.map((q) => q.params), [[U1, BLENDER], [U1]]);
    });
});

describe('learner-state-get: the tool description says there is no streak (mcp-server/createMcpServer.js)', () => {
    it('names the streak and still sends course lessons to course-progress-get', async () => {
        const saved = { warn: console.warn, error: console.error };
        console.warn = () => {};
        console.error = () => {};
        const server = createMcpServer({ profile: 'learner' });
        const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'learner-state-test', version: '1.0.0' });
        try {
            await server.connect(serverSide);
            await client.connect(clientSide);
            const { tools } = await client.listTools();
            const description = tools.find((t) => t.name === 'learner-state-get')?.description ?? '';
            assert.match(description, /course-progress-get/);
            assert.match(description, /連続して学んだ日数（streak）は返さない/);
            assert.match(description, /連続日数はアプリの画面で見られる/);
            // One register, the plain form of every other tool description (no です・ます).
            const jp = description.split(' / ')[0];
            assert.doesNotMatch(jp, /です|ます|ません/);
            assert.match(description, /No streak: learning days are app-only/);
        } finally {
            await client.close().catch(() => {});
            Object.assign(console, saved);
        }
    });
});
