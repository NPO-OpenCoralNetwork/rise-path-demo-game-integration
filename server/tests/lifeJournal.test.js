import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    VALID_MOODS,
    moodToScore,
    validateEntryDate,
    validateWritableEntryDate,
    getTodayInTimezone,
    validateDateRange,
    MAX_RANGE_DAYS,
    validateTimezone,
    validateReflection,
    validateLifestyle,
    validateDailyPayload,
    quoteTimezoneForSql,
    buildLearningQuery,
    fetchLearningMetricsForDate,
} from '../services/lifeJournalService.js';

describe('validateEntryDate', () => {
    it('accepts valid YYYY-MM-DD', () => {
        const result = validateEntryDate('2026-06-22');
        assert.equal(result.valid, true);
        assert.equal(result.normalized, '2026-06-22');
    });

    it('rejects invalid format', () => {
        const result = validateEntryDate('06/22/2026');
        assert.equal(result.valid, false);
    });

    it('rejects empty date', () => {
        const result = validateEntryDate('');
        assert.equal(result.valid, false);
    });

    it('rejects impossible calendar dates', () => {
        const result = validateEntryDate('2026-02-30');
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('invalid')));
    });
});

describe('validateDateRange', () => {
    it('accepts valid ranges within limit', () => {
        const result = validateDateRange('2026-06-01', '2026-06-30');
        assert.equal(result.valid, true);
        assert.equal(result.from, '2026-06-01');
        assert.equal(result.to, '2026-06-30');
    });

    it('rejects when from is after to', () => {
        const result = validateDateRange('2026-06-30', '2026-06-01');
        assert.equal(result.valid, false);
    });

    it(`rejects ranges wider than ${MAX_RANGE_DAYS} days`, () => {
        const result = validateDateRange('2025-01-01', '2026-01-02');
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes(String(MAX_RANGE_DAYS))));
    });
});

describe('validateTimezone', () => {
    it('accepts valid IANA timezone', () => {
        const result = validateTimezone('Asia/Tokyo');
        assert.equal(result.valid, true);
        assert.equal(result.normalized, 'Asia/Tokyo');
    });

    it('defaults to Asia/Tokyo when empty', () => {
        const result = validateTimezone('');
        assert.equal(result.valid, true);
        assert.equal(result.normalized, 'Asia/Tokyo');
    });

    it('rejects invalid timezone', () => {
        const result = validateTimezone('Not/A_Timezone');
        assert.equal(result.valid, false);
    });
});

describe('validateReflection', () => {
    it('accepts valid reflection', () => {
        const result = validateReflection({
            mood: 'good',
            energy: 4,
            focus: 3,
            diary_text: 'Focused morning.',
            tags: ['focused'],
        });
        assert.equal(result.valid, true);
        assert.equal(result.hasContent, true);
    });

    it('rejects invalid mood', () => {
        const result = validateReflection({ mood: 'bad' });
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('mood')));
    });

    it('rejects confidence out of range', () => {
        const result = validateReflection({ confidence: 6 });
        assert.equal(result.valid, false);
    });
});

describe('validateLifestyle', () => {
    it('accepts meals jsonb structure', () => {
        const result = validateLifestyle({
            sleep_hours: 7.5,
            exercise_min: 30,
            exercise_intensity: 'moderate',
            meals: {
                breakfast: { ate: true, balance: 4 },
                dinner: { ate: true, balance: 3, late_meal: false },
            },
            caffeine: { cups: 1, after_15h: false },
        });
        assert.equal(result.valid, true);
        assert.equal(result.hasContent, true);
    });

    it('rejects invalid exercise_intensity', () => {
        const result = validateLifestyle({ exercise_intensity: 'extreme' });
        assert.equal(result.valid, false);
    });

    it('rejects sleep_hours above 24', () => {
        const result = validateLifestyle({ sleep_hours: 25 });
        assert.equal(result.valid, false);
    });
});

describe('validateDailyPayload', () => {
    it('requires at least one field', () => {
        const result = validateDailyPayload({ reflection: {}, lifestyle: {} });
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('At least one')));
    });

    it('accepts lifestyle-only payload', () => {
        const result = validateDailyPayload({
            lifestyle: { sleep_hours: 7, exercise_min: 20 },
        });
        assert.equal(result.valid, true);
    });

    it('accepts reflection-only payload', () => {
        const result = validateDailyPayload({
            reflection: { mood: 'okay', focus: 3 },
        });
        assert.equal(result.valid, true);
    });
});

describe('moodToScore', () => {
    it('maps moods consistently with learning_journal', () => {
        assert.equal(moodToScore('great'), 5);
        assert.equal(moodToScore('good'), 4);
        assert.equal(moodToScore('okay'), 3);
        assert.equal(moodToScore('struggled'), 2);
        assert.equal(moodToScore('unknown'), null);
    });

    it('uses the same mood enum as learning_journal', () => {
        assert.deepEqual(VALID_MOODS, ['great', 'good', 'okay', 'struggled']);
    });
});

describe('validateWritableEntryDate', () => {
    it('rejects future dates relative to timezone', () => {
        const today = getTodayInTimezone('UTC');
        const future = today.replace(/-(\d{2})$/, (_, d) => `-${String(Number(d) + 1).padStart(2, '0')}`);
        const result = validateWritableEntryDate(future, 'UTC');
        if (future > today) {
            assert.equal(result.valid, false);
            assert.ok(result.errors.some((e) => e.includes('future')));
        }
    });

    it('accepts today in the given timezone', () => {
        const today = getTodayInTimezone('Asia/Tokyo');
        const result = validateWritableEntryDate(today, 'Asia/Tokyo');
        assert.equal(result.valid, true);
        assert.equal(result.normalized, today);
    });
});

describe('buildLearningQuery', () => {
    it('embeds quoted timezone in SQL', () => {
        const sql = buildLearningQuery('America/New_York');
        assert.ok(sql.includes("'America/New_York'"));
        assert.ok(!sql.includes('at time zone America/New_York'));
    });

    it('adds date bounds when bounded option is set', () => {
        const sql = buildLearningQuery('Asia/Tokyo', { bounded: true });
        assert.ok(sql.includes('between $2::date and $3::date'));
    });

    it('does not add date bounds for single-day queries', () => {
        const sql = buildLearningQuery('Asia/Tokyo');
        assert.ok(!sql.includes('between $2::date and $3::date'));
    });
});

describe('fetchLearningMetricsForDate', () => {
    it('issues SQL with quoted timezone via pool', async () => {
        let capturedSql = '';
        const pool = {
            query: async (sql) => {
                capturedSql = sql;
                return { rows: [] };
            },
        };
        await fetchLearningMetricsForDate(pool, '00000000-0000-4000-8000-000000000001', '2026-06-22', 'Asia/Tokyo');
        assert.ok(capturedSql.includes("'Asia/Tokyo'"));
    });
});

describe('quoteTimezoneForSql', () => {
    it('wraps IANA timezone in single quotes for SQL', () => {
        assert.equal(quoteTimezoneForSql('Asia/Tokyo'), "'Asia/Tokyo'");
    });

    it('escapes single quotes in timezone names', () => {
        assert.equal(quoteTimezoneForSql("Foo'Bar"), "'Foo''Bar'");
    });

    it('is used when building learning metric SQL', async () => {
        const fs = await import('node:fs');
        const source = fs.readFileSync(new URL('../services/lifeJournalService.js', import.meta.url), 'utf8');
        assert.ok(source.includes('quoteTimezoneForSql(timezone)'));
        assert.ok(source.includes("at time zone $TIMEZONE$"));
    });
});

describe('patch upsert contract', () => {
    it('updates only explicitly provided fields on conflict', async () => {
        const fs = await import('node:fs');
        const source = fs.readFileSync(new URL('../services/lifeJournalService.js', import.meta.url), 'utf8');
        assert.ok(source.includes('hasOwn(payload, col)'));
        assert.ok(source.includes('= excluded.'));
        assert.ok(!source.includes('coalesce(excluded.mood, daily_reflections.mood)'));
    });

    it('resolves insert defaults for NOT NULL columns (tags, jsonb meals)', async () => {
        const fs = await import('node:fs');
        const source = fs.readFileSync(new URL('../services/lifeJournalService.js', import.meta.url), 'utf8');
        assert.ok(source.includes('...columns.map((col) => resolver(payload, col))'));
        assert.ok(!source.includes('hasOwn(payload, col) ? resolver(payload, col) : null'));
    });
});

describe('life journal route errors', () => {
    it('omits error detail in production responses', async () => {
        const fs = await import('node:fs');
        const source = fs.readFileSync(new URL('../routes/lifeJournal.js', import.meta.url), 'utf8');
        assert.ok(source.includes("process.env.NODE_ENV !== 'production'"));
        assert.ok(source.includes('respondServerError'));
        assert.ok(!source.includes('detail: error.message'));
    });

    it('exposes life journal privacy export and delete endpoints', async () => {
        const fs = await import('node:fs');
        const source = fs.readFileSync(new URL('../routes/lifeJournal.js', import.meta.url), 'utf8');
        assert.ok(source.includes("router.get('/life-journal/privacy'"));
        assert.ok(source.includes("router.get('/life-journal/export'"));
        assert.ok(source.includes("router.delete('/life-journal/data'"));
    });

    it('exposes POST /life-journal/advice weekly endpoint', async () => {
        const fs = await import('node:fs');
        const source = fs.readFileSync(new URL('../routes/lifeJournal.js', import.meta.url), 'utf8');
        assert.ok(source.includes("router.post('/life-journal/advice'"));
        assert.ok(source.includes('buildWeeklyAdviceFromDays'));
    });
});

describe('user isolation contract', () => {
    it('life journal SQL helpers always scope by user_id parameter', async () => {
        const fs = await import('node:fs');
        const source = fs.readFileSync(new URL('../services/lifeJournalService.js', import.meta.url), 'utf8');
        assert.ok(source.includes('where user_id = cast($1 as uuid)'));
        assert.ok(source.includes('on conflict (user_id, entry_date)'));
    });
});