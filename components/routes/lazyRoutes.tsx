import { lazy } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { features } from '../../config/features';
import LegalPagesOff from '../features/legal/LegalPagesOff';

export const RouteLoading = () => {
  const { language } = useLanguage();
  return (
    <div role="status" className="p-8 text-small text-fg-3">
      {language === 'jp' ? '読み込んでいます…' : 'Loading…'}
    </div>
  );
};

/** Lesson reader for risepath.lesson/v1 (/learn and, in dev, /preview). */
export const LearnRoute = lazy(
  () => import('./LearnRoute')
);

/** /dev/blocks block gallery. Dev builds only: production bundles drop the import. */
export const DevBlocksRoute = lazy(
  () => (import.meta.env.DEV ? import('./DevBlocksRoute') : Promise.resolve({ default: () => null }))
);

export const CoursePathViewWrapper = lazy(
  () => import('../wrappers/CoursePathViewWrapper')
);
export const LessonViewWrapper = lazy(
  () => import('../wrappers/LessonViewWrapper')
);
export const GeneratedCourseViewWrapper = lazy(
  () => import('../wrappers/GeneratedCourseViewWrapper')
);
export const GeneratedLessonViewWrapper = lazy(
  () => import('../wrappers/GeneratedLessonViewWrapper')
);
export const EncyclopediaView = lazy(
  () => import('../features/ai/EncyclopediaView')
);
export const CourseGeneratorView = lazy(
  () => import('../features/ai/CourseGeneratorView')
);
/** /demo/* design samples. Dev builds only: production bundles drop the imports. */
export const BlenderChecklistGeneratorView = lazy(
  () => (import.meta.env.DEV ? import('../features/ai/BlenderChecklistGeneratorView') : Promise.resolve({ default: () => null }))
);
export const MultiFormatLessonView = lazy(
  () => (import.meta.env.DEV ? import('../features/ai/MultiFormatLessonView') : Promise.resolve({ default: () => null }))
);
export const PersonalAssessmentView = lazy(
  () => import('../features/dashboard/assessment/PersonalAssessmentView')
);
export const LifeJournalView = lazy(
  () => import('../features/life-journal/LifeJournalView')
);
export const LifeJournalMonthlyView = lazy(
  () => import('../features/life-journal/LifeJournalMonthlyView')
);
export const LifeJournalInsightsView = lazy(
  () => import('../features/life-journal/LifeJournalInsightsView')
);
export const LifeJournalChatView = lazy(
  () => import('../features/life-journal/LifeJournalChatView')
);
export const AICharacterIntroView = lazy(
  () => import('../features/ai/AICharacterIntroView')
);
export const AICharacterDetailView = lazy(
  () => import('../features/ai/AICharacterDetailView')
);
export const BlenderCurriculum = lazy(
  () => import('../features/blender/BlenderCurriculum')
);
export const BlenderPathView = lazy(
  () => import('../features/blender/BlenderPathView')
);
export const BlenderLessonView = lazy(
  () => import('../features/blender/BlenderLessonView')
);
export const TeacherBotLiveView = lazy(
  () => import('../features/blender/TeacherBotLiveView')
);
export const ProgrammingCurriculum = lazy(
  () => import('../features/programming/ProgrammingCurriculum')
);
export const ProgrammingCourseView = lazy(
  () => import('../features/programming/ProgrammingCourseView')
);
export const PythonBeginnerView = lazy(
  () => import('../features/programming/PythonBeginnerView')
);
export const HtmlCssView = lazy(
  () => import('../features/programming/HtmlCssView')
);
export const HtmlCssPathView = lazy(
  () => import('../features/programming/HtmlCssPathView')
);
export const HtmlCssPartTwoView = lazy(
  () => import('../features/programming/HtmlCssPartTwoView')
);
export const WebInspectorView = lazy(
  () => import('../features/programming/WebInspectorView')
);
export const VibePrologueView = lazy(
  () => import('../features/programming/VibePrologueView')
);
export const VibePathView = lazy(
  () => import('../features/programming/VibePathView')
);
export const ClaudeCodePathView = lazy(
  () => import('../features/programming/ClaudeCodePathView')
);
export const UnityPathView = lazy(
  () => import('../features/programming/UnityPathView')
);
export const UnityChapterView = lazy(
  () => import('../features/programming/UnityChapterView')
);
export const ArtMuseumView = lazy(
  () => import('../features/art/ArtMuseumView')
);
export const ArtHistoryView = lazy(
  () => import('../features/art/ArtHistoryView')
);
export const ArtPeriodDetailView = lazy(
  () => import('../features/art/ArtPeriodDetailView')
);
export const ArtKintsugiView = lazy(
  () => import('../features/art/ArtKintsugiView')
);
export const ArtCurriculumView = lazy(
  () => import('../features/art/ArtCurriculumView')
);
export const ArtIntroView = lazy(
  () => import('../features/art/ArtIntroView')
);
export const ArtCraftsView = lazy(
  () => import('../features/art/ArtCraftsView')
);
export const ArtCraftDetailView = lazy(
  () => import('../features/art/ArtCraftDetailView')
);
export const ArtTribalView = lazy(
  () => import('../features/art/ArtTribalView')
);
export const ArtTribalDetailView = lazy(
  () => import('../features/art/ArtTribalDetailView')
);
export const SonicLabView = lazy(
  () => import('../features/sonic/SonicLabView')
);
export const SonicSynthView = lazy(
  () => import('../features/sonic/SonicSynthView')
);
export const PSchoolView = lazy(
  () => import('../features/PSchool/PSchoolView')
);
export const AidjCurriculumView = lazy(
  () => import('../features/aidj/AidjCurriculumView')
);
/** Phase 0.5 minor safeguards: AI access setup, the public guide and the admin page. */
export const AiAccessSetupView = lazy(
  () => import('../safety/AiAccessSetupView')
);
export const AiSafetyGuideView = lazy(
  () => import('../features/safety/AiSafetyGuideView')
);
export const AdminSafetyView = lazy(
  () => import('../features/admin/AdminSafetyView')
);
/** Phase 1 (bring your own AI app): the OAuth consent page and the connected-apps settings page. */
export const OAuthConsentView = lazy(
  () => import('../features/oauth/OAuthConsentView')
);
export const ConnectedAppsView = lazy(
  () => import('../features/settings/ConnectedAppsView')
);
/** Phase 3 (the supporter plan): the plan page, its final confirmation screen and the public 特商法 page. */
export const PlanView = lazy(
  () => import('../features/settings/PlanView')
);
export const PlanConfirmView = lazy(
  () => import('../features/settings/PlanConfirmView')
);
export const CommerceDisclosureView = lazy(
  () => import('../features/legal/CommerceDisclosureView')
);
/** Phase 4 (account deletion): the delete page in Settings and the public page after a deletion. */
export const DeleteAccountView = lazy(() => import('../features/settings/DeleteAccountView'));
export const AccountDeletedView = lazy(() => import('../features/settings/AccountDeletedView'));
/** Phase 4: the generated legal text ships only in dev builds or with VITE_FEATURE_LEGAL_PAGES=true.
 *  Otherwise Rollup drops these imports (CI step "Fail if draft legal text reached the bundle") and
 *  /terms and /privacy show LegalPagesOff. Keep `features.legalPages` a plain property read here. */
export const TermsRoute = lazy(
  () => ((import.meta.env.DEV || features.legalPages) ? import('../features/legal/TermsPage') : Promise.resolve({ default: LegalPagesOff }))
);
export const PrivacyRoute = lazy(
  () => ((import.meta.env.DEV || features.legalPages) ? import('../features/legal/PrivacyPage') : Promise.resolve({ default: LegalPagesOff }))
);
/** The re-consent page (App.tsx). No legal text inside; gated anyway so a flag-off bundle carries none of it. */
export const LegalConsentView = lazy(
  () => (features.legalPages ? import('../legal/LegalConsentView') : Promise.resolve({ default: () => null }))
);
