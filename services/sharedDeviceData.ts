/**
 * Browser data that holds AI output or a learner's AI-related state (Phase 0.5 minor safeguards).
 * Community sites share tablets between children, so signing out removes it
 * (context/AuthContext.tsx logout): the next child must not see the previous child's saved tutor
 * answers, assessment insight or writing.
 *
 *   - rp:tutorCards: tutor answers saved as review cards (components/lesson/useTutorStream.ts)
 *   - personalized.profile.v1: assessment profile with the AI insight (constants/assessment.ts)
 *   - learner_profile_id: assessment profile id (LearningMirrorView)
 *   - active_curriculum_id: the AI-generated course last opened (GeneratedCourseViewWrapper)
 *   - sessionStorage rp:writingDraft:*: writing sent for AI feedback (components/common/LessonView.tsx)
 *
 * Plain module (no React, no imports) so server/tests/aiAccessFront.test.js can run it.
 */

export const AI_LOCAL_KEYS = ['rp:tutorCards', 'personalized.profile.v1', 'learner_profile_id', 'active_curriculum_id'] as const;
export const WRITING_DRAFT_PREFIX = 'rp:writingDraft:';

type StorageLike = Pick<Storage, 'removeItem' | 'key' | 'length'>;

const storageOrNull = (pick: () => StorageLike): StorageLike | null => {
  try {
    return pick();
  } catch {
    return null;
  }
};

/**
 * Removes AI answers kept in this browser. `keepDrafts`: a guest signing out to sign in keeps the
 * writing draft LessonView just saved for after sign-in (the learner's own text, not AI output).
 */
export function clearSharedDeviceAiData({
  keepDrafts = false,
  local = storageOrNull(() => window.localStorage),
  session = storageOrNull(() => window.sessionStorage),
}: { keepDrafts?: boolean; local?: StorageLike | null; session?: StorageLike | null } = {}): void {
  try {
    if (local) for (const key of AI_LOCAL_KEYS) local.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept there either.
  }
  if (keepDrafts || !session) return;
  try {
    const drafts: string[] = [];
    for (let i = 0; i < session.length; i += 1) {
      const key = session.key(i);
      if (key && key.startsWith(WRITING_DRAFT_PREFIX)) drafts.push(key);
    }
    for (const key of drafts) session.removeItem(key);
  } catch {
    // Storage blocked.
  }
}
