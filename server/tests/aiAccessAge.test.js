// Age from a birth month (server/safety/age.js): Japan-time dates, birthday = last day of the
// birth month, so turning 18 never happens earlier than the real birthday.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ageFromBirthYm, isMinorBirthYm, parseBirthYm, tokyoDate } from '../safety/age.js';

const at = (iso) => new Date(iso);

describe('ageFromBirthYm', () => {
    it('turns 18 on the last day of the birth month, at 00:00 Japan time', () => {
        // 31 Oct 2026 00:00 JST = 30 Oct 2026 15:00 UTC.
        assert.equal(ageFromBirthYm('2008-10', at('2026-10-30T14:59:59.999Z')), 17);
        assert.equal(ageFromBirthYm('2008-10', at('2026-10-30T15:00:00.000Z')), 18);
        assert.equal(isMinorBirthYm('2008-10', at('2026-10-30T14:59:59.999Z')), true);
        assert.equal(isMinorBirthYm('2008-10', at('2026-10-30T15:00:00.000Z')), false);
    });

    it('rounds toward younger across the month boundaries', () => {
        assert.equal(ageFromBirthYm('2008-10', at('2026-10-01T00:00:00+09:00')), 17, 'early in the birth month');
        assert.equal(ageFromBirthYm('2008-10', at('2026-09-30T23:59:00+09:00')), 17);
        assert.equal(ageFromBirthYm('2008-10', at('2026-11-01T00:00:00+09:00')), 18);
        assert.equal(ageFromBirthYm('2008-11', at('2026-10-31T23:59:59+09:00')), 17, 'the month before the birth month');
        assert.equal(ageFromBirthYm('2008-09', at('2026-10-01T00:00:00+09:00')), 18, 'the month after the birth month');
    });

    it('uses the Japan-time date, not the host or UTC date', () => {
        // 31 Oct 2026 08:00 JST is still 30 Oct in UTC.
        const now = at('2026-10-30T23:00:00.000Z');
        assert.deepEqual(tokyoDate(now), { year: 2026, month: 10, day: 31 });
        assert.equal(ageFromBirthYm('2008-10', now), 18);
    });

    it('handles December into January and February in leap and common years', () => {
        assert.equal(ageFromBirthYm('2008-12', at('2026-12-30T14:59:59.000Z')), 17);
        assert.equal(ageFromBirthYm('2008-12', at('2026-12-30T15:00:00.000Z')), 18, '31 Dec JST');
        assert.equal(ageFromBirthYm('2008-12', at('2027-01-01T00:00:00+09:00')), 18);
        assert.equal(ageFromBirthYm('2008-02', at('2026-02-27T23:59:59+09:00')), 17);
        assert.equal(ageFromBirthYm('2008-02', at('2026-02-28T00:00:00+09:00')), 18, 'common year: 28 Feb');
        assert.equal(ageFromBirthYm('2010-02', at('2028-02-28T23:59:59+09:00')), 17, 'leap year: not yet on 28 Feb');
        assert.equal(ageFromBirthYm('2010-02', at('2028-02-29T00:00:00+09:00')), 18, 'leap year: 29 Feb');
    });

    it('answers null for anything that is not YYYY-MM, and counts it as a minor', () => {
        for (const value of ['2008-1', '2008-13', '2008-00', '08-10', '2008/10', '', null, undefined, 200810, {}]) {
            assert.equal(ageFromBirthYm(value, at('2026-10-22T00:00:00Z')), null, String(value));
            assert.equal(isMinorBirthYm(value, at('2026-10-22T00:00:00Z')), true, String(value));
        }
        assert.equal(isMinorBirthYm('1980-04', at('2026-10-22T00:00:00Z')), false);
        assert.equal(isMinorBirthYm('2020-04', at('2026-10-22T00:00:00Z')), true);
    });
});

describe('parseBirthYm', () => {
    const now = at('2026-10-22T03:00:00Z');

    it('accepts past and current months as YYYY-MM', () => {
        assert.equal(parseBirthYm('2008-10', now), '2008-10');
        assert.equal(parseBirthYm(' 2014-03 ', now), '2014-03');
        assert.equal(parseBirthYm('1900-01', now), '1900-01');
        assert.equal(parseBirthYm('2026-10', now), '2026-10', 'the current month');
    });

    it('refuses the future, before 1900 and other shapes', () => {
        assert.equal(parseBirthYm('2026-11', now), null);
        assert.equal(parseBirthYm('2027-01', now), null);
        assert.equal(parseBirthYm('1899-12', now), null);
        assert.equal(parseBirthYm('2008-10-01', now), null);
        assert.equal(parseBirthYm('2008-13', now), null);
        assert.equal(parseBirthYm(2008, now), null);
        assert.equal(parseBirthYm(undefined, now), null);
    });

    it('takes the current month in Japan time', () => {
        // 1 Nov 2026 00:30 JST: November is the current month in Japan, not yet in UTC.
        const tokyoNovember = at('2026-10-31T15:30:00Z');
        assert.equal(parseBirthYm('2026-11', tokyoNovember), '2026-11');
        assert.equal(parseBirthYm('2026-11', at('2026-10-31T14:59:00Z')), null);
    });
});
