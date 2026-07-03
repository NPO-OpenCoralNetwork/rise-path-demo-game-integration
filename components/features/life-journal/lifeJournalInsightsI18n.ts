import type {
  LifeJournalAdvice,
  LifeJournalAnalysisMetrics,
  LifeJournalCorrelation,
  LifeJournalPattern,
} from '../../../services/lifeJournalApi';

export type InsightsLang = 'en' | 'jp';

const correlationLabels: Record<string, Record<InsightsLang, string>> = {
  'sleep_hours:focus': { en: 'Sleep hours vs focus', jp: '睡眠時間 × 集中度' },
  'sleep_hours:energy': { en: 'Sleep hours vs energy', jp: '睡眠時間 × エネルギー' },
  'exercise_min:focus': { en: 'Exercise minutes vs focus', jp: '運動時間 × 集中度' },
  'meal_balance:energy': { en: 'Meal balance vs energy', jp: '食事バランス × エネルギー' },
  'stress:focus': { en: 'Stress vs focus', jp: 'ストレス × 集中度' },
  'sleep_hours:total_learning_min': { en: 'Sleep hours vs learning time', jp: '睡眠時間 × 学習時間' },
};

const patternCopy: Record<string, {
  title: Record<InsightsLang, string>;
  evidence: (params: Record<string, string | number>) => Record<InsightsLang, string>;
}> = {
  exercise_mood_boost: {
    title: {
      en: 'Exercise days correlate with better mood',
      jp: '運動した日は気分が良い傾向',
    },
    evidence: ({ exercise_pct, non_exercise_pct }) => ({
      en: `Mood good/great rate: exercise days ${exercise_pct}%, non-exercise days ${non_exercise_pct}%`,
      jp: `good/great の割合: 運動日 ${exercise_pct}% / 非運動日 ${non_exercise_pct}%`,
    }),
  },
  sleep_focus_threshold: {
    title: {
      en: 'Shorter sleep may link to lower focus',
      jp: '睡眠が短い日は集中度が下がりやすい',
    },
    evidence: ({ focus_under_6, focus_over_7 }) => ({
      en: `Focus avg: sleep <6h ${focus_under_6}, sleep ≥7h ${focus_over_7}`,
      jp: `集中度の平均: 睡眠6h未満 ${focus_under_6} / 7h以上 ${focus_over_7}`,
    }),
  },
  exercise_focus_boost: {
    title: {
      en: 'Exercise days show higher focus',
      jp: '運動日は集中度が高い傾向',
    },
    evidence: ({ focus_exercise, focus_non_exercise }) => ({
      en: `Avg focus: exercise days ${focus_exercise}, non-exercise ${focus_non_exercise}`,
      jp: `集中度の平均: 運動日 ${focus_exercise} / 非運動日 ${focus_non_exercise}`,
    }),
  },
  breakfast_energy: {
    title: {
      en: 'Breakfast days align with steadier energy',
      jp: '朝食を記録した日はエネルギーが安定しやすい',
    },
    evidence: ({ breakfast_rate_pct, avg_energy }) => ({
      en: `Breakfast logged on ${breakfast_rate_pct}% of days; avg energy ${avg_energy}`,
      jp: `朝食記録 ${breakfast_rate_pct}% の日 / 平均エネルギー ${avg_energy}`,
    }),
  },
  late_meal_frequency: {
    title: {
      en: 'Late dinners appear often this period',
      jp: '遅い夕食の記録が多い期間です',
    },
    evidence: ({ late_meal_rate_pct }) => ({
      en: `Late dinner flagged on ${late_meal_rate_pct}% of logged days`,
      jp: `記録日の ${late_meal_rate_pct}% で遅い夕食`,
    }),
  },
  top_tag: {
    title: {
      en: 'Frequent tag',
      jp: 'よく使うタグ',
    }, // title uses tag param — see localizePattern
    evidence: ({ tag, count, logged_days }) => ({
      en: `Tag "${tag}" appeared ${count} times in ${logged_days} logged days`,
      jp: `タグ「${tag}」が ${logged_days} 日中 ${count} 回`,
    }),
  },
};

const adviceCopy: Record<string, {
  title: Record<InsightsLang, string>;
  action: Record<InsightsLang, string>;
  evidence: (metrics: Record<string, number | null | undefined>) => Record<InsightsLang, string>;
}> = {
  sleep_focus_drop: {
    title: {
      en: 'Sleep and focus may be connected',
      jp: '睡眠と集中度の関係が見えています',
    },
    action: {
      en: 'This week, avoid new lessons after 22:30 and lean on review tasks.',
      jp: '今週は22:30以降の新規学習を避け、復習中心にしましょう',
    },
    evidence: (m) => ({
      en: `On days with <6h sleep, focus is lower by ${m.focus_delta_sleep_threshold ?? '—'} vs ≥7h days`,
      jp: `睡眠6h未満の日は集中度が平均${m.focus_delta_sleep_threshold ?? '—'}下がっています（7h以上との差）`,
    }),
  },
  exercise_mood_boost: {
    title: {
      en: 'Exercise days tend to feel better',
      jp: '運動した日は気分が良い傾向',
    },
    action: {
      en: 'Schedule new lessons on exercise days and reviews on rest days.',
      jp: '運動日は新規学習、非運動日は復習中心に分けると続けやすいです',
    },
    evidence: (m) => ({
      en: `Good/great mood rate on exercise days: ${Math.round((m.exercise_mood_great_good_pct ?? 0) * 100)}%`,
      jp: `運動日の good/great 率は ${Math.round((m.exercise_mood_great_good_pct ?? 0) * 100)}% です`,
    }),
  },
  low_sleep_streak: {
    title: {
      en: 'Short sleep days are adding up',
      jp: '睡眠時間が足りない日が続いています',
    },
    action: {
      en: 'Shorten sessions by 15 min and reduce screen time before bed this week.',
      jp: '今週は学習セッションを15分短くし、就寝前の画面時間を減らしてみましょう',
    },
    evidence: (m) => ({
      en: `Avg sleep ${m.avg_sleep_hours ?? '—'}h; ${Math.round((m.sleep_under_7h_days_pct ?? 0) * 100)}% of days under 7h`,
      jp: `平均睡眠 ${m.avg_sleep_hours ?? '—'}h、7h未満の日が ${Math.round((m.sleep_under_7h_days_pct ?? 0) * 100)}%`,
    }),
  },
  late_meal_focus: {
    title: {
      en: 'Late dinners and focus',
      jp: '夜遅い食事と集中度',
    },
    action: {
      en: 'Keep evening learning light and aim to finish dinner before 21:00.',
      jp: '夜の学習は軽い復習タスクに寄せ、夕食は21時前を目安に',
    },
    evidence: (m) => ({
      en: `Late dinners on ${Math.round((m.late_meal_rate ?? 0) * 100)}% of days; avg focus ${m.avg_focus ?? '—'}`,
      jp: `遅い夕食の記録が ${Math.round((m.late_meal_rate ?? 0) * 100)}%、平均集中度 ${m.avg_focus ?? '—'}`,
    }),
  },
};

export const localizeCorrelation = (
  correlation: LifeJournalCorrelation,
  lang: InsightsLang,
): string => {
  const key = `${correlation.x}:${correlation.y}`;
  return correlationLabels[key]?.[lang] ?? correlation.label ?? `${correlation.x} × ${correlation.y}`;
};

export const localizePattern = (
  pattern: LifeJournalPattern,
  lang: InsightsLang,
): { title: string; evidence: string } => {
  const copy = patternCopy[pattern.id];
  if (!copy) {
    return { title: pattern.title, evidence: pattern.evidence };
  }
  const params = (pattern as LifeJournalPattern & { evidence_params?: Record<string, string | number> })
    .evidence_params ?? {};
  const evidence = copy.evidence(params);
  let title = copy.title[lang];
  if (pattern.id === 'top_tag' && params.tag != null) {
    title = lang === 'jp'
      ? `よく使うタグ: 「${params.tag}」`
      : `Frequent tag: "${params.tag}"`;
  }
  return {
    title,
    evidence: evidence[lang] ?? pattern.evidence,
  };
};

export const localizeAdvice = (
  advice: LifeJournalAdvice,
  lang: InsightsLang,
  metrics?: LifeJournalAnalysisMetrics | null,
): { title: string; action: string; evidence: string } => {
  const copy = adviceCopy[advice.rule_id];
  if (!copy || !metrics) {
    return { title: advice.title, action: advice.action, evidence: advice.evidence };
  }
  const evidence = copy.evidence(metrics as Record<string, number | null | undefined>);
  return {
    title: copy.title[lang],
    action: copy.action[lang],
    evidence: evidence[lang] ?? advice.evidence,
  };
};