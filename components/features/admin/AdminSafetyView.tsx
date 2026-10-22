import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleAlert, CircleCheck, ClipboardCheck, Flag, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { useUserRole } from '../../../hooks/useUserRole';
import PageHeader from '../../ui/PageHeader';
import { Button } from '../../ui/Button';
import { BirthYmFields, selectClasses } from '../../safety/BirthYmFields';
import { ConfirmDialog } from '../../safety/ConfirmDialog';
import { formatBirthYm, formatTokyoDateTime } from '../../safety/format';
import {
  AI_SAFETY_PATH,
  AiAccessApiError,
  CONSENT_POLICY_VERSION,
  adminGetUserAiAccess,
  adminRecordPaperConsent,
  adminRevokeConsent,
  adminSetBirthYm,
  getSafetySummary,
  isUserId,
  isValidBirthYm,
  listSafetyReports,
  markReportReviewed,
  splitBirthYm,
  toBirthYm,
  type AdminUserAiAccess,
  type GuardianRelationship,
  type ReportStatusFilter,
  type SafetyReport,
  type SafetySummary,
} from '../../../services/aiAccessApi';

/**
 * /settings/admin/safety — Phase 0.5 safety administration (admins only; the server checks the
 * role again on every call, server/middleware/requireAdmin.js):
 *   - counts of stopped messages, failed checks, support notices and reports;
 *   - reports from learners, with "mark reviewed";
 *   - one learner's AI access: record a birth month or a guardian's paper consent form, or
 *     withdraw the consent.
 * Report text is untrusted learner and model text: shown as plain text only.
 */

type Lang = 'en' | 'jp';

const copy = {
  en: {
    back: 'Back',
    eyebrow: 'Settings · Admin',
    title: 'AI safety',
    description: 'Safety counts, reports from learners, and age and guardian consent records.',
    checking: 'Checking your role…',
    notAdmin: 'This page is for administrators only.',
    toSettings: 'Back to settings',
    guide: 'Public AI safety page',
    refresh: 'Refresh',
    loading: 'Loading…',
    failed: 'This could not be loaded. Please try again.',
    noDatabase: 'The database is not configured on this server.',
    forbidden: 'The server says this account is not an administrator.',
    summaryTitle: 'Summary',
    period: 'Period',
    days: (n: number) => `Last ${n} days`,
    openReports: 'Open reports',
    groupsTitle: 'Breakdown',
    colKind: 'Kind',
    colCategory: 'Category',
    colSurface: 'Feature',
    colAudience: 'Audience',
    colCount: 'Count',
    noEvents: 'No events in this period.',
    reportsTitle: 'Reports',
    filter: 'Show',
    filters: { open: 'Open', reviewed: 'Reviewed', all: 'All' } as Record<ReportStatusFilter, string>,
    noReports: 'No reports.',
    reason: 'Reason',
    answer: 'AI answer',
    question: 'Question',
    note: 'Note',
    where: 'Where',
    learner: 'Learner',
    textCleared: 'The text was deleted after 90 days.',
    markReviewed: 'Mark reviewed',
    reviewed: (at: string | null) => (at ? `Reviewed ${at}` : 'Reviewed'),
    lookupTitle: 'A learner’s AI access',
    lookupHint: 'Enter the full number shown on the learner’s “AI access” page (36 characters).',
    userId: 'Learner number (user id)',
    lookup: 'Look up',
    invalidId: 'Enter the full number (8-4-4-4-12 characters).',
    notFound: 'No learner with this number.',
    status: 'Status',
    statuses: { ready: 'Can use AI', needs_age: 'Birth month not recorded', needs_guardian_consent: 'Waiting for guardian consent', paused: 'Paused for today' },
    audience: 'Audience',
    audiences: { adult: '18 or over', minor: 'Under 18' } as Record<string, string>,
    birthMonth: 'Birth year and month',
    consent: 'Guardian consent',
    none: 'None',
    methodDevice: 'on the learner’s device',
    methodPaper: 'paper form (staff)',
    recent: 'Last 30 days',
    ageFormTitle: 'Record the birth year and month',
    ageFixTitle: 'Correct the birth year and month',
    ageLegend: 'Birth year and month',
    declaredBy: 'Who told you',
    declaredByOptions: { guardian: 'The guardian', staff: 'Checked by staff' },
    saveAge: 'Save birth month',
    ageInvalid: 'Choose a year and a month.',
    paperTitle: 'Record a paper consent form',
    paperHint: (v: string) => `Only after you have the guardian’s signed paper form for consent text version ${v}.`,
    relationship: 'Guardian’s relationship',
    choose: 'Choose',
    relationships: { parent: 'Parent', guardian: 'Guardian (not a parent)', other: 'Other caregiver' } as Record<GuardianRelationship, string>,
    paperCheck: 'I have checked the signed paper consent form.',
    recordPaper: 'Record consent',
    paperIncomplete: 'Choose the relationship and tick the box.',
    revoke: 'Withdraw consent',
    revokeTitle: 'Withdraw this learner’s guardian consent?',
    revokeBody: 'AI stops for this learner at once. A guardian has to agree again.',
    cancel: 'Cancel',
    saved: 'Saved.',
    saveFailed: 'This could not be saved. Please try again.',
  },
  jp: {
    back: '戻る',
    eyebrow: '設定・管理者',
    title: 'AI の安全の管理',
    description: '止めた件数、学習者からの報告、年齢と保護者の同意の記録を扱います。',
    checking: '権限を確認しています…',
    notAdmin: 'このページは管理者だけが使えます。',
    toSettings: '設定に戻る',
    guide: '公開している「AI の安全について」',
    refresh: '更新',
    loading: '読み込んでいます…',
    failed: '読み込めませんでした。もう一度お試しください。',
    noDatabase: 'このサーバーにはデータベースが設定されていません。',
    forbidden: 'サーバーで管理者として確認できませんでした。',
    summaryTitle: '集計',
    period: '期間',
    days: (n: number) => `直近 ${n} 日`,
    openReports: '未確認の報告',
    groupsTitle: '内訳',
    colKind: '種類',
    colCategory: '分類',
    colSurface: '機能',
    colAudience: '対象',
    colCount: '件数',
    noEvents: 'この期間の記録はありません。',
    reportsTitle: '報告',
    filter: '表示',
    filters: { open: '未確認', reviewed: '確認済み', all: 'すべて' } as Record<ReportStatusFilter, string>,
    noReports: '報告はありません。',
    reason: '理由',
    answer: 'AI の答え',
    question: '質問',
    note: 'メモ',
    where: '場所',
    learner: '学習者',
    textCleared: '90日を過ぎたため、文章は消しました。',
    markReviewed: '確認済みにする',
    reviewed: (at: string | null) => (at ? `確認済み（${at}）` : '確認済み'),
    lookupTitle: '学習者の AI の利用設定',
    lookupHint: '学習者の「AI の利用設定」ページに出ている番号を、ぜんぶ（36文字）入力してください。',
    userId: '学習者の番号（ユーザー ID）',
    lookup: '調べる',
    invalidId: '番号をぜんぶ入力してください（8-4-4-4-12 文字）。',
    notFound: 'この番号の学習者は見つかりません。',
    status: '状態',
    statuses: { ready: 'AI を使える', needs_age: '生まれた年月が未登録', needs_guardian_consent: '保護者の同意待ち', paused: '今日はお休み中' },
    audience: '対象',
    audiences: { adult: '18歳以上', minor: '18歳未満' } as Record<string, string>,
    birthMonth: '生まれた年と月',
    consent: '保護者の同意',
    none: 'なし',
    methodDevice: '学習者の端末で同意',
    methodPaper: '紙の同意書（スタッフが記録）',
    recent: '直近30日',
    ageFormTitle: '生まれた年と月を登録する',
    ageFixTitle: '生まれた年と月を直す',
    ageLegend: '生まれた年と月',
    declaredBy: '確認のしかた',
    declaredByOptions: { guardian: '保護者からの申告', staff: 'スタッフが確認' },
    saveAge: '年月を登録する',
    ageInvalid: '年と月を選んでください。',
    paperTitle: '紙の同意書を記録する',
    paperHint: (v: string) => `同意文の版 ${v} の、保護者が署名した紙の同意書を受け取ってから記録してください。`,
    relationship: '保護者の続柄',
    choose: '選んでください',
    relationships: { parent: '親（父・母）', guardian: '親以外の保護者', other: 'その他の養育者' } as Record<GuardianRelationship, string>,
    paperCheck: '署名された紙の同意書を確認しました。',
    recordPaper: '同意を記録する',
    paperIncomplete: '続柄を選び、確認のチェックを入れてください。',
    revoke: '同意を取り消す',
    revokeTitle: 'この学習者の保護者の同意を取り消しますか？',
    revokeBody: 'この学習者の AI はすぐに止まります。使うには、保護者の同意がもう一度必要です。',
    cancel: 'やめる',
    saved: '保存しました。',
    saveFailed: '保存できませんでした。もう一度お試しください。',
  },
} as const;

type T = (typeof copy)[Lang];

const LABELS: Record<Lang, Record<string, string>> = {
  en: {
    input_blocked: 'Input stopped',
    output_blocked: 'Answer stopped',
    user_report: 'Report',
    support_shown: 'Support lines shown',
    check_failed: 'Check failed',
    none: 'None',
    self_harm: 'Self-harm',
    sexual: 'Sexual',
    violence: 'Violence',
    bullying: 'Bullying',
    personal_info: 'Personal info',
    dangerous: 'Dangerous',
    hate: 'Hate',
    other: 'Other',
    harmful: 'Harmful',
    wrong: 'Wrong',
    inappropriate_for_age: 'Not right for the age',
    tutor: 'AI tutor',
    writing_feedback: 'Writing feedback',
    assessment_insight: 'Assessment insight',
    course_generation: 'Course builder',
    generated_lesson: 'Generated lesson',
    adult: '18+',
    minor: 'Under 18',
  },
  jp: {
    input_blocked: '入力を止めた',
    output_blocked: '答えを止めた',
    user_report: '報告',
    support_shown: '相談先を表示',
    check_failed: '確認できず停止',
    none: 'なし',
    self_harm: '自傷',
    sexual: '性的',
    violence: '暴力',
    bullying: 'いじめ',
    personal_info: '個人情報',
    dangerous: '危険',
    hate: '差別',
    other: 'その他',
    harmful: 'あぶない',
    wrong: 'まちがい',
    inappropriate_for_age: '年齢に合わない',
    tutor: 'AI 先生',
    writing_feedback: '作文フィードバック',
    assessment_insight: '診断の解説',
    course_generation: 'コースづくり',
    generated_lesson: '生成レッスン',
    adult: '18歳以上',
    minor: '18歳未満',
  },
};

const KIND_ORDER = ['input_blocked', 'output_blocked', 'check_failed', 'support_shown', 'user_report'] as const;
const DAY_CHOICES = [7, 30, 90, 365];
const RELATIONSHIPS: GuardianRelationship[] = ['parent', 'guardian', 'other'];

const cardClasses = 'rounded-card border border-line bg-surface p-5 shadow-1';
const inputClasses = 'h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-body text-fg';

type LoadError = 'failed' | 'noDatabase' | 'forbidden';

const errorKind = (error: unknown): LoadError => {
  if (error instanceof AiAccessApiError) {
    if (error.status === 403) return 'forbidden';
    if (error.errorType === 'database_unavailable') return 'noDatabase';
  }
  return 'failed';
};

const ErrorLine: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p role="alert" className="flex items-start gap-2 text-small text-danger">
    <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
    {children}
  </p>
);

const AdminSafetyView: React.FC = () => {
  const { language } = useLanguage();
  const { isAdmin, loading } = useUserRole();
  const navigate = useNavigate();
  const t = copy[language];

  const header = (
    <>
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/settings'))}
        className="inline-flex items-center gap-2 rounded-control text-small font-medium text-fg-2 hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {t.back}
      </button>
      <PageHeader
        className="mt-4"
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.description}
        actions={
          <Link to={AI_SAFETY_PATH} className="text-small font-medium text-primary-text underline underline-offset-4">
            {t.guide}
          </Link>
        }
      />
    </>
  );

  return (
    <div className="mx-auto max-w-page px-4 pb-20 pt-8 sm:px-6 lg:px-8">
      {header}
      <div className="mt-6">
        {loading ? (
          <p role="status" className="text-body text-fg-3">
            {t.checking}
          </p>
        ) : !isAdmin ? (
          <div className={cardClasses}>
            <p className="text-body text-fg">{t.notAdmin}</p>
            <Link to="/settings" className="mt-2 inline-block text-small font-medium text-primary-text underline underline-offset-4">
              {t.toSettings}
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
            <div className="min-w-0 space-y-6">
              <SummaryPanel t={t} language={language} />
              <ReportsPanel t={t} language={language} />
            </div>
            <LearnerPanel t={t} language={language} />
          </div>
        )}
      </div>
    </div>
  );
};

// --- summary -----------------------------------------------------------------------------------

const SummaryPanel: React.FC<{ t: T; language: Lang }> = ({ t, language }) => {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<SafetySummary | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [busy, setBusy] = useState(true);
  const titleId = useId();
  const periodId = useId();
  const labels = LABELS[language];

  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setError(null);
    try {
      const next = await getSafetySummary(days, signal);
      if (!signal?.aborted) setSummary(next);
    } catch (err) {
      if (!signal?.aborted) setError(errorKind(err));
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, [days]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const label = (key: string | null) => (key ? labels[key] ?? key : '—');

  return (
    <section aria-labelledby={titleId} className={cardClasses}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id={titleId} className="flex items-center gap-2 text-h2 text-fg">
          <ShieldCheck size={22} aria-hidden="true" className="shrink-0 text-primary-text" />
          {t.summaryTitle}
        </h2>
        <div className="flex items-end gap-2">
          <div>
            <label htmlFor={periodId} className="block text-small font-medium text-fg-2">
              {t.period}
            </label>
            <select id={periodId} value={days} onChange={(e) => setDays(Number(e.target.value))} className={`mt-1 ${selectClasses} h-10 w-auto`}>
              {DAY_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {t.days(n)}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" size="md" onClick={() => void load()} disabled={busy} leadingIcon={<RefreshCw size={16} aria-hidden="true" />}>
            {t.refresh}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorLine>{error === 'noDatabase' ? t.noDatabase : error === 'forbidden' ? t.forbidden : t.failed}</ErrorLine>
        </div>
      ) : !summary ? (
        <p role="status" className="mt-4 text-body text-fg-3">
          {t.loading}
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-control border border-line bg-sunken p-3">
              <dt className="text-small text-fg-2">{t.openReports}</dt>
              <dd className="mt-1 text-h2 text-fg tabular">{summary.openReports}</dd>
            </div>
            {KIND_ORDER.map((kind) => (
              <div key={kind} className="rounded-control bg-sunken p-3">
                <dt className="text-small text-fg-2">{label(kind)}</dt>
                <dd className="mt-1 text-h2 text-fg tabular">{summary.totals[kind] ?? 0}</dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-6 text-h3 text-fg">{t.groupsTitle}</h3>
          {summary.groups.length === 0 ? (
            <p className="mt-2 text-body text-fg-3">{t.noEvents}</p>
          ) : (
            <div className="mt-2 overflow-x-auto" role="region" aria-label={t.groupsTitle} tabIndex={0}>
              <table className="w-full min-w-[26rem] text-left text-small">
                <thead className="border-b border-line text-fg-2">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">{t.colKind}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t.colCategory}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t.colSurface}</th>
                    <th scope="col" className="py-2 pr-3 font-medium">{t.colAudience}</th>
                    <th scope="col" className="py-2 text-right font-medium">{t.colCount}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-fg">
                  {summary.groups.slice(0, 50).map((group, index) => (
                    <tr key={`${group.kind}-${group.category}-${group.surface}-${group.audience}-${index}`}>
                      <td className="py-2 pr-3">{label(group.kind)}</td>
                      <td className="py-2 pr-3">{label(group.category)}</td>
                      <td className="py-2 pr-3">{label(group.surface)}</td>
                      <td className="py-2 pr-3">{label(group.audience)}</td>
                      <td className="py-2 text-right tabular">{group.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
};

// --- reports -----------------------------------------------------------------------------------

const ReportsPanel: React.FC<{ t: T; language: Lang }> = ({ t, language }) => {
  const [filter, setFilter] = useState<ReportStatusFilter>('open');
  const [reports, setReports] = useState<SafetyReport[] | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const titleId = useId();
  // The reviewed report's button goes away: focus moves to the heading so it is not lost.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const labels = LABELS[language];

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    setReports(null);
    try {
      const next = await listSafetyReports(filter, signal);
      if (!signal?.aborted) setReports(next);
    } catch (err) {
      if (!signal?.aborted) setError(errorKind(err));
    }
  }, [filter]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const review = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      const result = await markReportReviewed(id);
      setReports((prev) => {
        if (!prev) return prev;
        if (filter === 'open') return prev.filter((r) => r.id !== id);
        return prev.map((r) => (r.id === id ? { ...r, status: 'reviewed', reviewedAt: result.reviewedAt } : r));
      });
      headingRef.current?.focus();
    } catch {
      setActionError(t.saveFailed);
    } finally {
      setBusyId(null);
    }
  };

  const label = (key: string | null | undefined) => (key ? labels[key] ?? key : '—');

  return (
    <section aria-labelledby={titleId} className={cardClasses}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-h2 text-fg">
          <Flag size={22} aria-hidden="true" className="shrink-0 text-primary-text" />
          {t.reportsTitle}
        </h2>
        <div role="group" aria-label={t.filter} className="flex flex-wrap gap-1">
          {(['open', 'reviewed', 'all'] as ReportStatusFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`h-9 rounded-full border px-3 text-small font-semibold transition-colors duration-120 ${
                filter === key ? 'border-primary bg-primary-soft text-primary-text' : 'border-line bg-surface text-fg-2 hover:text-fg'
              }`}
            >
              {t.filters[key]}
            </button>
          ))}
        </div>
      </div>

      {actionError && <div className="mt-3"><ErrorLine>{actionError}</ErrorLine></div>}

      {error ? (
        <div className="mt-4">
          <ErrorLine>{error === 'noDatabase' ? t.noDatabase : error === 'forbidden' ? t.forbidden : t.failed}</ErrorLine>
        </div>
      ) : !reports ? (
        <p role="status" className="mt-4 text-body text-fg-3">
          {t.loading}
        </p>
      ) : reports.length === 0 ? (
        <p className="mt-4 text-body text-fg-3">{t.noReports}</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {reports.map((report) => {
            const where = report.context
              ? [report.context.courseId, report.context.lessonId, report.context.blockId].filter(Boolean).join(' / ')
              : '';
            return (
              <li key={report.id} className="rounded-control border border-line p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-2">
                  <span className="font-semibold text-fg">{formatTokyoDateTime(report.createdAt, language, true) ?? '—'}</span>
                  <span>{label(report.surface)}</span>
                  <span>
                    {t.reason}: <span className="font-semibold text-fg">{label(report.reason)}</span>
                  </span>
                  {report.audience && <span>{label(report.audience)}</span>}
                  {report.status === 'reviewed' && (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CircleCheck size={14} aria-hidden="true" />
                      {t.reviewed(formatTokyoDateTime(report.reviewedAt, language, true))}
                    </span>
                  )}
                </div>
                {report.textCleared ? (
                  <p className="mt-2 text-small text-fg-3">{t.textCleared}</p>
                ) : (
                  <dl className="mt-3 space-y-2 text-small">
                    {report.question && (
                      <div>
                        <dt className="font-medium text-fg-2">{t.question}</dt>
                        <dd className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-chip bg-sunken p-2 text-fg">{report.question}</dd>
                      </div>
                    )}
                    {report.answer && (
                      <div>
                        <dt className="font-medium text-fg-2">{t.answer}</dt>
                        <dd className="mt-0.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-chip bg-sunken p-2 text-fg">{report.answer}</dd>
                      </div>
                    )}
                    {report.note && (
                      <div>
                        <dt className="font-medium text-fg-2">{t.note}</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap break-words text-fg">{report.note}</dd>
                      </div>
                    )}
                    {where && (
                      <div>
                        <dt className="font-medium text-fg-2">{t.where}</dt>
                        <dd className="mt-0.5 break-all text-fg">{where}</dd>
                      </div>
                    )}
                  </dl>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="break-all text-caption text-fg-3">
                    {t.learner}: <span className="font-mono">{report.userId ?? '—'}</span>
                  </span>
                  {report.status === 'open' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busyId === report.id}
                      onClick={() => void review(report.id)}
                      leadingIcon={<ClipboardCheck size={14} aria-hidden="true" />}
                    >
                      {t.markReviewed}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

// --- one learner -------------------------------------------------------------------------------

const LearnerPanel: React.FC<{ t: T; language: Lang }> = ({ t, language }) => {
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [access, setAccess] = useState<AdminUserAiAccess | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Each save can remove the focused control (the paper form, the revoke button and its dialog):
  // focus moves to the "saved" status line once it has rendered.
  const [savedCount, setSavedCount] = useState(0);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const titleId = useId();
  const inputId = useId();
  const hintId = useId();
  const labels = LABELS[language];

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault();
    const id = input.trim().toLowerCase();
    setMessage(null);
    if (!isUserId(id)) {
      setLookupError(t.invalidId);
      return;
    }
    setBusy(true);
    setLookupError(null);
    try {
      setAccess(await adminGetUserAiAccess(id));
      setUserId(id);
    } catch (err) {
      setAccess(null);
      setUserId(null);
      if (err instanceof AiAccessApiError && err.errorType === 'user_not_found') setLookupError(t.notFound);
      else {
        const kind = errorKind(err);
        setLookupError(kind === 'noDatabase' ? t.noDatabase : kind === 'forbidden' ? t.forbidden : t.failed);
      }
    } finally {
      setBusy(false);
    }
  };

  const onSaved = (next: AdminUserAiAccess) => {
    // The write routes answer the access state without the event counts: keep the ones shown.
    setAccess((prev) => ({ ...next, recentEvents: next.recentEvents ?? prev?.recentEvents }));
    setMessage(t.saved);
    setSavedCount((n) => n + 1);
  };

  useEffect(() => {
    if (savedCount > 0) messageRef.current?.focus();
  }, [savedCount]);

  return (
    <section aria-labelledby={titleId} className={`${cardClasses} min-w-0`}>
      <h2 id={titleId} className="flex items-center gap-2 text-h2 text-fg">
        <Search size={22} aria-hidden="true" className="shrink-0 text-primary-text" />
        {t.lookupTitle}
      </h2>
      <form className="mt-3 space-y-2" onSubmit={lookup} noValidate>
        <label htmlFor={inputId} className="block text-body font-semibold text-fg">
          {t.userId}
        </label>
        <p id={hintId} className="text-small text-fg-2">
          {t.lookupHint}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={inputId}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-describedby={hintId}
            aria-invalid={lookupError === t.invalidId ? true : undefined}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            className={`${inputClasses} font-mono text-small`}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          <Button type="submit" disabled={busy} className="sm:shrink-0">
            {t.lookup}
          </Button>
        </div>
        {lookupError && <ErrorLine>{lookupError}</ErrorLine>}
      </form>

      {access && userId && (
        <div className="mt-5 space-y-5 border-t border-line pt-5">
          {message && (
            <p ref={messageRef} tabIndex={-1} role="status" className="flex items-center gap-2 text-small text-success">
              <CircleCheck size={16} aria-hidden="true" />
              {message}
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
            <dt className="text-fg-2">{t.status}</dt>
            <dd className="font-semibold text-fg">{t.statuses[access.status] ?? access.status}</dd>
            <dt className="text-fg-2">{t.audience}</dt>
            <dd className="text-fg">{access.audience ? t.audiences[access.audience] : '—'}</dd>
            <dt className="text-fg-2">{t.birthMonth}</dt>
            <dd className="text-fg">{access.birthYm ? formatBirthYm(access.birthYm, language) : t.none}</dd>
            <dt className="text-fg-2">{t.consent}</dt>
            <dd className="text-fg">
              {access.consent
                ? `${formatTokyoDateTime(access.consent.givenAt, language) ?? ''} · ${
                    access.consent.method === 'staff_paper_form' ? t.methodPaper : t.methodDevice
                  }${access.consent.relationship ? ` · ${t.relationships[access.consent.relationship]}` : ''}`
                : t.none}
            </dd>
            {access.pausedUntil && (
              <>
                <dt className="text-fg-2">{t.statuses.paused}</dt>
                <dd className="text-fg">{formatTokyoDateTime(access.pausedUntil, language, true)}</dd>
              </>
            )}
            <dt className="text-fg-2">{t.recent}</dt>
            <dd className="text-fg">
              {access.recentEvents && Object.keys(access.recentEvents).length > 0
                ? Object.entries(access.recentEvents)
                    .map(([kind, n]) => `${labels[kind] ?? kind} ${n}`)
                    .join(' · ')
                : t.none}
            </dd>
          </dl>

          <AdminAgeForm key={`age-${userId}`} t={t} userId={userId} current={access.birthYm} onSaved={onSaved} />

          {access.audience === 'minor' && !access.consent && (
            <PaperConsentForm key={`consent-${userId}`} t={t} userId={userId} onSaved={onSaved} />
          )}

          {access.consent && <RevokeConsent t={t} userId={userId} onSaved={onSaved} />}
        </div>
      )}
    </section>
  );
};

const AdminAgeForm: React.FC<{ t: T; userId: string; current: string | null; onSaved: (next: AdminUserAiAccess) => void }> = ({
  t,
  userId,
  current,
  onSaved,
}) => {
  const initial = splitBirthYm(current);
  const [year, setYear] = useState(initial ? String(initial.year) : '');
  const [month, setMonth] = useState(initial ? String(initial.month) : '');
  const [declaredBy, setDeclaredBy] = useState<'guardian' | 'staff'>('guardian');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const declaredId = useId();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const ym = year && month ? toBirthYm(Number(year), Number(month)) : '';
    if (!ym || !isValidBirthYm(ym)) {
      setError(t.ageInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await adminSetBirthYm(userId, ym, declaredBy));
    } catch {
      setError(t.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-labelledby={titleId} className="space-y-3" onSubmit={submit} noValidate>
      <h3 id={titleId} className="text-h3 text-fg">
        {current ? t.ageFixTitle : t.ageFormTitle}
      </h3>
      <BirthYmFields legend={t.ageLegend} year={year} month={month} onYearChange={setYear} onMonthChange={setMonth} disabled={busy} />
      <div>
        <label htmlFor={declaredId} className="block text-small font-medium text-fg-2">
          {t.declaredBy}
        </label>
        <select
          id={declaredId}
          value={declaredBy}
          disabled={busy}
          onChange={(e) => setDeclaredBy(e.target.value as 'guardian' | 'staff')}
          className={`mt-1 sm:max-w-sm ${selectClasses}`}
        >
          <option value="guardian">{t.declaredByOptions.guardian}</option>
          <option value="staff">{t.declaredByOptions.staff}</option>
        </select>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      <Button type="submit" variant="secondary" disabled={busy}>
        {t.saveAge}
      </Button>
    </form>
  );
};

const PaperConsentForm: React.FC<{ t: T; userId: string; onSaved: (next: AdminUserAiAccess) => void }> = ({ t, userId, onSaved }) => {
  const [relationship, setRelationship] = useState<GuardianRelationship | ''>('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const relId = useId();
  const checkId = useId();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!relationship || !checked) {
      setError(t.paperIncomplete);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await adminRecordPaperConsent(userId, relationship));
    } catch {
      setError(t.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-labelledby={titleId} className="space-y-3 border-t border-line pt-5" onSubmit={submit} noValidate>
      <h3 id={titleId} className="text-h3 text-fg">
        {t.paperTitle}
      </h3>
      <p className="text-small text-fg-2">{t.paperHint(CONSENT_POLICY_VERSION)}</p>
      <div>
        <label htmlFor={relId} className="block text-small font-medium text-fg-2">
          {t.relationship}
        </label>
        <select
          id={relId}
          value={relationship}
          disabled={busy}
          onChange={(e) => setRelationship(e.target.value as GuardianRelationship | '')}
          className={`mt-1 sm:max-w-sm ${selectClasses}`}
        >
          <option value="">{t.choose}</option>
          {RELATIONSHIPS.map((key) => (
            <option key={key} value={key}>
              {t.relationships[key]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-start gap-3">
        <input
          id={checkId}
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <label htmlFor={checkId} className="text-body text-fg">
          {t.paperCheck}
        </label>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      <Button type="submit" disabled={busy}>
        {t.recordPaper}
      </Button>
    </form>
  );
};

const RevokeConsent: React.FC<{ t: T; userId: string; onSaved: (next: AdminUserAiAccess) => void }> = ({ t, userId, onSaved }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await adminRevokeConsent(userId);
      setOpen(false);
      onSaved(next);
    } catch {
      setOpen(false);
      setError(t.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-line pt-5">
      {error && <ErrorLine>{error}</ErrorLine>}
      <Button ref={triggerRef} variant="secondary" onClick={() => setOpen(true)}>
        {t.revoke}
      </Button>
      <ConfirmDialog
        open={open}
        title={t.revokeTitle}
        body={t.revokeBody}
        confirmLabel={t.revoke}
        cancelLabel={t.cancel}
        busy={busy}
        onConfirm={() => void revoke()}
        onClose={() => setOpen(false)}
        returnFocusRef={triggerRef}
      />
    </div>
  );
};

export default AdminSafetyView;
