import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    extractLifeJournalPrivacyPreferences,
    resolveIncludeDiaryExcerpts,
    validateDeleteLifeJournalBody,
    buildLifeJournalExportPayload,
    deleteLifeJournalData,
    DELETE_CONFIRM_TOKEN,
    EXPORT_SCHEMA_VERSION,
} from '../services/lifeJournalPrivacyService.js';
import { validatePrivacyPreferencesPatch } from '../services/userPreferences.js';
import { setMemantoFetchForTests } from '../services/learnerMemoryBridge.js';

const USER_ID = '14fe15a2-bc4a-4449-afca-f39196f383b1';

describe('extractLifeJournalPrivacyPreferences', () => {
    it('defaults to false when missing', () => {
        assert.deepEqual(extractLifeJournalPrivacyPreferences({}), {
            allow_diary_excerpts_in_ai: false,
        });
    });

    it('reads allow_diary_excerpts_in_ai when true', () => {
        assert.deepEqual(extractLifeJournalPrivacyPreferences({
            privacy: { life_journal: { allow_diary_excerpts_in_ai: true } },
        }), {
            allow_diary_excerpts_in_ai: true,
        });
    });
});

describe('resolveIncludeDiaryExcerpts', () => {
    it('returns false when not requested', async () => {
        const result = await resolveIncludeDiaryExcerpts(null, 'user-1', false);
        assert.equal(result, false);
    });

    it('returns false when requested but pool is missing (fail closed)', async () => {
        const result = await resolveIncludeDiaryExcerpts(null, 'user-1', true);
        assert.equal(result, false);
    });

    it('returns false when requested but user has not opted in', async () => {
        const mockPool = {
            query: async () => ({
                rowCount: 1,
                rows: [{
                    preferences: {
                        privacy: { life_journal: { allow_diary_excerpts_in_ai: false } },
                    },
                }],
            }),
        };
        const result = await resolveIncludeDiaryExcerpts(mockPool, 'user-1', true);
        assert.equal(result, false);
    });

    it('returns true when requested and user opted in', async () => {
        const mockPool = {
            query: async () => ({
                rowCount: 1,
                rows: [{
                    preferences: {
                        privacy: { life_journal: { allow_diary_excerpts_in_ai: true } },
                    },
                }],
            }),
        };
        const result = await resolveIncludeDiaryExcerpts(mockPool, 'user-1', true);
        assert.equal(result, true);
    });
});

describe('buildLifeJournalExportPayload', () => {
    it('counts only logged days in entry_count but includes full calendar in days', () => {
        const payload = buildLifeJournalExportPayload({
            from: '2026-06-01',
            to: '2026-06-03',
            timezone: 'Asia/Tokyo',
            days: [
                { date: '2026-06-01', mood: 'good' },
                { date: '2026-06-02' },
                { date: '2026-06-03', diary_text: 'Focused day.' },
            ],
        });

        assert.equal(payload.schema_version, EXPORT_SCHEMA_VERSION);
        assert.equal(payload.entry_count, 2);
        assert.equal(payload.total_days_in_range, 3);
        assert.equal(payload.days.length, 3);
        assert.equal(payload.from, '2026-06-01');
        assert.equal(payload.to, '2026-06-03');
    });
});

describe('validateDeleteLifeJournalBody', () => {
    it('requires DELETE confirm token', () => {
        const result = validateDeleteLifeJournalBody({ confirm: 'NOPE', scope: 'all' });
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes(DELETE_CONFIRM_TOKEN)));
    });

    it('accepts delete all', () => {
        const result = validateDeleteLifeJournalBody({ confirm: DELETE_CONFIRM_TOKEN, scope: 'all' });
        assert.equal(result.valid, true);
        assert.equal(result.parsed.scope, 'all');
    });

    it('accepts delete range with valid dates', () => {
        const result = validateDeleteLifeJournalBody({
            confirm: DELETE_CONFIRM_TOKEN,
            scope: 'range',
            from: '2026-06-01',
            to: '2026-06-30',
        });
        assert.equal(result.valid, true);
        assert.equal(result.parsed.from, '2026-06-01');
        assert.equal(result.parsed.to, '2026-06-30');
    });
});

function createDeleteMockPool() {
    const client = {
        query: async (sql) => {
            const text = String(sql);
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
                return { rowCount: 0, rows: [] };
            }
            if (text.includes('DELETE FROM daily_reflections')) return { rowCount: 2, rows: [] };
            if (text.includes('DELETE FROM lifestyle_logs')) return { rowCount: 1, rows: [] };
            if (text.includes('DELETE FROM analysis_snapshots')) return { rowCount: 0, rows: [] };
            if (text.includes('DELETE FROM agent_chat_consent')) return { rowCount: 0, rows: [] };
            throw new Error(`Unexpected client query: ${text}`);
        },
        release: () => {},
    };

    return {
        connect: async () => client,
        query: async (sql) => {
            const text = String(sql);
            if (text.includes('DELETE FROM learner_memory_meta')) return { rowCount: 1, rows: [] };
            throw new Error(`Unexpected pool query: ${text}`);
        },
    };
}

describe('deleteLifeJournalData semantic purge', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env.MEMANTO_API_URL = 'http://127.0.0.1:8100';
        process.env.MEMANTO_ENABLED = 'true';
    });

    afterEach(() => {
        setMemantoFetchForTests();
        process.env = { ...originalEnv };
    });

    it('reports semantic purge failure without claiming success', async () => {
        setMemantoFetchForTests(async () => ({
            ok: false,
            status: 503,
            json: async () => ({ detail: 'down' }),
        }));

        const result = await deleteLifeJournalData({
            pool: createDeleteMockPool(),
            userId: USER_ID,
            scope: 'all',
        });

        assert.equal(result.ok, true);
        assert.equal(result.deleted.semantic_memories_purged, false);
        assert.match(result.semantic_memory_purge_error, /unavailable/i);
    });
});

describe('validatePrivacyPreferencesPatch', () => {
    it('accepts boolean allow_diary_excerpts_in_ai', () => {
        assert.equal(
            validatePrivacyPreferencesPatch({
                life_journal: { allow_diary_excerpts_in_ai: true },
            }),
            null,
        );
    });

    it('rejects non-boolean allow_diary_excerpts_in_ai', () => {
        const result = validatePrivacyPreferencesPatch({
            life_journal: { allow_diary_excerpts_in_ai: 'yes' },
        });
        assert.ok(result);
        assert.match(result.error, /allow_diary_excerpts_in_ai/);
    });
});