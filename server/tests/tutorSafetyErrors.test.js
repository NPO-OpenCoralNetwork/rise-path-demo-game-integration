// Phase 0.5 minor safeguards, client side: how the inline tutor (components/lesson/useTutorStream.ts)
// reads refusals from the AI access gate (server/middleware/aiAccessGate.js) and the safety screen
// (server/safety/moderation.js), and that a buffered answer sent as one delta still finishes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyTutorError,
    finishedTurn,
    isTutorAccessKind,
    isTutorLimitKind,
    tutorErrorIsFinal,
    tutorErrorSupport,
    tutorLimitFor,
} from '../../components/lesson/useTutorStream.ts';

describe('tutor: access gate refusals', () => {
    it('maps every access error_type to its own kind, whatever the status', () => {
        const cases = [
            [{ status: 401, errorType: 'sign_in_required' }, 'sign_in_required'],
            [{ status: 403, errorType: 'age_required' }, 'age_required'],
            [{ status: 403, errorType: 'guardian_consent_required' }, 'guardian_consent_required'],
            [{ status: 403, errorType: 'ai_paused_safety' }, 'ai_paused_safety'],
            [{ status: 403, errorType: 'adults_only' }, 'adults_only'],
        ];
        for (const [error, kind] of cases) {
            assert.equal(classifyTutorError(error), kind, JSON.stringify(error));
            assert.equal(isTutorAccessKind(kind), true);
            assert.equal(tutorErrorIsFinal(kind), true);
            // Not a daily cap: no local hold, the card says what to do.
            assert.equal(isTutorLimitKind(kind), false);
            assert.equal(tutorLimitFor(error), null);
        }
    });

    it('reads error_type from the parsed body too', () => {
        assert.equal(classifyTutorError({ status: 403, body: { error: 'x', error_type: 'age_required' } }), 'age_required');
        assert.equal(classifyTutorError({ status: 403, error_type: 'guardian_consent_required' }), 'guardian_consent_required');
    });

    it('keeps the old mapping for errors without a known error_type', () => {
        assert.equal(classifyTutorError({ status: 401 }), 'unavailable');
        assert.equal(classifyTutorError({ status: 403 }), 'unavailable');
        assert.equal(classifyTutorError({ status: 503, errorType: 'ai_access_unavailable' }), 'unavailable');
        assert.equal(classifyTutorError({ status: 422, errorType: 'refusal' }), 'refused');
        assert.equal(classifyTutorError({ status: 422 }), 'refused');
    });
});

describe('tutor: safety screen refusals', () => {
    it('a blocked question or answer is content_blocked, not a model refusal', () => {
        const input = { status: 422, errorType: 'content_blocked', category: 'violence', support: false };
        assert.equal(classifyTutorError(input), 'content_blocked');
        assert.equal(tutorErrorSupport(input), false);
        assert.equal(tutorErrorIsFinal('content_blocked'), true);
        // The output block arrives as the SSE error event (llmApi maps it to 422).
        const output = { status: 422, errorType: 'content_blocked', category: 'other' };
        assert.equal(classifyTutorError(output), 'content_blocked');
    });

    it('support lines only when the server says so', () => {
        assert.equal(tutorErrorSupport({ status: 422, errorType: 'content_blocked', category: 'self_harm', support: true }), true);
        assert.equal(tutorErrorSupport({ status: 422, body: { error_type: 'content_blocked', support: true } }), true);
        assert.equal(tutorErrorSupport({ status: 422, errorType: 'content_blocked', support: 'true' }), false);
        assert.equal(tutorErrorSupport({ status: 503, errorType: 'safety_check_unavailable', support: true }), false);
    });

    it('a check that could not run can be retried', () => {
        assert.equal(classifyTutorError({ status: 503, errorType: 'safety_check_unavailable' }), 'safety_unavailable');
        assert.equal(tutorErrorIsFinal('safety_unavailable'), false);
        assert.equal(isTutorAccessKind('safety_unavailable'), false);
    });

    it('daily caps still win over everything else', () => {
        assert.equal(classifyTutorError({ status: 429, errorType: 'daily_limit_reached', scope: 'user' }), 'daily_limit');
    });
});

describe('tutor: a buffered answer (minors) arrives as one delta', () => {
    const streaming = { id: 'a1', role: 'assistant', text: '', status: 'streaming', mode: 'explain' };
    const done = { mode: 'explain', locale: 'ja', grounding: { sectionId: 's1', blockId: 'b1' }, provider: 'anthropic', model: 'm', text: '' };

    it('keeps the single delta when done carries no text', () => {
        const afterDelta = { ...streaming, text: 'まとめて届いた答えです。' };
        const turn = finishedTurn(afterDelta, done);
        assert.equal(turn.text, 'まとめて届いた答えです。');
        assert.equal(turn.status, 'done');
        assert.deepEqual(turn.grounding, { sectionId: 's1', blockId: 'b1' });
    });

    it('uses done.text when it is there', () => {
        const turn = finishedTurn({ ...streaming, text: '答え' }, { ...done, text: '答え' });
        assert.equal(turn.text, '答え');
    });
});
