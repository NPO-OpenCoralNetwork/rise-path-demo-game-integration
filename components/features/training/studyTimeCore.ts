/**
 * The study page's signals (doc/brushup-2026/training-plan.ja.md §4.9), as a pure state machine:
 * what to send, when, and what the page shows. No timer, no DOM, no fetch: the hook
 * (useStudyTime.ts) passes the clock, ids and focus in each event, sends what a step returns, and
 * sets a timer for core.wakeAt. Rules (the server's contract, server/routes/trainingTime.js):
 * - A chain is one continuous time the page is visible on one unit. The page starts one when the
 *   unit page opens, becomes visible or changes unit (user: its first signal carries input), and on
 *   its own (no input from the start) after a timer that fired far too late, and after a restart,
 *   not_open, chain_ended or chain_mismatch answer, or another one not stored without nextInMs.
 * - One signal of a chain at a time; the next one nextInMs after the answer. focus: no blur since
 *   the chain's last signal and the page focused now; input: an input since then.
 * - Hidden, page hide or leaving: a stop for the chain the page keeps (keepalive), then nothing more
 *   of it. An answer with nextInMs null ends the chain: no more signals of it, not even a stop.
 * - other_place: the page stops and offers to record here (a new chain, the newest, wins).
 * - 409 (not configured, outside the dates, a unit not listed today), 401, 403 not_a_learner, 404,
 *   400: the page stops; a 409's may pass with the day, so the next user start tries again.
 * - The network, 500, another 403 (the terms check) and a malformed answer: the same signal again
 *   after nextInMs; 429 and 503 after their Retry-After (60 s without one), at least nextInMs. A
 *   signal that was not stored keeps its input and blur for the next one, or for the stop (a
 *   duplicate's own are the server's; what its resends took on since its first attempt stays).
 * - The numbers are the server's only; nothing advances them between answers.
 */
import type { StudyReason, StudySignalAnswer, StudySignalBody, StudySignalState } from '../../../services/trainingApi';

/** A beat's timer that fires more than this many beats late (a sleep, a frozen tab) starts a new chain. */
export const LATE_BEATS = 2;
/** Restarts on the server's answer in a row (no signal stored between) before the page gives up. */
export const MAX_RESTARTS = 3;
/** The wait after a 429 or a 503 without Retry-After. */
export const RETRY_FALLBACK_MS = 60_000;

/** Why the page sends no more signals until it is opened again (or reloaded). */
export type StopCause = 'time_not_configured' | 'not_in_session' | 'unit_unknown' | 'not_a_learner' | 'not_found' | 'off' | 'signin' | 'deleted' | 'invalid';
/** Why the page sends the same signal again later. */
export type RetryCause = 'network' | 'unavailable' | 'rate_limited' | 'failed';
/** Stop causes a later day can lift (a setting, the dates, the day's unit list): a user start tries again. */
const PASSING: readonly StopCause[] = ['time_not_configured', 'not_in_session', 'unit_unknown'];

/** What the page says about recording; the numbers are apart. */
export type RecordingView =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'counting' }
  | { kind: 'not_counting'; reason: StudyReason }
  | { kind: 'paused' }
  | { kind: 'other_place' }
  | { kind: 'retrying'; cause: RetryCause }
  | { kind: 'stopped'; cause: StopCause };

export type StudyNumbers = { todayMs: number; unit: { unitKey: string; countedMs: number; setMs: number; capReached: boolean } };

/** A signal the page sent (the body's chain, seq and flags). */
export type SentSignal = { chainId: string; seq: number; stop: boolean; focus: boolean; input: boolean };
type Chain = { id: string; nextSeq: number; userStart: boolean; restarts: number };

export type StudyCore = {
  unitKey: string;
  /** The last nextInMs (or GET …/time's beatMs before the first answer). */
  beatMs: number;
  /** The chain the page keeps, or null (none yet, hidden, or ended). */
  chain: Chain | null;
  /** Its signal on its way: one at a time (a stop does not wait). */
  inFlight: SentSignal | null;
  /**
   * What a seq's resends took on since its first attempt (which the server may have): kept while it
   * is tried again, back for the next seq on a duplicate, and on a stop meanwhile.
   */
  extra: { input: boolean; blur: boolean } | null;
  /** When the chain's next signal goes, or null (waiting for an answer, or no chain). */
  wakeAt: number | null;
  /** A signal that failed: the next one is it again (its seq, its input and blur kept). */
  retry: SentSignal | null;
  /** Since the chain's last signal: an input; a blur. */
  input: boolean;
  blur: boolean;
  view: RecordingView;
  numbers: StudyNumbers | null;
};

export type AnswerResult =
  | { ok: true; answer: StudySignalAnswer }
  | { ok: false; status: number; errorType?: string; retryAfterMs?: number };

export type StudyEvent =
  /** Start a chain: the unit page opened or became visible (user), or the learner chose to record here. */
  | { type: 'open'; now: number; id: string; focused: boolean }
  /** The timer for wakeAt fired. id: a new chain's, used only when it fired far too late. */
  | { type: 'beat'; now: number; id: string; focused: boolean }
  /** A signal's answer (sent: what was sent). id: a new chain's, used only on a restart answer. */
  | { type: 'answer'; now: number; sent: SentSignal; result: AnswerResult; id: string; focused: boolean }
  /** Hidden, page hide (keepalive), or the page leaves: a stop for the chain the page keeps. */
  | { type: 'end'; focused: boolean; keepalive: boolean }
  | { type: 'input' }
  | { type: 'blur' };

/** What to send after a step (keepalive: the page may be going). */
export type StudySend = { body: StudySignalBody; keepalive: boolean };
export type StudyStep = { core: StudyCore; sends: StudySend[] };

/** The core before any signal: the unit, GET …/time's beatMs and numbers. */
export function createStudyCore(unitKey: string, beatMs: number, numbers: StudyNumbers | null): StudyCore {
  return { unitKey, beatMs, chain: null, inFlight: null, extra: null, wakeAt: null, retry: null, input: false, blur: false, view: { kind: 'idle' }, numbers };
}

const body = (core: StudyCore, s: SentSignal): StudySignalBody => ({ unitKey: core.unitKey, chainId: s.chainId, seq: s.seq, stop: s.stop, focus: s.focus, input: s.input });

/**
 * The input and blur since the chain's last stored signal: those noted since, a failed signal's,
 * and what its resends took on (the resend on its way may be a duplicate).
 */
const sinceStored = (core: StudyCore) => ({
  input: core.input || Boolean(core.retry?.input) || Boolean(core.extra?.input),
  blur: core.blur || (core.retry ? !core.retry.focus : false) || Boolean(core.extra?.blur),
});

/** The chain's next signal now: the failed one again, or the next seq; the flags since the last one. */
function sendNext(core: StudyCore, focused: boolean): StudyStep {
  const chain = core.chain as Chain;
  const retry = core.retry;
  const seq = retry ? retry.seq : chain.nextSeq;
  const since = sinceStored(core);
  const sent: SentSignal = { chainId: chain.id, seq, stop: false, focus: !since.blur && focused, input: (seq === 0 && chain.userStart) || since.input };
  const next: StudyCore = {
    ...core,
    chain: { ...chain, nextSeq: Math.max(chain.nextSeq, seq + 1) },
    inFlight: sent,
    extra: retry ? { input: core.input || Boolean(core.extra?.input), blur: core.blur || Boolean(core.extra?.blur) } : null,
    wakeAt: null,
    retry: null,
    input: false,
    blur: false,
  };
  return { core: next, sends: [{ body: body(core, sent), keepalive: false }] };
}

/**
 * A stop for the chain the page keeps, after its last seq, with the flags since its last stored
 * signal; the chain ends here. Nothing to send without a chain, or before its first signal went
 * out (a restart still waiting).
 */
function stopChain(core: StudyCore, focused: boolean, keepalive: boolean): StudyStep {
  const chain = core.chain;
  const ended: StudyCore = { ...core, chain: null, inFlight: null, extra: null, wakeAt: null, retry: null, input: false, blur: false };
  if (!chain || chain.nextSeq === 0) return { core: ended, sends: [] };
  const since = sinceStored(core);
  const sent: SentSignal = { chainId: chain.id, seq: chain.nextSeq, stop: true, focus: !since.blur && focused, input: since.input };
  return { core: ended, sends: [{ body: body(core, sent), keepalive }] };
}

/** A new chain and its first signal (user: the learner started it, so it carries input). */
function startChain(core: StudyCore, id: string, user: boolean, focused: boolean, restarts = 0): StudyStep {
  const fresh: StudyCore = { ...core, chain: { id, nextSeq: 0, userStart: user, restarts }, inFlight: null, extra: null, wakeAt: null, retry: null, view: { kind: 'starting' } };
  return sendNext(fresh, focused);
}

/** A restart the server asked for: a new chain without input after one beat (bounded). */
function restartLater(core: StudyCore, id: string, now: number): StudyStep {
  const restarts = (core.chain?.restarts ?? 0) + 1;
  if (restarts > MAX_RESTARTS) return { core: { ...core, chain: null, inFlight: null, extra: null, wakeAt: null, retry: null, view: { kind: 'stopped', cause: 'invalid' } }, sends: [] };
  return { core: { ...core, chain: { id, nextSeq: 0, userStart: false, restarts }, inFlight: null, extra: null, retry: null, wakeAt: now + core.beatMs }, sends: [] };
}

/** The view and numbers of a stored signal's state (a state of another unit is not this page's). */
function shown(core: StudyCore, state: StudySignalState | null): Pick<StudyCore, 'view' | 'numbers'> {
  if (!state || state.unit.unitKey !== core.unitKey) return { view: core.view, numbers: core.numbers };
  return {
    view: state.counting ? { kind: 'counting' } : { kind: 'not_counting', reason: state.reason ?? 'unknown' },
    numbers: { todayMs: state.todayMs, unit: { ...state.unit } },
  };
}

const stopped = (core: StudyCore, cause: StopCause): StudyStep => ({ core: { ...core, chain: null, inFlight: null, extra: null, wakeAt: null, retry: null, view: { kind: 'stopped', cause } }, sends: [] });

function onAnswer(core: StudyCore, ev: Extract<StudyEvent, { type: 'answer' }>): StudyStep {
  const { sent, result, now } = ev;
  // A stop's answer, or one for a signal the page no longer waits for (an ended chain), changes nothing.
  if (sent.stop || !core.chain || !core.inFlight || core.inFlight.chainId !== sent.chainId || core.inFlight.seq !== sent.seq) return { core, sends: [] };
  const base: StudyCore = { ...core, inFlight: null, extra: null };
  if (result.ok === true) {
    const answer = result.answer;
    if (answer.accepted === true) {
      const after = { ...base, ...shown(base, answer.state), chain: { ...(base.chain as Chain), restarts: 0 } };
      if (answer.nextInMs !== null) return { core: { ...after, beatMs: answer.nextInMs, wakeAt: now + answer.nextInMs }, sends: [] };
      // Stored, but the chain ends: after the cohort's last day.
      return stopped(after, 'not_in_session');
    }
    // Not stored: its input and blur stay for the next signal. A duplicate's own are the server's
    // (stored before its answer was lost); what its retry took on since stays.
    const extra = answer.reason === 'duplicate' ? core.extra ?? { input: false, blur: false } : { input: sent.input, blur: !sent.focus };
    const kept: StudyCore = { ...base, input: base.input || extra.input, blur: base.blur || extra.blur };
    switch (answer.reason) {
      case 'other_place':
        return { core: { ...kept, chain: null, wakeAt: null, view: { kind: 'other_place' } }, sends: [] };
      case 'restart':
      case 'not_open':
      case 'chain_ended':
        return restartLater(kept, ev.id, now);
      default:
        // duplicate, too_soon, or a reason this page does not know: the chain goes on while it may;
        // without nextInMs it is over, and a new chain hears why (a 409), or goes on (bounded).
        if (answer.nextInMs !== null) return { core: { ...kept, beatMs: answer.nextInMs, wakeAt: now + answer.nextInMs }, sends: [] };
        return restartLater(kept, ev.id, now);
    }
  }
  const retryAt = (wait: number) => ({ ...base, retry: sent, extra: core.extra, wakeAt: now + Math.max(wait, base.beatMs) });
  switch (result.status) {
    case 401:
      return stopped(base, result.errorType === 'account_deleted' ? 'deleted' : 'signin');
    case 403:
      // Another 403 (terms_required, until the learner accepts the terms) is tried again.
      if (result.errorType === 'not_a_learner') return stopped(base, 'not_a_learner');
      return { core: { ...retryAt(0), view: { kind: 'retrying', cause: 'failed' } }, sends: [] };
    case 404:
      // As the GET (trainingModel.ts): no such class or membership; anything else is not offered.
      return stopped(base, result.errorType === 'cohort_not_found' ? 'not_found' : 'off');
    case 409:
      if (result.errorType === 'chain_mismatch') return restartLater(base, ev.id, now);
      if (PASSING.includes(result.errorType as StopCause)) return stopped(base, result.errorType as StopCause);
      return stopped(base, 'invalid');
    case 400:
      return stopped(base, 'invalid');
    case 429:
      return { core: { ...retryAt(result.retryAfterMs ?? RETRY_FALLBACK_MS), view: { kind: 'retrying', cause: 'rate_limited' } }, sends: [] };
    case 503:
      return { core: { ...retryAt(result.retryAfterMs ?? RETRY_FALLBACK_MS), view: { kind: 'retrying', cause: 'unavailable' } }, sends: [] };
    case 0:
      return { core: { ...retryAt(0), view: { kind: 'retrying', cause: 'network' } }, sends: [] };
    default:
      return { core: { ...retryAt(0), view: { kind: 'retrying', cause: 'failed' } }, sends: [] };
  }
}

/** One step of the study page. */
export function studyStep(core: StudyCore, ev: StudyEvent): StudyStep {
  switch (ev.type) {
    case 'input':
      return { core: core.input ? core : { ...core, input: true }, sends: [] };
    case 'blur':
      return { core: core.blur ? core : { ...core, blur: true }, sends: [] };
    case 'open': {
      if (core.view.kind === 'stopped' && !PASSING.includes(core.view.cause)) return { core, sends: [] };
      const ended = stopChain(core, ev.focused, false);
      const started = startChain(ended.core, ev.id, true, ev.focused);
      return { core: started.core, sends: [...ended.sends, ...started.sends] };
    }
    case 'beat': {
      if (!core.chain || core.inFlight || core.wakeAt === null || ev.now < core.wakeAt) return { core, sends: [] };
      if (ev.now - core.wakeAt > LATE_BEATS * core.beatMs && core.chain.nextSeq > 0) {
        // Far too late (a sleep): this chain's next pair would be a break; end it, start again without input.
        const ended = stopChain(core, ev.focused, false);
        const started = startChain(ended.core, ev.id, false, ev.focused);
        return { core: started.core, sends: [...ended.sends, ...started.sends] };
      }
      return sendNext(core, ev.focused);
    }
    case 'answer':
      return onAnswer(core, ev);
    case 'end': {
      const ended = stopChain(core, ev.focused, ev.keepalive);
      const view: RecordingView = core.view.kind === 'stopped' || core.view.kind === 'other_place' ? core.view : { kind: 'paused' };
      return { core: { ...ended.core, view }, sends: ended.sends };
    }
    default:
      return { core, sends: [] };
  }
}
