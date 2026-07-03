import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Sparkles, BookOpen, ArrowRight, Trophy, Cpu } from 'lucide-react';
import { ViewState } from '../../../../types';
import { useLanguage } from '../../../../context/LanguageContext';
import { useTheme } from '../../../../context/ThemeContext';
import { getLearningEvents, LearningEvent } from '../../../../services/progressService';

interface ProfileHistoryViewProps {
  onNavigate: (view: ViewState) => void;
}

const typeIcon = (type: LearningEvent['type']) => {
  switch (type) {
    case 'lesson_complete':
    case 'stage_complete': return <CheckCircle2 className="w-full h-full" />;
    case 'course_complete': return <Trophy className="w-full h-full" />;
    case 'course_generated': return <Sparkles className="w-full h-full" />;
    case 'diagnosis_complete': return <Cpu className="w-full h-full" />;
    default: return <BookOpen className="w-full h-full" />;
  }
};

const formatDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
};

const ProfileHistoryView: React.FC<ProfileHistoryViewProps> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();
  const [events, setEvents] = useState<LearningEvent[]>([]);

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  useEffect(() => {
    setEvents(getLearningEvents());
  }, []);

  const copy = {
    en: {
      title: 'Learning History',
      subtitle: 'A timeline of your recent learning activities.',
      cta: 'Start a new lesson',
      empty: 'No learning activities yet. Start exploring courses!'
    },
    jp: {
      title: '学習履歴',
      subtitle: '最近の学習アクティビティのタイムライン。',
      cta: '新しい学習を始める',
      empty: 'まだ学習アクティビティがありません。コースを探索してみましょう！'
    }
  } as const;

  const t = copy[language];

  return (
    <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
      <div className="max-w-5xl mx-auto space-y-10">
        <header className="space-y-3">
          <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
          <p className="text-slate-500">{t.subtitle}</p>
        </header>

        <div className="rounded-[2.5rem] bg-white border border-slate-100 p-8 shadow-xl">
          {events.length === 0 ? (
            <p className="text-slate-400 text-center py-8">{t.empty}</p>
          ) : (
            <div className="space-y-6">
              {events.map((event) => (
                <div key={event.id} className="flex gap-4 items-start">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-sm">
                    {typeIcon(event.type)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 text-xs text-slate-400 uppercase tracking-[0.25em]">
                      <Calendar size={14} />
                      {formatDate(event.timestamp)}
                    </div>
                    <div className="text-lg font-semibold text-slate-800 mt-2">
                      {language === 'jp' ? event.title.jp : event.title.en}
                    </div>
                    <p className="text-sm text-slate-500 mt-2">
                      {language === 'jp' ? event.description.jp : event.description.en}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => onNavigate(ViewState.LEARNING_HUB)}
            className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-500 transition"
          >
            {t.cta} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileHistoryView;
