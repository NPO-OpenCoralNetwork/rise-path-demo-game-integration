// Client helpers for the daily caps on paid AI features (services/aiDailyLimit.ts). The API answers
// 429 { error_type: 'daily_limit_reached', kind, scope, reset_at }; callers copy error_type and kind
// onto the thrown Error as `errorType` and `kind`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DAILY_LIMIT_ERROR_TYPE,
    dailyLimitFields,
    dailyLimitKind,
    dailyLimitResetAt,
    dailyLimitScope,
    isDailyLimitError,
    nextJstMidnight,
} from '../../services/aiDailyLimit.ts';
import { nextJstMidnight as serverNextJstMidnight } from '../middleware/dailyCaps.js';

const limitError = (kind) => Object.assign(new Error('limit'), { status: 429, errorType: 'daily_limit_reached', kind });

describe('aiDailyLimit: isDailyLimitError', () => {
    it('is true only for errorType daily_limit_reached', () => {
        assert.equal(DAILY_LIMIT_ERROR_TYPE, 'daily_limit_reached');
        assert.equal(isDailyLimitError(limitError('image')), true);
        assert.equal(isDailyLimitError({ errorType: 'daily_limit_reached' }), true);
        assert.equal(isDailyLimitError({ status: 429 }), false);
        assert.equal(isDailyLimitError({ status: 429, errorType: 'rate_limited' }), false);
        assert.equal(isDailyLimitError({ error_type: 'daily_limit_reached' }), false);
        assert.equal(isDailyLimitError(new Error('daily_limit_reached')), false);
    });

    it('is safe for null, undefined and non-objects', () => {
        assert.equal(isDailyLimitError(null), false);
        assert.equal(isDailyLimitError(undefined), false);
        assert.equal(isDailyLimitError('daily_limit_reached'), false);
        assert.equal(isDailyLimitError(429), false);
    });
});

describe('aiDailyLimit: dailyLimitKind', () => {
    it('returns the kind of a daily-limit error', () => {
        for (const kind of ['llm', 'course_generation', 'image', 'agent_chat', 'embeddings']) {
            assert.equal(dailyLimitKind(limitError(kind)), kind);
        }
    });

    it('returns null for an unknown or missing kind', () => {
        assert.equal(dailyLimitKind(limitError('tts')), null);
        assert.equal(dailyLimitKind(limitError(undefined)), null);
        assert.equal(dailyLimitKind(limitError(42)), null);
    });

    it('returns null for other errors, null and undefined', () => {
        assert.equal(dailyLimitKind({ status: 429, kind: 'image' }), null);
        assert.equal(dailyLimitKind({ errorType: 'rate_limited', kind: 'image' }), null);
        assert.equal(dailyLimitKind(null), null);
        assert.equal(dailyLimitKind(undefined), null);
    });
});

describe('aiDailyLimit: scope, reset time and body fields', () => {
    const NOW = Date.parse('2026-10-22T10:00:00Z');

    it('dailyLimitScope: the known scope, user for an older server, null for other errors', () => {
        for (const scope of ['user', 'ip', 'global', 'guest', 'off']) {
            assert.equal(dailyLimitScope({ errorType: 'daily_limit_reached', scope }), scope);
        }
        assert.equal(dailyLimitScope({ errorType: 'daily_limit_reached' }), 'user');
        assert.equal(dailyLimitScope({ errorType: 'daily_limit_reached', scope: 'planet' }), 'user');
        assert.equal(dailyLimitScope({ status: 429, scope: 'guest' }), null);
        assert.equal(dailyLimitScope(null), null);
        assert.equal(dailyLimitScope(undefined), null);
    });

    it('nextJstMidnight matches the server', () => {
        for (const iso of ['2026-10-22T10:00:00Z', '2026-10-22T14:59:59Z', '2026-10-22T15:00:00Z', '2026-12-31T23:00:00Z']) {
            assert.equal(nextJstMidnight(Date.parse(iso)), serverNextJstMidnight(Date.parse(iso)), iso);
        }
        assert.equal(new Date(nextJstMidnight(NOW)).toISOString(), '2026-10-22T15:00:00.000Z');
    });

    it('dailyLimitResetAt: reset_at within a day, else the next 00:00 JST; null when off or not a limit', () => {
        const limit = (extra) => ({ errorType: 'daily_limit_reached', scope: 'user', ...extra });
        assert.equal(dailyLimitResetAt(limit({ resetAt: '2026-10-22T15:00:00.000Z' }), NOW), Date.parse('2026-10-22T15:00:00Z'));
        assert.equal(dailyLimitResetAt(limit({}), NOW), Date.parse('2026-10-22T15:00:00Z'));
        assert.equal(dailyLimitResetAt(limit({ resetAt: 'soon' }), NOW), Date.parse('2026-10-22T15:00:00Z'));
        assert.equal(dailyLimitResetAt(limit({ resetAt: '2026-10-21T15:00:00.000Z' }), NOW), Date.parse('2026-10-22T15:00:00Z'), 'in the past');
        assert.equal(dailyLimitResetAt(limit({ resetAt: '2027-01-01T00:00:00.000Z' }), NOW), Date.parse('2026-10-22T15:00:00Z'), 'too far');
        assert.equal(dailyLimitResetAt(limit({ scope: 'off' }), NOW), null);
        assert.equal(dailyLimitResetAt({ status: 429 }, NOW), null);
    });

    it('dailyLimitFields copies error_type, kind, scope and reset_at; ignores the rest', () => {
        assert.deepEqual(
            dailyLimitFields({ error: 'x', error_type: 'daily_limit_reached', kind: 'image', scope: 'ip', reset_at: '2026-10-22T15:00:00.000Z' }),
            { errorType: 'daily_limit_reached', kind: 'image', scope: 'ip', resetAt: '2026-10-22T15:00:00.000Z' },
        );
        assert.deepEqual(dailyLimitFields({ error_type: 42 }), { errorType: undefined, kind: undefined, scope: undefined, resetAt: undefined });
        assert.deepEqual(dailyLimitFields(null), {});
        assert.deepEqual(dailyLimitFields('oops'), {});
    });
});
