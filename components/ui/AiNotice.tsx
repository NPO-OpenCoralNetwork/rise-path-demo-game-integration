import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleAlert, CloudOff, Flag, Info, LogIn, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { AiAccessRequired } from '../safety/AiAccessRequired';
import { SupportLines } from '../safety/SupportLines';
import {
  REPORT_LIMITS,
  REPORT_REASONS,
  SafetyApiError,
  reportAiAnswer,
  type AiRefusal,
  type ReportContext,
  type ReportReason,
  type ReportSurface,
} from '../../services/safetyApi';

/**
 * AI disclosure under every AI answer (Phase 0.5, doc/brushup-2026/ai-access-plan.ja.md §4):
 * one line saying the answer was written by AI and can be wrong, plus a "report" button that
 * opens a small dialog (reason, optional note) and sends the answer to the operators through
 * services/safetyApi.ts reportAiAnswer. Signed-in learners only (the report route needs a
 * sign-in); guests still see the disclosure.
 *
 * The dialog is a native modal <dialog> in a portal on <body>: the rest of the page is inert,
 * Esc closes it (also inside the tutor's sheet, whose own Esc and Tab handlers it keeps out) and
 * focus returns to the report button.
 *
 * AiRefusalNotice: what to show when an AI call was refused for access or safety (see
 * services/safetyApi.ts aiRefusalOf).
 */

type Lang = 'en' | 'jp';

const copy = {
  en: {
    notice: 'This answer was written by AI. It can make mistakes. Check important things with a teacher or a family member too.',
    report: 'Report',
    reportLabel: 'Report this AI answer',
    reported: 'Reported',
    title: 'Report this answer',
    lead: 'What was the problem? Our staff will read it and check.',
    reasonLegend: 'Reason',
    reasons: {
      wrong: 'It is wrong',
      harmful: 'It is scary, hurtful or dangerous',
      inappropriate_for_age: 'It is not right for my age',
      other: 'Something else',
    } satisfies Record<ReportReason, string>,
    note: 'Anything to add? (optional)',
    privacy: 'Please do not write your name, address or phone number.',
    cancel: 'Cancel',
    send: 'Send',
    sending: 'Sending…',
    close: 'Close',
    pickReason: 'Please choose a reason.',
    thanks: 'Thank you. Your report was sent.',
    errors: {
      report_limit: 'You have sent many reports today. Please try again tomorrow.',
      sign_in: 'Please sign in to send a report.',
      failed: 'The report could not be sent. Please wait a little and try again.',
    },
  },
  jp: {
    notice: 'AIが作った答えです。まちがえることがあります。大切なことは、先生やおうちの人にも確かめてください。',
    report: '報告する',
    reportLabel: 'このAIの答えを報告する',
    reported: '報告しました',
    title: 'この答えを報告する',
    lead: 'どこが気になりましたか？ 運営のスタッフが読んで、確かめます。',
    reasonLegend: '理由',
    reasons: {
      wrong: 'まちがっている',
      harmful: 'こわい・いやな気持ちになる・あぶない',
      inappropriate_for_age: '子どもに向いていない',
      other: 'そのほか',
    } satisfies Record<ReportReason, string>,
    note: 'ひとこと（書かなくても大丈夫です）',
    privacy: '名前や住所、電話番号は書かないでください。',
    cancel: 'やめる',
    send: '送る',
    sending: '送っています…',
    close: '閉じる',
    pickReason: '理由をえらんでください。',
    thanks: '送りました。教えてくれて、ありがとうございます。',
    errors: {
      report_limit: '今日はたくさん報告が送られました。また明日、送ってください。',
      sign_in: '報告を送るには、ログインしてください。',
      failed: '送れませんでした。少し待ってから、もう一度お試しください。',
    },
  },
} as const;

/** Order of the reason choices: every REPORT_REASONS value, the most common first. */
const REASON_ORDER = ['wrong', 'harmful', 'inappropriate_for_age', 'other'] as const satisfies readonly (typeof REPORT_REASONS)[number][];

export interface AiNoticeProps {
  surface: ReportSurface;
  /** The AI text the notice belongs to (sent with a report). */
  answer: string;
  /** What the learner asked, when there was a question. */
  question?: string;
  context?: ReportContext;
  /** Overrides the app language (screens with their own language switch). */
  language?: Lang;
  className?: string;
}

export const AiNotice: React.FC<AiNoticeProps> = ({ surface, answer, question, context, language: override, className = '' }) => {
  const { language: appLanguage } = useLanguage();
  const language: Lang = override ?? appLanguage;
  const t = copy[language];
  const { user, isLoggedIn } = useAuth();
  const canReport = Boolean(isLoggedIn && user && !user.isGuest && answer.trim());
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={`flex flex-wrap items-start gap-x-3 gap-y-1 text-caption text-fg-3 ${className}`} data-ai-notice={surface}>
      <p className="flex min-w-0 flex-1 basis-56 items-start gap-1.5">
        <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>{t.notice}</span>
      </p>
      {canReport && (
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          aria-label={reported ? `${t.reportLabel} (${t.reported})` : t.reportLabel}
          onClick={() => setOpen(true)}
          className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-chip px-1.5 font-semibold text-fg-2 underline-offset-2 hover:bg-sunken hover:text-fg hover:underline"
        >
          {reported ? <Check size={13} aria-hidden="true" /> : <Flag size={13} aria-hidden="true" />}
          {reported ? t.reported : t.report}
        </button>
      )}
      {open && (
        <ReportDialog
          t={t}
          language={language}
          returnFocusRef={buttonRef}
          onClose={() => setOpen(false)}
          onSent={() => setReported(true)}
          payload={{ surface, answer, question, context }}
        />
      )}
    </div>
  );
};

type Copy = (typeof copy)[Lang];

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function ReportDialog({ t, language, payload, returnFocusRef, onClose, onSent }: {
  t: Copy;
  language: Lang;
  payload: { surface: ReportSurface; answer: string; question?: string; context?: ReportContext };
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSent: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // The reader's theme and world (the dialog lives on <body>, outside the reader's subtree).
  const [scope] = useState(() => {
    const host = returnFocusRef.current?.closest<HTMLElement>('[data-theme]');
    return { theme: host?.getAttribute('data-theme') ?? undefined, world: host?.closest<HTMLElement>('[data-world]')?.getAttribute('data-world') ?? undefined };
  });

  const close = useCallback(() => {
    const dialog = ref.current;
    if (dialog?.open) dialog.close();
    onCloseRef.current();
    const back = returnFocusRef.current;
    if (back && back.isConnected) requestAnimationFrame(() => back.focus({ preventScroll: true }));
  }, [returnFocusRef]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    try {
      if (!dialog.open) dialog.showModal();
    } catch {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector<HTMLElement>('input[type="radio"]')?.focus();

    // Esc and Tab are handled here, before any page-level handler (the tutor sheet listens on
    // document in the capture phase and would close itself on Esc).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      event.stopPropagation();
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close]);

  useEffect(() => {
    if (sent) closeRef.current?.focus();
  }, [sent]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!reason) {
      setError(t.pickReason);
      ref.current?.querySelector<HTMLElement>('input[type="radio"]')?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reportAiAnswer({ ...payload, reason, note: note.trim() || undefined });
      setSent(true);
      onSent();
    } catch (err) {
      const status = err instanceof SafetyApiError ? err.status : 0;
      const type = err instanceof SafetyApiError ? err.errorType : undefined;
      setError(type === 'report_limit' || status === 429 ? t.errors.report_limit : status === 401 ? t.errors.sign_in : t.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const noteId = `${uid}-note`;
  const privacyId = `${uid}-privacy`;
  const buttonBase = 'inline-flex h-10 items-center justify-center gap-2 rounded-control border px-4 text-body font-semibold';

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      lang={language === 'jp' ? 'ja' : 'en'}
      data-theme={scope.theme}
      data-world={scope.world}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself, outside its content) closes it.
        if (event.target === ref.current) close();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-hero border border-line bg-raised p-0 text-fg shadow-3 backdrop:bg-overlay"
    >
      <div className="p-5">
        <h2 id={titleId} className="flex items-center gap-2 text-h3 text-fg">
          <Flag size={18} aria-hidden="true" className="shrink-0 text-fg-2" />
          {t.title}
        </h2>
        {sent ? (
          <>
            <p id={descId} role="status" className="mt-3 flex items-start gap-2 text-body text-fg">
              <Check size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
              <span>{t.thanks}</span>
            </p>
            <div className="mt-5 flex justify-end">
              <button ref={closeRef} type="button" onClick={close} className={`${buttonBase} border-line bg-surface text-fg hover:bg-sunken`}>
                {t.close}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <p id={descId} className="mt-2 text-body text-fg-2">{t.lead}</p>
            <fieldset className="mt-4">
              <legend className="text-small font-semibold text-fg">{t.reasonLegend}</legend>
              <div className="mt-2 grid gap-1.5">
                {REASON_ORDER.map((value) => (
                  <label
                    key={value}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 text-body text-fg has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                  >
                    <input
                      type="radio"
                      name={`${uid}-reason`}
                      value={value}
                      checked={reason === value}
                      onChange={() => {
                        setReason(value);
                        setError(null);
                      }}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span>{t.reasons[value]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor={noteId} className="mt-4 block text-small font-semibold text-fg">{t.note}</label>
            <textarea
              id={noteId}
              rows={3}
              maxLength={REPORT_LIMITS.note}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby={privacyId}
              className="mt-1 w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2 text-body text-fg placeholder:text-fg-3"
            />
            <p id={privacyId} className="mt-1 text-caption text-fg-3">{t.privacy}</p>
            {error && (
              <p role="alert" className="mt-3 flex items-start gap-1.5 text-small text-danger">
                <CircleAlert size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={close} className={`${buttonBase} border-line bg-surface text-fg hover:bg-sunken`}>
                {t.cancel}
              </button>
              <button
                type="submit"
                aria-disabled={busy || undefined}
                className={`${buttonBase} border-transparent bg-primary text-on-primary hover:bg-primary-hover aria-disabled:opacity-60`}
              >
                {busy ? t.sending : t.send}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>,
    document.body,
  );
}

// --- refusals ------------------------------------------------------------------------------

const refusalCopy = {
  en: {
    blockedTitle: 'The AI cannot answer this',
    blockedBody: 'Try asking in different words. If something is bothering you, talk to a teacher or a family member.',
    blockedResultBody: 'The AI answer had something that cannot be shown here. If something is bothering you, talk to a teacher or a family member.',
    supportTitle: 'You do not have to carry this alone',
    supportBody: 'The AI cannot help with this, but people can. Please talk to an adult you trust, or to one of the places below.',
    checkTitle: 'AI is not available right now',
    checkBody: 'The safety check is not working at the moment. Please try again a little later.',
    signIn: 'Sign in',
  },
  jp: {
    blockedTitle: 'この内容には、AIは答えられません',
    blockedBody: 'ことばを変えて、もう一度聞いてみてください。こまっていることがあれば、先生やおうちの人に話してください。',
    blockedResultBody: 'AIの答えに、ここでは見せられない内容がありました。こまっていることがあれば、先生やおうちの人に話してください。',
    supportTitle: 'ひとりでかかえなくて大丈夫です',
    supportBody: 'この話には、AIは答えられません。でも、話を聞いてくれる人がいます。信じられる大人や、下の相談先に話してみてください。',
    checkTitle: '今は、AIを使えません',
    checkBody: '安全のチェックが、今はうまく動いていません。少し時間をおいて、もう一度お試しください。',
    signIn: 'ログイン',
  },
} as const;

export interface AiRefusalNoticeProps {
  refusal: AiRefusal;
  /** Sign-in action for 'sign_in_required' (guests: logout() leads to the sign-in page). */
  onSignIn?: () => void;
  /** 'result': no learner text was sent (e.g. the assessment insight), so a block is about the answer. */
  variant?: 'ask' | 'result';
  language?: Lang;
  className?: string;
}

/**
 * The card for a refused AI call: the access gate (AiAccessRequired), a blocked message (calm,
 * no blame; support lines when the server says the learner may be in distress) or a safety
 * check that could not run.
 */
export const AiRefusalNotice: React.FC<AiRefusalNoticeProps> = ({ refusal, onSignIn, variant = 'ask', language: override, className = '' }) => {
  const { language: appLanguage } = useLanguage();
  const t = refusalCopy[override ?? appLanguage];

  if (refusal.type === 'access') {
    return (
      <div className={className}>
        <AiAccessRequired kind={refusal.kind} language={override} />
        {refusal.kind === 'sign_in_required' && onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            className="mt-2 inline-flex h-8 items-center gap-2 rounded-control border border-line bg-surface px-3 text-small font-semibold text-fg hover:bg-sunken"
          >
            <LogIn size={14} aria-hidden="true" />
            {t.signIn}
          </button>
        )}
      </div>
    );
  }

  if (refusal.type === 'check_unavailable') {
    return (
      <div role="status" className={`rounded-card border border-line bg-surface p-4 ${className}`} data-ai-refusal="check_unavailable">
        <p className="flex items-start gap-2 text-body font-semibold text-fg">
          <CloudOff size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-2" />
          {t.checkTitle}
        </p>
        <p className="mt-1 pl-6.5 text-small text-fg-2">{t.checkBody}</p>
      </div>
    );
  }

  const support = refusal.support;
  return (
    <div role="status" className={className} data-ai-refusal={support ? 'support' : 'blocked'}>
      <div className="rounded-card border border-line bg-surface p-4">
        <p className="flex items-start gap-2 text-body font-semibold text-fg">
          <ShieldAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-primary-text" />
          {support ? t.supportTitle : t.blockedTitle}
        </p>
        <p className="mt-1 pl-6.5 text-small text-fg-2">{support ? t.supportBody : variant === 'result' ? t.blockedResultBody : t.blockedBody}</p>
      </div>
      {support && <SupportLines compact language={override} className="mt-2" />}
    </div>
  );
};

export default AiNotice;
