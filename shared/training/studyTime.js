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
 *   stop:  the page ended the chain: it hid, left, changed unit or started over (nothing of the
 *          chain counts after it);
 *   focus: the page had the window focus since its previous signal;
 *   input: the learner acted on the page since its previous signal (key, pointer, scroll, touch;
 *          the page also reports one on the first signal of a chain it starts because the learner
 *          opened or showed the page or changed unit, and not on a restart of its own).
 *
 * Counting a span [a, b) inside one Japan-time day, with the rule values of the school's private
 * rules file (timeRules.js; tests use artificial values):
 *   1. pieces: two consecutive signals (prev, s) of one chain, prev not a stop, with
 *      0 < s.at - prev.at <= gapMs give (prev.at, prev.at + min(s.at - prev.at, creditCapMs)] for
 *      the chain's unit. A longer pair is a break and counts nothing.
 *   2. presence, per page: from each signal that reports an input, until idleMs after it. A
 *      piece counts only inside its own chain's presence. A chain ends at its first stop: nothing of
 *      it counts after that, whatever was stored.
 *   3. requireFocus: pieces without focus do not count.
 *   4. the cohort's dates (cohortRange; null, a cohort without both dates, counts nothing) and
 *      the span.
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
 * @typedef {{ beatMs: number, minSpacingMs: number, maxPlaces: number, gapMs: number, unitKnown: (unit: string) => boolean }} AdmitRules
 *   what admitSignal decides a signal on a day with (pendingSignals): the collection's beatMs (the
 *   nextInMs a signal stored that day answers), minSpacingMs and maxPlaces, the counting's gapMs (its
 *   open places) and whether the day's unit list has a unit
 */

/** The Japan-time day (YYYY-MM-DD) of an instant. @param {number} ms */
export const jstDayOf = (ms) => new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);

/** A Japan-time day as [start, end) in epoch milliseconds. @param {string} day @returns {{ start: number, end: number }} */
export function jstDayRange(day) {
  const m = DAY_RE.exec(day);
  if (!m) throw new TypeError('jstDayRange: not a YYYY-MM-DD day');
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - JST_OFFSET_MS;
  if (jstDayOf(start) !== day) throw new TypeError('jstDayRange: not a YYYY-MM-DD day');
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
      if (prev?.stop) break;
      if (prev) {
        const delta = s.at - prev.at;
        if (delta > 0 && delta <= gapMs) {
          pieces.push({ start: prev.at, end: prev.at + Math.min(delta, creditCapMs), unit: s.unit, chain: s.chain, born: s.born, focus: s.focus, key: `${s.chain}#${s.seq}` });
        }
      }
      if (s.input) presence.push([s.at, s.at + idleMs]);
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

/** No cohort dates given (tests and references): nothing is clipped. */
const NO_COHORT = Object.freeze({ from: -Infinity, to: Infinity });
/** A cohort without both dates (cohortRange returned null): nothing counts. */
const EMPTY = Object.freeze({ from: Infinity, to: -Infinity });

/**
 * Counted time of [a, b) (inside one Japan-time day); each unit's set time applies after carriedMs.
 * cohort: the cohort's range (cohortRange); null counts nothing; left out, nothing is clipped.
 * @param {{ a: number, b: number, signals: Signal[], rules: Pick<TimeRules, 'counting'>, setMs: Map<string, number>, carriedMs: Map<string, number>, cohort?: Range | null }} input
 * @returns {{ countedMs: number, units: UnitTime[], carriedAfterMs: Map<string, number>, signals: number }}
 */
export function countSpan({ a, b, signals, rules, setMs, carriedMs, cohort = NO_COHORT }) {
  const w = evidenceWindow(a, b, rules.counting);
  const inWindow = signals.filter((s) => s.at >= w.from && s.at <= w.to);
  const { pieces, present } = piecesOf(inWindow, rules.counting);
  const segs = winners(pieces, present, a, b, rules.counting, cohort ?? EMPTY);
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
 * @param {{ fromDay: string, toDay: string, signals: Signal[], rulesOf: (day: string) => Pick<TimeRules, 'counting'>, setMsOf: (day: string) => Map<string, number>, carriedMs: Map<string, number>, cohort?: Range | null }} input
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
 * @param {{ signals: Signal[], rules: Pick<TimeRules, 'counting'>, setMs: Map<string, number>, cohort?: Range | null }} input
 * @returns {Map<string, Map<string, number>>} day → unit → counted ms
 */
export function countWhole({ signals, rules, setMs, cohort = NO_COHORT }) {
  const { pieces, present } = piecesOf(signals, rules.counting);
  const segs = winners(pieces, present, -Infinity, Infinity, rules.counting, cohort ?? EMPTY);
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
 *     the cohort's dates, or a date missing ('not_in_session'; a signal of a chain the server knows
 *     is still stored up to gapMs after the last day so its last pair can count, a new chain is not);
 *     a unit not in today's units
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
  if (!session || now < session.from || now >= (chain ? session.to + rules.counting.gapMs : session.to)) return { verdict: 'refuse', reason: 'not_in_session' };
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

/**
 * The other open pages' next signals: open pages go on, so the time since a page's last signal is
 * not stored yet but will be. Each page sends its chain's next beat nextInMs after its last signal
 * (the beatMs of that signal's day), and admitSignal decides it as it comes, with the setting of
 * the day it comes on (admitOf), in time order: accepted, it is pending (its last signal again, with
 * its last flags and no input); refused (no setting, a unit that day's list does not have) or
 * ignored other_place, the page sends no more signals of that chain (nextInMs null, not even a
 * stop); ignored too_soon (a setting from 00:00 with a larger minSpacingMs), the page sends it again
 * nextInMs (that day's beatMs) later. A beat due by now and not stored was decided as it came: one
 * admitSignal would have stored is late, and comes now. A page whose beat is stored goes on beating
 * nextInMs (that day's beatMs) after it. A beat's places are the chains' last signals at its
 * instant: the stored ones, and, for an instant after now, the beats this look-ahead stores before
 * it (a late beat renews only a place still open now). Not foreseen: pages opened or stopped after
 * now, a pushed-out page's stop before its beat (the learner hid or closed it; a stop passes, and
 * closes its last pair), beats later than their nextInMs, pages closed without a stop, and the
 * order of signals in the same millisecond. Whether a day credits a pending pair is the counting's
 * (that day's gapMs and creditCapMs).
 * @param {{ now: number, signals: Signal[], admitOf: (day: string) => AdmitRules | null, except?: string | null }} input
 *   signals: the stored evidence up to now; admitOf: a day's rules (null: no setting that day;
 *   beatMs 0: the next beat is now); except: a chain left out (the page asking; it still goes on)
 * @returns {Signal[]} each other chain's pending signal (last signal before now), in the order of the evidence
 */
export function pendingSignals({ now, signals, admitOf, except = null }) {
  /** @type {Map<string, Signal[]>} each chain's signals in order */
  const chains = new Map();
  for (const s of signals) {
    const list = chains.get(s.chain);
    if (list) list.push(s);
    else chains.set(s.chain, [s]);
  }
  for (const list of chains.values()) list.sort((x, y) => x.seq - y.seq);
  /** The beats this look-ahead stores at or after now, by chain. @type {Map<string, number>} */
  const stored = new Map();
  /** Every chain's place at t: its last signal at or before t; after now, a beat stored here up to t. @param {number} t */
  const placesAt = (t) => {
    const places = [];
    for (const [chain, list] of chains) {
      let q = null;
      for (const g of list) {
        if (g.at > t) break;
        q = g;
      }
      if (!q) continue;
      const beat = t > now ? stored.get(chain) : undefined;
      places.push(beat !== undefined && beat <= t
        ? { chainId: chain, bornAt: q.born, lastAt: beat, lastStop: false }
        : { chainId: chain, bornAt: q.born, lastAt: q.at, lastStop: q.stop });
    }
    return places;
  };
  /**
   * A page's beat: its chain l, seq, at t, after its last accepted signal at `from`; first: the
   * beat whose pending pair is wanted (the other pages' next beat after their last stored signal),
   * else one that only keeps its page's place (the asking page's, and each page's later beats).
   * @typedef {{ l: Signal, seq: number, from: number, t: number, resent: number, first: boolean }} Beat
   */
  /** admitSignal on a beat, with the setting of its day. @param {Beat} beat */
  const decide = ({ l, seq, from, t }) => {
    const rules = admitOf(jstDayOf(t));
    const verdict = admitSignal({
      now: t, cohortId: '', signal: { chainId: l.chain, seq, unitKey: l.unit, stop: false },
      configured: rules !== null, session: { from: -Infinity, to: Infinity }, unitKnown: rules !== null && rules.unitKnown(l.unit),
      chain: { cohortId: '', unitKey: l.unit, bornAt: l.born, lastSeq: seq - 1, lastAt: from, lastStop: false },
      places: placesAt(t),
      rules: { collection: { minSpacingMs: rules?.minSpacingMs ?? 0, maxPlaces: rules?.maxPlaces ?? 0 }, counting: { gapMs: rules?.gapMs ?? 0 } },
    });
    return { verdict, rules };
  };
  /** @type {Beat[]} each open page's next beat */
  const beats = [];
  for (const list of chains.values()) {
    const l = list[list.length - 1];
    if (l.stop) continue;
    const own = admitOf(jstDayOf(l.at));
    const due = l.at + (own ? own.beatMs : 0);
    beats.push({ l, seq: l.seq + 1, from: l.at, t: due > l.at ? due : Math.max(now, l.at + 1), resent: 0, first: l.chain !== except && l.at < now });
  }
  /** @type {Map<string, number>} */
  const pending = new Map();
  // In time order, while a wanted beat is undecided: each page goes on beating nextInMs after each
  // beat stored here, which keeps its place for the later ones. A few beats per page in practice;
  // past a budget (a beatMs of hours one day and of seconds the next) only the wanted ones go on.
  let budget = 1000 + 8 * chains.size;
  while (beats.some((b) => b.first)) {
    if (--budget < 0) for (let i = beats.length - 1; i >= 0; i -= 1) if (!beats[i].first) beats.splice(i, 1);
    beats.sort((x, y) => x.t - y.t || x.l.born - y.l.born || (x.l.chain < y.l.chain ? -1 : x.l.chain > y.l.chain ? 1 : 0));
    const beat = /** @type {Beat} */ (beats.shift());
    const { verdict, rules } = decide(beat);
    if (verdict.verdict === 'accept') {
      if (beat.t < now) {
        beats.push({ ...beat, t: now }); // due by now and not stored: late, it comes now
        continue;
      }
      if (beat.first) pending.set(beat.l.chain, beat.t);
      // A late beat keeps the place only of a page still open now (one silent for longer has gone).
      if (rules && (beat.t > now || now - beat.from <= rules.gapMs)) {
        stored.set(beat.l.chain, beat.t);
        if (rules.beatMs > 0) beats.push({ l: beat.l, seq: beat.seq + 1, from: beat.t, t: beat.t + rules.beatMs, resent: 0, first: false });
      }
    } else if (verdict.reason === 'too_soon' && rules && beat.resent < 3) {
      beats.push({ ...beat, t: beat.t + rules.beatMs, resent: beat.resent + 1 });
    }
  }
  /** @type {Signal[]} */
  const out = [];
  for (const list of chains.values()) {
    const l = list[list.length - 1];
    const at = pending.get(l.chain);
    if (at === undefined || l.chain === except || l.at >= now) continue;
    out.push({ ...l, seq: l.seq + 1, at, stop: false, input: false });
  }
  return out;
}

/**
 * @typedef {'not_in_session' | 'cap_reached' | 'starting' | 'gap' | 'focus' | 'idle' | 'other_tab'} StudyReason
 */

/**
 * Why a page's time is not counting, judged right after its signal at `now` was stored (the answer
 * to that signal; the counting above is unchanged and decides the numbers). It judges x, the last
 * counted millisecond of the page's last pair as the days count it (each day with its own rules:
 * the pair is credited from prevAt for min(now - prevAt, creditCapMs) when the day's gapMs allows
 * it), as countSpan counts x with the rules of x's day, with the other open pages' pending signals
 * (pendingSignals: their next beats as admitSignal will decide them, with admitOf). A page that
 * replaced its chain without a stop still looks open until gapMs passes, so the page sends a stop
 * for a chain it ends while it keeps it (its last answer's nextInMs not null). First match:
 *   'not_in_session' now is outside the cohort's dates (a known chain's signal after the last day):
 *                    nothing counts from now on (the part of its last pair before the end still does);
 *   'cap_reached'    the unit's time through now (unitMs, with the same pending signals) reached its
 *                    set time: nothing more of it counts;
 *   'starting'       the chain's first signal: no pair yet;
 *   'gap'            the last pair is a break: no day credits it (longer than its gapMs);
 *   null             counting: the unit gets x (from this page, or another page of the same unit);
 *   'focus'          requireFocus, and the page had no focus;
 *   'starting'       no input of this page covers x, and this signal brings one (it counts from now);
 *   'idle'           no input of this page covers x (the learner did not act within idleMs);
 *   'other_tab'      another page of another unit wins x (overlap), or both lose (drop_conflicts).
 * @param {{
 *   now: number,
 *   chain: { id: string, unit: string, prevAt: number | null },
 *   signal: { focus: boolean, input: boolean },
 *   signals: Signal[],
 *   counting: CountingRules,
 *   countingOf?: (day: string) => CountingRules | null,
 *   admitOf?: (day: string) => AdmitRules | null,
 *   setMs: number,
 *   unitMs: number,
 *   cohort: Range | null,
 * }} input chain: this page's chain, prevAt its previous stored signal (null for seq 0); signals: the
 *   learner's stored evidence in the cohort up to now (this signal included); counting: today's
 *   rules, and countingOf a day's (null: none that day; default: today's for every day); admitOf:
 *   a day's rules for the other pages' next beats (pendingSignals; default: every beat now, today's
 *   gapMs, no page pushed out, every unit listed); setMs: the unit's set time today; unitMs: its
 *   counted time through now (closed days and the live ones, with the same pending signals:
 *   tools/core/trainingTime.js liveTime's unitNowMs)
 * @returns {StudyReason | null}
 */
export function studyReason({
  now, chain, signal, signals, counting, countingOf = () => counting,
  admitOf = () => ({ beatMs: 0, minSpacingMs: 0, maxPlaces: Infinity, gapMs: counting.gapMs, unitKnown: () => true }), setMs, unitMs, cohort,
}) {
  if (!cohort || now < cohort.from || now >= cohort.to) return 'not_in_session';
  if (unitMs >= setMs) return 'cap_reached';
  if (chain.prevAt === null) return 'starting';
  const prevAt = chain.prevAt;
  const delta = now - prevAt;
  // x: the last millisecond of the pair a day credits, the latest such day (a pair lasts at most 6 hours).
  let x = -1;
  /** @type {CountingRules | null} */
  let rules = null;
  for (let day = jstDayOf(prevAt); jstDayRange(day).start < now; day = nextDay(day)) {
    const c = countingOf(day);
    const { start, end } = jstDayRange(day);
    const credited = c && delta <= c.gapMs ? Math.min(prevAt + Math.min(delta, c.creditCapMs), end) : start;
    if (credited > Math.max(prevAt, start)) {
      x = credited - 1;
      rules = c;
    }
  }
  if (!rules) return 'gap';
  // The other pages' next beats as admitSignal will decide them (each with its day's rules). A
  // pending pair longer than x's day's gapMs is a break there, so it counts nothing at x.
  const pending = pendingSignals({ now, signals, admitOf, except: chain.id });
  const at = countSpan({ a: x, b: x + 1, signals: [...signals, ...pending], rules: { counting: rules }, setMs: new Map(), carriedMs: new Map(), cohort });
  const mine = at.units.find((u) => u.unit === chain.unit);
  if (mine && mine.countedMs + mine.overCapMs === 1) return null;
  if (rules.requireFocus && !signal.focus) return 'focus';
  const idleMs = rules.idleMs;
  const present = signals.some((s) => s.chain === chain.id && s.input && s.at <= x && x < s.at + idleMs);
  if (!present) return signal.input ? 'starting' : 'idle';
  return 'other_tab';
}
