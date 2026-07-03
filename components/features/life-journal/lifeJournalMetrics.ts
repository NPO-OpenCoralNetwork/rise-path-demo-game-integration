import type {
  LifeJournalDay,
  LifeJournalLifestyle,
  LifeJournalMood,
} from '../../../services/lifeJournalApi';

export type DrinkType = 'water' | 'coffee' | 'tea' | 'other';

export const DRINK_TYPES: DrinkType[] = ['water', 'coffee', 'tea', 'other'];

const CAFFEINE_DRINK_TYPES = new Set<DrinkType>(['coffee', 'tea']);

export type DrinkFormState = {
  drinkType: DrinkType | null;
  drinkCups: string;
  caffeineAfter15h: boolean;
};

export const drinkFieldsFromLifestyle = (
  lifestyle?: LifeJournalLifestyle | null,
): DrinkFormState => {
  const custom = lifestyle?.custom_metrics as { drink_type?: DrinkType } | undefined;
  let drinkType = custom?.drink_type ?? null;
  if (!drinkType) {
    if (lifestyle?.caffeine?.cups != null && lifestyle.caffeine.cups > 0) {
      drinkType = 'coffee';
    } else if (lifestyle?.hydration_cups != null) {
      drinkType = 'water';
    }
  }
  const cups = lifestyle?.caffeine?.cups ?? lifestyle?.hydration_cups;
  return {
    drinkType,
    drinkCups: cups != null ? String(cups) : '',
    caffeineAfter15h: Boolean(lifestyle?.caffeine?.after_15h),
  };
};

const clearDrinkPatch = (): Partial<LifeJournalLifestyle> => ({
  hydration_cups: null,
  caffeine: {},
  custom_metrics: {},
});

export const lifestyleDrinkPatch = (
  drinkType: DrinkType | null,
  drinkCups: string,
  caffeineAfter15h: boolean,
): Partial<LifeJournalLifestyle> => {
  if (!drinkType) return clearDrinkPatch();

  const trimmed = drinkCups.trim();
  if (!trimmed) return clearDrinkPatch();

  const cups = Number(trimmed);
  if (Number.isNaN(cups) || cups < 0) return clearDrinkPatch();

  const patch: Partial<LifeJournalLifestyle> = {
    custom_metrics: { drink_type: drinkType },
  };

  if (CAFFEINE_DRINK_TYPES.has(drinkType)) {
    patch.caffeine = { cups, after_15h: caffeineAfter15h };
    patch.hydration_cups = null;
  } else {
    patch.hydration_cups = cups;
    patch.caffeine = {};
  }

  return patch;
};

// Chart mood scale (1–4): compact range for Recharts area/line axes.
// Server learning_journal avg_mood_score uses 2–5 (see lifeJournalService.moodToScore).
export const MOOD_SCORES: Record<LifeJournalMood, number> = {
  great: 4,
  good: 3,
  okay: 2,
  struggled: 1,
};

export const LEARNING_MOOD_SCORES: Record<LifeJournalMood, number> = {
  great: 5,
  good: 4,
  okay: 3,
  struggled: 2,
};

export const moodToScore = (mood?: LifeJournalMood | null): number | null => {
  if (!mood) return null;
  return MOOD_SCORES[mood] ?? null;
};

const hasMealData = (meals?: LifeJournalDay['meals']) =>
  Boolean(meals && Object.values(meals).some((slot) =>
    slot && (slot.ate || slot.balance != null || slot.late_meal != null || (slot.note && slot.note.trim())),
  ));

export const isDayLogged = (day: LifeJournalDay): boolean =>
  Boolean(
    day.mood
    || day.energy != null
    || day.focus != null
    || day.stress != null
    || day.confidence != null
    || (day.diary_text && day.diary_text.trim())
    || (day.tags && day.tags.length > 0)
    || day.sleep_hours != null
    || day.sleep_quality != null
    || day.exercise_min != null
    || day.exercise_intensity
    || day.exercise_type
    || day.meal_balance != null
    || day.hydration_cups != null
    || day.alcohol != null
    || hasMealData(day.meals),
  );

export const shiftDate = (date: string, delta: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

export const getLocalDateString = (offsetDays = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA');
};

export const ROLLING_WEEK_DAYS = 7;

export const getRollingWeekRange = (anchorDate = getLocalDateString(), days = ROLLING_WEEK_DAYS) => ({
  from: shiftDate(anchorDate, -(days - 1)),
  to: anchorDate,
  days,
});

export const STREAK_LOOKBACK_DAYS = 90;

export const getStreakLookbackFrom = (anchorDate: string, lookbackDays = STREAK_LOOKBACK_DAYS): string =>
  shiftDate(anchorDate, -(lookbackDays - 1));

export const computeCurrentStreak = (loggedDates: Set<string>, anchorDate: string): number => {
  let streak = 0;
  let cursor = anchorDate;
  if (!loggedDates.has(cursor)) cursor = shiftDate(cursor, -1);
  while (loggedDates.has(cursor)) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
};

export const computeBestStreak = (days: LifeJournalDay[]): number => {
  let best = 0;
  let run = 0;
  for (const day of days) {
    if (isDayLogged(day)) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
};

export const getMonthRange = (year: number, month: number): { from: string; to: string } => {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
};

export const formatMonthLabel = (year: number, month: number, locale: string): string => {
  const d = new Date(`${year}-${String(month).padStart(2, '0')}-15T12:00:00Z`);
  return d.toLocaleDateString(locale === 'jp' ? 'ja-JP' : 'en-US', { year: 'numeric', month: 'long' });
};

export const formatShortDate = (date: string, locale: string): string => {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString(locale === 'jp' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric' });
};

const avg = (values: (number | null | undefined)[]): number | null => {
  const nums = values.filter((v): v is number => v != null && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
};

export interface MonthSummary {
  daysLogged: number;
  daysInMonth: number;
  avgSleep: number | null;
  avgFocus: number | null;
  avgEnergy: number | null;
  avgStress: number | null;
  avgMoodScore: number | null;
  totalLearningMin: number;
  currentStreak: number;
  bestStreak: number;
  bestStreakInMonth: number;
}

export const computeMonthSummary = (
  days: LifeJournalDay[],
  options: {
    anchorDate?: string;
    streakDays?: LifeJournalDay[];
  } = {},
): MonthSummary => {
  const anchorDate = options.anchorDate ?? getLocalDateString();
  const logged = days.filter(isDayLogged);
  const loggedDates = new Set(logged.map((d) => d.date));
  const streakSource = options.streakDays ?? days;
  const streakLoggedDates = new Set(streakSource.filter(isDayLogged).map((d) => d.date));
  const currentStreak = computeCurrentStreak(streakLoggedDates, anchorDate);
  const bestStreak = computeBestStreak(streakSource);
  const bestStreakInMonth = computeBestStreak(days);

  return {
    daysLogged: logged.length,
    daysInMonth: days.length,
    avgSleep: avg(logged.map((d) => d.sleep_hours)),
    avgFocus: avg(logged.map((d) => d.focus)),
    avgEnergy: avg(logged.map((d) => d.energy)),
    avgStress: avg(logged.map((d) => d.stress)),
    avgMoodScore: avg(logged.map((d) => moodToScore(d.mood))),
    totalLearningMin: days.reduce((sum, d) => sum + (d.total_learning_min ?? 0), 0),
    currentStreak,
    bestStreak,
    bestStreakInMonth,
  };
};

export interface ChartDayPoint {
  date: string;
  label: string;
  sleep_hours: number | null;
  focus: number | null;
  energy: number | null;
  stress: number | null;
  moodScore: number | null;
  learning_min: number;
  logged: boolean;
}

export const toChartPoints = (days: LifeJournalDay[], locale: string): ChartDayPoint[] =>
  days.map((day) => ({
    date: day.date,
    label: formatShortDate(day.date, locale),
    sleep_hours: day.sleep_hours ?? null,
    focus: day.focus ?? null,
    energy: day.energy ?? null,
    stress: day.stress ?? null,
    moodScore: moodToScore(day.mood),
    learning_min: day.total_learning_min ?? 0,
    logged: isDayLogged(day),
  }));

export const toScatterPoints = (points: ChartDayPoint[]) =>
  points
    .filter((p) => p.sleep_hours != null && p.focus != null)
    .map((p) => ({
      sleep_hours: p.sleep_hours as number,
      focus: p.focus as number,
      label: p.label,
    }));