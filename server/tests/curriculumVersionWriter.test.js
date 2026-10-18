import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { saveDraftVersion } from '../routes/ai.js';
import chatgptCurriculumRoutes from '../routes/chatgptCurriculum.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CURRICULUM_ID = '22222222-2222-4222-8222-222222222222';

/** Mock pg pool: records every query (pool and client) and answers with respond(sql, params). */
function createMockPool(respond = () => undefined) {
    const queries = [];
    let released = 0;
    const run = async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        queries.push({ sql: text, params });
        const answer = await respond(text.toLowerCase(), params);
        if (answer instanceof Error) throw answer;
        return answer || { rowCount: 0, rows: [] };
    };
    return {
        queries,
        get released() { return released; },
        query: run,
        connect: async () => ({ query: run, release: () => { released += 1; } }),
        statements: () => queries.map((q) => q.sql.split(' ').slice(0, 3).join(' ').toLowerCase()),
    };
}

/** Answers for the shared writeCurriculumVersion path. */
const versionResponder = ({ owned = true, nextVersion = 2, uiTemplateId = 'blender_3d', title = 'Old title' } = {}) => (sql) => {
    if (sql.startsWith('select id, title, ui_template_id from curricula') || sql.startsWith('select id from curricula')) {
        return owned
            ? { rowCount: 1, rows: [{ id: CURRICULUM_ID, title, ui_template_id: uiTemplateId }] }
            : { rowCount: 0, rows: [] };
    }
    if (sql.startsWith('select coalesce(max(version)')) return { rowCount: 1, rows: [{ next_version: nextVersion }] };
    if (sql.startsWith('insert into curricula ')) return { rowCount: 1, rows: [{ id: CURRICULUM_ID }] };
    if (sql.startsWith('insert into curriculum_versions')) {
        return { rowCount: 1, rows: [{ id: 'version-9', status: 'draft', created_at: '2026-10-18T00:00:00.000Z' }] };
    }
    return undefined;
};

const find = (pool, prefix) => pool.queries.find((q) => q.sql.toLowerCase().startsWith(prefix));
const assertNoPhantomColumns = (pool) => {
    for (const q of pool.queries) assert.doesNotMatch(q.sql, /curriculum_data/, q.sql);
};

afterEach(() => resetPoolForTests());

describe('POST /ai/generate draft save (server/routes/ai.js saveDraftVersion)', () => {
    const generated = {
        title: { jp: 'ブレンダー入門', en: 'Blender basics' },
        description: { jp: '3D の基本', en: '3D basics' },
        modules: [{ lessons: [{}, {}] }, { lessons: [{}] }, { title: 'no lessons' }],
    };

    it('writes curriculum_versions.content_json through writeCurriculumVersion and marks the draft done', async () => {
        const pool = createMockPool(versionResponder({ nextVersion: 4 }));
        const versionId = await saveDraftVersion(pool, {
            curriculumId: CURRICULUM_ID,
            userId: USER_ID,
            curriculum: generated,
            intake: { goal: 'Blender を学ぶ' },
            modules: [{ title: 'M1' }],
        });

        assert.equal(versionId, 'version-9');
        assert.deepEqual(pool.statements(), [
            'begin', 'select id, title,', 'select coalesce(max(version), 0)', 'insert into curriculum_versions',
            'update curricula set', 'update curricula set', 'commit',
        ]);
        assertNoPhantomColumns(pool);

        const insert = find(pool, 'insert into curriculum_versions');
        assert.equal(insert.params[0], CURRICULUM_ID);
        assert.equal(insert.params[1], 4);
        assert.deepEqual(JSON.parse(insert.params[2]), generated);
        assert.deepEqual(JSON.parse(insert.params[3]), { goal: 'Blender を学ぶ' });
        assert.deepEqual(JSON.parse(insert.params[4]), [{ title: 'M1' }]);
        assert.equal(insert.params[6], USER_ID);

        const [pointer, status] = pool.queries.filter((q) => q.sql.toLowerCase().startsWith('update curricula set'));
        assert.match(pointer.sql, /current_version_id = CAST\(\$3 AS uuid\)/);
        // title, description, version id, total lessons, ui template kept from the row, model_used untouched
        assert.deepEqual(pointer.params, ['ブレンダー入門', '3D の基本', 'version-9', 3, 'blender_3d', null, CURRICULUM_ID]);
        assert.match(status.sql, /status = 'draft'/);
        assert.deepEqual(status.params, [CURRICULUM_ID, USER_ID]);
        assert.equal(pool.released, 1);
    });

    it('keeps the existing title when the generated one is missing', async () => {
        const pool = createMockPool(versionResponder({ title: 'Kept title', uiTemplateId: null }));
        await saveDraftVersion(pool, { curriculumId: CURRICULUM_ID, userId: USER_ID, curriculum: { modules: [] } });
        const pointer = find(pool, 'update curricula set title');
        assert.equal(pointer.params[0], 'Kept title');
        assert.equal(pointer.params[3], 0);
        assert.equal(pointer.params[4], 'vibe_coding', 'falls back to the column default');
    });

    it('rolls back and throws when the draft is not owned by the user', async () => {
        const pool = createMockPool(versionResponder({ owned: false }));
        await assert.rejects(
            () => saveDraftVersion(pool, { curriculumId: CURRICULUM_ID, userId: USER_ID, curriculum: generated }),
            /Draft not found/,
        );
        assert.deepEqual(pool.statements(), ['begin', 'select id, title,', 'rollback']);
        assert.equal(pool.released, 1);
    });
});

describe('POST /api/v2/ai/curriculum-drafts uses the shared version writer', () => {
    const lesson = (n) => ({
        title: `レッスン${n}`,
        objective: `Web の役割を説明できる (${n})`,
        summary: 'Web アプリはブラウザとサーバーが役割を分担して動きます。',
        explanation: 'ブラウザは画面を描画し、ユーザーの操作を受け取ります。サーバーはデータを保存し、計算を行い、結果を返します。'
            + 'この分担を理解すると、どこで何が起きているかを切り分けて考えられるようになります。'
            + 'たとえばログイン処理では、入力はブラウザで行われ、照合はサーバーで行われます。'
            + '通信は HTTP で行われ、リクエストとレスポンスの組で成り立ちます。開発者ツールで実際の通信を観察してみましょう。'
            + 'どの処理がブラウザ側で、どの処理がサーバー側で行われているかを毎回意識することが、設計と不具合調査の第一歩になります。',
        why_it_matters: '不具合の原因を素早く切り分けられるようになるからです。',
        key_points: ['ブラウザは表示と操作', 'サーバーは保存と計算', '通信は HTTP'],
        practice: ['開発者ツールで通信を観察する', 'ログインの流れを図にする'],
        cautions: ['秘密情報をブラウザ側に置かない'],
        takeaway: '役割分担を意識して設計しよう。',
    });
    const body = (extra = {}) => ({
        portal_id: 'general',
        template_id: 'default',
        policy_version: '2026-03-10.a',
        intake: { target_audience: '初学者', goal: 'Web を理解する', current_level: '初学者', duration_weeks: 2 },
        curriculum: {
            title: 'Web の基本',
            summary: 'Web アプリの仕組みを学ぶ',
            modules: [{ title: '基礎', goal: '役割を説明できる', lessons: [lesson(1), lesson(2)] }],
        },
        ...extra,
    });

    const post = async (payload) => {
        const app = express();
        app.use(express.json());
        app.use('/api/v2', chatgptCurriculumRoutes);
        const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
        try {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/ai/curriculum-drafts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            return { status: response.status, json: await response.json() };
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    };

    const withEnv = async (fn) => {
        const saved = { token: process.env.RISE_PATH_BRIDGE_TOKEN, db: process.env.DATABASE_URL_PHASE1 };
        process.env.RISE_PATH_BRIDGE_TOKEN = '';
        delete process.env.DATABASE_URL_PHASE1;
        try {
            return await fn();
        } finally {
            if (saved.token === undefined) delete process.env.RISE_PATH_BRIDGE_TOKEN;
            else process.env.RISE_PATH_BRIDGE_TOKEN = saved.token;
            if (saved.db === undefined) delete process.env.DATABASE_URL_PHASE1;
            else process.env.DATABASE_URL_PHASE1 = saved.db;
        }
    };

    it('creates curricula + a draft version whose content_json carries the new curriculum id', async () => {
        const pool = createMockPool(versionResponder());
        setPoolForTests(pool);
        const { status, json } = await withEnv(() => post(body()));

        assert.equal(status, 200, JSON.stringify(json));
        assert.equal(json.ok, true);
        assert.equal(json.curriculum_id, CURRICULUM_ID);
        assert.equal(json.curriculum_version_id, 'version-9');
        assert.equal(json.status, 'draft');
        assert.equal(json.saved_at, '2026-10-18T00:00:00.000Z');
        assertNoPhantomColumns(pool);

        const tx = pool.statements().filter((s) => !s.startsWith('insert into auth'));
        assert.deepEqual(tx, ['begin', 'insert into curricula', 'insert into curriculum_versions', 'update curricula set', 'commit']);
        const insert = find(pool, 'insert into curriculum_versions');
        assert.equal(insert.params[1], 1);
        const content = JSON.parse(insert.params[2]);
        assert.equal(content.curriculum_id, CURRICULUM_ID);
        assert.equal(content._meta.portal_id, 'general');
        assert.equal(JSON.parse(insert.params[3]).goal, 'Web を理解する');
        assert.ok(JSON.parse(insert.params[5]).ui_template_id, 'ui_hints stored');
        assert.equal(find(pool, 'update curricula set').params[3], 2, 'total_lessons');
        assert.equal(pool.released, 1);
    });

    it('adds the next version to an owned curriculum and 404s for one the user does not own', async () => {
        let pool = createMockPool(versionResponder({ nextVersion: 5 }));
        setPoolForTests(pool);
        let res = await withEnv(() => post(body({ curriculum_id: CURRICULUM_ID })));
        assert.equal(res.status, 200, JSON.stringify(res.json));
        assert.equal(find(pool, 'insert into curricula '), undefined);
        assert.equal(find(pool, 'insert into curriculum_versions').params[1], 5);

        pool = createMockPool(versionResponder({ owned: false }));
        setPoolForTests(pool);
        res = await withEnv(() => post(body({ curriculum_id: CURRICULUM_ID })));
        assert.equal(res.status, 404);
        assert.equal(find(pool, 'insert into curriculum_versions'), undefined);
        assert.equal(pool.statements().at(-1), 'rollback');
    });
});
