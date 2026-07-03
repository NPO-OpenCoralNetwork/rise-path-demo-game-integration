import React, { Suspense, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, useParams } from 'react-router-dom';
import { ViewState, GeneratedCourse, Course } from './types';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { fetchGeneratedCourseById, saveGeneratedCourse } from './services/curriculumApi';

// Common Components
import Layout from './components/common/Layout';
import ErrorBoundary from './components/common/ErrorBoundary';
import LoginView from './components/common/ExperienceLoginView';
import LandingView from './components/common/ExperienceLandingView';
import AuthCallbackView from './components/common/AuthCallbackView';
import AuthConfirmPendingView from './components/common/AuthConfirmPendingView';
import type { AuthMode } from './components/common/ExperienceLoginView';
import Library from './components/common/Library';

// Dashboard Features
import Dashboard from './components/features/dashboard/Dashboard';
import CourseList from './components/features/dashboard/CourseList';
import LearningHub from './components/features/dashboard/LearningHub';
import ProfilePassport from './components/features/dashboard/ProfilePassport';
import MyContent from './components/features/dashboard/MyContent';
import ProfileDiagnosisView from './components/features/dashboard/profile/ProfileDiagnosisView';
import ProfileHistoryView from './components/features/dashboard/profile/ProfileHistoryView';
import ProfileBadgesView from './components/features/dashboard/profile/ProfileBadgesView';
import ProfileGeneratedView from './components/features/dashboard/profile/ProfileGeneratedView';
import ProfileEditView from './components/features/dashboard/profile/ProfileEditView';
import LearningMirrorView from './components/features/dashboard/profile/LearningMirrorView';
import NotificationsView from './components/features/dashboard/NotificationsView';
import SubscriptionView from './components/features/dashboard/SubscriptionView';
import SettingsView from './components/features/settings/SettingsView';
import SettingsVoiceView from './components/features/settings/SettingsVoiceView';
import SettingsDialogueVoiceView from './components/features/settings/SettingsDialogueVoiceView';
import SettingsApiKeyView from './components/features/settings/SettingsApiKeyView';
import SettingsPrivacyView from './components/features/settings/SettingsPrivacyView';
import SettingsAiMemoryView from './components/features/settings/SettingsAiMemoryView';

// Common Floating Components
import { FloatingChatbot } from './components/common/FloatingChatbot';

import {
  RouteLoading,
  CoursePathViewWrapper,
  LessonViewWrapper,
  GeneratedCourseViewWrapper,
  GeneratedLessonViewWrapper,
  EncyclopediaView,
  CourseGeneratorView,
  BlenderChecklistGeneratorView,
  MultiFormatLessonView,
  PersonalAssessmentView,
  LifeJournalView,
  LifeJournalMonthlyView,
  LifeJournalInsightsView,
  LifeJournalChatView,
  AICharacterIntroView,
  AICharacterDetailView,
  BlenderCurriculum,
  BlenderPathView,
  BlenderLessonView,
  TeacherBotLiveView,
  ProgrammingCurriculum,
  ProgrammingCourseView,
  PythonBeginnerView,
  HtmlCssView,
  HtmlCssPathView,
  HtmlCssPartTwoView,
  WebInspectorView,
  VibePrologueView,
  VibeChapterZeroView,
  VibeChapterOneView,
  VibeChapterTwoView,
  VibeChapterThreeView,
  VibeChapterFourView,
  VibeChapterFiveView,
  VibeChapterSixView,
  VibeChapterSevenView,
  VibeChapterEightView,
  VibeChapterNineView,
  VibeChapterTenView,
  VibeChapterElevenView,
  VibePathView,
  UnityPathView,
  UnityChapterView,
  ArtMuseumView,
  ArtHistoryView,
  ArtPeriodDetailView,
  ArtKintsugiView,
  ArtCurriculumView,
  ArtIntroView,
  ArtCraftsView,
  ArtCraftDetailView,
  ArtTribalView,
  ArtTribalDetailView,
  SonicLabView,
  SonicSynthView,
  PSchoolView,
  AidjCurriculumView,
} from './components/routes/lazyRoutes';

import { User, Settings, Bell, Shield } from 'lucide-react';

// Profile Placeholder (kept for reference or usage)
const ProfilePlaceholder: React.FC = () => (
  <div className="p-8 max-w-2xl mx-auto">
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="h-32 bg-indigo-600"></div>
      <div className="px-8 pb-8">
        <div className="relative -top-12 mb-[-12px] flex justify-between items-end">
          <div className="w-24 h-24 bg-white rounded-full p-1 shadow-md">
            <div className="w-full h-full bg-slate-200 rounded-full overflow-hidden">
              <img src="https://picsum.photos/200" alt="Avatar" className="w-full h-full object-cover" />
            </div>
          </div>
          <button className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800">Edit Profile</button>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 mt-4">Alex Johnson</h1>
        <p className="text-slate-500">Passionate Learner • Level 12</p>

        <div className="mt-8 space-y-2">
          <div className="flex items-center justify-between p-4 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors border border-slate-100">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-50 p-2 rounded-lg text-indigo-600"><Settings size={20} /></div>
              <span className="font-medium text-slate-700">Account Settings</span>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors border border-slate-100">
            <div className="flex items-center gap-3">
              <div className="bg-blue-50 p-2 rounded-lg text-blue-600"><Bell size={20} /></div>
              <span className="font-medium text-slate-700">Notifications</span>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors border border-slate-100">
            <div className="flex items-center gap-3">
              <div className="bg-green-50 p-2 rounded-lg text-green-600"><Shield size={20} /></div>
              <span className="font-medium text-slate-700">Privacy & Security</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { language, setLanguage } = useLanguage();
  const { isLoggedIn, isLoading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // UI state
  const [isLoginPageVisible, setIsLoginPageVisible] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');

  // Derive current view from location for Layout highlight
  // This is a simple mapping for the Layout's navigation prop
  const getCurrentViewState = (): ViewState => {
    const path = location.pathname;
    if (path === '/') return ViewState.DASHBOARD;
    if (path === '/learning-hub') return ViewState.LEARNING_HUB;
    if (path.startsWith('/courses')) return ViewState.COURSES;
    if (path.startsWith('/generated-course')) return ViewState.GENERATED_COURSE_PATH;
    if (path.startsWith('/generated-lesson')) return ViewState.GENERATED_LESSON_VIEW;
    if (path.startsWith('/my-content')) return ViewState.MY_CONTENT;
    if (path.startsWith('/profile/diagnosis')) return ViewState.PROFILE_DIAGNOSIS;
    if (path.startsWith('/profile/history')) return ViewState.PROFILE_HISTORY;
    if (path.startsWith('/profile/badges')) return ViewState.PROFILE_BADGES;
    if (path.startsWith('/profile/mirror')) return ViewState.PROFILE_MIRROR;
    if (path.startsWith('/profile/generated')) return ViewState.PROFILE_GENERATED;
    if (path.startsWith('/profile/edit')) return ViewState.PROFILE_EDIT;
    if (path.startsWith('/profile')) return ViewState.PROFILE;
    if (path.startsWith('/settings/voice/dialogue')) return ViewState.SETTINGS_DIALOGUE_VOICE;
    if (path.startsWith('/settings/ai-memory')) return ViewState.SETTINGS_AI_MEMORY;
    if (path.startsWith('/settings/privacy')) return ViewState.SETTINGS_PRIVACY;
    if (path.startsWith('/settings/api-key')) return ViewState.SETTINGS_API_KEY;
    if (path.startsWith('/settings/voice')) return ViewState.SETTINGS_VOICE;
    if (path.startsWith('/settings')) return ViewState.SETTINGS;
    if (path.startsWith('/notifications')) return ViewState.NOTIFICATIONS;
    if (path.startsWith('/subscription')) return ViewState.SUBSCRIPTION;
    if (path.startsWith('/life-journal/chat')) return ViewState.LIFE_JOURNAL_CHAT;
    if (path.startsWith('/life-journal/insights')) return ViewState.LIFE_JOURNAL_INSIGHTS;
    if (path.startsWith('/life-journal/monthly')) return ViewState.LIFE_JOURNAL_MONTHLY;
    if (path.startsWith('/life-journal')) return ViewState.LIFE_JOURNAL;
    if (path.startsWith('/assessment')) return ViewState.AI_DIAGNOSIS;
    if (path.startsWith('/course-generator')) return ViewState.COURSE_GENERATOR;
    if (path.startsWith('/characters') || path.startsWith('/character')) return ViewState.AI_CHARACTERS;
    if (path.startsWith('/blender')) return ViewState.BLENDER;
    if (path.startsWith('/programming')) return ViewState.PROGRAMMING;
    if (path.startsWith('/art')) return ViewState.ART_MUSEUM;
    if (path.startsWith('/sonic')) return ViewState.SONIC_LAB;
    if (path.startsWith('/vibe')) return ViewState.PROGRAMMING_VIBE;
    if (path.startsWith('/unity')) return ViewState.UNITY_AI_GAME_DEV;
    if (path === '/library') return ViewState.LIBRARY;
    return ViewState.DASHBOARD;
  };

  const handleNavigate = (view: ViewState) => {
    switch (view) {
      case ViewState.DASHBOARD: navigate('/'); break;
      case ViewState.LEARNING_HUB: navigate('/learning-hub'); break;
      case ViewState.COURSES: navigate('/courses'); break;
      case ViewState.MY_CONTENT: navigate('/my-content'); break;
      case ViewState.PROFILE: navigate('/profile'); break;
      case ViewState.PROFILE_DIAGNOSIS: navigate('/profile/diagnosis'); break;
      case ViewState.PROFILE_HISTORY: navigate('/profile/history'); break;
      case ViewState.PROFILE_BADGES: navigate('/profile/badges'); break;
      case ViewState.PROFILE_GENERATED: navigate('/profile/generated'); break;
      case ViewState.PROFILE_MIRROR: navigate('/profile/mirror'); break;
      case ViewState.PROFILE_EDIT: navigate('/profile/edit'); break;
      case ViewState.NOTIFICATIONS: navigate('/notifications'); break;
      case ViewState.SUBSCRIPTION: navigate('/subscription'); break;
      case ViewState.SETTINGS: navigate('/settings'); break;
      case ViewState.SETTINGS_VOICE: navigate('/settings/voice'); break;
      case ViewState.SETTINGS_DIALOGUE_VOICE: navigate('/settings/voice/dialogue'); break;
      case ViewState.SETTINGS_API_KEY: navigate('/settings/api-key'); break;
      case ViewState.SETTINGS_PRIVACY: navigate('/settings/privacy'); break;
      case ViewState.SETTINGS_AI_MEMORY: navigate('/settings/ai-memory'); break;
      case ViewState.LIBRARY: navigate('/library'); break;

      case ViewState.LESSON:
        const currentChapterId = sessionStorage.getItem('current_chapter_id');
        const currentCourseId = sessionStorage.getItem('current_course_id');
        // Simple heuristic: Generated IDs are usually UUIDs (>30 chars), static IDs are shorter
        if (currentCourseId && currentCourseId.length > 30) {
          navigate(`/generated-lesson/${currentCourseId}`);
        } else if (currentCourseId) {
          navigate(`/lesson/${currentCourseId}`);
        } else {
          console.warn("No course ID context for Lesson view");
          navigate('/');
        }
        break;

      // Feature Hubs
      case ViewState.BLENDER: navigate('/blender'); break;
      case ViewState.PROGRAMMING: navigate('/programming'); break;
      case ViewState.PROGRAMMING_WEB: navigate('/programming/web'); break;
      case ViewState.PROGRAMMING_AI: navigate('/programming/ai'); break;
      case ViewState.PROGRAMMING_VIBE: navigate('/vibe'); break;
      case ViewState.VIBE_PATH: navigate('/vibe'); break;
      case ViewState.UNITY_AI_GAME_DEV: navigate('/unity'); break;
      case ViewState.ART_MUSEUM: navigate('/art'); break;
      case ViewState.SONIC_LAB: navigate('/sonic'); break;
      case ViewState.SONIC_SYNTH: navigate('/sonic/synth'); break;
      case ViewState.P_SCHOOL: navigate('/p-school'); break;

      // Specific Tools
      case ViewState.COURSE_GENERATOR: navigate('/course-generator'); break;
      case ViewState.AI_DIAGNOSIS: navigate('/assessment'); break;
      case ViewState.LIFE_JOURNAL: navigate('/life-journal'); break;
      case ViewState.LIFE_JOURNAL_MONTHLY: navigate('/life-journal/monthly'); break;
      case ViewState.LIFE_JOURNAL_INSIGHTS: navigate('/life-journal/insights'); break;
      case ViewState.LIFE_JOURNAL_CHAT: navigate('/life-journal/chat'); break;
      case ViewState.AI_CHARACTERS: navigate('/characters'); break;

      // Deep Links (Mapping known sub-routes)
      case ViewState.HTML_CSS_PATH: navigate('/programming/html-css'); break;
      case ViewState.HTML_CSS_COURSE: navigate('/programming/html-css/course'); break;
      case ViewState.HTML_CSS_PART_TWO: navigate('/programming/html-css/part2'); break;
      case ViewState.WEB_INSPECTOR: navigate('/programming/web-inspector'); break;
      case ViewState.PYTHON_COURSE: navigate('/programming/python'); break;

      // Art Sub-routes
      case ViewState.ART_HISTORY: navigate('/art/history'); break;
      case ViewState.ART_CURRICULUM: navigate('/art/curriculum'); break;
      case ViewState.ART_INTRO: navigate('/art/intro'); break;
      case ViewState.ART_PERIOD_DETAIL: navigate('/art/period'); break;
      case ViewState.ART_CRAFTS: navigate('/art/crafts'); break;
      case ViewState.ART_KINTSUGI: navigate('/art/kintsugi'); break;
      case ViewState.ART_TRIBAL: navigate('/art/tribal'); break;
      case ViewState.ART_TRIBAL_DETAIL: navigate('/art/tribal/intro'); break; // Default

      // Fallback
      default: console.warn('Unhandled navigation:', view); navigate('/'); break;
    }
  };

  const handleCourseSelect = async (course: Course) => {
    if (course.id === 'vibe-coding') { navigate('/vibe'); return; }
    if (course.id === 'blender-3d') { navigate('/blender'); return; }
    if (course.id === 'art-atelier') { navigate('/art'); return; }
    if (course.id === 'scratch-game') { navigate('/p-school'); return; }
    if (course.id === 'unity-ai') { navigate('/unity'); return; }
    if (course.id === 'web-basics') { navigate('/programming/web'); return; }
    if (course.id === 'gen-ai-camp') { navigate('/programming/ai'); return; }

    // Generated Courses
    if (course.source === 'generated') {
      navigate(`/generated-course/${course.id}`);
    } else {
      // Static/Standard Courses
      navigate(`/course/${course.id}`);
    }
  };

  const handleGeneratedCourseSelect = (course: GeneratedCourse) => {
    navigate(`/generated-course/${course.id}`);
  };

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setIsLoginPageVisible(true);
  };

  const handleLoginSuccess = () => {
    setIsLoginPageVisible(false);
    navigate('/', { replace: true });
  };

  const handleBackToLogin = () => {
    setAuthMode('login');
    setIsLoginPageVisible(true);
    navigate('/', { replace: true });
  };

  // Vibe Chapter Navigation Helper
  const navigateToVibeChapter = (chapter: string) => {
    navigate(`/vibe/${chapter}`);
  };

  return (
    <>
      {authLoading ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black text-white/50 text-sm font-mono">
          Loading…
        </div>
      ) : (!isLoggedIn && location.pathname !== '/aidj') ? (
        location.pathname === '/auth/callback' ? (
          <AuthCallbackView onSuccess={handleLoginSuccess} />
        ) : location.pathname === '/auth/confirm-pending' ? (
          <AuthConfirmPendingView onBackToLogin={handleBackToLogin} />
        ) : isLoginPageVisible ? (
          <LoginView initialMode={authMode} onLoginSuccess={handleLoginSuccess} />
        ) : (
          <LandingView onAuthClick={openAuth} />
        )
      ) : (
        <>
          {location.pathname === '/aidj' ? (
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/aidj" element={<AidjCurriculumView />} />
              </Routes>
            </Suspense>
          ) : (
            <Layout currentView={getCurrentViewState()} onNavigate={handleNavigate}>
              <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Dashboard onNavigate={handleNavigate} />} />
                <Route path="/aidj" element={<AidjCurriculumView />} />
              <Route path="/learning-hub" element={<LearningHub onNavigate={handleNavigate} />} />
              <Route path="/courses" element={<CourseList onSelectCourse={handleCourseSelect} />} />
              <Route path="/course/:courseId" element={<CoursePathViewWrapper />} />

              {/* My Content & Generated Courses */}
              <Route path="/my-content" element={<MyContent onNavigate={handleNavigate} onSelectCourse={handleGeneratedCourseSelect} />} />
              <Route path="/generated-course/:courseId" element={<GeneratedCourseViewWrapper />} />
              <Route path="/generated-lesson/:courseId" element={<GeneratedLessonViewWrapper />} />
              <Route path="/generated-course/:courseId/encyclopedia" element={<EncyclopediaView />} />
              <Route path="/course-generator" element={<CourseGeneratorView onBack={() => navigate('/')} onCourseGenerated={(c) => { navigate(`/generated-course/${c.id}`); }} onNavigate={handleNavigate} />} />

              {/* Standard Lesson View (Mock/Demo) */}
              <Route path="/lesson/:courseId" element={<LessonViewWrapper />} />

              {/* Assessment & Profile */}
              <Route path="/assessment" element={<PersonalAssessmentView onNavigate={handleNavigate} />} />
              <Route path="/life-journal/chat" element={<LifeJournalChatView onNavigate={handleNavigate} />} />
              <Route path="/life-journal/insights" element={<LifeJournalInsightsView onNavigate={handleNavigate} />} />
              <Route path="/life-journal/monthly" element={<LifeJournalMonthlyView onNavigate={handleNavigate} />} />
              <Route path="/life-journal" element={<LifeJournalView onNavigate={handleNavigate} />} />
              <Route path="/profile" element={<ProfilePassport onNavigate={handleNavigate} />} />
              <Route path="/profile/diagnosis" element={<ProfileDiagnosisView onNavigate={handleNavigate} />} />
              <Route path="/profile/history" element={<ProfileHistoryView onNavigate={handleNavigate} />} />
              <Route path="/profile/badges" element={<ProfileBadgesView />} />
              <Route path="/profile/generated" element={<ProfileGeneratedView onNavigate={handleNavigate} />} />
              <Route path="/profile/edit" element={<ProfileEditView onNavigate={handleNavigate} />} />
              <Route path="/profile/mirror" element={<LearningMirrorView />} />
              <Route path="/settings/voice/dialogue" element={<SettingsDialogueVoiceView onNavigate={handleNavigate} />} />
              <Route path="/settings/voice" element={<SettingsVoiceView onNavigate={handleNavigate} />} />
              <Route path="/settings/api-key" element={<SettingsApiKeyView onNavigate={handleNavigate} />} />
              <Route path="/settings/ai-memory" element={<SettingsAiMemoryView onNavigate={handleNavigate} />} />
              <Route path="/settings/privacy" element={<SettingsPrivacyView onNavigate={handleNavigate} />} />
              <Route path="/settings" element={<SettingsView onNavigate={handleNavigate} />} />
              <Route path="/notifications" element={<NotificationsView onNavigate={handleNavigate} />} />
              <Route path="/subscription" element={<SubscriptionView onNavigate={handleNavigate} />} />
              <Route path="/library" element={<Library />} />
              <Route path="/characters" element={<AICharacterIntroView onNavigate={handleNavigate} onSelectCharacter={(id) => navigate(`/character/${id}`)} />} />
              <Route path="/character/:characterId" element={<AICharacterDetailViewWrapper onNavigate={handleNavigate} />} />

              {/* Blender */}
              <Route path="/blender" element={<BlenderCurriculum onNavigate={handleNavigate} />} />
              <Route path="/blender/path" element={<BlenderPathView onBack={() => navigate('/blender')} onStartLesson={(stageId) => navigate(`/blender/lesson/${stageId}`)} />} />
              <Route path="/blender/lesson/:stageId" element={<BlenderLessonViewWrapper />} />
              <Route path="/blender/teacher-bot" element={<TeacherBotLiveView onBack={() => navigate('/learning-hub')} />} />

              {/* Programming Hubs */}
              <Route path="/programming" element={<ProgrammingCurriculum onNavigate={handleNavigate} initialTrack="web" />} />
              <Route path="/programming/web" element={<ProgrammingCurriculum onNavigate={handleNavigate} initialTrack="web" />} />
              <Route path="/programming/ai" element={<ProgrammingCurriculum onNavigate={handleNavigate} initialTrack="ai" />} />
              <Route path="/programming/python" element={<PythonBeginnerView onBack={() => navigate('/programming/ai')} />} />
              <Route path="/programming/path" element={<ProgrammingCourseView onBack={() => navigate('/programming')} />} />

              {/* HTML/CSS Path */}
              <Route path="/programming/html-css" element={<HtmlCssPathView onBack={() => navigate('/programming/web')} onNavigate={handleNavigate} />} />
              <Route path="/programming/html-css/course" element={<HtmlCssView onBack={() => navigate('/programming/html-css')} />} />
              <Route path="/programming/html-css/part2" element={<HtmlCssPartTwoView onBack={() => navigate('/programming/html-css')} />} />
              <Route path="/programming/web-inspector" element={<WebInspectorView onBack={() => navigate('/programming/html-css')} onNavigate={handleNavigate} />} />

              {/* Vibe Coding */}
              <Route path="/vibe" element={<VibePathView onBack={() => navigate('/learning-hub')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/prologue" element={<VibePrologueView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-0" element={<VibeChapterZeroView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-1" element={<VibeChapterOneView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-2" element={<VibeChapterTwoView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-3" element={<VibeChapterThreeView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-4" element={<VibeChapterFourView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-5" element={<VibeChapterFiveView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-6" element={<VibeChapterSixView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-7" element={<VibeChapterSevenView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-8" element={<VibeChapterEightView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-9" element={<VibeChapterNineView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-10" element={<VibeChapterTenView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/chapter-11" element={<VibeChapterElevenView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />

              {/* Unity */}
              <Route path="/unity" element={<UnityPathView onBack={() => navigate('/learning-hub')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/unity/:chapterId" element={<UnityChapterWrapper language={language} setLanguage={setLanguage} onNavigate={handleNavigate} />} />

              {/* Art */}
              <Route path="/art" element={<ArtMuseumView onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/art/history" element={<ArtHistoryView onBack={() => navigate('/art')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/art/curriculum" element={<ArtCurriculumView onBack={() => navigate('/art')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/art/intro" element={<ArtIntroView onBack={() => navigate('/art/curriculum')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/art/period" element={<ArtPeriodDetailView onBack={() => navigate('/art/curriculum')} language={language} setLanguage={setLanguage} />} />
              <Route path="/art/crafts" element={<ArtCraftsView onBack={() => navigate('/art')} onSelectCraft={(id) => navigate(`/art/craft/${id}`)} language={language} setLanguage={setLanguage} />} />
              <Route path="/art/craft/:craftId" element={<ArtCraftDetailViewWrapper language={language} setLanguage={setLanguage} />} />
              <Route path="/art/kintsugi" element={<ArtKintsugiView onBack={() => navigate('/art/crafts')} language={language} setLanguage={setLanguage} />} />
              <Route path="/art/tribal" element={<ArtTribalView onBack={() => navigate('/art')} onSelectChapter={(id) => navigate(`/art/tribal/${id}`)} language={language} setLanguage={setLanguage} />} />
              <Route path="/art/tribal/:chapterId" element={<ArtTribalDetailViewWrapper language={language} setLanguage={setLanguage} />} />

              {/* Sonic */}
              <Route path="/sonic" element={<SonicLabView onNavigate={handleNavigate} />} />
              <Route path="/sonic/synth" element={<SonicSynthView onBack={() => navigate('/sonic')} />} />

              {/* P-School */}
              <Route path="/p-school" element={<PSchoolView />} />

              {/* Demos */}
              <Route path="/demo/multi" element={<MultiFormatLessonView onBack={() => navigate('/')} />} />
              <Route path="/demo/checklist-gen" element={<BlenderChecklistGeneratorView onBack={() => navigate('/')} />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </Layout>
          )}
          <FloatingChatbot />
        </>
      )}
    </>
  );
};

// --- Inline Wrappers for less common dynamic routes ---

const AICharacterDetailViewWrapper: React.FC<{ onNavigate: (v: ViewState) => void }> = ({ onNavigate }) => {
  const { characterId } = useParams<{ characterId: string }>();
  const navigate = useNavigate();
  return <AICharacterDetailView characterId={characterId || 'openness'} onNavigate={onNavigate} onBack={() => navigate('/characters')} />;
};

const BlenderLessonViewWrapper: React.FC = () => {
  const { stageId } = useParams<{ stageId: string }>();
  const navigate = useNavigate();
  return <BlenderLessonView stageId={Number(stageId) || 1} onBack={() => navigate('/blender/path')} onComplete={() => navigate('/blender/path')} />;
};

const UnityChapterWrapper: React.FC<{ language: any, setLanguage: any, onNavigate: any }> = ({ language, setLanguage, onNavigate }) => {
  const { chapterId } = useParams<{ chapterId: string }>();
  const navigate = useNavigate();
  // Map URL param to ViewState for the component (it expects ViewState)
  // NOTE: UnityChapterView expects 'viewState' prop to determine content. 
  // We need to map chapterId to ViewState.
  let vs = ViewState.UNITY_CHAPTER_0;
  if (chapterId === 'chapter-1') vs = ViewState.UNITY_CHAPTER_1;
  if (chapterId === 'chapter-2') vs = ViewState.UNITY_CHAPTER_2;
  if (chapterId === 'chapter-3') vs = ViewState.UNITY_CHAPTER_3;

  return <UnityChapterView viewState={vs} onBack={() => navigate('/unity')} onNavigate={onNavigate} language={language} setLanguage={setLanguage} />;
};

const ArtCraftDetailViewWrapper: React.FC<{ language: any, setLanguage: any }> = ({ language, setLanguage }) => {
  const { craftId } = useParams<{ craftId: string }>();
  const navigate = useNavigate();
  if (craftId === 'kintsugi') return <ArtKintsugiView onBack={() => navigate('/art/crafts')} language={language} setLanguage={setLanguage} />;
  return <ArtCraftDetailView craftId={craftId || 'urushi'} onBack={() => navigate('/art/crafts')} language={language} setLanguage={setLanguage} />;
};

const ArtTribalDetailViewWrapper: React.FC<{ language: any, setLanguage: any }> = ({ language, setLanguage }) => {
  const { chapterId } = useParams<{ chapterId: string }>();
  const navigate = useNavigate();
  return <ArtTribalDetailView chapterId={chapterId || 'intro'} onBack={() => navigate('/art/tribal')} language={language} setLanguage={setLanguage} />;
};

const App: React.FC = () => (
  <ErrorBoundary>
    <LanguageProvider>
      <AuthProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </AuthProvider>
    </LanguageProvider>
  </ErrorBoundary>
);

export default App;
