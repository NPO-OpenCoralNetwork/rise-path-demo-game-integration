import React, { useEffect, useMemo } from 'react';
import {
  Trophy,
  Sparkles,
  Flame,
  Shield,
  Medal,
  Crown,
  Gem,
  LockKeyhole
} from 'lucide-react';
import { useLanguage } from '../../../../context/LanguageContext';
import { useTheme } from '../../../../context/ThemeContext';
import { getLearningEvents, getAllProgress } from '../../../../services/progressService';

const ProfileBadgesView: React.FC = () => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  // Compute earned badges from real data
  const earned = useMemo(() => {
    const events = getLearningEvents();
    const progress = getAllProgress();
    const hasCompletedLesson = events.some(e => e.type === 'lesson_complete' || e.type === 'stage_complete');
    const hasGeneratedCourse = events.some(e => e.type === 'course_generated');
    const hasDiagnosis = events.some(e => e.type === 'diagnosis_complete');
    const completedCourses = Object.values(progress).filter(p => p.completedStages.length >= 3).length;
    return { hasCompletedLesson, hasGeneratedCourse, hasDiagnosis, completedCourses };
  }, []);

  const copy = {
    en: {
      title: 'Badges & Trophies',
      subtitle: 'Celebrate your milestones and next targets.',
      featuredTitle: 'Milestone Trophy',
      featuredBody: 'Awarded for your first AI curriculum build.',
      featuredTag: 'Legendary Reward'
    },
    jp: {
      title: 'バッジ & トロフィー',
      subtitle: '到達点と次の目標を見える化。',
      featuredTitle: 'マイルストーントロフィー',
      featuredBody: '初めてAIカリキュラムを生成した記念。',
      featuredTag: 'レジェンド報酬'
    }
  } as const;

  const t = copy[language];

  const badges = [
    {
      label: language === 'jp' ? 'レッスン完了' : 'First Lesson',
      icon: Flame,
      earned: earned.hasCompletedLesson,
      accent: 'from-orange-400 via-amber-400 to-yellow-300',
      glow: 'shadow-[0_18px_30px_rgba(251,146,60,0.35)]'
    },
    {
      label: language === 'jp' ? '初ビルド' : 'First Build',
      icon: Sparkles,
      earned: earned.hasGeneratedCourse,
      accent: 'from-sky-400 via-cyan-400 to-indigo-400',
      glow: 'shadow-[0_18px_30px_rgba(56,189,248,0.35)]'
    },
    {
      label: language === 'jp' ? 'AI探究者' : 'AI Explorer',
      icon: Gem,
      earned: earned.hasDiagnosis,
      accent: 'from-fuchsia-400 via-pink-400 to-rose-400',
      glow: 'shadow-[0_18px_30px_rgba(236,72,153,0.35)]'
    },
    {
      label: language === 'jp' ? '学習の守護者' : 'Learning Guardian',
      icon: Shield,
      earned: earned.completedCourses >= 1,
      accent: 'from-emerald-400 via-teal-400 to-cyan-400',
      glow: 'shadow-[0_18px_30px_rgba(45,212,191,0.2)]'
    },
    {
      label: language === 'jp' ? 'マスター' : 'Mastery',
      icon: Medal,
      earned: earned.completedCourses >= 3,
      accent: 'from-slate-400 via-slate-300 to-slate-200',
      glow: 'shadow-[0_18px_30px_rgba(148,163,184,0.2)]'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
      <div className="max-w-5xl mx-auto space-y-10">
        <header className="space-y-3">
          <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
          <p className="text-slate-500">{t.subtitle}</p>
        </header>

        <div className="grid lg:grid-cols-[1fr,1fr] gap-6">
          <div className={`rounded-[2.5rem] text-white p-8 shadow-2xl relative overflow-hidden ${earned.hasGeneratedCourse ? 'bg-slate-900' : 'bg-slate-600'}`}>
            <div className="absolute top-0 right-0 w-40 h-40 bg-indigo-500/30 rounded-full blur-2xl" />
            <div className="absolute bottom-0 left-8 w-32 h-32 bg-amber-400/20 rounded-full blur-3xl" />
            <div className="flex items-start gap-5 mb-6">
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-[28px] bg-gradient-to-br from-amber-400 via-yellow-300 to-orange-500 shadow-[0_25px_50px_rgba(251,191,36,0.35)]" />
                <div className="absolute inset-[3px] rounded-[24px] bg-gradient-to-b from-white/40 to-white/5 border border-white/40" />
                <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-emerald-300/60 blur-md" />
                <div className="relative z-10 w-full h-full flex items-center justify-center text-amber-950">
                  <Trophy className="w-9 h-9" />
                </div>
                <div className="absolute -bottom-2 -left-2 w-7 h-7 rounded-full bg-slate-900 flex items-center justify-center border border-white/20">
                  <Crown className="w-4 h-4 text-amber-300" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.3em] text-indigo-100">
                  {t.featuredTag}
                </div>
                <div className="text-xs font-bold uppercase tracking-[0.3em] text-indigo-200">{t.featuredTitle}</div>
              </div>
            </div>
            <div className="text-2xl font-semibold leading-tight">{t.featuredBody}</div>
          </div>

          <div className="rounded-[2.5rem] bg-white border border-slate-100 p-8 shadow-xl">
            <div className="grid grid-cols-2 gap-4">
              {badges.map((badge) => {
                const Icon = badge.icon;
                return (
                <div
                  key={badge.label}
                  className={`rounded-3xl border p-4 flex flex-col items-center text-center gap-3 shadow-sm ${
                    badge.earned
                      ? 'border-white/80 bg-white text-slate-800 shadow-indigo-100/60'
                      : 'border-slate-200 bg-slate-50 text-slate-400'
                  }`}
                >
                  <div className="relative">
                    <div
                      className={`absolute inset-0 rounded-[20px] bg-gradient-to-br ${
                        badge.earned ? badge.accent : 'from-slate-200 via-slate-100 to-white'
                      } ${badge.earned ? badge.glow : ''}`}
                    />
                    <div
                      className={`absolute inset-[2px] rounded-[18px] ${
                        badge.earned
                          ? 'bg-slate-950/20 border border-white/50'
                          : 'bg-white/70 border border-slate-200'
                      }`}
                    />
                    <div className="relative z-10 w-14 h-14 flex items-center justify-center">
                      <Icon
                        className={`w-7 h-7 ${
                          badge.earned ? 'text-white drop-shadow-[0_6px_12px_rgba(15,23,42,0.25)]' : 'text-slate-400'
                        }`}
                      />
                    </div>
                    {!badge.earned && (
                      <div className="absolute -bottom-2 -right-2 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-md">
                        <LockKeyhole className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>
                  <span className="text-xs font-bold tracking-wide">{badge.label}</span>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileBadgesView;
