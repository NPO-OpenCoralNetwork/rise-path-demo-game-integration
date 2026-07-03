import { getLearningEvents, getAllProgress } from './progressService';

// XP rewards per event type
const XP_TABLE: Record<string, number> = {
  lesson_complete: 40,
  stage_complete: 80,
  course_complete: 200,
  diagnosis_complete: 30,
  course_generated: 50,
  lesson_start: 10,
};

// Level thresholds: level N requires LEVEL_XP[N] total XP
const XP_PER_LEVEL = 100; // Each level requires 100 XP

export const getTotalXp = (): number => {
  const events = getLearningEvents();
  return events.reduce((sum, e) => sum + (XP_TABLE[e.type] || 0), 0);
};

export const getLevel = (): number => {
  const xp = getTotalXp();
  return Math.max(1, Math.floor(xp / XP_PER_LEVEL) + 1);
};

export const getXpForNextLevel = (): { current: number; goal: number } => {
  const xp = getTotalXp();
  const currentLevelXp = xp % XP_PER_LEVEL;
  return { current: currentLevelXp, goal: XP_PER_LEVEL };
};

export const getStreak = (): number => {
  const events = getLearningEvents();
  if (events.length === 0) return 0;

  // Get unique dates (YYYY-MM-DD) with activity, sorted descending
  const dates = [...new Set(
    events.map(e => e.timestamp.split('T')[0])
  )].sort().reverse();

  if (dates.length === 0) return 0;

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Streak must include today or yesterday
  if (dates[0] !== today && dates[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 0; i < dates.length - 1; i++) {
    const d1 = new Date(dates[i]);
    const d2 = new Date(dates[i + 1]);
    const diffDays = Math.round((d1.getTime() - d2.getTime()) / 86400000);
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
};

export const getCompletedCoursesCount = (): number => {
  const progress = getAllProgress();
  return Object.values(progress).filter(p => p.completedStages.length >= 3).length;
};

export const getCompletedLessonsCount = (): number => {
  const events = getLearningEvents();
  return events.filter(e => e.type === 'lesson_complete' || e.type === 'stage_complete').length;
};
