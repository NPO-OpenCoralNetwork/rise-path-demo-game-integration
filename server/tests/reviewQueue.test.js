// Phase 6 stage 1 (design §1.5, §1.6, §7.1 "One model for order and schedule"): the pure queue rules
// in shared/review/queue.js.
// - riskOf of a card is the retrievability its next review uses (the lesson prior or the last
//   review), so ordering and scheduling cannot drift apart; a card with no memory sorts last;
// - pickToday: R2's cap of 10 per Japan-time day, most at risk first, the rest carried over;
// - reviewMinutes (「約 N 分」);
// - B1: the release backlog (92 cards learned 1–8 days before day 0) through the real scheduler
//   and pickToday, day by day (design R-5).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AGAIN, DEFAULT_PARAMETERS, GOOD, S_MAX, S_MIN, scheduler } from '../../shared/review/fsrs.js';
import { LESSON_PRIORS, REVIEW_DAILY_LIMIT, SECONDS_PER_CARD, pickToday, reviewMinutes, riskOf } from '../../shared/review/queue.js';

const w = DEFAULT_PARAMETERS;
const DECAY = -w[20];
const FACTOR = 0.9 ** (1 / DECAY) - 1;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

/**
 * The FSRS-6 recall and lapse stability for a review that sees retrievability r, written again
 * here from the wiki formulas, so the test can feed it riskOf's value.
 */
const stabilityAfter = ({ stability: s, difficulty: d }, grade, r) => clamp(grade === AGAIN
  ? Math.min(w[11] * d ** -w[12] * ((s + 1) ** w[13] - 1) * Math.exp(w[14] * (1 - r)), s / Math.exp(w[17] * w[18]))
  : s * (1 + Math.exp(w[8]) * (11 - d) * s ** -w[9] * (Math.exp(w[10] * (1 - r)) - 1)), S_MIN, S_MAX);

/** 'YYYY-MM-DD' of day n after 2026-10-27 (test dates only). */
const dayOn = (n) => new Date(Date.UTC(2026, 9, 27 + n)).toISOString().slice(0, 10);

/** A queue row (the shape tools/core/reviewQueue.js builds from REVIEW_ROWS_SQL). */
const row = (patch) => ({ due: true, reviewedToday: false, stability: 2.3065, daysSince: 2, dueOn: dayOn(0), order: 0, ...patch });

describe('constants', () => {
  it('10 cards a day, 18 seconds a card (R2: about 3 minutes)', () => {
    assert.equal(REVIEW_DAILY_LIMIT, 10);
    assert.equal(SECONDS_PER_CARD, 18);
    assert.equal(reviewMinutes(REVIEW_DAILY_LIMIT), 3);
  });
});

describe('reviewMinutes', () => {
  it('0 for none, else max(1, round(n·18/60))', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 20].map(reviewMinutes), [0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6]);
    for (const n of [-1, NaN, Infinity, -Infinity]) assert.equal(reviewMinutes(n), 0, `n ${n}`);
  });
});

describe('one model for order and schedule', () => {
  it('riskOf of a lesson prior is the R the first review uses (Good and Again, both buttons)', () => {
    for (const [name, prior, days] of [['good', LESSON_PRIORS.good, [1, 2, 3, 5, 8, 13, 30]], ['again', LESSON_PRIORS.again, [1, 2, 4, 9]]]) {
      for (const t of days) {
        const r = riskOf({ stability: prior.stability, daysSince: t });
        assert.equal(r, scheduler.retrievability(t, prior.stability), `${name} t ${t}`);
        for (const grade of [GOOD, AGAIN]) {
          const next = scheduler.review(prior, grade, t);
          const want = stabilityAfter(prior, grade, r);
          assert.ok(Math.abs(next.stability - want) <= 1e-9 * want, `${name} t ${t} grade ${grade}: ${next.stability} = ${want}`);
        }
      }
    }
  });

  it('riskOf of a reviewed card is the R its next review uses', () => {
    const memory = scheduler.review(LESSON_PRIORS.good, GOOD, 2);
    for (const t of [1, 5, 11, 20]) {
      const r = riskOf({ stability: memory.stability, daysSince: t });
      const next = scheduler.review(memory, GOOD, t);
      assert.ok(Math.abs(next.stability - stabilityAfter(memory, GOOD, r)) <= 1e-9 * next.stability, `t ${t}`);
    }
  });

  it('the prior is not the new-card model: a Good prior learned 2 days ago is due with R ≈ 0.909', () => {
    const r = riskOf({ stability: LESSON_PRIORS.good.stability, daysSince: LESSON_PRIORS.good.intervalDays });
    assert.ok(r > 0.9 && r < 0.91, `R ${r}`);
  });

  it('riskOf: no memory is Infinity, t = 0 is 1, older is lower, a negative day counts as 0, bad values sort like no memory', () => {
    assert.equal(riskOf({ stability: null, daysSince: null }), Infinity);
    assert.equal(riskOf({ stability: undefined, daysSince: 3 }), Infinity);
    assert.equal(riskOf({ stability: 2.3065, daysSince: 0 }), 1);
    assert.ok(riskOf({ stability: 2.3065, daysSince: 3 }) < riskOf({ stability: 2.3065, daysSince: 2 }));
    assert.ok(riskOf({ stability: 0.212, daysSince: 1 }) < riskOf({ stability: 2.3065, daysSince: 1 }));
    for (const bad of [{ stability: 0, daysSince: 1 }, { stability: NaN, daysSince: 1 }, { stability: 2, daysSince: null }, { stability: 2, daysSince: NaN }]) {
      assert.equal(riskOf(bad), Infinity, JSON.stringify(bad));
    }
    // A negative daysSince (a rating dated after today) counts as 0, so R never exceeds 1.
    assert.equal(riskOf({ stability: 2.3065, daysSince: -1 }), 1);
  });

  it('a card with no memory sorts after every card with one, even one reviewed today-fresh', () => {
    const rows = [
      row({ stability: null, daysSince: null, dueOn: dayOn(-30), order: 0 }),
      row({ stability: S_MAX, daysSince: 0, order: 1 }),
      row({ stability: 0.212, daysSince: 1, order: 2 }),
      row({ stability: null, daysSince: null, dueOn: dayOn(-1), order: 3 }),
    ];
    // Among cards without memory, the earlier due day first.
    assert.deepEqual(pickToday(rows, { doneToday: 0 }).picked.map((r) => r.order), [2, 1, 0, 3]);
  });
});

describe('pickToday (R2)', () => {
  const fifteen = Array.from({ length: 15 }, (_, k) => row({ daysSince: 2 + k, order: k }));

  it('15 due, 0 done → the 10 most at risk; 5 carried over', () => {
    const today = pickToday(fifteen, { doneToday: 0 });
    assert.deepEqual(today.picked.map((r) => r.order), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    assert.deepEqual([today.dueTotal, today.remainingToday, today.carriedOver], [15, 10, 5]);
  });

  it('3 done → 7; 10 done → 0; more than 10 done → 0', () => {
    assert.equal(pickToday(fifteen, { doneToday: 3 }).picked.length, 7);
    assert.equal(pickToday(fifteen, { doneToday: 3 }).carriedOver, 8);
    for (const doneToday of [10, 12]) {
      const today = pickToday(fifteen, { doneToday });
      assert.deepEqual([today.picked.length, today.remainingToday, today.dueTotal, today.carriedOver], [0, 0, 15, 15]);
    }
    assert.equal(pickToday(fifteen, { doneToday: 0, limit: 4 }).picked.length, 4);
  });

  it('doneToday NaN or negative counts as 0; a fractional one is rounded down', () => {
    for (const doneToday of [NaN, -3]) {
      const today = pickToday(fifteen, { doneToday });
      assert.deepEqual([today.picked.length, today.carriedOver], [10, 5], String(doneToday));
    }
    const today = pickToday(fifteen, { doneToday: 2.7 });
    assert.deepEqual([today.picked.length, today.carriedOver], [8, 7]);
  });

  it('only due cards not graded today; fewer than the room → no carry-over', () => {
    const rows = [
      row({ order: 0 }),
      row({ order: 1, due: false, dueOn: dayOn(3) }),
      row({ order: 2, due: false, reviewedToday: true, dueOn: dayOn(11) }),
      row({ order: 3, reviewedToday: true }),
      row({ order: 4 }),
    ];
    const today = pickToday(rows, { doneToday: 1 });
    assert.deepEqual(today.picked.map((r) => r.order), [0, 4]);
    assert.deepEqual([today.dueTotal, today.remainingToday, today.carriedOver], [2, 2, 0]);
    assert.deepEqual(pickToday([], { doneToday: 0 }), { picked: [], dueTotal: 0, remainingToday: 0, carriedOver: 0 });
  });

  it('ties: same risk → the earlier due day, then catalog order; the input is not reordered', () => {
    const rows = [
      row({ order: 5, dueOn: dayOn(0) }),
      row({ order: 2, dueOn: dayOn(0) }),
      row({ order: 9, dueOn: dayOn(-2) }),
      row({ order: 1, dueOn: dayOn(0), daysSince: 3 }),
    ];
    const before = rows.map((r) => r.order);
    assert.deepEqual(pickToday(rows, { doneToday: 0 }).picked.map((r) => r.order), [1, 9, 2, 5]);
    assert.deepEqual(rows.map((r) => r.order), before);
    assert.equal(pickToday(rows, { doneToday: 0 }).picked[0], rows[3], 'picked are the caller\'s rows');
  });

  it('a 「もう一度」 prior from yesterday comes before a Good prior due today', () => {
    const rows = [
      row({ order: 0, stability: LESSON_PRIORS.good.stability, daysSince: 2 }),
      row({ order: 1, stability: LESSON_PRIORS.again.stability, daysSince: 1 }),
    ];
    assert.deepEqual(pickToday(rows, { doneToday: 0 }).picked.map((r) => r.order), [1, 0]);
  });
});

describe('B1: the release backlog (design R-5), pure, fuzz off, every answer 「覚えた」', () => {
  /**
   * 92 cards; card i learned 1 + i mod 8 days before day 0 with a lesson prior (Again for the
   * cards againOf picks), due that day + the prior's interval. Each day: pickToday with the cap
   * (nothing done yet that day), then every picked card graded Good at t = days since its last rating.
   * @param {(i: number) => boolean} againOf
   */
  const simulate = (againOf) => {
    const cards = Array.from({ length: 92 }, (_, i) => {
      const learned = -(1 + (i % 8));
      const prior = againOf(i) ? LESSON_PRIORS.again : LESSON_PRIORS.good;
      return { i, memory: { stability: prior.stability, difficulty: prior.difficulty }, last: learned, dueDay: learned + prior.intervalDays, reviews: 0 };
    });
    const perDay = [];
    const carried = [];
    let allSeenBy = null;
    for (let d = 0; d < 60; d += 1) {
      const rows = cards.map((c) => ({
        card: c, due: c.dueDay <= d, reviewedToday: false,
        stability: c.memory.stability, daysSince: d - c.last, dueOn: dayOn(c.dueDay), order: c.i,
      }));
      const today = pickToday(rows, { doneToday: 0 });
      for (const { card } of today.picked) {
        const next = scheduler.review(card.memory, GOOD, d - card.last);
        card.memory = { stability: next.stability, difficulty: next.difficulty };
        card.last = d;
        card.dueDay = d + next.intervalDays;
        card.reviews += 1;
      }
      perDay.push(today.picked.length);
      carried.push(today.carriedOver);
      if (allSeenBy === null && cards.every((c) => c.reviews > 0)) allSeenBy = d;
    }
    const total = perDay.reduce((a, b) => a + b, 0);
    return { perDay, carried, total, allSeenBy, carryEndsOn: carried.indexOf(0) };
  };

  it('every 「覚えた」 in the lessons: 10 a day for 9 days, then 2; each card seen once by day 9; 184 reviews in 60 days', () => {
    const run = simulate(() => false);
    assert.deepEqual(run.perDay.slice(0, 12), [10, 10, 10, 10, 10, 10, 10, 10, 10, 2, 0, 0]);
    assert.equal(run.allSeenBy, 9);
    assert.equal(run.carryEndsOn, 9);
    assert.equal(run.total, 184);
    assert.ok(run.perDay.every((n) => n <= REVIEW_DAILY_LIMIT));
    assert.deepEqual(run.perDay, [
      10, 10, 10, 10, 10, 10, 10, 10, 10, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 9, 9, 9, 9, 8, 8,
      8, 10, 10, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('every 5th card marked 「もう一度」 in its lesson: carry-over ends on day 11; 208 reviews in 60 days', () => {
    const run = simulate((i) => i % 5 === 0);
    assert.deepEqual(run.perDay.slice(0, 12), [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 1]);
    assert.equal(run.carryEndsOn, 11);
    assert.equal(run.allSeenBy, 9);
    assert.equal(run.total, 208);
    assert.ok(run.perDay.every((n) => n <= REVIEW_DAILY_LIMIT));
  });

  it('the 「もう一度」 cards come first on day 0', () => {
    const cards = Array.from({ length: 92 }, (_, i) => {
      const prior = i % 5 === 0 ? LESSON_PRIORS.again : LESSON_PRIORS.good;
      const learned = -(1 + (i % 8));
      return row({ order: i, stability: prior.stability, daysSince: -learned, due: learned + prior.intervalDays <= 0, again: i % 5 === 0 });
    });
    const picked = pickToday(cards, { doneToday: 0 }).picked;
    assert.ok(picked.every((r) => r.again), picked.map((r) => r.order).join(','));
  });
});

describe('a row that is not a memory', () => {
  it('sorts like a card with no memory instead of throwing', () => {
    const rows = [row({ order: 0, stability: -1 }), row({ order: 1 })];
    assert.deepEqual(pickToday(rows, { doneToday: 0 }).picked.map((r) => r.order), [1, 0]);
  });
});
