import React, { useEffect, useState } from 'react';
import { BarChart3, BookOpen, Clock, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { useNavigate } from 'react-router-dom';

interface DigestStats {
  total_lessons: number;
  completed_lessons: number;
  completion_rate: number;
  completed_this_week: number;
}

interface WeeklyDigest {
  week_number: number;
  stats: DigestStats;
  completed_titles: string[];
  next_actions: { module_id: string; lesson_id: string; title: string }[];
  message: string;
}

interface WeeklyLoad {
  adjusted_minutes: number;
  adjustment: string;
  reason: string;
  suggestion?: string;
}

interface SummaryCard {
  lesson_id: string;
  module_id: string;
  title: string;
  key_points: string[];
  takeaway: string | null;
}

interface LearningInsightsWidgetProps {
  curriculumId?: string;
}

const LearningInsightsWidget: React.FC<LearningInsightsWidgetProps> = ({ curriculumId }) => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);
  const [load, setLoad] = useState<WeeklyLoad | null>(null);
  const [summaryCards, setSummaryCards] = useState<SummaryCard[]>([]);
  const [loading, setLoading] = useState(true);

  const t = language === 'jp' ? {
    title: '今週の学習',
    noData: '学習データがまだありません',
    completed: '完了',
    remaining: '残り',
    thisWeek: '今週',
    recommendedLoad: '推奨学習量',
    minutes: '分',
    keyPoints: '要点カード',
    viewAll: 'すべて見る',
    nextUp: '次のレッスン',
  } : {
    title: 'This Week',
    noData: 'No learning data yet',
    completed: 'Completed',
    remaining: 'Remaining',
    thisWeek: 'This week',
    recommendedLoad: 'Recommended load',
    minutes: 'min',
    keyPoints: 'Key Points',
    viewAll: 'View all',
    nextUp: 'Next up',
  };

  useEffect(() => {
    if (!curriculumId) {
      setLoading(false);
      return;
    }

    const base = '/api/v2';
    Promise.allSettled([
      fetch(`${base}/curricula/${curriculumId}/weekly-digest`).then(r => r.ok ? r.json() : null),
      fetch(`${base}/curricula/${curriculumId}/weekly-load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_load_minutes: 60 }),
      }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/curricula/${curriculumId}/summary-cards`).then(r => r.ok ? r.json() : null),
    ]).then(([digestR, loadR, cardsR]) => {
      if (digestR.status === 'fulfilled' && digestR.value) setDigest(digestR.value);
      if (loadR.status === 'fulfilled' && loadR.value) setLoad(loadR.value);
      if (cardsR.status === 'fulfilled' && cardsR.value?.cards) setSummaryCards(cardsR.value.cards.slice(0, 3));
    }).finally(() => setLoading(false));
  }, [curriculumId]);

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-100 bg-white/80 backdrop-blur p-6 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/3 mb-4" />
        <div className="h-20 bg-slate-100 rounded-xl" />
      </div>
    );
  }

  if (!curriculumId || !digest) return null;

  const { stats } = digest;
  const progressPercent = stats.completion_rate;

  return (
    <div className="rounded-3xl border border-slate-100 bg-white/80 backdrop-blur p-6 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
          <BarChart3 size={14} /> {t.title}
        </h3>
        {load && (
          <div className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 text-slate-600">
            <Clock size={12} />
            {t.recommendedLoad}: {load.adjusted_minutes}{t.minutes}
            {load.adjustment === 'reduced' && <TrendingDown size={12} className="text-amber-500" />}
            {load.adjustment === 'increased' && <TrendingUp size={12} className="text-emerald-500" />}
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-indigo-50 p-3 text-center">
          <div className="text-2xl font-bold text-indigo-700">{stats.completed_this_week}</div>
          <div className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">{t.thisWeek}</div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-center">
          <div className="text-2xl font-bold text-emerald-700">{stats.completed_lessons}</div>
          <div className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">{t.completed}</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-center">
          <div className="text-2xl font-bold text-slate-700">{stats.total_lessons - stats.completed_lessons}</div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{t.remaining}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>{digest.message}</span>
          <span className="font-semibold">{progressPercent}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {/* Next actions */}
      {digest.next_actions.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t.nextUp}</div>
          <div className="space-y-2">
            {digest.next_actions.slice(0, 2).map((action) => (
              <button
                key={`${action.module_id}:${action.lesson_id}`}
                onClick={() => curriculumId && navigate(`/generated-lesson/${curriculumId}?lesson=${action.lesson_id}`)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-indigo-50 text-left transition-colors group"
              >
                <BookOpen size={16} className="text-slate-400 group-hover:text-indigo-500 shrink-0" />
                <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-700 flex-1 truncate">{action.title}</span>
                <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Summary cards preview */}
      {summaryCards.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t.keyPoints}</div>
          <div className="space-y-2">
            {summaryCards.map((card) => (
              <div key={card.lesson_id} className="rounded-xl border border-slate-100 p-3">
                <div className="text-sm font-semibold text-slate-700 mb-1">{card.title}</div>
                <ul className="text-xs text-slate-500 space-y-0.5">
                  {card.key_points.slice(0, 2).map((pt, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-indigo-400 mt-0.5 shrink-0">-</span>
                      <span className="truncate">{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Load suggestion */}
      {load?.suggestion && (
        <p className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3 italic">{load.suggestion}</p>
      )}
    </div>
  );
};

export default LearningInsightsWidget;
