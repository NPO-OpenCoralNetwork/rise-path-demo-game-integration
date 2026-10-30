// @ts-check
/**
 * Study time for job training, rule "study-time/v1" (doc/brushup-2026/training-plan.ja.md §4.9).
 * Pure: no imports, no Date.now, no randomness. Every time is the database clock in epoch
 * milliseconds; the browser never sends a time or a duration.
 *
 * The training page sends signals. A chain is one continuous visible stretch of one page: a new
 * random id when the page opens a unit, becomes visible again, changes unit, wakes from a stalled
 * timer, or is told to start over. A signal: { chain, seq, unit, born, at, stop, focus, input }.
 *   born:  server time of the chain's first stored signal (seq 0), the same on every signal of it;
 *   at:    server time the signal was received (strictly increasing within a chain, see admitSignal);
 *   stop:  the page hid or left (nothing of the chain counts after it);
 *   focus: the page had the window focus since its previous signal;
 *   input: the learner acted on the page (key, pointer, scroll, touch) since its previous signal.
 *
 * Counting a span [a, b) inside one Japan-time day, with the rule values of the school's private
 * rules file (timeRules.js; tests use artificial values):
 *   1. pieces: two consecutive signals (prev, s) of one chain, prev not a stop, with
 *      0 < s.at - prev.at <= gapMs give (prev.at, prev.at + min(s.at - prev.at, creditCapMs)] for
 *      the chain's unit. A longer pair is a break and counts nothing.
 *   2. presence, per page: from the chain's first signal and from each signal that reports an
 *      input, until idleMs after it. A piece counts only inside its own chain's presence.
 *   3. requireFocus: pieces without focus do not count.
 *   4. the cohort's dates and the span.
 *   5. overlap: an instant counts once. Same unit: once. Different units: 'prefer_focus_latest'
 *      (the focused page, then the page whose chain began last, then the smaller chain id) or
 *      'drop_conflicts' (neither).
 *   6. the unit's set time, in time order, after what earlier days counted (carried); the rest is
 *      kept as over the cap.
 * A span depends only on signals with at in [a - max(idleMs, gapMs), b + gapMs], so a day is final
 * once the database clock passes its end + gapMs; splitting a day anywhere and carrying the cap
 * gives the same total (server/tests/trainingStudyTime.test.js).
 */

export const STUDY_TIME_ALGORITHM = 'study-time/v1';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000; // Japan has no daylight saving time
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * @typedef {{ chain: string, seq: number, unit: string, born: number, at: number, stop: boolean, focus: boolean, input: boolean }} Signal
 * @typedef {{ gapMs: number, creditCapMs: number, idleMs: number, requireFocus: boolean, overlap: 'prefer_focus_latest' | 'drop_conflicts' }} CountingRules
 * @typedef {{ beatMs: number, minSpacingMs: number, maxPlaces: number }} CollectionRules
 * @typedef {{ algorithm: string, collection: CollectionRules, counting: CountingRules }} TimeRules
 * @typedef {{ from: number, to: number }} Range
 * @typedef {{ unit: string, countedMs: number, overCapMs: number }} UnitTime
 */

/** The Japan-time day (YYYY-MM-DD) of an instant. @param {number} ms */
export const jstDayOf = (ms) => new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);

/** A Japan-time day as [start, end) in epoch milliseconds. @param {string} day @returns {{ start: number, end: number }} */
export function jstDayRange(day) {
  const m = DAY_RE.exec(day);
  if (!m) throw new TypeError('jstDayRange: not a YYYY-MM-DD day');
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - JST_OFFSET_MS;
  return { start, end: start + DAY_MS };
}

/** @param {string} day */
export const nextDay = (day) => jstDayOf(jstDayRange(day).end);

/**
 * A cohort's dates (YYYY-MM-DD, both required) as the range it counts: [00:00 JST of the first
 * day, 00:00 JST after the last day). null when a date is missing: nothing counts then.
 * @param {string | null | undefined} startsOn @param {string | null | undefined} endsOn
 * @returns {Range | null}
 */
export function cohortRange(startsOn, endsOn) {
  if (!startsOn || !endsOn || endsOn < startsOn) return null;
  return { from: jstDayRange(startsOn).start, to: jstDayRange(endsOn).end };
}

/** The evidence a span [a, b) needs. @param {number} a @param {number} b @param {Pick<CountingRules, 'gapMs' | 'idleMs'>} counting */
export const evidenceWindow = (a, b, counting) => ({ from: a - Math.max(counting.idleMs, counting.gapMs), to: b + counting.gapMs });

/** @param {Array<[number, number]>} spans @returns {Array<[number, number]>} */
function mergeSpans(spans) {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** @param {number} a @param {number} b @param {Array<[number, number]>} spans */
function clipTo(a, b, spans) {
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const [x, y] of spans) {
    const lo = Math.max(a, x);
    const hi = Math.min(b, y);
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}

/**
 * @typedef {{ start: number, end: number, unit: string, chain: string, born: number, focus: boolean, key: string }} Piece
 */

/**
 * Pieces (step 1) and each chain's presence (step 2) of a set of signals.
 * @param {Signal[]} signals @param {CountingRules} counting
 */
function piecesOf(signals, counting) {
  const { gapMs, creditCapMs, idleMs } = counting;
  /** @type {Map<string, Signal[]>} */
  const byChain = new Map();
  for (const s of signals) {
    const list = byChain.get(s.chain);
    if (list) list.push(s);
    else byChain.set(s.chain, [s]);
  }
  /** @type {Piece[]} */
  const pieces = [];
  /** @type {Map<string, Array<[number, number]>>} */
  const present = new Map();
  for (const list of byChain.values()) {
    list.sort((x, y) => x.seq - y.seq);
    /** @type {Array<[number, number]>} */
    const presence = [];
    /** @type {Signal | null} */
    let prev = null;
    for (const s of list) {
      if (prev && !prev.stop) {
        const delta = s.at - prev.at;
        if (delta > 0 && delta <= gapMs) {
          pieces.push({ start: prev.at, end: prev.at + Math.min(delta, creditCapMs), unit: s.unit, chain: s.chain, born: s.born, focus: s.focus, key: `${s.chain}#${s.seq}` });
        }
      }
      if (s.input || s.seq === 0) presence.push([s.at, s.at + idleMs]);
      prev = s;
    }
    present.set(list[0].chain, mergeSpans(presence));
  }
  return { pieces, present };
}

/**
 * The winning piece of each elementary segment of [a, b) (steps 2 to 5).
 * @param {Piece[]} pieces @param {Map<string, Array<[number, number]>>} present @param {number} a @param {number} b
 * @param {CountingRules} counting @param {Range} cohort
 */
function winners(pieces, present, a, b, counting, cohort) {
  const lo = Math.max(a, cohort.from);
  const hi = Math.min(b, cohort.to);
  /** @type {Piece[]} */
  const parts = [];
  for (const p of pieces) {
    if (counting.requireFocus && !p.focus) continue;
    for (const [x, y] of clipTo(Math.max(p.start, lo), Math.min(p.end, hi), present.get(p.chain) ?? [])) parts.push({ ...p, start: x, end: y });
  }
  const edges = [...new Set(parts.flatMap((p) => [p.start, p.end]))].sort((x, y) => x - y);
  const byStart = [...parts].sort((x, y) => x.start - y.start);
  /** @type {{ start: number, end: number, unit: string, key: string }[]} */
  const out = [];
  let next = 0;
  /** @type {Piece[]} */
  let active = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const x = edges[i];
    const y = edges[i + 1];
    while (next < byStart.length && byStart[next].start <= x) active.push(byStart[next++]);
    active = active.filter((p) => p.end > x);
    if (!active.length) continue;
    const units = new Set(active.map((p) => p.unit));
    if (counting.overlap === 'drop_conflicts' && units.size > 1) continue;
    const win = [...active].sort((p, q) => (Number(q.focus) - Number(p.focus)) || (q.born - p.born) || (p.chain < q.chain ? -1 : p.chain > q.chain ? 1 : 0))[0];
    const last = out[out.length - 1];
    if (last && last.end === x && last.unit === win.unit && last.key === win.key) last.end = y;
    else out.push({ start: x, end: y, unit: win.unit, key: win.key });
  }
  return out;
}

const NO_COHORT = Object.freeze({ from: -Infinity, to: Infinity });

/**
 * Counted time of [a, b) (inside one Japan-time day); each unit's set time applies after carriedMs.
 * @param {{ a: number, b: number, signals: Signal[], rules: Pick<TimeRules, 'counting'>, setMs: Map<string, number>, carriedMs: Map<string, number>, cohort?: Range }} input
 * @returns {{ countedMs: number, units: UnitTime[], carriedAfterMs: Map<string, number>, signals: number }}
 */
export function countSpan({ a, b, signals, rules, setMs, carriedMs, cohort = NO_COHORT }) {
  const w = evidenceWindow(a, b, rules.counting);
  const inWindow = signals.filter((s) => s.at >= w.from && s.at <= w.to);
  const { pieces, present } = piecesOf(inWindow, rules.counting);
  const segs = winners(pieces, present, a, b, rules.counting, cohort);
  /** @type {Map<string, number>} */
  const counted = new Map();
  /** @type {Map<string, number>} */
  const over = new Map();
  for (const seg of segs) {
    const len = seg.end - seg.start;
    const used = (carriedMs.get(seg.unit) ?? 0) + (counted.get(seg.unit) ?? 0);
    const c = Math.min(len, Math.max(0, (setMs.get(seg.unit) ?? 0) - used));
    counted.set(seg.unit, (counted.get(seg.unit) ?? 0) + c);
    over.set(seg.unit, (over.get(seg.unit) ?? 0) + (len - c));
  }
  const units = [...new Set([...counted.keys(), ...over.keys()])].sort().map((unit) => ({ unit, countedMs: counted.get(unit) ?? 0, overCapMs: over.get(unit) ?? 0 }));
  const carriedAfterMs = new Map(carriedMs);
  for (const u of units) carriedAfterMs.set(u.unit, (carriedAfterMs.get(u.unit) ?? 0) + u.countedMs);
  return { countedMs: units.reduce((n, u) => n + u.countedMs, 0), units, carriedAfterMs, signals: inWindow.length };
}

/**
 * One Japan-time day.
 * @param {{ day: string } & Omit<Parameters<typeof countSpan>[0], 'a' | 'b'>} input
 */
export function countDay({ day, ...rest }) {
  const { start, end } = jstDayRange(day);
  return { day, ...countSpan({ a: start, b: end, ...rest }) };
}

/**
 * Consecutive days, each unit's set time carried from one day to the next (closing days, and the
 * reference for today's live total). Rules and units may change by day (the cohort's settings).
 * @param {{ fromDay: string, toDay: string, signals: Signal[], rulesOf: (day: string) => Pick<TimeRules, 'counting'>, setMsOf: (day: string) => Map<string, number>, carriedMs: Map<string, number>, cohort?: Range }} input
 */
export function countDays({ fromDay, toDay, signals, rulesOf, setMsOf, carriedMs, cohort }) {
  const days = [];
  let carried = new Map(carriedMs);
  for (let day = fromDay; day <= toDay; day = nextDay(day)) {
    const r = countDay({ day, signals, rules: rulesOf(day), setMs: setMsOf(day), carriedMs: carried, cohort });
    days.push(r);
    carried = r.carriedAfterMs;
  }
  return { days, carriedAfterMs: carried };
}

/**
 * The reference: every signal at once, no window, cut at 00:00 Japan time at the end. The tests
 * check that the day-by-day fold gives the same numbers.
 * @param {{ signals: Signal[], rules: Pick<TimeRules, 'counting'>, setMs: Map<string, number>, cohort?: Range }} input
 * @returns {Map<string, Map<string, number>>} day → unit → counted ms
 */
export function countWhole({ signals, rules, setMs, cohort = NO_COHORT }) {
  const { pieces, present } = piecesOf(signals, rules.counting);
  const segs = winners(pieces, present, -Infinity, Infinity, rules.counting, cohort);
  /** @type {Map<string, Map<string, number>>} */
  const byDay = new Map();
  /** @type {Map<string, number>} */
  const used = new Map();
  for (const seg of segs) {
    for (let x = seg.start; x < seg.end;) {
      const day = jstDayOf(x);
      const y = Math.min(seg.end, jstDayRange(day).end);
      const c = Math.min(y - x, Math.max(0, (setMs.get(seg.unit) ?? 0) - (used.get(seg.unit) ?? 0)));
      used.set(seg.unit, (used.get(seg.unit) ?? 0) + c);
      let m = byDay.get(day);
      if (!m) byDay.set(day, (m = new Map()));
      m.set(seg.unit, (m.get(seg.unit) ?? 0) + c);
      x = y;
    }
  }
  return byDay;
}

/**
 * Whether the server stores a signal, decided under the learner's lock with the database clock.
 *   refuse (409, nothing stored): no rules or units for today ('time_not_configured'); outside
 *     the cohort's dates, or a date missing ('not_in_session'; a signal up to gapMs after the
 *     last day is still stored so the last pair can count); a unit not in today's units
 *     ('unit_unknown'); a chain id already used for another cohort or unit ('chain_mismatch').
 *   ignore (200, accepted: false, nothing stored; the page reacts to the reason):
 *     'duplicate'   seq not after the chain's last stored seq;
 *     'chain_ended' the chain already stopped;
 *     'not_open'    a chain the server does not know that starts with a stop or after seq 0;
 *     'restart'     the clock has not moved past the chain's last signal (the page starts a new chain);
 *     'too_soon'    a beat sooner than minSpacingMs after the chain's last signal (a stop passes);
 *     'other_place' more open chains than maxPlaces and this one is not among the newest (a stop passes).
 *   An open chain: its last signal is not a stop and is at most gapMs old.
 * @param {{
 *   now: number,
 *   cohortId: string,
 *   signal: { chainId: string, seq: number, unitKey: string, stop: boolean },
 *   configured: boolean,
 *   session: Range | null,
 *   unitKnown: boolean,
 *   chain: { cohortId: string, unitKey: string, bornAt: number, lastSeq: number, lastAt: number, lastStop: boolean } | null,
 *   places: { chainId: string, bornAt: number, lastAt: number, lastStop: boolean }[],
 *   rules: { collection: Pick<CollectionRules, 'minSpacingMs' | 'maxPlaces'>, counting: Pick<CountingRules, 'gapMs'> },
 * }} input
 * @returns {{ verdict: 'accept', bornAt: number } | { verdict: 'refuse' | 'ignore', reason: string }}
 */
export function admitSignal({ now, cohortId, signal, configured, session, unitKnown, chain, places, rules }) {
  if (!configured) return { verdict: 'refuse', reason: 'time_not_configured' };
  if (!session || now < session.from || now >= session.to + rules.counting.gapMs) return { verdict: 'refuse', reason: 'not_in_session' };
  if (!unitKnown) return { verdict: 'refuse', reason: 'unit_unknown' };
  if (chain && (chain.cohortId !== cohortId || chain.unitKey !== signal.unitKey)) return { verdict: 'refuse', reason: 'chain_mismatch' };
  if (chain) {
    if (signal.seq <= chain.lastSeq) return { verdict: 'ignore', reason: 'duplicate' };
    if (chain.lastStop) return { verdict: 'ignore', reason: 'chain_ended' };
    if (now <= chain.lastAt) return { verdict: 'ignore', reason: 'restart' };
    if (!signal.stop && now - chain.lastAt < rules.collection.minSpacingMs) return { verdict: 'ignore', reason: 'too_soon' };
  } else if (signal.stop || signal.seq !== 0) {
    return { verdict: 'ignore', reason: 'not_open' };
  }
  const bornAt = chain ? chain.bornAt : now;
  if (!signal.stop) {
    const open = places.filter((p) => p.chainId !== signal.chainId && !p.lastStop && now - p.lastAt <= rules.counting.gapMs);
    const newer = open.filter((p) => p.bornAt > bornAt || (p.bornAt === bornAt && p.chainId < signal.chainId)).length;
    if (newer >= rules.collection.maxPlaces) return { verdict: 'ignore', reason: 'other_place' };
  }
  return { verdict: 'accept', bornAt };
}
