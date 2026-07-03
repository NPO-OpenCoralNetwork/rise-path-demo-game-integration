import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Frown,
  HeartPulse,
  Meh,
  Moon,
  Save,
  Smile,
  ThumbsUp,
  Dumbbell,
  Sparkles,
  Droplets,
  Coffee,
  Leaf,
  CupSoda,
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import {
  getLifeJournalDaily,
  saveLifeJournalDaily,
  type LifeJournalMood,
  type LifeJournalDailyEntry,
} from '../../../services/lifeJournalApi';
import {
  type DrinkType,
  DRINK_TYPES,
  drinkFieldsFromLifestyle,
  getLocalDateString,
  lifestyleDrinkPatch,
  shiftDate,
} from './lifeJournalMetrics';

const DRINK_ICONS: Record<DrinkType, typeof Droplets> = {
  water: Droplets,
  coffee: Coffee,
  tea: Leaf,
  other: CupSoda,
};

interface LifeJournalViewProps {
  onNavigate: (view: ViewState) => void;
}

const MOODS = [
  { value: 'great' as LifeJournalMood, icon: Smile, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { value: 'good' as LifeJournalMood, icon: ThumbsUp, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { value: 'okay' as LifeJournalMood, icon: Meh, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { value: 'struggled' as LifeJournalMood, icon: Frown, color: 'text-rose-600 bg-rose-50 border-rose-200' },
];

const EXERCISE_INTENSITIES = ['none', 'light', 'moderate', 'hard'] as const;
const SAVE_COUNT_KEY = 'rp_life_journal_save_count';
const ADVANCED_UNLOCK_SAVES = 7;

const LifeJournalView: React.FC<LifeJournalViewProps> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();

  const [entryDate, setEntryDate] = useState(getLocalDateString);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [learning, setLearning] = useState<LifeJournalDailyEntry['learning'] | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [mood, setMood] = useState<LifeJournalMood | null>(null);
  const [energy, setEnergy] = useState(3);
  const [focus, setFocus] = useState(3);
  const [stress, setStress] = useState(3);
  const [confidence, setConfidence] = useState(3);
  const [diaryText, setDiaryText] = useState('');
  const [sleepHours, setSleepHours] = useState<string>('');
  const [sleepQuality, setSleepQuality] = useState(3);
  const [exerciseMin, setExerciseMin] = useState<string>('');
  const [exerciseIntensity, setExerciseIntensity] = useState<(typeof EXERCISE_INTENSITIES)[number]>('none');
  const [mealBalance, setMealBalance] = useState(3);
  const [breakfast, setBreakfast] = useState(false);
  const [drinkType, setDrinkType] = useState<DrinkType | null>(null);
  const [drinkCups, setDrinkCups] = useState<string>('');
  const [caffeineAfter15h, setCaffeineAfter15h] = useState(false);

  const saveCount = useMemo(() => Number(localStorage.getItem(SAVE_COUNT_KEY) || '0'), [saved]);
  const advancedUnlocked = saveCount >= ADVANCED_UNLOCK_SAVES;

  const resetForm = useCallback(() => {
    setMood(null);
    setEnergy(3);
    setFocus(3);
    setStress(3);
    setConfidence(3);
    setDiaryText('');
    setSleepHours('');
    setSleepQuality(3);
    setExerciseMin('');
    setExerciseIntensity('none');
    setMealBalance(3);
    setBreakfast(false);
    setDrinkType(null);
    setDrinkCups('');
    setCaffeineAfter15h(false);
    setLearning(null);
    setSaved(false);
  }, []);

  const copy = {
    en: {
      title: 'Life Journal',
      subtitle: 'Track mood, habits, and learning — in about 30 seconds.',
      date: 'Date',
      mood: 'How do you feel?',
      energy: 'Energy',
      focus: 'Focus',
      stress: 'Stress',
      confidence: 'Confidence',
      sleep: 'Sleep (hours)',
      sleepQuality: 'Sleep quality',
      exercise: 'Exercise (min)',
      intensity: 'Intensity',
      meals: 'Meal balance',
      breakfast: 'Had breakfast',
      drinks: 'Hydration & drinks',
      drinksHint: 'What did you mainly drink today?',
      drinkCups: 'Cups / servings',
      caffeineAfter15h: 'Caffeine after 3 p.m.',
      drinkTypes: { water: 'Water', coffee: 'Coffee', tea: 'Tea', other: 'Other' },
      diary: 'Free notes',
      diaryPlaceholder: 'Anything worth remembering about today?',
      learningToday: 'Learning today',
      learningMin: 'min studied',
      lessons: 'lesson reflections',
      save: 'Save entry',
      saved: 'Saved!',
      copyYesterday: 'Copy yesterday',
      showMore: 'Add more details',
      showLess: 'Show less',
      disclaimer: 'Wellness tips only — not medical or nutritional advice.',
      monthly: 'Monthly overview',
      insights: 'Insights & patterns',
      habitChat: 'Ask AI coach',
      backDiagnosis: 'View AI diagnosis',
      moods: { great: 'Great', good: 'Good', okay: 'Okay', struggled: 'Struggled' },
      intensities: { none: 'None', light: 'Light', moderate: 'Moderate', hard: 'Hard' },
      unlockHint: 'Keep logging — detailed fields unlock after 7 entries.',
    },
    jp: {
      title: 'ライフジャーナル',
      subtitle: '気分・生活習慣・学習を約30秒で記録。',
      date: '日付',
      mood: '今日の気分は？',
      energy: 'エネルギー',
      focus: '集中度',
      stress: 'ストレス',
      confidence: '自信度',
      sleep: '睡眠（時間）',
      sleepQuality: '睡眠の質',
      exercise: '運動（分）',
      intensity: '強度',
      meals: '食事バランス',
      breakfast: '朝食を食べた',
      drinks: '水分・飲み物',
      drinksHint: '今日の水分補給は主に？',
      drinkCups: '杯数',
      caffeineAfter15h: '15時以降にカフェイン',
      drinkTypes: { water: '水', coffee: 'コーヒー', tea: 'お茶', other: 'その他' },
      diary: '自由メモ',
      diaryPlaceholder: '今日印象に残ったことは？',
      learningToday: '今日の学習',
      learningMin: '分 学習',
      lessons: '件 振り返り',
      save: '保存する',
      saved: '保存しました',
      copyYesterday: '昨日と同じ',
      showMore: '詳細を追加',
      showLess: '詳細を閉じる',
      disclaimer: 'ウェルネスの参考情報です。医療・栄養のアドバイスではありません。',
      monthly: '月間サマリー',
      insights: 'インサイト',
      habitChat: 'AI コーチに質問',
      backDiagnosis: 'AI診断を見る',
      moods: { great: '最高', good: '良い', okay: '普通', struggled: '難しい' },
      intensities: { none: 'なし', light: '軽い', moderate: '中', hard: '高' },
      unlockHint: '7回記録すると詳細項目が使えるようになります。',
    },
  } as const;

  const t = copy[language];

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  const applyEntry = useCallback((entry: LifeJournalDailyEntry) => {
    const r = entry.reflection;
    const l = entry.lifestyle;
    setMood(r?.mood ?? null);
    setEnergy(r?.energy ?? 3);
    setFocus(r?.focus ?? 3);
    setStress(r?.stress ?? 3);
    setConfidence(r?.confidence ?? 3);
    setDiaryText(r?.diary_text ?? '');
    setSleepHours(l?.sleep_hours != null ? String(l.sleep_hours) : '');
    setSleepQuality(l?.sleep_quality ?? 3);
    setExerciseMin(l?.exercise_min != null ? String(l.exercise_min) : '');
    setExerciseIntensity((l?.exercise_intensity as typeof exerciseIntensity) ?? 'none');
    setMealBalance(l?.meal_balance ?? 3);
    setBreakfast(Boolean(l?.meals?.breakfast?.ate));
    const drinks = drinkFieldsFromLifestyle(l);
    setDrinkType(drinks.drinkType);
    setDrinkCups(drinks.drinkCups);
    setCaffeineAfter15h(drinks.caffeineAfter15h);
    setLearning(entry.learning);
  }, []);

  const loadEntry = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const entry = await getLifeJournalDaily(date);
      applyEntry(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      resetForm();
    } finally {
      setLoading(false);
    }
  }, [applyEntry, resetForm]);

  useEffect(() => {
    loadEntry(entryDate);
  }, [entryDate, loadEntry]);

  const handleCopyYesterday = async () => {
    const yesterday = shiftDate(entryDate, -1);
    try {
      const entry = await getLifeJournalDaily(yesterday);
      applyEntry(entry);
      setSaved(false);
    } catch {
      setError(language === 'jp' ? '昨日の記録がありません' : 'No entry for yesterday');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const reflection: Record<string, unknown> = {};
      if (mood) reflection.mood = mood;
      if (showAdvanced || advancedUnlocked) {
        reflection.energy = energy;
        reflection.focus = focus;
        reflection.stress = stress;
        reflection.confidence = confidence;
        if (diaryText.trim()) reflection.diary_text = diaryText.trim();
      }

      const lifestyle: Record<string, unknown> = {};
      if (sleepHours) lifestyle.sleep_hours = Number(sleepHours);
      if (showAdvanced || advancedUnlocked) lifestyle.sleep_quality = sleepQuality;
      if (exerciseMin) lifestyle.exercise_min = Number(exerciseMin);
      if (exerciseIntensity !== 'none') lifestyle.exercise_intensity = exerciseIntensity;
      if (showAdvanced || advancedUnlocked) {
        lifestyle.meal_balance = mealBalance;
        lifestyle.meals = { breakfast: { ate: breakfast, balance: breakfast ? mealBalance : undefined } };
      }

      Object.assign(lifestyle, lifestyleDrinkPatch(drinkType, drinkCups, caffeineAfter15h));

      const hasReflection = Object.keys(reflection).length > 0;
      const hasLifestyle = Object.keys(lifestyle).length > 0;
      if (!hasReflection && !hasLifestyle) {
        setError(language === 'jp' ? '1つ以上入力してください' : 'Enter at least one field');
        return;
      }

      const savedEntry = await saveLifeJournalDaily(
        entryDate,
        {
          reflection: hasReflection ? reflection : undefined,
          lifestyle: hasLifestyle ? lifestyle : undefined,
        },
      );
      applyEntry(savedEntry);
      const nextCount = saveCount + 1;
      localStorage.setItem(SAVE_COUNT_KEY, String(nextCount));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const renderScale = (label: string, value: number, onChange: (v: number) => void) => (
    <div>
      <div className="flex justify-between text-sm font-semibold text-slate-600 mb-1">
        <span>{label}</span>
        <span className="text-indigo-600">{value}/5</span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-600"
      />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-8 pb-24">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-2xl bg-indigo-100 text-indigo-700">
            <BookOpen size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
            <p className="text-slate-500 text-sm">{t.subtitle}</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-3">{t.disclaimer}</p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-slate-500">{t.date}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEntryDate(shiftDate(entryDate, -1))}
              className="p-2 rounded-xl hover:bg-slate-50 text-slate-500"
              aria-label="Previous day"
            >
              <ChevronLeft size={18} />
            </button>
            <input
              type="date"
              value={entryDate}
              max={getLocalDateString()}
              onChange={(e) => setEntryDate(e.target.value)}
              className="text-sm font-semibold text-slate-800 border border-slate-200 rounded-xl px-3 py-2"
            />
            <button
              type="button"
              onClick={() => setEntryDate(shiftDate(entryDate, 1))}
              disabled={entryDate >= getLocalDateString()}
              className="p-2 rounded-xl hover:bg-slate-50 text-slate-500 disabled:opacity-30"
              aria-label="Next day"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div className="px-6 py-6 space-y-6">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-8">...</p>
          ) : (
            <>
              <div>
                <label className="text-sm font-semibold text-slate-600 block mb-3">{t.mood}</label>
                <div className="grid grid-cols-4 gap-2">
                  {MOODS.map((m) => {
                    const Icon = m.icon;
                    const selected = mood === m.value;
                    return (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setMood(m.value)}
                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                          selected ? `${m.color} border-current scale-[1.02]` : 'bg-white border-slate-100 hover:border-slate-200'
                        }`}
                      >
                        <Icon size={22} className={selected ? '' : 'text-slate-400'} />
                        <span className={`text-[10px] font-semibold ${selected ? '' : 'text-slate-400'}`}>
                          {t.moods[m.value]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-semibold text-slate-600 flex items-center gap-1.5 mb-2">
                    <Moon size={14} /> {t.sleep}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={sleepHours}
                    onChange={(e) => setSleepHours(e.target.value)}
                    placeholder="7.5"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-600 flex items-center gap-1.5 mb-2">
                    <Dumbbell size={14} /> {t.exercise}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={exerciseMin}
                    onChange={(e) => setExerciseMin(e.target.value)}
                    placeholder="30"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-600 block mb-1">{t.drinks}</label>
                <p className="text-xs text-slate-400 mb-3">{t.drinksHint}</p>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {DRINK_TYPES.map((type) => {
                    const Icon = DRINK_ICONS[type];
                    const selected = drinkType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          if (selected) {
                            setDrinkType(null);
                            setDrinkCups('');
                            setCaffeineAfter15h(false);
                          } else {
                            setDrinkType(type);
                          }
                        }}
                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                          selected
                            ? 'bg-sky-50 border-sky-300 text-sky-800 scale-[1.02]'
                            : 'bg-white border-slate-100 hover:border-slate-200 text-slate-500'
                        }`}
                      >
                        <Icon size={20} />
                        <span className="text-[10px] font-semibold">{t.drinkTypes[type]}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-slate-500 block mb-1">{t.drinkCups}</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={drinkCups}
                      onChange={(e) => setDrinkCups(e.target.value)}
                      placeholder="2"
                      disabled={!drinkType}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm disabled:opacity-40"
                    />
                  </div>
                  {(drinkType === 'coffee' || drinkType === 'tea') && (
                    <label className="flex items-center gap-2 text-sm text-slate-600 pb-2.5 shrink-0">
                      <input
                        type="checkbox"
                        checked={caffeineAfter15h}
                        onChange={(e) => setCaffeineAfter15h(e.target.checked)}
                      />
                      {t.caffeineAfter15h}
                    </label>
                  )}
                </div>
              </div>

              {(advancedUnlocked || showAdvanced) ? (
                <div className="space-y-5 pt-2 border-t border-slate-100">
                  {renderScale(t.energy, energy, setEnergy)}
                  {renderScale(t.focus, focus, setFocus)}
                  {renderScale(t.stress, stress, setStress)}
                  {renderScale(t.confidence, confidence, setConfidence)}
                  {renderScale(t.sleepQuality, sleepQuality, setSleepQuality)}

                  <div>
                    <label className="text-sm font-semibold text-slate-600 block mb-2">{t.intensity}</label>
                    <div className="flex flex-wrap gap-2">
                      {EXERCISE_INTENSITIES.map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setExerciseIntensity(level)}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                            exerciseIntensity === level
                              ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                              : 'border-slate-200 text-slate-500'
                          }`}
                        >
                          {t.intensities[level]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {renderScale(t.meals, mealBalance, setMealBalance)}
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={breakfast} onChange={(e) => setBreakfast(e.target.checked)} />
                    {t.breakfast}
                  </label>
                  <div>
                    <label className="text-sm font-semibold text-slate-600 block mb-2">{t.diary}</label>
                    <textarea
                      value={diaryText}
                      onChange={(e) => setDiaryText(e.target.value)}
                      placeholder={t.diaryPlaceholder}
                      rows={3}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-xs text-slate-500">
                  {t.unlockHint}
                </div>
              )}

              {!advancedUnlocked && (
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  {showAdvanced ? t.showLess : t.showMore}
                </button>
              )}

              {learning && (learning.total_learning_min > 0 || learning.journal_entries > 0) && (
                <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 flex items-center gap-3">
                  <HeartPulse size={18} className="text-indigo-600 shrink-0" />
                  <div className="text-sm">
                    <p className="font-semibold text-indigo-900">{t.learningToday}</p>
                    <p className="text-indigo-700">
                      {learning.total_learning_min} {t.learningMin} · {learning.journal_entries} {t.lessons}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-rose-600">{error}</p>}
          {saved && <p className="text-sm text-emerald-600 font-semibold">{t.saved}</p>}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCopyYesterday}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-white"
          >
            <Copy size={16} />
            {t.copyYesterday}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 ml-auto"
          >
            <Save size={16} />
            {saving ? '...' : t.save}
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-4">
        <button
          type="button"
          onClick={() => onNavigate(ViewState.LIFE_JOURNAL_MONTHLY)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
        >
          <BarChart3 size={16} />
          {t.monthly}
        </button>
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
          onClick={() => onNavigate(ViewState.LIFE_JOURNAL_CHAT)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          <Sparkles size={16} />
          {t.habitChat}
        </button>
        <button
          type="button"
          onClick={() => onNavigate(ViewState.PROFILE_DIAGNOSIS)}
          className="text-sm font-semibold text-slate-500 hover:text-indigo-600"
        >
          {t.backDiagnosis}
        </button>
      </div>
    </div>
  );
};

export default LifeJournalView;