// Outside-AI drafts over MCP (tools/core/mcpAiAccess.js): a session opened with a learner's own
// JWT may save curriculum or lesson drafts only as a ready adult, the same rule as the learner JWT
// path of server/routes/chatgptCurriculum.js. Bridge-token sessions and stdio are not checked.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adultDraftRefusal, learnerJwtSessionUser } from '../../tools/core/mcpAiAccess.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { resetAiAccessForTests } from '../safety/access.js';
import { createAiAccessPool } from './helpers/aiAccessPool.js';

const PHASE1 = '00000000-0000-0000-0000-000000000001';
const CHILD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADULT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NO_AGE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ENV = { NODE_ENV: 'development' };

/** The sessions map mcp-server/index.js keeps, with one SSE session for `userId`. */
const sessionFor = (userId) => ({
    sessions: new Map([['s1', { userId }]]),
    extra: { sessionId: 's1' },
});

describe('MCP outside-AI drafts: adults only for learner JWT sessions', () => {
    const savedPhase1 = process.env.PHASE1_USER_ID;
    const savedError = console.error;

    beforeEach(() => {
        delete process.env.PHASE1_USER_ID;
        resetAiAccessForTests();
        setPoolForTests(createAiAccessPool({ ages: { [CHILD]: '2014-04', [ADULT]: '1990-01' } }));
        console.error = () => {};
    });

    afterEach(() => {
        if (savedPhase1 === undefined) delete process.env.PHASE1_USER_ID;
        else process.env.PHASE1_USER_ID = savedPhase1;
        console.error = savedError;
        resetPoolForTests();
        resetAiAccessForTests();
    });

    it('treats only a non-bridge SSE session as a learner JWT session', () => {
        assert.equal(learnerJwtSessionUser(sessionFor(ADULT).extra, sessionFor(ADULT).sessions), ADULT);
        assert.equal(learnerJwtSessionUser(sessionFor(PHASE1).extra, sessionFor(PHASE1).sessions), null, 'bridge token (PHASE1)');
        assert.equal(learnerJwtSessionUser({}, new Map()), null, 'stdio: no session');
    });

    it('refuses a minor (adults_only) and a learner with no age (age_required); allows an adult', async () => {
        assert.deepEqual((await adultDraftRefusal({ ...sessionFor(CHILD), env: ENV }))?.error_type, 'adults_only');
        assert.deepEqual((await adultDraftRefusal({ ...sessionFor(NO_AGE), env: ENV }))?.error_type, 'age_required');
        assert.equal(await adultDraftRefusal({ ...sessionFor(ADULT), env: ENV }), null);
    });

    it('fails closed with ai_access_unavailable when the lookup fails', async () => {
        setPoolForTests(createAiAccessPool({ fail: () => true }));
        assert.equal((await adultDraftRefusal({ ...sessionFor(ADULT), env: ENV }))?.error_type, 'ai_access_unavailable');
        resetPoolForTests();
        resetAiAccessForTests();
        assert.equal((await adultDraftRefusal({ ...sessionFor(ADULT), env: { NODE_ENV: 'production' } }))?.error_type, 'ai_access_unavailable', 'production without a database');
    });

    it('leaves bridge-token and stdio calls (the operator path) unchecked', async () => {
        setPoolForTests(createAiAccessPool({ fail: () => true }));
        assert.equal(await adultDraftRefusal({ ...sessionFor(PHASE1), env: ENV }), null);
        assert.equal(await adultDraftRefusal({ extra: {}, sessions: new Map(), env: ENV }), null);
    });

    it('mcp-server/index.js runs the check in save-curriculum-draft and in lesson-upsert-draft (db store)', () => {
        const source = readFileSync(new URL('../../mcp-server/index.js', import.meta.url), 'utf8');
        const handler = (name) => {
            const start = source.indexOf(`policyTool(\n    '${name}',`);
            assert.notEqual(start, -1, `${name} is registered`);
            return source.slice(start, source.indexOf('\npolicyTool(', start + 1));
        };
        const save = handler('save-curriculum-draft');
        assert.match(save, /adultDraftRefusal\(\{ extra, sessions \}\)[\s\S]*saveDraft\(/, 'checked before saveDraft');
        const upsert = handler('lesson-upsert-draft');
        const dbBranch = upsert.slice(upsert.indexOf("if (store === 'db') {"), upsert.indexOf('upsertLessonDraft('));
        assert.match(dbBranch, /^if \(store === 'db'\) \{[\s\S]*adultDraftRefusal\(\{ extra, sessions \}\)/, 'checked in the db store before upsertLessonDraft');
    });
});
