import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Clock, Layers } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';

interface EncyclopediaEntry {
  module_id: string;
  module_title: string;
  lessons: {
    lesson_id: string;
    title: string;
    subtitle: string;
    estimated_min: number;
  }[];
}

interface Encyclopedia {
  title: string;
  description: string;
  module_count: number;
  total_lessons: number;
  entries: EncyclopediaEntry[];
}

const EncyclopediaView: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [data, setData] = useState<Encyclopedia | null>(null);
  const [loading, setLoading] = useState(true);

  const t = language === 'jp' ? {
    back: 'コースに戻る',
    title: 'ミニ図鑑',
    subtitle: 'カリキュラム全体の俯瞰',
    modules: 'モジュール',
    lessons: 'レッスン',
    min: '分',
    empty: 'データがありません',
  } : {
    back: 'Back to course',
    title: 'Mini Encyclopedia',
    subtitle: 'Overview of the entire curriculum',
    modules: 'Modules',
    lessons: 'Lessons',
    min: 'min',
    empty: 'No data available',
  };

  useEffect(() => {
    if (!courseId) return;
    fetch(`/api/v2/curricula/${courseId}/encyclopedia`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [courseId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-8">
          <ArrowLeft size={18} /> {t.back}
        </button>
        <p className="text-center text-slate-400 mt-20">{t.empty}</p>
      </div>
    );
  }

  const totalMin = data.entries.reduce((s, m) => s + m.lessons.reduce((ls, l) => ls + l.estimated_min, 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <div className="bg-slate-900 text-white pt-8 pb-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/40 to-transparent" />
        <div className="max-w-3xl mx-auto px-6 relative z-10">
          <button onClick={() => navigate(`/generated-course/${courseId}`)} className="flex items-center gap-2 text-slate-300 hover:text-white mb-6 transition-colors">
            <ArrowLeft size={18} /> {t.back}
          </button>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <BookOpen size={20} />
            </div>
            <h1 className="text-2xl font-bold">{t.title}</h1>
          </div>
          <p className="text-slate-300 mb-6">{data.title} — {t.subtitle}</p>
          <div className="flex gap-4 text-sm">
            <span className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-full">
              <Layers size={14} /> {data.module_count} {t.modules}
            </span>
            <span className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-full">
              <BookOpen size={14} /> {data.total_lessons} {t.lessons}
            </span>
            <span className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-full">
              <Clock size={14} /> {totalMin}{t.min}
            </span>
          </div>
        </div>
      </div>

      {/* Entries */}
      <div className="max-w-3xl mx-auto px-6 -mt-8">
        <div className="space-y-6">
          {data.entries.map((module, mi) => (
            <div key={module.module_id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">
                    {mi + 1}
                  </span>
                  <h2 className="font-bold text-slate-800">{module.module_title}</h2>
                  <span className="ml-auto text-xs text-slate-400">{module.lessons.length} {t.lessons}</span>
                </div>
              </div>
              <div className="divide-y divide-slate-50">
                {module.lessons.map((lesson) => (
                  <button
                    key={lesson.lesson_id}
                    onClick={() => navigate(`/generated-lesson/${courseId}?lesson=${lesson.lesson_id}`)}
                    className="w-full px-6 py-4 text-left hover:bg-slate-50 transition-colors group flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-700 group-hover:text-indigo-700 transition-colors truncate">
                        {lesson.title}
                      </div>
                      {lesson.subtitle && (
                        <div className="text-xs text-slate-400 mt-0.5 truncate">{lesson.subtitle}</div>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0">
                      <Clock size={12} /> {lesson.estimated_min}{t.min}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default EncyclopediaView;
