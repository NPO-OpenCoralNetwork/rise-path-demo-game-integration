import {
  ASSESSMENT_PROFILE_STORAGE_KEY,
} from '../constants/assessment';
import {
  AssessmentProfile,
  Big5Profile,
  PersonalityType,
} from '../types';
import { apiFetch, isApiAvailable } from './apiClient';

export type AssessmentProfileSource = 'database' | 'local';

type LearnerProfileLatestResponse = {
  ok?: boolean;
  raw_profile?: {
    big_five?: Partial<Big5Profile>;
    learning_style?: { type?: string };
    motivation?: { primary?: string };
  };
  derived_learning_profile?: Record<string, unknown>;
  created_at?: string;
};

const TRAITS: (keyof Big5Profile)[] = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'neuroticism',
];

function loadLocalAssessmentProfile(): AssessmentProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ASSESSMENT_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AssessmentProfile;
  } catch {
    return null;
  }
}

function normalizeBig5Scores(bigFive: Partial<Big5Profile> | undefined): Big5Profile {
  return {
    openness: Number(bigFive?.openness ?? 0),
    conscientiousness: Number(bigFive?.conscientiousness ?? 0),
    extraversion: Number(bigFive?.extraversion ?? 0),
    agreeableness: Number(bigFive?.agreeableness ?? 0),
    neuroticism: Number(bigFive?.neuroticism ?? 0),
  };
}

function inferPersonalityType(scores: Big5Profile): PersonalityType {
  const topTrait = [...TRAITS].sort((a, b) => scores[b] - scores[a])[0];
  const map: Partial<Record<keyof Big5Profile, PersonalityType>> = {
    openness: 'character/openness',
    conscientiousness: '職人',
    extraversion: '冒険家',
    agreeableness: 'サポーター',
    neuroticism: '思想家',
  };
  return map[topTrait] || 'バランサー';
}

export function mapLearnerProfileToAssessmentProfile(
  row: LearnerProfileLatestResponse,
  localOverlay?: AssessmentProfile | null,
): AssessmentProfile {
  const raw = row.raw_profile ?? {};
  const scores = normalizeBig5Scores(raw.big_five);
  const derived = row.derived_learning_profile ?? {};

  const profile: AssessmentProfile = {
    scores,
    personalityType: localOverlay?.personalityType || inferPersonalityType(scores),
    learningStyle: String(
      raw.learning_style?.type
      || derived.learning_mode
      || localOverlay?.learningStyle
      || '標準学習モード',
    ),
    motivation: String(
      raw.motivation?.primary
      || localOverlay?.motivation
      || '継続的な改善',
    ),
    completedAt: row.created_at || localOverlay?.completedAt || new Date().toISOString(),
    aiAdvice: localOverlay?.aiAdvice,
  };

  return profile;
}

export async function loadAssessmentProfile(): Promise<{
  profile: AssessmentProfile | null;
  source: AssessmentProfileSource | null;
}> {
  const local = loadLocalAssessmentProfile();

  if (isApiAvailable()) {
    try {
      const res = await apiFetch('/learner-profiles/latest');
      if (res.ok) {
        const data = await res.json() as LearnerProfileLatestResponse;
        return {
          profile: mapLearnerProfileToAssessmentProfile(data, local),
          source: 'database',
        };
      }
      if (res.status !== 404) {
        throw new Error(`Failed to load learner profile (${res.status})`);
      }
    } catch {
      // Fall through to local demo data
    }
  }

  if (local) {
    return { profile: local, source: 'local' };
  }

  return { profile: null, source: null };
}