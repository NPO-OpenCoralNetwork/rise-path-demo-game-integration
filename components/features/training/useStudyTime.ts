/**
 * The study page's signals in the browser: binds the pure core (studyTimeCore.ts) to the page's
 * visibility, focus and inputs, a timer and the API (services/trainingApi.ts postStudySignal).
 * - Mount (visible), becoming visible or shown again from the back-forward cache without a chain,
 *   and 「この画面で記録する」: a chain the learner started.
 * - Hidden and page hide: a stop with keepalive, sent at once with the learner's own last session
 *   token (getSession waits for a lock: a later task, after the page is gone; as
 *   components/lesson/progressSyncClient.ts). Unmount (another unit, or leaving the page): a stop.
 *   A stop never overtakes a signal still waiting for its token: it goes right after that signal's
 *   request starts, with its token. Before any signal had this learner's token, nothing is sent.
 * - Every other signal goes out only while the primary session still belongs to this learner:
 *   another tab can switch it to another account (that stops the page, as a 401 would); no session
 *   right now (a token refresh failing on a flaky network) is retried as a network error.
 * - Inputs: keydown, pointerdown, wheel, touchstart, focusin, a pointermove and a scroll of
 *   main#main-content (the app scrolls there) at most once a second each. Focus: the window's blur.
 */
import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../../../services/supabaseClient';
import { getStudyTime, postStudySignal, TrainingApiError } from '../../../services/trainingApi';
import { createStudyCore, studyStep, type AnswerResult, type RecordingView, type SentSignal, type StudyEvent, type StudyNumbers, type StudySend } from './studyTimeCore';
import { studyTimeForAnswer, studyTimeForFailure, type StudyTimePageState } from './trainingModel';

/**
 * GET …/time for a study time page: loading, then the class's study time or why not; retry reads
 * again. Guests (learnerId null) send nothing. An answer for another learner or class never shows;
 * a change of learner or class aborts the request in flight.
 */
export function useStudyTimeRead(cohortId: string, learnerId: string | null): { state: StudyTimePageState; retry: () => void } {
  const [state, setState] = useState<StudyTimePageState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!learnerId) {
      setState({ kind: 'account' });
      return undefined;
    }
    const controller = new AbortController();
    setState({ kind: 'loading' });
    getStudyTime(cohortId, controller.signal).then(
      (time) => { if (!controller.signal.aborted) setState(studyTimeForAnswer(time, learnerId, cohortId)); },
      (error) => { if (!controller.signal.aborted) setState(studyTimeForFailure(error)); },
    );
    return () => controller.abort();
  }, [attempt, learnerId, cohortId]);
  return { state, retry: () => setAttempt((n) => n + 1) };
}

const INPUT_EVENTS = ['keydown', 'pointerdown', 'wheel', 'touchstart', 'focusin'] as const;
/** A pointermove or a scroll counts as an input at most this often. */
const FREQUENT_INPUT_MS = 1000;

export type StudyTimeState = { view: RecordingView; numbers: StudyNumbers | null };

/**
 * The learner's own session token, or what to answer instead: 'other' (another account's session:
 * the page stops), 'none' (no session right now: tried again later). No Supabase client (demo and
 * mock modes): no token, and apiFetch sends what it sends.
 */
async function ownToken(learnerId: string): Promise<{ token: string | null } | 'other' | 'none'> {
  const client = getSupabaseClient();
  if (!client) return { token: null };
  try {
    const { data } = await client.auth.getSession();
    const session = data.session;
    if (!session) return 'none';
    if (String(session.user?.id ?? '').toLowerCase() !== learnerId.toLowerCase()) return 'other';
    return { token: session.access_token ?? null };
  } catch {
    return 'none';
  }
}

const resultOf = (error: unknown): AnswerResult => (error instanceof TrainingApiError
  ? { ok: false, status: error.status, errorType: error.errorType, retryAfterMs: error.retryAfterMs }
  : { ok: false, status: 0, errorType: 'network' });

const newChainId = (): string => crypto.randomUUID();
const focusedNow = (): boolean => (typeof document.hasFocus === 'function' ? document.hasFocus() : true);

/**
 * Sends the unit page's signals while it is mounted and visible, and returns what it shows: the
 * recording view and the server's numbers (the initial ones from GET …/time), and recordHere for
 * 「この画面で記録する」.
 */
export function useStudyTime({ cohortId, unitKey, learnerId, beatMs, numbers }: {
  cohortId: string;
  unitKey: string;
  learnerId: string;
  /** GET …/time's beatMs (the first signals' pace until an answer gives nextInMs). */
  beatMs: number;
  numbers: StudyNumbers | null;
}): StudyTimeState & { recordHere: () => void } {
  const [state, setState] = useState<StudyTimeState>({ view: { kind: 'idle' }, numbers });
  const recordHere = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let core = createStudyCore(unitKey, beatMs, numbers);
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** The token of this learner's last signal: undefined before any (null: no Supabase client). */
    let token: string | null | undefined;
    /** Signals waiting for the token (their request not started), and the stops waiting for them. */
    let waiting = 0;
    let stops: (() => void)[] = [];
    let lastFrequent = 0;
    let shownKey = '';

    const show = () => {
      const key = JSON.stringify([core.view, core.numbers]);
      if (!alive || key === shownKey) return;
      shownKey = key;
      setState({ view: core.view, numbers: core.numbers });
    };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (!alive || core.wakeAt === null) return;
      timer = setTimeout(() => {
        timer = null;
        apply({ type: 'beat', now: Date.now(), id: newChainId(), focused: focusedNow() });
      }, Math.max(0, core.wakeAt - Date.now()));
    };
    const answer = (sent: SentSignal, result: AnswerResult) => {
      if (alive) apply({ type: 'answer', now: Date.now(), sent, result, id: newChainId(), focused: focusedNow() });
    };
    const flushStops = () => {
      if (waiting > 0) return;
      const ready = stops;
      stops = [];
      for (const go of ready) go();
    };
    const send = ({ body, keepalive }: StudySend) => {
      const sent: SentSignal = { chainId: body.chainId, seq: body.seq, stop: body.stop, focus: body.focus, input: body.input };
      if (keepalive) {
        // The page may be going: fetch starts now (or right after the signal before it), with the
        // token of this learner's last signal; without one, no signal of this learner went out.
        const go = () => {
          if (token !== undefined) postStudySignal(cohortId, body, { keepalive: true, token }).catch(() => {});
        };
        if (waiting > 0) stops.push(go);
        else go();
        return;
      }
      waiting += 1;
      void (async () => {
        const own = await ownToken(learnerId);
        waiting -= 1;
        if (own === 'other' || own === 'none') {
          flushStops();
          return answer(sent, own === 'other' ? { ok: false, status: 401, errorType: 'session_changed' } : { ok: false, status: 0, errorType: 'no_session' });
        }
        token = own.token;
        const posted = postStudySignal(cohortId, body, { token });
        flushStops();
        try {
          answer(sent, { ok: true, answer: await posted });
        } catch (error) {
          answer(sent, resultOf(error));
        }
      })();
    };
    function apply(ev: StudyEvent) {
      const step = studyStep(core, ev);
      core = step.core;
      show();
      schedule();
      for (const s of step.sends) send(s);
    }

    const open = () => apply({ type: 'open', now: Date.now(), id: newChainId(), focused: focusedNow() });
    const end = (keepalive: boolean) => apply({ type: 'end', focused: focusedNow(), keepalive });
    /** Visible again (or shown again from the back-forward cache) with no chain: the learner is back. */
    const resume = () => {
      if (document.visibilityState === 'visible' && core.chain === null) open();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') end(true);
      else resume();
    };
    const onPageHide = () => end(true);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resume();
    };
    const onBlur = () => apply({ type: 'blur' });
    const onInput = () => apply({ type: 'input' });
    const onFrequent = () => {
      const now = Date.now();
      if (now - lastFrequent < FREQUENT_INPUT_MS) return;
      lastFrequent = now;
      onInput();
    };
    const main = document.getElementById('main-content');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('blur', onBlur);
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { passive: true, capture: true });
    window.addEventListener('pointermove', onFrequent, { passive: true, capture: true });
    main?.addEventListener('scroll', onFrequent, { passive: true });
    recordHere.current = open;
    if (document.visibilityState === 'visible') open();

    return () => {
      // Nothing shows or waits after this; the stop still goes (keepalive: the page may be going).
      alive = false;
      end(true);
      if (timer !== null) clearTimeout(timer);
      recordHere.current = () => {};
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('blur', onBlur);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
      window.removeEventListener('pointermove', onFrequent, { capture: true });
      main?.removeEventListener('scroll', onFrequent);
    };
    // numbers and beatMs only seed the core: a new GET answer for the same unit does not restart it.
  }, [cohortId, unitKey, learnerId]);

  return { ...state, recordHere: () => recordHere.current() };
}
