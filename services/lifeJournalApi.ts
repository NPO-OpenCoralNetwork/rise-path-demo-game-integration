import { apiFetch, isApiAvailable } from './apiClient';

const USE_DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';
const STORAGE_KEY = 'rp_life_journal_v1';

export type LifeJournalMood = 'great' | 'good' | 'okay' | 'struggled';

export interface LifeJournalReflection {
  mood?: LifeJournalMood;
  energy?: number;
  focus?: number;
  stress?: number;
  confidence?: number;
  diary_text?: string;
  tags?: string[];
}

export interface LifeJournalMealSlot {
  ate?: boolean;
  balance?: number;
  late_meal?: boolean;
  note?: string;
}

export interface LifeJournalLifestyle {
  sleep_hours?: number;
  sleep_quality?: number;
  bedtime?: string;
  wake_time?: string;
  exercise_min?: number;
  exercise_intensity?: 'none' | 'light' | 'moderate' | 'hard';
  exercise_type?: string;
  steps?: number;
  meals?: Record<string, LifeJournalMealSlot>;
  meal_balance?: number;
  hydration_cups?: number;
  caffeine?: { cups?: number; after_15h?: boolean };
  alcohol?: boolean;
  screen_time_before_sleep_min?: number;
  health_note?: string;
  custom_metrics?: Record<string, unknown>;
}

export interface LifeJournalLearningMetrics {
  total_learning_min: number;
  journal_entries: number;
  avg_confidence: number | null;
  avg_mood_score: number | null;
}

export interface LifeJournalDay {
  date: string;
  mood?: LifeJournalMood | null;
  energy?: number | null;
  focus?: number | null;
  stress?: number | null;
  confidence?: number | null;
  diary_text?: string | null;
  tags?: string[];
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  exercise_min?: number | null;
  exercise_intensity?: string | null;
  exercise_type?: string | null;
  meals?: Record<string, LifeJournalMealSlot>;
  meal_balance?: number | null;
  hydration_cups?: number | null;
  caffeine?: { cups?: number; after_15h?: boolean };
  alcohol?: boolean | null;
  total_learning_min?: number;
  journal_entries?: number;
  avg_confidence?: number | null;
  avg_mood_score?: number | null;
}

export interface LifeJournalDailyEntry {
  date: string;
  reflection: LifeJournalReflection | null;
  lifestyle: LifeJournalLifestyle | null;
  learning: LifeJournalLearningMetrics;
  day: LifeJournalDay;
}

type StoredJournal = Record<string, {
  reflection?: LifeJournalReflection;
  lifestyle?: LifeJournalLifestyle;
}>;

const readStore = (): StoredJournal => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

const writeStore = (store: StoredJournal) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

const emptyLearning = (): LifeJournalLearningMetrics => ({
  total_learning_min: 0,
  journal_entries: 0,
  avg_confidence: null,
  avg_mood_score: null,
});

const buildDemoEntry = (date: string, stored?: StoredJournal[string]): LifeJournalDailyEntry => {
  const reflection = stored?.reflection ?? null;
  const lifestyle = stored?.lifestyle ?? null;
  const day: LifeJournalDay = {
    date,
    mood: reflection?.mood ?? null,
    energy: reflection?.energy ?? null,
    focus: reflection?.focus ?? null,
    stress: reflection?.stress ?? null,
    confidence: reflection?.confidence ?? null,
    diary_text: reflection?.diary_text ?? null,
    tags: reflection?.tags ?? [],
    sleep_hours: lifestyle?.sleep_hours ?? null,
    sleep_quality: lifestyle?.sleep_quality ?? null,
    exercise_min: lifestyle?.exercise_min ?? null,
    exercise_intensity: lifestyle?.exercise_intensity ?? null,
    exercise_type: lifestyle?.exercise_type ?? null,
    meals: lifestyle?.meals ?? {},
    meal_balance: lifestyle?.meal_balance ?? null,
    hydration_cups: lifestyle?.hydration_cups ?? null,
    caffeine: lifestyle?.caffeine ?? {},
    alcohol: lifestyle?.alcohol ?? null,
    total_learning_min: 0,
    journal_entries: 0,
    avg_confidence: null,
    avg_mood_score: null,
  };
  return {
    date,
    reflection,
    lifestyle,
    learning: emptyLearning(),
    day,
  };
};

const shouldUseDemo = () => USE_DEMO_MODE || !isApiAvailable();

const patchObject = <T extends object>(
  prev: T | undefined | null,
  patch: Partial<T> | undefined,
): T | undefined => {
  if (patch === undefined) return prev;
  const next = { ...(prev ?? {}) } as T;
  for (const key of Object.keys(patch)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      (next as Record<string, unknown>)[key] = patch[key];
    }
  }
  return next;
};

export const resolveClientTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
  } catch {
    return 'Asia/Tokyo';
  }
};

const parseResponse = async <T>(res: Response, path: string): Promise<T> => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API ${path}: ${res.status}`);
  }
  return res.json();
};

export const saveLifeJournalDaily = async (
  date: string,
  payload: { reflection?: LifeJournalReflection; lifestyle?: LifeJournalLifestyle },
  timezone = resolveClientTimezone(),
): Promise<LifeJournalDailyEntry> => {
  if (shouldUseDemo()) {
    const store = readStore();
    const prev = store[date] ?? {};
    store[date] = {
      reflection: patchObject(prev.reflection, payload.reflection),
      lifestyle: patchObject(prev.lifestyle, payload.lifestyle),
    };
    writeStore(store);
    return buildDemoEntry(date, store[date]);
  }

  const res = await apiFetch(`/life-journal/daily/${date}?timezone=${encodeURIComponent(timezone)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse<{ ok: boolean; entry: LifeJournalDailyEntry }>(res, `/life-journal/daily/${date}`);
  return data.entry;
};

export const getLifeJournalDaily = async (
  date: string,
  timezone = resolveClientTimezone(),
): Promise<LifeJournalDailyEntry> => {
  if (shouldUseDemo()) {
    const store = readStore();
    return buildDemoEntry(date, store[date]);
  }

  const res = await apiFetch(`/life-journal/daily/${date}?timezone=${encodeURIComponent(timezone)}`);
  return parseResponse<LifeJournalDailyEntry & { ok: boolean }>(res, `/life-journal/daily/${date}`);
};

const MAX_RANGE_DAYS = 366;

const assertRangeSpan = (from: string, to: string) => {
  const fromMs = new Date(`${from}T12:00:00Z`).getTime();
  const toMs = new Date(`${to}T12:00:00Z`).getTime();
  if (fromMs > toMs) throw new Error('Invalid date range: from must be <= to');
  const spanDays = Math.floor((toMs - fromMs) / 86400000) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new Error(`Date range must not exceed ${MAX_RANGE_DAYS} days`);
  }
};

export const getLifeJournalRange = async (
  from: string,
  to: string,
  timezone = resolveClientTimezone(),
): Promise<{ from: string; to: string; timezone: string; days: LifeJournalDay[] }> => {
  assertRangeSpan(from, to);

  if (shouldUseDemo()) {
    const store = readStore();
    const days: LifeJournalDay[] = [];
    const start = new Date(`${from}T12:00:00Z`);
    const end = new Date(`${to}T12:00:00Z`);
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      days.push(buildDemoEntry(date, store[date]).day);
    }
    return { from, to, timezone, days };
  }

  const qs = new URLSearchParams({ from, to, timezone });
  const res = await apiFetch(`/life-journal/range?${qs.toString()}`);
  return parseResponse(res, '/life-journal/range');
};

export interface LifeJournalCorrelation {
  x: string;
  y: string;
  label?: string;
  method: string;
  r: number;
  strength: string;
  sample_size: number;
  confidence: string;
}

export interface LifeJournalPattern {
  type: string;
  id: string;
  title: string;
  evidence: string;
  evidence_params?: Record<string, string | number>;
  confidence: string;
}

export interface LifeJournalAdvice {
  rule_id: string;
  title: string;
  action: string;
  evidence: string;
  confidence: string;
  difficulty: string;
  priority?: string;
}

export interface LifeJournalAnalysisSummary {
  days_logged: number;
  avg_sleep_hours: number | null;
  avg_focus: number | null;
  avg_energy: number | null;
  avg_stress: number | null;
  total_learning_min: number;
  record_streak: number;
}

export interface LifeJournalAnalysisMetrics {
  days_logged: number;
  sample_size: number;
  insufficient_data: boolean;
  avg_sleep_hours?: number | null;
  avg_focus?: number | null;
  focus_delta_sleep_threshold?: number | null;
  exercise_mood_great_good_pct?: number | null;
  sleep_under_7h_days_pct?: number | null;
  late_meal_rate?: number | null;
  [key: string]: unknown;
}

export interface LifeJournalAnalysisResult {
  ok: boolean;
  from?: string;
  to?: string;
  granularity?: string;
  summary: LifeJournalAnalysisSummary;
  metrics?: LifeJournalAnalysisMetrics;
  correlations: LifeJournalCorrelation[];
  patterns: LifeJournalPattern[];
  advice?: LifeJournalAdvice[];
  data_quality: {
    sample_size: number;
    missing_days: number;
    correlations_shown: number;
    granularity?: string;
    warning: string;
    message?: string;
  };
}

export const getLifeJournalAnalysis = async (
  from: string,
  to: string,
  timezone = resolveClientTimezone(),
  granularity: 'weekly' | 'monthly' | 'custom' = 'custom',
): Promise<LifeJournalAnalysisResult> => {
  assertRangeSpan(from, to);

  if (shouldUseDemo()) {
    const range = await getLifeJournalRange(from, to, timezone);
    const [{ analyzeLifeJournal }, { deriveLifeHabitSignals }] = await Promise.all([
      import('../tools/core/lifeJournalAnalysis.js'),
      import('../tools/core/lifeHabitRules.js'),
    ]);
    const analysis = analyzeLifeJournal(range.days, {
      from,
      to,
      granularity,
    } as Parameters<typeof analyzeLifeJournal>[1]) as LifeJournalAnalysisResult;
    const habitSignals = deriveLifeHabitSignals(analysis.metrics);
    return {
      ...analysis,
      advice: habitSignals.advice,
      data_quality: {
        ...analysis.data_quality,
      },
    };
  }

  const qs = new URLSearchParams({ from, to, timezone, granularity });
  const res = await apiFetch(`/life-journal/analysis?${qs.toString()}`);
  return parseResponse<LifeJournalAnalysisResult>(res, '/life-journal/analysis');
};

export interface LifeJournalWeeklySummary extends LifeJournalAnalysisSummary {
  record_rate_pct: number;
  total_days: number;
}

export interface LifeJournalWeeklyAdviceResult {
  ok: boolean;
  from: string;
  to: string;
  timezone?: string;
  summary: LifeJournalWeeklySummary;
  advice: LifeJournalAdvice[];
  patterns?: LifeJournalPattern[];
  metrics?: LifeJournalAnalysisMetrics;
  insufficient_data?: boolean;
  days_logged?: number;
  data_quality?: LifeJournalAnalysisResult['data_quality'];
}

export const getLifeJournalAdvice = async (
  from: string,
  to: string,
  timezone = resolveClientTimezone(),
): Promise<LifeJournalWeeklyAdviceResult> => {
  assertRangeSpan(from, to);

  if (shouldUseDemo()) {
    const range = await getLifeJournalRange(from, to, timezone);
    const { buildWeeklyAdviceFromDays } = await import('../tools/core/lifeJournalWeekly.js');
    return buildWeeklyAdviceFromDays(range.days, { from, to, timezone }) as LifeJournalWeeklyAdviceResult;
  }

  const qs = new URLSearchParams({ timezone });
  const res = await apiFetch(`/life-journal/advice?${qs.toString()}`, {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });
  return parseResponse<LifeJournalWeeklyAdviceResult>(res, '/life-journal/advice');
};

export const clearLifeJournalDemoStore = () => {
  localStorage.removeItem(STORAGE_KEY);
};