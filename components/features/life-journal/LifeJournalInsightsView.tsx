import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Lightbulb,
  Link2,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import {
  getLifeJournalAnalysis,
  type LifeJournalAnalysisResult,
} from '../../../services/lifeJournalApi';
import { getLocalDateString, getRollingWeekRange, ROLLING_WEEK_DAYS } from './lifeJournalMetrics';
import {
  localizeAdvice,
  localizeCorrelation,
  localizePattern,
  type InsightsLang,
} from './lifeJournalInsightsI18n';

interface LifeJournalInsightsViewProps {
  onNavigate: (view: ViewState) => void;
}

const INSIGHT_WINDOWS = {
  week: ROLLING_WEEK_DAYS,
  month: 30,
} as const;

type InsightWindow = keyof typeof INSIGHT_WINDOWS;

const shiftDate = (date: string, delta: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

const strengthLabel = (strength: string, lang: string) => {
  const map: Record<string, { en: string; jp: string }> = {
    very_weak: { en: 'very weak', jp: 'とても弱い' },
    weak: { en: 'weak', jp: '弱い' },
    moderate: { en: 'moderate', jp: '中程度' },
    strong: { en: 'strong', jp: '強い' },
    very_strong: { en: 'very strong', jp: 'とても強い' },
  };
  return map[strength]?.[lang === 'jp' ? 'jp' : 'en'] ?? strength;
};

const LifeJournalInsightsView: React.FC<LifeJournalInsightsViewProps> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<LifeJournalAnalysisResult | null>(null);

  const [window, setWindow] = useState<InsightWindow>('week');
  const today = getLocalDateString();
  const { from, to } = useMemo(() => {
    if (window === 'week') {
      const range = getRollingWeekRange(today);
      return { from: range.from, to: range.to };
    }
    return { from: shiftDate(today, -(INSIGHT_WINDOWS.month - 1)), to: today };
  }, [today, window]);
  const windowDays = INSIGHT_WINDOWS[window];

  const copy = {
    en: {
      title: 'Insights',
      subtitle: 'Evidence-based patterns — not medical advice.',
      week: 'This week',
      month: 'Last 30 days',
      backMonthly: 'Monthly charts',
      backDaily: 'Daily journal',
      askCoach: 'Ask AI coach',
      daysLogged: 'Days logged',
      avgFocus: 'Avg focus',
      avgSleep: 'Avg sleep',
      correlations: 'Top correlations',
      patterns: 'Detected patterns',
      advice: 'Suggested actions',
      noCorrelations: 'Log at least 7 days with overlapping metrics to unlock correlations.',
      noPatterns: 'No strong patterns yet — keep logging sleep, mood, and exercise.',
      noAdvice: 'No rule-based suggestions for this period yet.',
      rLabel: 'r',
      nLabel: 'n',
      confidence: 'confidence',
      disclaimer: 'Correlations suggest associations, not causes. Not medical or nutritional advice.',
      loadError: 'Could not load analysis.',
    },
    jp: {
      title: 'インサイト',
      subtitle: '根拠ベースのパターン（医療アドバイスではありません）',
      week: '今週',
      month: '直近30日',
      backMonthly: '月間グラフ',
      backDaily: '日次ジャーナル',
      askCoach: 'AI コーチに質問',
      daysLogged: '記録日数',
      avgFocus: '平均集中度',
      avgSleep: '平均睡眠',
      correlations: '主な相関',
      patterns: '検出パターン',
      advice: 'おすすめアクション',
      noCorrelations: '相関は7日分以上の記録で表示されます。',
      noPatterns: 'まだ明確なパターンはありません。睡眠・気分・運動を続けて記録しましょう。',
      noAdvice: 'この期間ではルールベースの提案はありません。',
      rLabel: 'r',
      nLabel: 'n',
      confidence: '信頼度',
      disclaimer: '相関は因果ではありません。医療・栄養・心理の診断ではありません。',
      loadError: '分析の読み込みに失敗しました。',
    },
  };
  const lang: InsightsLang = language === 'jp' ? 'jp' : 'en';
  const t = copy[lang];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getLifeJournalAnalysis(
        from,
        to,
        undefined,
        window === 'week' ? 'weekly' : 'custom',
      );
      setAnalysis(result);
    } catch {
      setError(t.loadError);
    } finally {
      setLoading(false);
    }
  }, [from, to, window, t.loadError]);

  useEffect(() => {
    setTheme('default');
    load();
  }, [load, setTheme]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-violet-100 text-violet-700">
            <Sparkles size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
            <p className="text-sm text-slate-500">{t.subtitle}</p>
            <p className="text-xs text-slate-400 mt-1">
              {window === 'week' ? t.week : t.month} · {windowDays} {lang === 'jp' ? '日' : 'days'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {(['week', 'month'] as InsightWindow[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setWindow(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                window === key
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {key === 'week' ? t.week : t.month}
            </button>
          ))}
        </div>
      </header>

      {loading && (
        <p className="text-sm text-slate-500 animate-pulse">…</p>
      )}

      {error && (
        <div className="rounded-xl bg-rose-50 text-rose-700 px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && !error && analysis && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              icon={BookOpen}
              label={t.daysLogged}
              value={String(analysis.summary.days_logged)}
            />
            <StatCard
              icon={TrendingUp}
              label={t.avgFocus}
              value={analysis.summary.avg_focus != null ? String(analysis.summary.avg_focus) : '—'}
            />
            <StatCard
              icon={TrendingUp}
              label={t.avgSleep}
              value={analysis.summary.avg_sleep_hours != null ? `${analysis.summary.avg_sleep_hours}h` : '—'}
            />
          </div>

          <Section
            icon={Link2}
            title={t.correlations}
            empty={!analysis.correlations.length}
            emptyText={analysis.data_quality.message || t.noCorrelations}
          >
            <ul className="space-y-3">
              {analysis.correlations.map((c) => (
                <li
                  key={`${c.x}-${c.y}`}
                  className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm"
                >
                  <p className="font-semibold text-slate-800 text-sm">
                    {localizeCorrelation(c, lang)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {t.rLabel}={c.r} · {t.nLabel}={c.sample_size} · {strengthLabel(c.strength, lang)} · {t.confidence}: {c.confidence}
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            icon={Lightbulb}
            title={t.patterns}
            empty={!analysis.patterns.length}
            emptyText={t.noPatterns}
          >
            <ul className="space-y-3">
              {analysis.patterns.map((p) => {
                const localized = localizePattern(p, lang);
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm"
                  >
                    <p className="font-semibold text-slate-800 text-sm">{localized.title}</p>
                    <p className="text-xs text-slate-600 mt-1">{localized.evidence}</p>
                    <p className="text-xs text-slate-400 mt-1">{t.confidence}: {p.confidence}</p>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section
            icon={Sparkles}
            title={t.advice}
            empty={!analysis.advice?.length}
            emptyText={t.noAdvice}
          >
            <ul className="space-y-3">
              {(analysis.advice || []).map((a) => {
                const localized = localizeAdvice(a, lang, analysis.metrics);
                return (
                  <li
                    key={a.rule_id}
                    className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3"
                  >
                    <p className="font-semibold text-indigo-900 text-sm">{localized.title}</p>
                    <p className="text-sm text-slate-700 mt-1">{localized.action}</p>
                    <p className="text-xs text-slate-500 mt-2">{localized.evidence}</p>
                  </li>
                );
              })}
            </ul>
          </Section>

          <p className="text-xs text-slate-400 border-t border-slate-100 pt-4">{t.disclaimer}</p>
        </>
      )}

      <div className="flex flex-wrap gap-4 pt-2">
        <button
          type="button"
          onClick={() => onNavigate(ViewState.LIFE_JOURNAL_CHAT)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          <Sparkles size={16} />
          {t.askCoach}
        </button>
        <button
          type="button"
          onClick={() => onNavigate(ViewState.LIFE_JOURNAL_MONTHLY)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
        >
          <ArrowLeft size={16} />
          {t.backMonthly}
        </button>
        <button
          type="button"
          onClick={() => onNavigate(ViewState.LIFE_JOURNAL)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
        >
          <ArrowLeft size={16} />
          {t.backDaily}
        </button>
      </div>
    </div>
  );
};

const StatCard: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
}> = ({ icon: Icon, label, value }) => (
  <div className="rounded-2xl bg-white border border-slate-100 px-4 py-3 shadow-sm">
    <div className="flex items-center gap-2 text-slate-500 text-xs font-medium">
      <Icon size={14} />
      {label}
    </div>
    <p className="text-xl font-bold text-slate-900 mt-1">{value}</p>
  </div>
);

const Section: React.FC<{
  icon: React.ElementType;
  title: string;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}> = ({ icon: Icon, title, empty, emptyText, children }) => (
  <section className="space-y-3">
    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700">
      <Icon size={16} className="text-indigo-600" />
      {title}
    </h2>
    {empty ? (
      <p className="text-sm text-slate-500 rounded-xl bg-slate-50 px-4 py-3">{emptyText}</p>
    ) : children}
  </section>
);

export default LifeJournalInsightsView;