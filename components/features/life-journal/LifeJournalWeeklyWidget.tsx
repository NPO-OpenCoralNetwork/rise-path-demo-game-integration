import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, HeartPulse, RefreshCw, Sparkles } from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import {
  getLifeJournalAdvice,
  getLifeJournalRange,
} from '../../../services/lifeJournalApi';
import {
  computeCurrentStreak,
  getLocalDateString,
  getRollingWeekRange,
  getStreakLookbackFrom,
  isDayLogged,
} from './lifeJournalMetrics';
import { localizeAdvice, type InsightsLang } from './lifeJournalInsightsI18n';

interface LifeJournalWeeklyWidgetProps {
  onNavigate: (view: ViewState) => void;
}

const LifeJournalWeeklyWidget: React.FC<LifeJournalWeeklyWidgetProps> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const lang: InsightsLang = language === 'jp' ? 'jp' : 'en';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekly, setWeekly] = useState<Awaited<ReturnType<typeof getLifeJournalAdvice>> | null>(null);
  const [currentStreak, setCurrentStreak] = useState(0);

  const copy = {
    en: {
      kicker: 'Life habits',
      title: 'This week',
      subtitle: 'Record rate and sleep from your journal.',
      meta: 'Last 7 days',
      recordRate: 'Days logged',
      avgSleep: 'Avg sleep',
      avgFocus: 'Avg focus',
      streak: 'Current streak',
      streakMeta: '90d lookback',
      topAdvice: 'Top suggestion',
      noAdvice: 'Keep logging — personalized tips unlock after 7 entries.',
      noData: 'No journal entries this week yet.',
      logToday: 'Log today',
      viewInsights: 'View insights',
      retry: 'Try again',
      loadError: 'Could not load weekly summary.',
      disclaimer: 'Wellness trends only — not medical advice.',
    },
    jp: {
      kicker: '生活習慣',
      title: '今週のサマリー',
      subtitle: 'ジャーナルから記録率と睡眠を表示。',
      meta: '直近7日',
      recordRate: '記録日数',
      avgSleep: '平均睡眠',
      avgFocus: '平均集中度',
      streak: '連続記録',
      streakMeta: '90日ルックバック',
      topAdvice: '今週の提案',
      noAdvice: '7日分以上記録するとパーソナル提案が表示されます。',
      noData: '今週の記録はまだありません。',
      logToday: '今日を記録',
      viewInsights: 'インサイトを見る',
      retry: '再読み込み',
      loadError: '週次サマリーの読み込みに失敗しました。',
      disclaimer: 'ウェルネス参考情報です。医療アドバイスではありません。',
    },
  };
  const t = copy[lang];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = getLocalDateString();
      const { from, to } = getRollingWeekRange(today);
      const streakFrom = getStreakLookbackFrom(today);

      const [result, streakRange] = await Promise.all([
        getLifeJournalAdvice(from, to),
        getLifeJournalRange(streakFrom, today),
      ]);

      const loggedDates = new Set(
        streakRange.days.filter(isDayLogged).map((d) => d.date),
      );
      setCurrentStreak(computeCurrentStreak(loggedDates, today));
      setWeekly(result);
    } catch {
      setWeekly(null);
      setCurrentStreak(0);
      setError(t.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.loadError]);

  useEffect(() => {
    load();
  }, [load]);

  const topAdvice = weekly?.advice?.[0];
  const localizedAdvice = topAdvice
    ? localizeAdvice(topAdvice, lang, weekly?.metrics)
    : null;

  return (
    <div className="rounded-3xl border border-slate-100 bg-white/80 backdrop-blur p-6 sm:p-7 md:p-8 shadow-sm flex flex-col gap-5 min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{t.kicker}</p>
          <h3 className="text-lg md:text-xl font-semibold text-slate-900 mt-2">{t.title}</h3>
          <p className="text-sm text-slate-500 mt-1">{t.subtitle}</p>
          <p className="text-xs text-slate-400 mt-1">{t.meta}</p>
        </div>
        <div className="h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
          <HeartPulse size={22} />
        </div>
      </div>

      {loading && (
        <p className="text-sm text-slate-400 animate-pulse">…</p>
      )}

      {!loading && error && (
        <div className="space-y-3">
          <div className="rounded-xl bg-rose-50 text-rose-700 px-4 py-3 text-sm">
            {error}
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
          >
            <RefreshCw size={16} />
            {t.retry}
          </button>
        </div>
      )}

      {!loading && !error && weekly && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricPill
              label={t.recordRate}
              value={`${weekly.summary.days_logged}/${weekly.summary.total_days}`}
              sub={`${weekly.summary.record_rate_pct}%`}
            />
            <MetricPill
              label={t.avgSleep}
              value={weekly.summary.avg_sleep_hours != null ? `${weekly.summary.avg_sleep_hours}h` : '—'}
            />
            <MetricPill
              label={t.avgFocus}
              value={weekly.summary.avg_focus != null ? String(weekly.summary.avg_focus) : '—'}
            />
            <MetricPill
              label={t.streak}
              value={String(currentStreak)}
              sub={t.streakMeta}
            />
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 flex items-center gap-1.5">
              <Sparkles size={14} />
              {t.topAdvice}
            </p>
            {localizedAdvice ? (
              <div className="mt-2 space-y-1">
                <p className="text-sm font-semibold text-slate-800">{localizedAdvice.title}</p>
                <p className="text-sm text-slate-600">{localizedAdvice.action}</p>
                <p className="text-xs text-slate-500">{localizedAdvice.evidence}</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500 mt-2">
                {weekly.summary.days_logged === 0 ? t.noData : t.noAdvice}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate(ViewState.LIFE_JOURNAL)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
            >
              <BookOpen size={16} />
              {t.logToday}
            </button>
            <button
              type="button"
              onClick={() => onNavigate(ViewState.LIFE_JOURNAL_INSIGHTS)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-violet-600 hover:text-violet-700"
            >
              <ArrowUpRight size={16} />
              {t.viewInsights}
            </button>
          </div>

          <p className="text-[11px] text-slate-400">{t.disclaimer}</p>
        </>
      )}
    </div>
  );
};

const MetricPill: React.FC<{ label: string; value: string; sub?: string }> = ({
  label,
  value,
  sub,
}) => (
  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
    <p className="text-[11px] text-slate-500">{label}</p>
    <p className="text-base font-bold text-slate-900">{value}</p>
    {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
  </div>
);

export default LifeJournalWeeklyWidget;