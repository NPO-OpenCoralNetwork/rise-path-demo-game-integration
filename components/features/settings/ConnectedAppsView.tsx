import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleAlert, CircleCheck, PlugZap, Unplug } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import PageHeader from '../../ui/PageHeader';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../safety/ConfirmDialog';
import { formatTokyoDateTime } from '../../safety/format';
import {
  ConnectedAppsError,
  confirmRevocation,
  listConnectedApps,
  revokeConnectedApp,
  type ConnectedApp,
  type RevokeTarget,
} from '../../../services/connectedAppsApi';

/**
 * /settings/connected-apps — AI apps the learner connected to the Rise Path MCP endpoint with
 * Supabase OAuth (Phase 1, doc/brushup-2026/ai-access-plan.ja.md §5).
 *
 * Lists Rise Path's own records (first and last use, written by the MCP server) merged with
 * Supabase's grants, and disconnects an app: our revocation first (the MCP server then refuses
 * the app's current tokens within a few seconds), then supabase.auth.oauth.revokeGrant (no new
 * tokens), then our revocation again (see services/connectedAppsApi.ts).
 */

type Lang = 'en' | 'jp';

const copy = {
  en: {
    back: 'Back',
    eyebrow: 'Settings',
    title: 'Connected AI apps',
    description:
      'AI apps you connected to Rise Path, such as Claude Code, Codex or ChatGPT. A connected app can read your learning progress and journal, add journal entries and record finished lessons.',
    loading: 'Loading…',
    retry: 'Try again',
    loadFailed: 'We could not load your connected apps right now. Please try again in a little while.',
    signInNeeded: 'Please sign in to see your connected apps.',
    grantsUnavailable: 'Part of the list could not be loaded. Some apps may be missing; please check again later.',
    emptyTitle: 'No AI apps are connected',
    emptyBody:
      'To connect one, add the Rise Path MCP server in your AI app and sign in when it asks. Connecting is for adults (18 and over).',
    connectedSection: 'Connected',
    pastSection: 'Disconnected',
    unnamed: 'An app without a name',
    nameNote: 'Name chosen by the app',
    website: 'Website',
    statusActive: 'Connected',
    statusRevoked: 'Disconnected',
    statusPending: 'Disconnecting not finished',
    pendingHint: 'Until this is finished, the app can still renew its sign-in on its own. Press “Finish disconnecting”.',
    connectedOn: 'Allowed on',
    firstUsed: 'First used',
    lastUsed: 'Last used',
    revokedOn: 'Disconnected on',
    never: 'Not used yet',
    disconnect: 'Disconnect',
    finish: 'Finish disconnecting',
    dialogTitle: (name: string) => `Disconnect ${name}?`,
    dialogBody:
      'Within a few seconds, the app stops reading and writing your Rise Path data. What it already sent to its AI service stays there under that service’s terms. You can connect it again later from the app.',
    confirm: 'Disconnect',
    cancel: 'Cancel',
    busy: 'Disconnecting…',
    done: (name: string) => `${name} is disconnected. Within a few seconds, it can no longer read or write your data.`,
    partial: (name: string) =>
      `Within a few seconds, ${name}’s current sign-in stops working on Rise Path. But we could not finish at the sign-in service, so the app could still sign in again on its own. Please press “Finish disconnecting”.`,
    unconfirmed: (name: string) =>
      `${name} can no longer sign in again, but we could not save the last step. A sign-in it got in the last few seconds may still work for up to an hour. Please press “Try again”.`,
    retryConfirm: 'Try again',
    retryingConfirm: 'Trying again…',
    retryFailed: (name: string) =>
      `We still could not save the last step for ${name}. Please try again in a little while.`,
    reloadFailed: 'The list could not be refreshed, so what you see may be out of date.',
    failed: 'This could not be disconnected. Please try again in a little while.',
  },
  jp: {
    back: '戻る',
    eyebrow: '設定',
    title: 'つないでいる AI アプリ',
    description:
      'Rise Path につないだ AI アプリ（Claude Code、Codex、ChatGPT など）です。つないだアプリは、学習の進み具合やジャーナルを読み、ジャーナルに記録を追加したり、終えたレッスンを記録したりできます。',
    loading: '読み込んでいます…',
    retry: 'もう一度試す',
    loadFailed: 'いまは一覧を読み込めませんでした。少し時間をおいてお試しください。',
    signInNeeded: '一覧を見るには、サインインしてください。',
    grantsUnavailable: '一覧の一部を読み込めませんでした。表示されていないアプリがあるかもしれません。またあとでご確認ください。',
    emptyTitle: 'つないでいる AI アプリはありません',
    emptyBody:
      'つなぐときは、AI アプリに Rise Path の MCP サーバーを追加して、求められたらサインインしてください。つなげるのは 18 歳以上の方です。',
    connectedSection: '接続中',
    pastSection: '解除ずみ',
    unnamed: '名前のないアプリ',
    nameNote: 'アプリ自身が付けた名前です',
    website: 'サイト',
    statusActive: '接続中',
    statusRevoked: '解除ずみ',
    statusPending: '解除が終わっていません',
    pendingHint: '終わるまでは、アプリが自分でサインインし直せます。「解除を終える」を押して、手続きを終えてください。',
    connectedOn: '許可した日',
    firstUsed: '最初に使った日',
    lastUsed: '最後に使った日',
    revokedOn: '解除した日',
    never: 'まだ使われていません',
    disconnect: '解除する',
    finish: '解除を終える',
    dialogTitle: (name: string) => `${name} の接続を解除しますか？`,
    dialogBody:
      'アプリは、数秒以内に Rise Path のデータを読み書きできなくなります。すでに AI サービスへ送られた内容は、そのサービスの約束に従って残ります。あとでアプリからつなぎ直すこともできます。',
    confirm: '解除する',
    cancel: 'キャンセル',
    busy: '解除しています…',
    done: (name: string) => `${name} の接続を解除しました。数秒以内に、データを読み書きできなくなります。`,
    partial: (name: string) =>
      `${name} のいまのサインインは、数秒以内に Rise Path で使えなくなります。ただ、サインインのサービス側の手続きが終わっておらず、アプリが自分でサインインし直せます。「解除を終える」を押してください。`,
    unconfirmed: (name: string) =>
      `${name} は、もうサインインし直せません。ただ、最後の記録を保存できませんでした。直前の数秒に受け取ったサインインが、最大 1 時間使える場合があります。「もう一度試す」を押してください。`,
    retryConfirm: 'もう一度試す',
    retryingConfirm: 'もう一度試しています…',
    retryFailed: (name: string) =>
      `${name} の最後の記録は、まだ保存できていません。少し時間をおいて、もう一度お試しください。`,
    reloadFailed: '一覧を新しくできませんでした。表示が古いかもしれません。',
    failed: '解除できませんでした。少し時間をおいてお試しください。',
  },
} as const;

type T = (typeof copy)[Lang];

interface Notice {
  tone: 'ok' | 'warn';
  text: string;
  /** Disconnected at Supabase, but our second revoked_at could not be written: offer to retry it. */
  retry?: RevokeTarget;
}

type RevokedHandler = (app: ConnectedApp, result: { supabaseRevoked: boolean; confirmed: boolean }) => void;

const cardClasses = 'rounded-card border border-line bg-surface p-5 shadow-1';

const ConnectedAppsView: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const t = copy[language];

  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [grantsUnavailable, setGrantsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'failed' | 'signin' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // Set after a disconnect: once the list has reloaded, focus moves to the notice. The row's
  // button the dialog returned focus to is usually gone by then (the app moved to "Disconnected").
  const focusNoticeAfterLoad = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listConnectedApps(signal);
      if (signal?.aborted) return;
      setApps(result.apps);
      setGrantsUnavailable(result.grantsUnavailable);
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(error instanceof ConnectedAppsError && error.status === 401 ? 'signin' : 'failed');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (loading || !focusNoticeAfterLoad.current) return;
    focusNoticeAfterLoad.current = false;
    noticeRef.current?.focus();
  }, [loading, apps, notice]);

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/settings');
  };

  const onRevoked = (app: ConnectedApp, result: { supabaseRevoked: boolean; confirmed: boolean }) => {
    const name = app.name ?? t.unnamed;
    if (!result.supabaseRevoked) setNotice({ tone: 'warn', text: t.partial(name) });
    else if (!result.confirmed) {
      setNotice({ tone: 'warn', text: t.unconfirmed(name), retry: { clientId: app.clientId, name: app.name } });
    } else setNotice({ tone: 'ok', text: t.done(name) });
    focusNoticeAfterLoad.current = true;
    void load();
  };

  const retryConfirm = async (target: RevokeTarget) => {
    setConfirming(true);
    try {
      const ok = await confirmRevocation(target).catch(() => false);
      if (ok) {
        setNotice({ tone: 'ok', text: t.done(target.name ?? t.unnamed) });
        focusNoticeAfterLoad.current = true;
        void load();
      } else {
        // Keep the retry button, and say that this attempt failed too. The button was disabled
        // while it had focus, so focus goes to the new notice.
        setNotice({ tone: 'warn', text: t.retryFailed(target.name ?? t.unnamed), retry: target });
        focusNoticeAfterLoad.current = true;
      }
    } finally {
      setConfirming(false);
    }
  };

  const active = apps?.filter((app) => app.active || app.hasGrant) ?? [];
  const past = apps?.filter((app) => !app.active && !app.hasGrant) ?? [];

  return (
    <div className="mx-auto max-w-form px-4 pb-20 pt-8 sm:px-6">
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex items-center gap-2 rounded-control text-small font-medium text-fg-2 hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {t.back}
      </button>

      <PageHeader className="mt-4" eyebrow={t.eyebrow} title={t.title} description={t.description} />

      <div className="mt-6 space-y-6">
        {notice && (
          <div className="rounded-control border border-line bg-sunken px-4 py-3">
            <p ref={noticeRef} tabIndex={-1} role="status" className="flex items-start gap-2 text-body text-fg">
              {notice.tone === 'ok' ? (
                <CircleCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
              ) : (
                <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sun-text" />
              )}
              {notice.text}
            </p>
            {notice.retry && (
              <Button
                className="mt-3"
                variant="secondary"
                size="sm"
                disabled={confirming}
                onClick={() => notice.retry && void retryConfirm(notice.retry)}
              >
                {confirming ? t.retryingConfirm : t.retryConfirm}
              </Button>
            )}
          </div>
        )}

        {loadError === 'failed' && apps && !loading && (
          <div role="alert" className="rounded-control border border-line bg-surface px-4 py-3">
            <p className="flex items-start gap-2 text-body text-fg">
              <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
              {t.reloadFailed}
            </p>
            <Button className="mt-3" variant="secondary" size="sm" onClick={() => void load()}>
              {t.retry}
            </Button>
          </div>
        )}

        {loading && !apps ? (
          <p role="status" className="text-body text-fg-3">
            {t.loading}
          </p>
        ) : loadError && !apps ? (
          <div role="alert" className={cardClasses}>
            <p className="flex items-start gap-2 text-body text-fg">
              <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
              {loadError === 'signin' ? t.signInNeeded : t.loadFailed}
            </p>
            {loadError === 'failed' && (
              <Button className="mt-3" variant="secondary" size="sm" onClick={() => void load()}>
                {t.retry}
              </Button>
            )}
          </div>
        ) : apps ? (
          <>
            {grantsUnavailable && (
              <p className="flex items-start gap-2 rounded-control bg-sun-soft px-4 py-3 text-small text-fg">
                <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-sun-text" />
                {t.grantsUnavailable}
              </p>
            )}

            {apps.length === 0 ? (
              <section className={cardClasses}>
                <h2 className="flex items-center gap-2 text-h2 text-fg">
                  <PlugZap size={22} aria-hidden="true" className="shrink-0 text-primary-text" />
                  {t.emptyTitle}
                </h2>
                <p className="mt-2 text-body text-fg-2">{t.emptyBody}</p>
              </section>
            ) : (
              <>
                {active.length > 0 && (
                  <AppList t={t} language={language} title={t.connectedSection} apps={active} onRevoked={onRevoked} onFailed={() => setNotice({ tone: 'warn', text: t.failed })} />
                )}
                {past.length > 0 && (
                  <AppList t={t} language={language} title={t.pastSection} apps={past} onRevoked={onRevoked} onFailed={() => setNotice({ tone: 'warn', text: t.failed })} />
                )}
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
};

const AppList: React.FC<{
  t: T;
  language: Lang;
  title: string;
  apps: ConnectedApp[];
  onRevoked: RevokedHandler;
  onFailed: () => void;
}> = ({ t, language, title, apps, onRevoked, onFailed }) => {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="text-h3 text-fg">
        {title}
      </h2>
      <ul className="mt-3 space-y-3">
        {apps.map((app) => (
          <AppRow key={app.clientId} t={t} language={language} app={app} onRevoked={onRevoked} onFailed={onFailed} />
        ))}
      </ul>
    </section>
  );
};

const AppRow: React.FC<{
  t: T;
  language: Lang;
  app: ConnectedApp;
  onRevoked: RevokedHandler;
  onFailed: () => void;
}> = ({ t, language, app, onRevoked, onFailed }) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const nameId = useId();
  const name = app.name ?? t.unnamed;
  // Revoked on our side, but Supabase still holds the grant (revokeGrant failed last time).
  const unfinished = app.hasGrant && !app.active;
  const status = app.active ? 'active' : unfinished ? 'pending' : 'revoked';
  const date = (iso: string | null) => formatTokyoDateTime(iso, language);

  const revoke = async () => {
    setBusy(true);
    try {
      const result = await revokeConnectedApp({ clientId: app.clientId, name: app.name });
      setConfirmOpen(false);
      onRevoked(app, result);
    } catch {
      setConfirmOpen(false);
      onFailed();
    } finally {
      setBusy(false);
    }
  };

  const chip =
    status === 'active'
      ? 'bg-primary-soft text-primary-text'
      : status === 'pending'
        ? 'bg-sun-soft text-sun-text'
        : 'bg-sunken text-fg-2';

  const rows: Array<[string, string | null]> = [
    [t.connectedOn, date(app.grantedAt)],
    // An app that never called Rise Path has no use dates: one "Not used yet" row instead.
    [t.firstUsed, date(app.firstSeenAt)],
    [t.lastUsed, date(app.lastUsedAt) ?? t.never],
    [t.revokedOn, status === 'active' ? null : date(app.revokedAt)],
  ];

  return (
    <li className={cardClasses}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p id={nameId} className="break-words text-h3 text-fg">
            {name}
          </p>
          {app.name && <p className="mt-0.5 text-caption text-fg-3">{t.nameNote}</p>}
          {app.uriHost && (
            <p className="mt-1 break-all text-small text-fg-2">
              <span className="font-medium">{t.website}: </span>
              <span className="font-mono">{app.uriHost}</span>
            </p>
          )}
        </div>
        <span className={`inline-flex shrink-0 self-start items-center rounded-full px-2.5 py-0.5 text-small font-semibold ${chip}`}>
          {status === 'active' ? t.statusActive : status === 'pending' ? t.statusPending : t.statusRevoked}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small sm:gap-x-6">
        {rows
          .filter((row): row is [string, string] => Boolean(row[1]))
          .map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="font-medium text-fg-2">{label}</dt>
              <dd className="text-fg">{value}</dd>
            </React.Fragment>
          ))}
      </dl>

      {unfinished && <p className="mt-3 text-small text-fg-2">{t.pendingHint}</p>}

      {app.hasGrant && (
        <>
          <Button
            ref={buttonRef}
            className="mt-4"
            variant="secondary"
            size="sm"
            leadingIcon={<Unplug size={14} aria-hidden="true" />}
            aria-describedby={nameId}
            onClick={() => setConfirmOpen(true)}
          >
            {unfinished ? t.finish : t.disconnect}
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            title={t.dialogTitle(name)}
            body={t.dialogBody}
            confirmLabel={busy ? t.busy : t.confirm}
            cancelLabel={t.cancel}
            busy={busy}
            onConfirm={() => void revoke()}
            onClose={() => setConfirmOpen(false)}
            returnFocusRef={buttonRef}
          />
        </>
      )}
    </li>
  );
};

export default ConnectedAppsView;
