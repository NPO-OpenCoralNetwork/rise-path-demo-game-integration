import { lazy } from 'react';

export const RouteLoading = () => (
  <div className="p-8 text-sm text-slate-500">Loading...</div>
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
export const BlenderChecklistGeneratorView = lazy(
  () => import('../features/ai/BlenderChecklistGeneratorView')
);
export const MultiFormatLessonView = lazy(
  () => import('../features/ai/MultiFormatLessonView')
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
export const VibeChapterZeroView = lazy(
  () => import('../features/programming/VibeChapterZeroView')
);
export const VibeChapterOneView = lazy(
  () => import('../features/programming/VibeChapterOneView')
);
export const VibeChapterTwoView = lazy(
  () => import('../features/programming/VibeChapterTwoView')
);
export const VibeChapterThreeView = lazy(
  () => import('../features/programming/VibeChapterThreeView')
);
export const VibeChapterFourView = lazy(
  () => import('../features/programming/VibeChapterFourView')
);
export const VibeChapterFiveView = lazy(
  () => import('../features/programming/VibeChapterFiveView')
);
export const VibeChapterSixView = lazy(
  () => import('../features/programming/VibeChapterSixView')
);
export const VibeChapterSevenView = lazy(
  () => import('../features/programming/VibeChapterSevenView')
);
export const VibeChapterEightView = lazy(
  () => import('../features/programming/VibeChapterEightView')
);
export const VibeChapterNineView = lazy(
  () => import('../features/programming/VibeChapterNineView')
);
export const VibeChapterTenView = lazy(
  () => import('../features/programming/VibeChapterTenView')
);
export const VibeChapterElevenView = lazy(
  () => import('../features/programming/VibeChapterElevenView')
);
export const VibePathView = lazy(
  () => import('../features/programming/VibePathView')
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