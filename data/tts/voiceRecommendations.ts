import { ASSESSMENT_PROFILE_STORAGE_KEY } from '../../constants/assessment';
import type { AssessmentProfile } from '../../types';
import { recommendVoiceIdFromProfile } from './voiceRecommendationsCore.js';

export { recommendVoiceIdFromProfile } from './voiceRecommendationsCore.js';

export function loadAssessmentProfile(): AssessmentProfile | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(ASSESSMENT_PROFILE_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as AssessmentProfile;
    } catch {
        return null;
    }
}

export function hasAssessmentProfile(): boolean {
    return loadAssessmentProfile() != null;
}

export function recommendVoiceId(profile?: AssessmentProfile | null): string {
    const resolved = profile ?? loadAssessmentProfile();
    return recommendVoiceIdFromProfile(resolved?.scores, resolved?.aiAdvice);
}

// learner_profiles API integration (spec §5) is deferred; localStorage is the MVP source.
