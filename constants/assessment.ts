export const ASSESSMENT_PROFILE_STORAGE_KEY = 'personalized.profile.v1';

export const ASSESSMENT_PROFILE_CHANGED_EVENT = 'rise-path:assessment-profile-changed';

export function notifyAssessmentProfileChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(ASSESSMENT_PROFILE_CHANGED_EVENT));
}
