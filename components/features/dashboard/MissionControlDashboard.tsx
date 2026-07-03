import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Brain,
  Compass,
  Flame,
  BookOpen,
  Sparkles,
  Target,
  Trophy,
  Zap,
  Wand2
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip as RechartsTooltip
} from 'recharts';
import { ViewState } from '../../../types';
import { useTheme } from '../../../context/ThemeContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { getTotalXp, getLevel, getStreak, getXpForNextLevel, getCompletedLessonsCount } from '../../../services/gamificationService';
import LearningInsightsWidget from './LearningInsightsWidget';
const LifeJournalWeeklyWidget = lazy(
  () => import('../life-journal/LifeJournalWeeklyWidget')
);

interface DashboardProps {
  onNavigate: (view: ViewState) => void;
}

const MissionControlDashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const { setTheme } = useTheme();
  const { language } = useLanguage();
  const { user: authUser } = useAuth();
  const [chartReady, setChartReady] = useState(false);
  const [levelNotice, setLevelNotice] = useState(true);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [showLevelToast, setShowLevelToast] = useState(false);
  const [showLevelCelebration, setShowLevelCelebration] = useState(false);
  const [achievementPopup, setAchievementPopup] = useState<{
    title: string;
    subtitle: string;
    body: string;
    reward?: string;
    progress?: { label: string; value: string; percent: number };
    icon: React.ComponentType<{ size?: number }>;
    accent: string;
  } | null>(null);
  const [showAchievementPopup, setShowAchievementPopup] = useState(false);
  const [levelValue, setLevelValue] = useState(() => getLevel());
  const [toastProgress, setToastProgress] = useState(0);
  const [toastXp, setToastXp] = useState(0);
  const levelUpTimer = useRef<number | null>(null);
  const levelToastTimer = useRef<number | null>(null);
  const levelValueTimer = useRef<number | null>(null);
  const levelCelebrateTimer = useRef<number | null>(null);
  const achievementTimer = useRef<number | null>(null);

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  useEffect(() => {
    setChartReady(true);
  }, []);

  useEffect(() => {
    return () => {
      if (levelUpTimer.current) {
        window.clearTimeout(levelUpTimer.current);
      }
      if (levelToastTimer.current) {
        window.clearTimeout(levelToastTimer.current);
      }
      if (levelValueTimer.current) {
        window.clearTimeout(levelValueTimer.current);
      }
      if (levelCelebrateTimer.current) {
        window.clearTimeout(levelCelebrateTimer.current);
      }
      if (achievementTimer.current) {
        window.clearTimeout(achievementTimer.current);
      }
    };
  }, []);

  const copy = {
    en: {
      heroKicker: 'Mission Control',
      heroTitle: 'Welcome back, Alex',
      heroSubtitle: 'Pick a lane, ship a win, and let AI do the heavy lifting.',
      streak: '3 day streak',
      weeklyHours: '2.5h this week',
      levelLabel: 'Level',
      levelUpTitle: 'Level Up!',
      levelUpBody: 'New rewards unlocked in your quest board.',
      streakPopupTitle: 'Streak Bonus',
      streakPopupBody: 'Keep your momentum for the 7-day reward.',
      streakPopupReward: '+40 XP today',
      streakPopupProgressLabel: 'Progress',
      streakPopupProgressValue: '3 / 7 days',
      badgePopupTitle: 'Badge Unlocked',
      badgePopupRewardLabel: 'Reward',
      badgePopupBodies: [
        'Three days in a row. Next reward at day 7.',
        'Your first AI curriculum shipped.',
        'Explored a new AI pathway.'
      ],
      badgePopupRewards: ['+30 XP', '+50 XP', '+40 XP'],
      primaryKicker: 'Now Playing',
      primaryTitle: 'Vibe Coding: The Engine',
      primaryDescription: 'Master OSS workflows with Codex as your co-pilot. You are 75% through Chapter 3.',
      primaryMeta: 'Chapter 3 • 25 min',
      primaryCta: 'Resume chapter',
      quickActions: 'Quick Actions',
      actionDiagnosisTitle: 'AI Learning Diagnosis',
      actionDiagnosisBody: '5-question demo assessment',
      actionJournalTitle: 'Life Journal',
      actionJournalBody: 'Log mood, sleep, and exercise',
      actionGeneratorTitle: 'AI Course Generator',
      actionGeneratorBody: 'Turn any topic into a path',
      actionHubTitle: 'Learning Hub',
      actionHubBody: 'Browse themed experiences',
      actionProfileTitle: 'Profile Passport',
      actionProfileBody: 'See your strengths',
      conditionTitle: 'Learning Condition',
      conditionSubtitle: 'Keep your pace sustainable.',
      conditionMeta: 'Last 7 days average',
      conditionItems: [
        { label: 'Focus', value: '82%', percent: 82, tone: 'indigo', note: 'Strong attention window' },
        { label: 'Energy', value: '64%', percent: 64, tone: 'emerald', note: 'Afternoons dip a bit' },
        { label: 'Sleep', value: '7h 10m', percent: 78, tone: 'amber', note: 'Average per night' }
      ],
      questBoardTitle: 'Quest Board',
      questBoardSubtitle: 'Complete quests to earn XP and unlock badges.',
      questSeeAll: 'See all quests',
      quests: [
        {
          title: '15-min Focus Sprint',
          description: 'Finish one focused block without distractions.',
          reward: '+40 XP',
          progress: '0 / 1',
          percent: 20,
          difficulty: '★',
          tone: 'indigo'
        },
        {
          title: 'AI Diagnosis',
          description: 'Run today’s 5-question assessment.',
          reward: '+30 XP',
          progress: '0 / 1',
          percent: 0,
          difficulty: '★★',
          tone: 'emerald'
        },
        {
          title: 'Lesson Complete',
          description: 'Finish one lesson in any track.',
          reward: '+60 XP',
          progress: '1 / 3',
          percent: 35,
          difficulty: '★★★',
          tone: 'amber'
        }
      ],
      aiCoachTitle: 'AI Coach',
      aiCoachSubtitle: 'Personalized guidance based on your focus, energy, and streak.',
      aiCoachMeta: 'Signals from the last 7 days',
      aiCoachCards: [
        { title: 'Best focus window', body: 'Schedule a 20-minute deep focus block around 20:30.', tag: 'Recommended' },
        { title: 'Low-energy fallback', body: 'If energy dips, switch to review + quiz for 10 minutes.', tag: 'Light' },
        { title: 'Streak protection', body: 'Keep the 3-day streak with a micro-task today.', tag: 'Streak' }
      ],
      aiScheduleTitle: 'Smart Schedule',
      aiScheduleSubtitle: 'Auto-adjusts when your energy drops.',
      aiScheduleSlots: [
        { time: 'Tue 20:30', label: 'Focus sprint (20m)' },
        { time: 'Thu 07:30', label: 'Review + quiz (10m)' },
        { time: 'Sat 11:00', label: 'Build session (45m)' }
      ],
      aiScheduleCta: 'Open planner',
      gamificationTitle: 'Level Up',
      gamificationSubtitle: 'Complete one quest to gain +40 XP.',
      gamificationMeta: 'Next reward at 500 XP',
      gamificationLevelLabel: 'Level',
      gamificationLevelValue: '12',
      gamificationXpLabel: 'XP Progress',
      gamificationXpValue: 340,
      gamificationXpGoal: 500,
      gamificationQuestTitle: 'Daily Quest',
      gamificationQuestBody: '15 min focus block',
      gamificationQuestReward: '+40 XP',
      gamificationBadges: ['Streak 3', 'First Build', 'AI Explorer'],
      momentumTitle: 'Momentum',
      momentumMeta: 'Total 2.5 hours this week',
      momentumCardTitle: 'Weekly goal',
      momentumCardValue: '75%',
      momentumCardBody: '3 sessions to hit 4h',
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    },
    jp: {
      heroKicker: 'ミッションコントロール',
      heroTitle: 'おかえりなさい、Alex',
      heroSubtitle: 'レーンを決めて、成果を出そう。重い作業はAIに任せる。',
      streak: '3日連続',
      weeklyHours: '今週 2.5h',
      levelLabel: 'レベル',
      levelUpTitle: 'レベルアップ！',
      levelUpBody: 'クエスト報酬が解放されました。',
      streakPopupTitle: '連続ボーナス',
      streakPopupBody: '7日連続でさらに報酬が増加します。',
      streakPopupReward: '本日 +40 XP',
      streakPopupProgressLabel: '進捗',
      streakPopupProgressValue: '3 / 7 日',
      badgePopupTitle: 'バッジ獲得',
      badgePopupRewardLabel: '報酬',
      badgePopupBodies: [
        '3日連続で学習を継続。次は7日を狙いましょう。',
        '初めてのAIカリキュラムを完成。',
        '新しいAIパスを探索。'
      ],
      badgePopupRewards: ['+30 XP', '+50 XP', '+40 XP'],
      primaryKicker: '再開ポイント',
      primaryTitle: 'Vibe Coding: The Engine',
      primaryDescription: 'Codexを相棒にOSSワークフローを攻略。第3章は75%完了。',
      primaryMeta: '第3章 • 25分',
      primaryCta: '続きから再開',
      quickActions: 'クイックアクション',
      actionDiagnosisTitle: 'AI学習診断',
      actionDiagnosisBody: '5問のデモ診断',
      actionJournalTitle: 'ライフジャーナル',
      actionJournalBody: '気分・睡眠・運動を記録',
      actionGeneratorTitle: 'AIコース生成',
      actionGeneratorBody: '任意トピックを学習パス化',
      actionHubTitle: 'ラーニングハブ',
      actionHubBody: 'テーマ別体験を一覧',
      actionProfileTitle: 'プロフィール',
      actionProfileBody: '強みを可視化',
      conditionTitle: '学習コンディション',
      conditionSubtitle: '無理なく続けるための指標',
      conditionMeta: '直近7日平均',
      conditionItems: [
        { label: '集中度', value: '82%', percent: 82, tone: 'indigo', note: '集中の持続が良好' },
        { label: 'エネルギー', value: '64%', percent: 64, tone: 'emerald', note: '午後に少し低下' },
        { label: '睡眠', value: '7h 10m', percent: 78, tone: 'amber', note: '平均 7時間10分' }
      ],
      questBoardTitle: 'クエストボード',
      questBoardSubtitle: 'クエスト達成でXPとバッジを獲得。',
      questSeeAll: 'すべてのクエスト',
      quests: [
        {
          title: '集中15分スプリント',
          description: '集中ブロックを1回完了する。',
          reward: '+40 XP',
          progress: '0 / 1',
          percent: 20,
          difficulty: '★',
          tone: 'indigo'
        },
        {
          title: 'AI学習診断',
          description: '5問の診断を実施する。',
          reward: '+30 XP',
          progress: '0 / 1',
          percent: 0,
          difficulty: '★★',
          tone: 'emerald'
        },
        {
          title: 'レッスン完了',
          description: '任意のレッスンを1つ完了する。',
          reward: '+60 XP',
          progress: '1 / 3',
          percent: 35,
          difficulty: '★★★',
          tone: 'amber'
        }
      ],
      aiCoachTitle: 'AIコーチ',
      aiCoachSubtitle: '集中・体力・継続データから最適な提案。',
      aiCoachMeta: '直近7日間のシグナル',
      aiCoachCards: [
        { title: '最適な集中時間', body: '20:30 前後に20分の集中ブロックを提案。', tag: 'おすすめ' },
        { title: '低エネルギー時', body: '疲れている日はレビュー＋クイズ10分に切替。', tag: '軽量' },
        { title: '継続ボーナス維持', body: '3日連続を守るためにミニタスクを提案。', tag: 'ストリーク' }
      ],
      aiScheduleTitle: 'スマートスケジュール',
      aiScheduleSubtitle: '体調が落ちたら自動で軽量タスクに切り替え。',
      aiScheduleSlots: [
        { time: '火 20:30', label: '集中スプリント (20分)' },
        { time: '木 07:30', label: 'レビュー＋クイズ (10分)' },
        { time: '土 11:00', label: 'ビルドセッション (45分)' }
      ],
      aiScheduleCta: 'プランナーを開く',
      gamificationTitle: 'レベルアップ',
      gamificationSubtitle: 'クエスト達成で +40 XP',
      gamificationMeta: '次の報酬まで 500 XP',
      gamificationLevelLabel: 'レベル',
      gamificationLevelValue: '12',
      gamificationXpLabel: 'XP 進捗',
      gamificationXpValue: 340,
      gamificationXpGoal: 500,
      gamificationQuestTitle: 'デイリークエスト',
      gamificationQuestBody: '集中15分チャレンジ',
      gamificationQuestReward: '+40 XP',
      gamificationBadges: ['連続3日', '初ビルド', 'AIエクスプローラー'],
      momentumTitle: 'モメンタム',
      momentumMeta: '今週合計 2.5 時間',
      momentumCardTitle: '週間ゴール',
      momentumCardValue: '75%',
      momentumCardBody: 'あと3セッションで4h達成',
      days: ['月', '火', '水', '木', '金', '土', '日']
    }
  } as const;

  const t = copy[language];

  // Real gamification data
  const realXp = getTotalXp();
  const realLevel = getLevel();
  const realStreak = getStreak();
  const xpNext = getXpForNextLevel();
  const completedLessons = getCompletedLessonsCount();
  const userName = authUser?.name || 'Explorer';

  const baseXp = xpNext.current;
  const goalXp = xpNext.goal;
  const startPercent = Math.min(100, Math.round((baseXp / goalXp) * 100));
  const levelText = `${t.levelLabel} ${realLevel}`;
  const streakProgress = {
    label: t.streakPopupProgressLabel,
    value: `${realStreak} / 7 ${language === 'jp' ? '日' : 'days'}`,
    percent: Math.min(100, Math.round((realStreak / 7) * 100))
  };

  const activityData = useMemo(() => (
    t.days.map((day, index) => ({
      day,
      count: [12, 18, 15, 25, 20, 8, 30][index]
    }))
  ), [t.days]);
  const conditionToneMap = {
    indigo: 'bg-indigo-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500'
  } as const;
  const questToneMap = {
    indigo: {
      ring: 'ring-indigo-200/70',
      glow: 'from-indigo-500/20 via-sky-500/10 to-transparent',
      icon: 'bg-indigo-500 text-white',
      bar: 'bg-indigo-500'
    },
    emerald: {
      ring: 'ring-emerald-200/70',
      glow: 'from-emerald-500/20 via-teal-500/10 to-transparent',
      icon: 'bg-emerald-500 text-white',
      bar: 'bg-emerald-500'
    },
    amber: {
      ring: 'ring-amber-200/80',
      glow: 'from-amber-400/20 via-orange-400/10 to-transparent',
      icon: 'bg-amber-500 text-white',
      bar: 'bg-amber-500'
    }
  } as const;

  const triggerLevelUp = () => {
    setLevelNotice(false);
    setShowLevelUp(false);
    setShowLevelToast(true);
    setToastProgress(startPercent);
    setToastXp(baseXp);
    if (levelUpTimer.current) {
      window.clearTimeout(levelUpTimer.current);
    }
    if (levelToastTimer.current) {
      window.clearTimeout(levelToastTimer.current);
    }
    if (levelValueTimer.current) {
      window.clearTimeout(levelValueTimer.current);
    }
    if (levelCelebrateTimer.current) {
      window.clearTimeout(levelCelebrateTimer.current);
    }
    requestAnimationFrame(() => setShowLevelUp(true));
    requestAnimationFrame(() => setToastProgress(100));
    levelUpTimer.current = window.setTimeout(() => setShowLevelUp(false), 1200);
    levelToastTimer.current = window.setTimeout(() => setShowLevelToast(false), 2000);
    levelValueTimer.current = window.setTimeout(() => {
      setToastXp(goalXp);
      setLevelValue(13);
      setShowLevelCelebration(true);
      levelCelebrateTimer.current = window.setTimeout(() => setShowLevelCelebration(false), 900);
    }, 900);
  };

  const triggerAchievementPopup = (data: {
    title: string;
    subtitle: string;
    body: string;
    reward?: string;
    progress?: { label: string; value: string; percent: number };
    icon: React.ComponentType<{ size?: number }>;
    accent: string;
  }) => {
    setAchievementPopup(data);
    setShowAchievementPopup(false);
    if (achievementTimer.current) {
      window.clearTimeout(achievementTimer.current);
    }
    requestAnimationFrame(() => setShowAchievementPopup(true));
    achievementTimer.current = window.setTimeout(() => setShowAchievementPopup(false), 2200);
  };

  return (
    <div className="relative overflow-hidden p-4 sm:p-6 lg:p-10 max-w-[1200px] xl:max-w-[1280px] w-full mx-auto min-h-screen">
      <div
        className={`absolute right-4 md:right-6 top-6 md:top-8 z-50 w-[88vw] max-w-[320px] rounded-2xl border border-indigo-200/60 bg-white/95 px-5 py-4 shadow-xl backdrop-blur transition-all duration-300 ${
          showLevelToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3 pointer-events-none'
        } ${showLevelCelebration ? 'level-toast-glow' : ''}`}
      >
        <div className={`level-toast-confetti ${showLevelCelebration ? 'level-toast-confetti-active' : ''}`}>
          <span className="level-confetti" style={{ ['--x' as any]: '-16px', ['--y' as any]: '10px', ['--delay' as any]: '0ms', ['--size' as any]: '6px', ['--hue' as any]: '38' }} />
          <span className="level-confetti" style={{ ['--x' as any]: '12px', ['--y' as any]: '12px', ['--delay' as any]: '60ms', ['--size' as any]: '5px', ['--hue' as any]: '210' }} />
          <span className="level-confetti" style={{ ['--x' as any]: '22px', ['--y' as any]: '-6px', ['--delay' as any]: '90ms', ['--size' as any]: '4px', ['--hue' as any]: '280' }} />
          <span className="level-confetti" style={{ ['--x' as any]: '-22px', ['--y' as any]: '-8px', ['--delay' as any]: '120ms', ['--size' as any]: '5px', ['--hue' as any]: '120' }} />
          <span className="level-confetti" style={{ ['--x' as any]: '4px', ['--y' as any]: '-14px', ['--delay' as any]: '150ms', ['--size' as any]: '4px', ['--hue' as any]: '24' }} />
        </div>
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-300 via-yellow-200 to-rose-200 text-amber-900 flex items-center justify-center shadow-md">
            <Trophy size={18} />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-bold uppercase tracking-[0.24em] text-indigo-500">{t.levelUpTitle}</div>
            <div className="text-sm font-semibold text-slate-900">{levelText}</div>
            <div className="text-xs text-slate-500">{t.levelUpBody}</div>
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>XP</span>
                <span className="font-semibold text-slate-700">{toastXp} / {goalXp}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="level-toast-bar h-2 rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-indigo-400"
                  style={{ width: `${toastProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      {achievementPopup && (
        <div
          className={`absolute right-4 md:right-6 top-28 md:top-32 z-40 w-[84vw] max-w-[280px] rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur transition-all duration-300 ${
            showAchievementPopup ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
          }`}
        >
          <div className="flex items-start gap-3">
            {(() => {
              const PopupIcon = achievementPopup.icon;
              return (
                <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${achievementPopup.accent} text-white flex items-center justify-center shadow-md`}>
                  <PopupIcon size={18} />
                </div>
              );
            })()}
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-500">{achievementPopup.title}</div>
              <div className="text-sm font-semibold text-slate-900">{achievementPopup.subtitle}</div>
              <div className="text-xs text-slate-500">{achievementPopup.body}</div>
              {achievementPopup.reward && (
                <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  {t.badgePopupRewardLabel}: {achievementPopup.reward}
                </div>
              )}
              {achievementPopup.progress && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>{achievementPopup.progress.label}</span>
                    <span className="font-semibold text-slate-700">{achievementPopup.progress.value}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-300"
                      style={{ width: `${achievementPopup.progress.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute -top-40 -right-40 h-[420px] w-[420px] rounded-full bg-gradient-to-br from-indigo-400/40 via-purple-300/20 to-transparent blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-[360px] w-[360px] rounded-full bg-gradient-to-tr from-emerald-200/40 via-sky-200/20 to-transparent blur-[120px]" />

      <div className="space-y-10">
        <header className="relative z-10 flex flex-col gap-6 dashboard-fade" style={{ animationDelay: '40ms' }}>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t.heroKicker}</p>
              <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl text-slate-900 mt-2 break-words">{language === 'jp' ? `おかえりなさい、${userName}` : `Welcome back, ${userName}`}</h1>
              <p className="text-slate-500 mt-3 max-w-xl break-words">{t.heroSubtitle}</p>
            </div>
            <div className="flex flex-wrap gap-3">
            <StatPill
              icon={Flame}
              label={language === 'jp' ? `${realStreak}日連続` : `${realStreak} day streak`}
              tone="orange"
              delay="120ms"
              onClick={() =>
                triggerAchievementPopup({
                  title: t.streakPopupTitle,
                  subtitle: language === 'jp' ? `${realStreak}日連続` : `${realStreak} day streak`,
                  body: t.streakPopupBody,
                  reward: `+${realStreak * 10} XP`,
                  progress: streakProgress,
                  icon: Flame,
                  accent: 'from-orange-400 via-amber-300 to-yellow-300'
                })
              }
            />
            <StatPill icon={Target} label={t.weeklyHours} tone="indigo" delay="200ms" />
              <StatPill
                icon={Trophy}
                label={levelText}
                tone="emerald"
                delay="280ms"
                notify={levelNotice}
                animate={showLevelUp}
                onClick={triggerLevelUp}
              />
            </div>
          </div>
        </header>

        <section className="grid lg:grid-cols-[1.15fr,0.85fr] gap-6">
          <div className="relative overflow-hidden rounded-3xl bg-slate-900 text-white p-6 sm:p-7 md:p-8 shadow-xl dashboard-fade-float min-w-0" style={{ animationDelay: '120ms' }}>
            <div className="pointer-events-none absolute -top-16 right-0 h-64 w-64 rounded-full bg-purple-500/30 blur-[90px] dashboard-glow" />
            <div className="pointer-events-none absolute bottom-0 left-10 h-44 w-44 rounded-full bg-emerald-400/20 blur-[80px] dashboard-glow" />
            <div className="relative z-10 space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.25em] text-slate-300">
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">{t.primaryKicker}</span>
                <span>{t.primaryMeta}</span>
              </div>
              <div>
                <h2 className="font-serif text-2xl md:text-3xl break-words">{t.primaryTitle}</h2>
                <p className="text-slate-300 mt-3 text-sm md:text-base max-w-xl break-words">{t.primaryDescription}</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(ViewState.VIBE_PATH)}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-slate-900 font-semibold shadow-lg shadow-white/20 hover:bg-purple-50 transition"
              >
                {t.primaryCta} <ArrowUpRight size={18} />
              </button>
            </div>
          </div>

          <div className="dashboard-fade min-w-0" style={{ animationDelay: '200ms' }}>
            <Suspense fallback={<div className="h-40 animate-pulse rounded-3xl bg-slate-100/80" aria-hidden />}>
              <LifeJournalWeeklyWidget onNavigate={onNavigate} />
            </Suspense>
          </div>
        </section>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="rounded-3xl border border-slate-100 bg-white/80 backdrop-blur p-6 shadow-sm dashboard-fade min-w-0" style={{ animationDelay: '280ms' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">{t.quickActions}</h3>
          </div>
          <div className="grid gap-3">
            <ActionCard
              title={t.actionDiagnosisTitle}
              description={t.actionDiagnosisBody}
              icon={Brain}
              tone="indigo"
              onClick={() => onNavigate(ViewState.AI_DIAGNOSIS)}
            />
            <ActionCard
              title={t.actionJournalTitle}
              description={t.actionJournalBody}
              icon={BookOpen}
              tone="amber"
              onClick={() => onNavigate(ViewState.LIFE_JOURNAL)}
            />
            <ActionCard
              title={t.actionGeneratorTitle}
              description={t.actionGeneratorBody}
              icon={Wand2}
              tone="emerald"
              onClick={() => onNavigate(ViewState.COURSE_GENERATOR)}
            />
            <ActionCard
              title={t.actionHubTitle}
              description={t.actionHubBody}
              icon={Compass}
              tone="amber"
              onClick={() => onNavigate(ViewState.LEARNING_HUB)}
            />
            <ActionCard
              title={t.actionProfileTitle}
              description={t.actionProfileBody}
              icon={Sparkles}
              tone="rose"
              onClick={() => onNavigate(ViewState.PROFILE)}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white/80 backdrop-blur p-6 shadow-sm dashboard-fade min-w-0" style={{ animationDelay: '320ms' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">{t.questBoardTitle}</h3>
              <p className="text-xs text-slate-500 mt-2">{t.questBoardSubtitle}</p>
            </div>
            <button className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 transition-colors">
              {t.questSeeAll}
            </button>
          </div>
          <div className="space-y-3">
            {t.quests.map((quest, index) => {
              const styles = questToneMap[quest.tone as keyof typeof questToneMap];
              return (
                <div
                  key={quest.title}
                  className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ${styles.ring}`}
                >
                  <div className="relative z-10 flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${styles.icon} shadow-md`}>
                      <Sparkles size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h4 className="font-semibold text-slate-800 break-words min-w-0 flex-1">{quest.title}</h4>
                        <span className="text-xs font-semibold text-slate-500 shrink-0">{quest.difficulty}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{quest.description}</p>
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>{quest.progress}</span>
                          <span className="font-semibold text-emerald-600">{quest.reward}</span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-slate-100">
                          <div
                            className={`h-2 rounded-full ${styles.bar} dashboard-progress`}
                            style={{ ['--progress' as any]: `${quest.percent}%` } as React.CSSProperties}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-100 bg-white/90 backdrop-blur p-6 sm:p-8 shadow-sm dashboard-fade min-w-0" style={{ animationDelay: '380ms' }}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{t.aiCoachTitle}</p>
            <h3 className="text-2xl font-semibold text-slate-900 mt-2 break-words">{t.aiCoachSubtitle}</h3>
            <p className="text-sm text-slate-500 mt-2 break-words">{t.aiCoachMeta}</p>
          </div>
          <div className="h-12 w-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Brain size={22} />
          </div>
        </div>
        <div className="grid md:grid-cols-[1.1fr,0.9fr] gap-6 mt-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 min-w-0">
            {t.aiCoachCards.map((card) => (
              <div key={card.title} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm min-w-0">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Sparkles size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-800 break-words min-w-0 flex-1">{card.title}</div>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full shrink-0">
                        {card.tag}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 break-words">{card.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl bg-slate-900 text-white p-5 flex flex-col gap-4 min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
              <Zap size={14} />
              {t.aiScheduleTitle}
            </div>
            <p className="text-sm text-slate-300 break-words">{t.aiScheduleSubtitle}</p>
            <div className="space-y-2">
              {t.aiScheduleSlots.map((slot) => (
                <div key={`${slot.time}-${slot.label}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 flex items-center gap-3 min-w-0">
                  <div className="text-sm font-semibold text-white shrink-0">{slot.time}</div>
                  <div className="text-xs text-slate-300 break-words">{slot.label}</div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-slate-900 text-sm font-semibold shadow-lg shadow-white/20 hover:bg-indigo-50 transition"
            >
              {t.aiScheduleCta} <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-100 bg-white p-6 sm:p-8 shadow-sm dashboard-fade min-w-0" style={{ animationDelay: '460ms' }}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-6">
          <h3 className="text-slate-800 font-bold">{t.momentumTitle}</h3>
          <span className="text-sm text-slate-400">{t.momentumMeta}</span>
        </div>
        <div className="grid md:grid-cols-[1fr,220px] gap-6 items-stretch">
          <div className="h-[140px] w-full min-w-[220px]">
            {chartReady && (
              <ResponsiveContainer width="100%" height="100%" minWidth={220} minHeight={120}>
                <AreaChart data={activityData}>
                  <defs>
                    <linearGradient id="momentumStroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#818cf8" />
                      <stop offset="100%" stopColor="#38bdf8" />
                    </linearGradient>
                    <filter id="momentumGlow" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="6" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#6366f1"
                    strokeOpacity={0.35}
                    strokeWidth={10}
                    fill="transparent"
                    filter="url(#momentumGlow)"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="url(#momentumStroke)"
                    strokeWidth={3}
                    fill="transparent"
                    dot={{ r: 4, fill: '#cbd5e1', strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: '#6366f1' }}
                  />
                  <RechartsTooltip
                    contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '10px', color: 'white' }}
                    itemStyle={{ color: 'white' }}
                    cursor={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="rounded-2xl bg-slate-900 text-white p-5 flex flex-col justify-between">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{t.momentumCardTitle}</div>
            <div className="text-3xl font-bold">{t.momentumCardValue}</div>
            <div className="text-sm text-slate-300">{t.momentumCardBody}</div>
          </div>
        </div>
      </section>

      {/* Learning Insights (powered by personalization APIs) */}
      <section className="dashboard-fade" style={{ animationDelay: '500ms' }}>
        <LearningInsightsWidget curriculumId={localStorage.getItem('active_curriculum_id') || undefined} />
      </section>
    </div>
  </div>
  );
};

const StatPill = ({
  icon: Icon,
  label,
  tone,
  delay,
  notify,
  animate,
  onClick
}: {
  icon: any;
  label: string;
  tone: 'orange' | 'indigo' | 'emerald';
  delay?: string;
  notify?: boolean;
  animate?: boolean;
  onClick?: () => void;
}) => {
  const toneMap = {
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100'
  };
  const Element = onClick ? 'button' : 'div';
  const elementProps = onClick ? { type: 'button' as const, onClick } : {};
  return (
    <Element
      {...elementProps}
      className={`relative rounded-full border px-4 py-2 text-sm font-semibold dashboard-pop ${toneMap[tone]}`}
      style={delay ? { animationDelay: delay } : undefined}
    >
      {notify && <span className="level-notify-dot" />}
      {animate && (
        <>
          <span className="level-up-flare" />
          <span className="level-burst" />
          <span className="level-burst level-burst-second" />
        </>
      )}
      <span className={`level-pill-body ${animate ? 'level-up-pop' : ''}`}>
        <Icon size={16} />
        {label}
      </span>
    </Element>
  );
};

const ActionCard = ({
  title,
  description,
  icon: Icon,
  tone,
  onClick
}: {
  title: string;
  description: string;
  icon: any;
  tone: 'indigo' | 'emerald' | 'amber' | 'rose';
  onClick: () => void;
}) => {
  const toneMap = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100'
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md min-w-0"
    >
      <div className={`h-11 w-11 rounded-xl border flex items-center justify-center ${toneMap[tone]}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-800 break-words">{title}</div>
        <div className="text-xs text-slate-500 break-words">{description}</div>
      </div>
      <ArrowUpRight size={18} className="text-slate-400 group-hover:text-slate-600 transition" />
    </button>
  );
};

export default MissionControlDashboard;
