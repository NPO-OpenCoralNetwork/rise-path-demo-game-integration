/**
 * The study page's signals in the browser: binds the pure core (studyTimeCore.ts) to the page's
 * visibility, focus and inputs, a timer and the API (services/trainingApi.ts postStudySignal).
 * - Mount (visible), becoming visible or shown again from the back-forward cache without a chain,
 *   and 「この画面で記録する」: a chain the learner started.
 * - Hidden and page hide: a stop with keepalive, sent at once with the learner's own last session
 *   token (getSession waits for a lock: a later task, after the page is gone; as
 *   components/lesson/progressSyncClient.ts). Unmount (another unit, or leaving the page): a stop.
 *   The chain's signal still waiting for its token then never goes: the stop takes its input and
 *   blur. No stop goes for a chain none of whose signals went out (the server knows nothing of it),
 *   so nothing goes before any signal had this learner's token. A stop may still reach the server
 *   before the seq 0 on its way (answered not_open): if that seq 0 is stored with the chain going
 *   on, the stop goes again.
 * - Every other signal goes out only while the primary session still belongs to this learner:
 *   another tab can switch it to another account (that stops the page, as a 401 would); no session
 *   right now (a token refresh failing on a flaky network) is retried as a network error.
 * - Inputs: keydown, pointerdown, wheel, touchstart, focusin, pointermove and a scroll of
 *   main#main-content (the app scrolls there); only the first since the last signal is a step. The
 *   page's own focus moves (moveFocus) are not inputs. Focus: the window's blur.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { getSupabaseClient } from '../../../services/supabaseClient';
import { getStudyTime, postStudySignal, TrainingApiError, type StudySignalBody } from '../../../services/trainingApi';
import { createStudyCore, studyStep, type AnswerResult, type RecordingView, type SentSignal, type StudyEvent, type StudyNumbers, type StudySend } from './studyTimeCore';
import { studyTimeForAnswer, studyTimeForFailure, type StudyTimePageState } from './trainingModel';

/** True only while the page moves focus itself (moveFocus): that focusin is not the learner's input. */
let movingFocus = false;

/**
 * The study pages' own focus moves: a title or heading, after the button that had focus left.
 * focus() fires focusin at once, so the unit page's recorder can tell it from the learner's.
 */
export function moveFocus(el: HTMLElement | null): void {
  if (!el) return;
  movingFocus = true;
  try {
    el.focus({ preventScroll: true });
  } finally {
    movingFocus = false;
  }
}

/**
 * GET …/time for a study time page: loading, then the class's study time or why not; retry reads
 * again. Guests (learnerId null) send nothing. An answer for another learner or class never shows;
 * a change of learner or class aborts the request in flight. After a retry (its button leaves with
 * the old state), focus that fell to the page body goes to the page title (titleRef, for
 * PageHeader) once the new state shows, as on /training (TrainingView).
 */
export function useStudyTimeRead(cohortId: string, learnerId: string | null): {
  state: StudyTimePageState;
  retry: () => void;
  titleRef: RefObject<HTMLHeadingElement | null>;
} {
  const [state, setState] = useState<StudyTimePageState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const refocus = useRef(false);
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
  useEffect(() => {
    if (state.kind === 'loading' || !refocus.current) return;
    refocus.current = false;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (!active || active === document.body) moveFocus(titleRef.current);
  }, [state.kind]);
  const retry = () => {
    refocus.current = true;
    setAttempt((n) => n + 1);
  };
  return { state, retry, titleRef };
}

const INPUT_EVENTS = ['keydown', 'pointerdown', 'wheel', 'touchstart', 'focusin', 'pointermove'] as const;

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

/** A seq 0 on its way: its chain, the stop sent while it was (if any), and its token. */
type Opening = { chainId: string; stop: StudySignalBody | null; token: string | null };

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
    /** Chains with a signal whose request started: a stop of any other has nothing to end. */
    const posted = new Set<string>();
    /** The chain's signal waiting for its token (its request not started): its chain's stop cancels it. */
    let waiting: { sent: SentSignal; cancelled: boolean } | null = null;
    /** A seq 0 on its way, and the stop sent after it (which may reach the server first). */
    let opening: Opening | null = null;
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
    /** A stop with keepalive: the page may be going, so its request starts now, with the last token. */
    const stopNow = (body: StudySignalBody) => {
      let stop = body;
      if (waiting && waiting.sent.chainId === body.chainId) {
        // The chain's signal still waits for its token: it never goes; the stop takes its flags.
        stop = { ...body, focus: body.focus && waiting.sent.focus, input: body.input || waiting.sent.input };
        waiting.cancelled = true;
        waiting = null;
      }
      if (token === undefined || !posted.has(body.chainId)) return;
      if (opening?.chainId === body.chainId) opening.stop = stop;
      postStudySignal(cohortId, stop, { keepalive: true, token }).catch(() => {});
    };
    const send = ({ body, keepalive }: StudySend) => {
      if (keepalive) return stopNow(body);
      const sent: SentSignal = { chainId: body.chainId, seq: body.seq, stop: body.stop, focus: body.focus, input: body.input };
      const mine = { sent, cancelled: false };
      if (!body.stop) waiting = mine;
      void (async () => {
        const own = await ownToken(learnerId);
        if (mine.cancelled) return;
        if (waiting === mine) waiting = null;
        if (own === 'other' || own === 'none') {
          return answer(sent, own === 'other' ? { ok: false, status: 401, errorType: 'session_changed' } : { ok: false, status: 0, errorType: 'no_session' });
        }
        token = own.token;
        if (body.stop && !posted.has(body.chainId)) return;
        posted.add(body.chainId);
        const first: Opening | null = body.seq === 0 && !body.stop ? { chainId: body.chainId, stop: null, token } : null;
        if (first) opening = first;
        let result: AnswerResult;
        try {
          result = { ok: true, answer: await postStudySignal(cohortId, body, { token }) };
        } catch (error) {
          result = resultOf(error);
        }
        if (first) {
          if (opening === first) opening = null;
          // Stopped while on its way, then stored with the chain going on: its stop may have come first.
          if (first.stop && result.ok && result.answer.accepted && result.answer.nextInMs !== null) {
            postStudySignal(cohortId, first.stop, { keepalive: true, token: first.token }).catch(() => {});
          }
        }
        answer(sent, result);
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
    /** pointermove and scroll come in bursts: an input already noted since the last signal adds nothing. */
    const onInput = () => {
      if (!movingFocus && !core.input) apply({ type: 'input' });
    };
    const main = document.getElementById('main-content');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('blur', onBlur);
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { passive: true, capture: true });
    main?.addEventListener('scroll', onInput, { passive: true });
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
      main?.removeEventListener('scroll', onInput);
    };
    // numbers and beatMs only seed the core: a new GET answer for the same unit does not restart it.
  }, [cohortId, unitKey, learnerId]);

  return { ...state, recordHere: () => recordHere.current() };
}
