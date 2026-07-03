import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Flame,
  LineChart as LineChartIcon,
  Moon,
  TrendingUp,
  Sparkles,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import { getLifeJournalRange } from '../../../services/lifeJournalApi';
import {
  computeMonthSummary,
  formatMonthLabel,
  getLocalDateString,
  getMonthRange,
  getStreakLookbackFrom,
  toChartPoints,
  toScatterPoints,
} from './lifeJournalMetrics';
import type { LifeJournalDay } from '../../../services/lifeJournalApi';

interface LifeJournalMonthlyViewProps {
  onNavigate: (view: ViewState) => void;
}

const CHART_HEIGHT = 220;

const LifeJournalMonthlyView: React.FC<LifeJournalMonthlyViewProps> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();
  const [chartReady, setChartReady] = useState(false);

  const today = getLocalDateString();
  const [yearMonth, setYearMonth] = useState(() => today.slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<LifeJournalDay[]>([]);
  const [streakDays, setStreakDays] = useState<LifeJournalDay[]>([]);

  const [year, month] = useMemo(() => {
    const [y, m] = yearMonth.split('-').map(Number);
    return [y, m];
  }, [yearMonth]);

  const copy = {
    en: {
      title: 'Monthly Overview',
      subtitle: 'See how habits and learning connect over time.',
      backDaily: 'Back to daily journal',
      insights: 'Insights & patterns',
      daysLogged: 'Days logged',
      avgSleep: 'Avg sleep',
      avgFocus: 'Avg focus',
      avgEnergy: 'Avg energy',
      avgStress: 'Avg stress',
      currentStreak: 'Current streak',
      bestStreak: 'Best streak (90d)',
      bestStreakThisMonth: 'Best this month',
      scatterNeedMore: 'Need at least 2 days with both sleep and focus logged',
      totalLearning: 'Total learning',
      hours: 'h',
      min: 'min',
      days: 'days',
      noData: 'No entries this month yet — start with today\'s journal.',
      sleepFocusEnergy: 'Sleep, focus, energy & stress',
      stress: 'Stress',
      moodTrend: 'Mood trend',
      learningTime: 'Learning time',
      sleepVsFocus: 'Sleep vs focus',
      sleep: 'Sleep',
      focus: 'Focus',
      energy: 'Energy',
      mood: 'Mood',
      learning: 'Learning',
      disclaimer: 'Wellness trends only — not medical or nutritional advice.',
    },
    jp: {
      title: '月間サマリー',
      subtitle: '生活習慣と学習の関係を月単位で確認。',
      backDaily: '日次ジャーナルへ戻る',
      insights: 'インサイト',
      daysLogged: '記録日数',
      avgSleep: '平均睡眠',
      avgFocus: '平均集中度',
      avgEnergy: '平均エネルギー',
      avgStress: '平均ストレス',
      currentStreak: '現在の連続記録',
      bestStreak: '最長連続（90日）',
      bestStreakThisMonth: '今月の最長',
      scatterNeedMore: '睡眠と集中度の両方が記録された日が2日以上必要です',
      totalLearning: '学習時間合計',
      hours: '時間',
      min: '分',
      days: '日',
      noData: '今月の記録はまだありません。今日のジャーナルから始めましょう。',
      sleepFocusEnergy: '睡眠・集中・エネルギー・ストレス',
      stress: 'ストレス',
      moodTrend: '気分の推移',
      learningTime: '学習時間',
      sleepVsFocus: '睡眠 × 集中度',
      sleep: '睡眠',
      focus: '集中度',
      energy: 'エネルギー',
      mood: '気分',
      learning: '学習',
      disclaimer: 'ウェルネスの参考情報です。医療・栄養のアドバイスではありません。',
    },
  } as const;

  const t = copy[language];
  const monthLabel = formatMonthLabel(year, month, language);
  const isCurrentMonth = yearMonth === today.slice(0, 7);
  const canGoNext = !isCurrentMonth;

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setChartReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const loadMonth = useCallback(async (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    const { from, to } = getMonthRange(y, m);
    const streakFrom = getStreakLookbackFrom(today);
    setLoading(true);
    setError(null);
    try {
      const [monthResult, streakResult] = await Promise.all([
        getLifeJournalRange(from, to),
        getLifeJournalRange(streakFrom, today),
      ]);
      setDays(monthResult.days);
      setStreakDays(streakResult.days);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setDays([]);
      setStreakDays([]);
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    loadMonth(yearMonth);
  }, [yearMonth, loadMonth]);

  const chartPoints = useMemo(() => toChartPoints(days, language), [days, language]);
  const scatterPoints = useMemo(() => toScatterPoints(chartPoints), [chartPoints]);
  const summary = useMemo(
    () => computeMonthSummary(days, { anchorDate: today, streakDays }),
    [days, streakDays, today],
  );

  const shiftMonth = (delta: number) => {
    const d = new Date(`${yearMonth}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + delta);
    const next = d.toISOString().slice(0, 7);
    if (next > today.slice(0, 7)) return;
    setYearMonth(next);
  };

  const tooltipStyle = {
    contentStyle: { background: '#0f172a', border: 'none', borderRadius: '10px', color: 'white', fontSize: '12px' },
    itemStyle: { color: 'white' },
    labelStyle: { color: '#94a3b8' },
  };

  const formatAvg = (value: number | null, suffix = '') =>
    value != null ? `${value}${suffix}` : '—';

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-8 pb-24">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-2xl bg-indigo-100 text-indigo-700">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
            <p className="text-slate-500 text-sm">{t.subtitle}</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-3">{t.disclaimer}</p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="p-2 rounded-xl hover:bg-slate-50 text-slate-500"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-bold text-slate-800">{monthLabel}</span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={!canGoNext}
            className="p-2 rounded-xl hover:bg-slate-50 text-slate-500 disabled:opacity-30"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-slate-400">...</div>
        ) : error ? (
          <div className="px-6 py-8 text-center text-sm text-rose-600">{error}</div>
        ) : (
          <div className="px-6 py-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3 mb-8">
              <SummaryCard
                label={t.daysLogged}
                value={`${summary.daysLogged}/${summary.daysInMonth}`}
                icon={BookOpen}
                tone="indigo"
              />
              <SummaryCard
                label={t.avgSleep}
                value={formatAvg(summary.avgSleep, t.hours)}
                icon={Moon}
                tone="violet"
              />
              <SummaryCard
                label={t.avgFocus}
                value={formatAvg(summary.avgFocus, '/5')}
                icon={TrendingUp}
                tone="blue"
              />
              <SummaryCard
                label={t.avgEnergy}
                value={formatAvg(summary.avgEnergy, '/5')}
                icon={LineChartIcon}
                tone="emerald"
              />
              <SummaryCard
                label={t.avgStress}
                value={formatAvg(summary.avgStress, '/5')}
                icon={TrendingUp}
                tone="rose"
              />
              <SummaryCard
                label={t.currentStreak}
                value={`${summary.currentStreak} ${t.days}`}
                icon={Flame}
                tone="amber"
              />
              <SummaryCard
                label={t.bestStreak}
                value={`${summary.bestStreak} ${t.days}`}
                icon={Flame}
                tone="violet"
              />
              <SummaryCard
                label={t.totalLearning}
                value={`${summary.totalLearningMin} ${t.min}`}
                icon={BarChart3}
                tone="slate"
              />
            </div>

            {summary.daysLogged === 0 ? (
              <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-8 text-center text-sm text-slate-500">
                {t.noData}
              </div>
            ) : chartReady && (
              <div className="space-y-8">
                <ChartSection title={t.sleepFocusEnergy}>
                  <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                    <LineChart data={chartPoints} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                      <YAxis yAxisId="sleep" domain={[0, 12]} tick={{ fontSize: 10, fill: '#94a3b8' }} width={32} />
                      <YAxis yAxisId="score" orientation="right" domain={[1, 5]} tick={{ fontSize: 10, fill: '#94a3b8' }} width={28} />
                      <RechartsTooltip {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Line
                        yAxisId="sleep"
                        type="monotone"
                        dataKey="sleep_hours"
                        name={t.sleep}
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        dot={{ r: 2, fill: '#8b5cf6' }}
                        connectNulls
                      />
                      <Line
                        yAxisId="score"
                        type="monotone"
                        dataKey="focus"
                        name={t.focus}
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 2, fill: '#3b82f6' }}
                        connectNulls
                      />
                      <Line
                        yAxisId="score"
                        type="monotone"
                        dataKey="energy"
                        name={t.energy}
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ r: 2, fill: '#10b981' }}
                        connectNulls
                      />
                      <Line
                        yAxisId="score"
                        type="monotone"
                        dataKey="stress"
                        name={t.stress}
                        stroke="#f43f5e"
                        strokeWidth={2}
                        dot={{ r: 2, fill: '#f43f5e' }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartSection>

                <div className="grid md:grid-cols-2 gap-6">
                  <ChartSection title={t.moodTrend}>
                    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                      <AreaChart data={chartPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="moodFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                        <YAxis domain={[1, 4]} ticks={[1, 2, 3, 4]} tick={{ fontSize: 10, fill: '#94a3b8' }} width={28} />
                        <RechartsTooltip {...tooltipStyle} />
                        <Area
                          type="monotone"
                          dataKey="moodScore"
                          name={t.mood}
                          stroke="#6366f1"
                          strokeWidth={2}
                          fill="url(#moodFill)"
                          connectNulls
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartSection>

                  <ChartSection title={t.learningTime}>
                    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                      <BarChart data={chartPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={32} />
                        <RechartsTooltip {...tooltipStyle} />
                        <Bar dataKey="learning_min" name={t.learning} fill="#818cf8" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartSection>
                </div>

                <ChartSection
                  title={t.sleepVsFocus}
                  meta={summary.bestStreakInMonth > 0
                    ? `${t.bestStreakThisMonth}: ${summary.bestStreakInMonth} ${t.days}`
                    : undefined}
                >
                  {scatterPoints.length < 2 ? (
                    <p className="text-sm text-slate-400 text-center py-12">
                      {t.scatterNeedMore}
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                      <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis
                          type="number"
                          dataKey="sleep_hours"
                          name={t.sleep}
                          domain={[0, 12]}
                          tick={{ fontSize: 10, fill: '#94a3b8' }}
                          label={{ value: t.sleep, position: 'insideBottom', offset: -2, fontSize: 10, fill: '#94a3b8' }}
                        />
                        <YAxis
                          type="number"
                          dataKey="focus"
                          name={t.focus}
                          domain={[1, 5]}
                          tick={{ fontSize: 10, fill: '#94a3b8' }}
                          width={32}
                          label={{ value: t.focus, angle: -90, position: 'insideLeft', fontSize: 10, fill: '#94a3b8' }}
                        />
                        <RechartsTooltip
                          {...tooltipStyle}
                          cursor={{ strokeDasharray: '3 3' }}
                          formatter={(value: number, name: string) => [value, name]}
                          labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ''}
                        />
                        <Scatter data={scatterPoints} fill="#6366f1" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  )}
                </ChartSection>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <button
          type="button"
          onClick={() => onNavigate(ViewState.LIFE_JOURNAL_INSIGHTS)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-violet-600 hover:text-violet-700"
        >
          <Sparkles size={16} />
          {t.insights}
        </button>
        <button
          type="button"
          onClick={() => onNavigate(ViewState.LIFE_JOURNAL)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
        >
          <BookOpen size={16} />
          {t.backDaily}
        </button>
      </div>
    </div>
  );
};

const SummaryCard = ({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number }>;
  tone: 'indigo' | 'violet' | 'blue' | 'emerald' | 'amber' | 'rose' | 'slate';
}) => {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-700',
    violet: 'bg-violet-50 text-violet-700',
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    slate: 'bg-slate-50 text-slate-700',
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-3 py-3 shadow-sm">
      <div className={`inline-flex p-1.5 rounded-lg mb-2 ${tones[tone]}`}>
        <Icon size={14} />
      </div>
      <div className="text-lg font-bold text-slate-800 leading-tight">{value}</div>
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
};

const ChartSection = ({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="text-sm font-bold text-slate-700">{title}</h3>
      {meta && <span className="text-xs text-slate-400">{meta}</span>}
    </div>
    {children}
  </div>
);

export default LifeJournalMonthlyView;