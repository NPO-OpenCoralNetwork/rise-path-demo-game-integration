import React, { Suspense, useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, useParams } from 'react-router-dom';
import { ViewState, GeneratedCourse, Course } from './types';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProgressAdoptDialog from './components/lesson/ProgressAdoptDialog';
import UnsavedLogoutDialog from './components/lesson/UnsavedLogoutDialog';
import SaveStoppedNotice from './components/lesson/SaveStoppedNotice';
import { VIEW_PATHS } from './navigation/viewPaths';
import { normalizePath, trackViewForPath } from './navigation/pathViews';
import { authReturnTarget, postSignInPath } from './navigation/authReturn';
import { features } from './config/features';
import { syncLegalGate, useLegalGate } from './components/legal/legalGateClient';
import LegalNoticeBar from './components/legal/LegalNoticeBar';

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
  VibePathView,
  ClaudeCodePathView,
  LearnRoute,
  DevBlocksRoute,
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
  AiAccessSetupView,
  AiSafetyGuideView,
  AdminSafetyView,
  OAuthConsentView,
  ConnectedAppsView,
  PlanView,
  PlanConfirmView,
  CommerceDisclosureView,
  DeleteAccountView,
  AccountDeletedView,
  TermsRoute,
  PrivacyRoute,
  LegalConsentView,
  ReviewView,
  TrainingRoute,
} from './components/routes/lazyRoutes';
import { OAUTH_CONSENT_PATH, pendingConsentReturnPath } from './services/oauthConsentRules';

/** sessionStorage key for the page to open after sign-in. */
const RETURN_TO_KEY = 'rp:returnTo';
/** Pages open when signed out; they render outside the Layout then. */
const PUBLIC_PATHS = new Set(['/aidj', '/ai-safety', '/legal/commerce', '/terms', '/privacy', '/account/deleted']);
/**
 * Pages that stay open while the signed-in learner has not accepted a terms version that requires
 * acceptance (Phase 4, design §4.3, finding 17): reading the texts and every public page, deleting
 * the account, withdrawing the guardian's AI consent, disconnecting AI apps, the privacy deletes,
 * AI memory and cancelling a plan (the portal; checkout is /settings/plan/confirm) never depend on
 * accepting new text. Everything else, P-School and /oauth/consent included, shows the
 * re-consent page (LegalConsentView) instead.
 */
const LEGAL_GATE_EXEMPT = new Set([
  ...PUBLIC_PATHS,
  '/settings/delete-account',
  '/settings/ai-access',
  '/settings/connected-apps',
  '/settings/privacy',
  '/settings/ai-memory',
  '/settings/plan',
]);
/** Pages that finish a sign-in: when the session is already there, they forward like handleLoginSuccess. */
const POST_SIGN_IN_PATHS = new Set(['/auth/callback', '/auth/confirm-pending']);

const readLocalStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * Where to go after sign-in: the saved in-app path, else a pending agent connection request
 * (/oauth/consent, kept in localStorage so email confirmation in another tab comes back), else
 * the dashboard. `consume` clears the saved path.
 */
const postSignInTarget = (consume: boolean): string => {
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(RETURN_TO_KEY);
    if (consume) sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // Storage blocked: fall through.
  }
  return postSignInPath(saved, pendingConsentReturnPath(readLocalStorage()));
};

/** Signed in on /auth/callback or /auth/confirm-pending (the session arrived first): forward once. */
const PostSignInRedirect: React.FC = () => {
  const [target] = useState(() => postSignInTarget(false));
  useEffect(() => {
    postSignInTarget(true);
  }, []);
  return <Navigate to={target} replace />;
};

const AppContent: React.FC = () => {
  const { language, setLanguage } = useLanguage();
  const { user, isLoggedIn, isLoading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Phase 4: whether the terms are accepted (components/legal/legalGateClient.ts; off unless
  // VITE_FEATURE_LEGAL_PAGES=true). Only `needed` blocks, and only outside LEGAL_GATE_EXEMPT.
  const legal = useLegalGate(features.legalPages);
  useEffect(() => {
    syncLegalGate(features.legalPages, user ? { id: user.id, email: user.email, isGuest: user.isGuest } : null);
  }, [user?.id, user?.email, user?.isGuest]);

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
    if (normalizePath(path) === '/review') return ViewState.REVIEW;
    if (path.startsWith('/profile/mirror')) return ViewState.PROFILE_MIRROR;
    if (path.startsWith('/profile/generated')) return ViewState.PROFILE_GENERATED;
    if (path.startsWith('/profile/edit')) return ViewState.PROFILE_EDIT;
    if (path.startsWith('/profile')) return ViewState.PROFILE;
    if (path.startsWith('/settings/admin/safety')) return ViewState.SETTINGS_ADMIN_SAFETY;
    if (path.startsWith('/settings/ai-access')) return ViewState.SETTINGS_AI_ACCESS;
    if (path.startsWith('/settings/connected-apps')) return ViewState.SETTINGS_CONNECTED_APPS;
    if (path.startsWith('/settings/plan/confirm')) return ViewState.SETTINGS_PLAN_CONFIRM;
    if (path.startsWith('/settings/plan')) return ViewState.SETTINGS_PLAN;
    if (path.startsWith('/ai-safety')) return ViewState.AI_SAFETY;
    if (path.startsWith('/legal/commerce')) return ViewState.LEGAL_COMMERCE;
    if (normalizePath(path) === '/terms') return ViewState.LEGAL_TERMS;
    if (normalizePath(path) === '/privacy') return ViewState.LEGAL_PRIVACY;
    if (path === '/account/deleted') return ViewState.ACCOUNT_DELETED;
    if (path.startsWith('/settings/delete-account')) return ViewState.SETTINGS_DELETE_ACCOUNT;
    if (path.startsWith('/settings/voice/dialogue')) return ViewState.SETTINGS_DIALOGUE_VOICE;
    if (path.startsWith('/settings/ai-memory')) return ViewState.SETTINGS_AI_MEMORY;
    if (path.startsWith('/settings/privacy')) return ViewState.SETTINGS_PRIVACY;
    if (path.startsWith('/settings/api-key')) return ViewState.SETTINGS_API_KEY;
    if (path.startsWith('/settings/voice')) return ViewState.SETTINGS_VOICE;
    if (path.startsWith('/settings')) return ViewState.SETTINGS;
    if (path.startsWith('/notifications')) return ViewState.NOTIFICATIONS;
    if (path.startsWith('/subscription')) return ViewState.SETTINGS;
    if (path.startsWith('/life-journal/chat')) return ViewState.LIFE_JOURNAL_CHAT;
    if (path.startsWith('/life-journal/insights')) return ViewState.LIFE_JOURNAL_INSIGHTS;
    if (path.startsWith('/life-journal/monthly')) return ViewState.LIFE_JOURNAL_MONTHLY;
    if (path.startsWith('/life-journal')) return ViewState.LIFE_JOURNAL;
    if (path.startsWith('/assessment')) return ViewState.AI_DIAGNOSIS;
    if (path.startsWith('/course-generator')) return ViewState.COURSE_GENERATOR;
    if (path.startsWith('/characters') || path.startsWith('/character')) return ViewState.AI_CHARACTERS;
    if (path.startsWith('/blender')) return ViewState.BLENDER;
    // /programming and /vibe: light or dark shell to match each page ("/vibe/" is "/vibe").
    const trackView = trackViewForPath(normalizePath(path));
    if (trackView) return trackView as ViewState;
    if (path.startsWith('/art')) return ViewState.ART_MUSEUM;
    if (path.startsWith('/sonic')) return ViewState.SONIC_LAB;
    if (path.startsWith('/claude-code')) return ViewState.CLAUDE_CODE;
    if (path.startsWith('/unity')) return ViewState.UNITY_AI_GAME_DEV;
    if (path === '/library') return ViewState.LIBRARY;
    // Lesson reader (default theme; the shell switches to the rail via isLessonPath).
    if (path.startsWith('/learn/') || path.startsWith('/preview/')) return ViewState.LESSON;
    if (path === '/dev/blocks') return ViewState.DEV_BLOCKS;
    if (path === '/training' || path.startsWith('/training/')) return ViewState.TRAINING;
    return ViewState.DASHBOARD;
  };

  const handleNavigate = (view: ViewState) => {
    const path = VIEW_PATHS[view];
    if (path) {
      navigate(path);
      return;
    }
    console.warn('Unhandled navigation:', view);
    navigate('/');
  };

  // Phase 5 (O4): false = the learner chose to stay signed in (unsaved lesson records): stay here.
  const handleLogout = () => {
    logout()
      .then((done) => { if (done !== false) navigate('/', { replace: true }); })
      .catch((error) => { console.warn('Logout failed:', error); navigate('/', { replace: true }); });
  };

  const handleCourseSelect = async (course: Course) => {
    if (course.id === 'vibe-coding') { navigate('/vibe'); return; }
    if (course.id === 'claude-code') { navigate('/claude-code'); return; }
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

  // In-app path to open after sign-in: the landing's "read chapter 1" CTA when guest access is
  // off; else, unless an AI app's connection request is waiting (postSignInTarget returns to it),
  // the page the visitor opened (a shared lesson link shows the landing at that URL).
  // sessionStorage, so it survives the OAuth redirect through /auth/callback.
  const openAuth = (mode: AuthMode, returnTo?: string) => {
    const consentWaiting = pendingConsentReturnPath(readLocalStorage()) !== null;
    const target = authReturnTarget(returnTo, location, consentWaiting);
    try {
      if (target) sessionStorage.setItem(RETURN_TO_KEY, target);
      else sessionStorage.removeItem(RETURN_TO_KEY);
    } catch {
      // Storage blocked: sign-in still works and lands on the dashboard.
    }
    setAuthMode(mode);
    setIsLoginPageVisible(true);
  };

  const handleLoginSuccess = () => {
    setIsLoginPageVisible(false);
    navigate(postSignInTarget(true), { replace: true });
  };

  const handleBackToLogin = () => {
    setAuthMode('login');
    setIsLoginPageVisible(true);
    navigate('/', { replace: true });
  };

  const publicPath = PUBLIC_PATHS.has(normalizePath(location.pathname));
  // Agent connection consent (Phase 1): outside the Layout, signed in or out, no chat widget.
  const consentPath = normalizePath(location.pathname) === OAUTH_CONSENT_PATH;

  return (
    <>
      {authLoading ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black text-white/50 text-sm font-mono">
          Loading…
        </div>
      ) : isLoggedIn && legal.status === 'needed' && !LEGAL_GATE_EXEMPT.has(normalizePath(location.pathname)) ? (
        <Suspense fallback={<RouteLoading />}>
          <LegalConsentView />
        </Suspense>
      ) : consentPath ? (
        !isLoggedIn && isLoginPageVisible ? (
          <LoginView initialMode={authMode} onLoginSuccess={handleLoginSuccess} />
        ) : (
          <Suspense fallback={<RouteLoading />}>
            <OAuthConsentView onSignIn={openAuth} />
          </Suspense>
        )
      ) : isLoggedIn && POST_SIGN_IN_PATHS.has(normalizePath(location.pathname)) ? (
        <PostSignInRedirect />
      ) : (!isLoggedIn && !publicPath) ? (
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
          {normalizePath(location.pathname) === '/aidj' || (!isLoggedIn && publicPath) ? (
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/aidj" element={<AidjCurriculumView />} />
                {/* Public guide for children and guardians (signed out: its own header, no Layout). */}
                <Route path="/ai-safety" element={<AiSafetyGuideView />} />
                {/* Phase 3: 特定商取引法に基づく表記 (public; Stripe's commerce disclosure link). */}
                <Route path="/legal/commerce" element={<CommerceDisclosureView />} />
                {/* Phase 4: 利用規約 and プライバシーポリシー (LegalPagesOff unless VITE_FEATURE_LEGAL_PAGES=true). */}
                <Route path="/terms" element={<TermsRoute />} />
                <Route path="/privacy" element={<PrivacyRoute />} />
                {/* Phase 4: after an account deletion (this device is signed out by then). */}
                <Route path="/account/deleted" element={<AccountDeletedView />} />
              </Routes>
            </Suspense>
          ) : (
            // Phase 4: notice = a changed text (dismissible), or "please agree" on an exempt page.
            // Phase 5: and, while saving has stopped with lesson records unsaved, SaveStoppedNotice.
            <Layout currentView={getCurrentViewState()} onNavigate={handleNavigate} onLogout={handleLogout} notice={<>{features.legalPages ? <LegalNoticeBar /> : null}<SaveStoppedNotice /></>}>
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
              {/* The shared Hermes chat is off unless VITE_FEATURE_AGENT_CHAT=true (config/features.ts). */}
              <Route
                path="/life-journal/chat"
                element={features.agentChat
                  ? <LifeJournalChatView onNavigate={handleNavigate} />
                  : <Navigate to="/life-journal" replace />}
              />
              <Route path="/life-journal/insights" element={<LifeJournalInsightsView onNavigate={handleNavigate} />} />
              <Route path="/life-journal/monthly" element={<LifeJournalMonthlyView onNavigate={handleNavigate} />} />
              <Route path="/life-journal" element={<LifeJournalView onNavigate={handleNavigate} />} />
              <Route path="/profile" element={<ProfilePassport onNavigate={handleNavigate} />} />
              <Route path="/profile/diagnosis" element={<ProfileDiagnosisView onNavigate={handleNavigate} />} />
              <Route path="/profile/history" element={<ProfileHistoryView onNavigate={handleNavigate} />} />
              <Route path="/profile/badges" element={<ProfileBadgesView />} />
              {/* Phase 6: today's review cards (signed-in learners; the page explains sign-in to guests). */}
              <Route path="/review" element={<ReviewView />} />
              {/* Job training (doc/brushup-2026/training-plan.ja.md 4.6): only with VITE_FEATURE_TRAINING=true
                  (config/features.ts); otherwise the home page. */}
              <Route path="/training/*" element={features.training ? <TrainingRoute /> : <Navigate to="/" replace />} />
              <Route path="/profile/generated" element={<ProfileGeneratedView onNavigate={handleNavigate} />} />
              <Route path="/profile/edit" element={<ProfileEditView onNavigate={handleNavigate} />} />
              <Route path="/profile/mirror" element={<LearningMirrorView />} />
              <Route path="/settings/voice/dialogue" element={<SettingsDialogueVoiceView onNavigate={handleNavigate} />} />
              <Route path="/settings/voice" element={<SettingsVoiceView onNavigate={handleNavigate} />} />
              <Route path="/settings/api-key" element={<SettingsApiKeyView onNavigate={handleNavigate} />} />
              <Route path="/settings/ai-memory" element={<SettingsAiMemoryView onNavigate={handleNavigate} />} />
              <Route path="/settings/privacy" element={<SettingsPrivacyView onNavigate={handleNavigate} />} />
              {/* Phase 0.5 minor safeguards: birth month, guardian consent, admin safety page. */}
              <Route path="/settings/ai-access" element={<AiAccessSetupView />} />
              <Route path="/settings/admin/safety" element={<AdminSafetyView />} />
              {/* Phase 1: AI apps the learner connected to the remote MCP endpoint. */}
              <Route path="/settings/connected-apps" element={<ConnectedAppsView />} />
              {/* Phase 3: the supporter plan and its final confirmation screen, only with
                  VITE_FEATURE_BILLING=true (config/features.ts); otherwise Settings. */}
              <Route path="/settings/plan" element={features.billing ? <PlanView /> : <Navigate to="/settings" replace />} />
              <Route path="/settings/plan/confirm" element={features.billing ? <PlanConfirmView /> : <Navigate to="/settings" replace />} />
              <Route path="/ai-safety" element={<AiSafetyGuideView />} />
              <Route path="/legal/commerce" element={<CommerceDisclosureView />} />
              <Route path="/terms" element={<TermsRoute />} />
              <Route path="/privacy" element={<PrivacyRoute />} />
              {/* Phase 4: delete one's own Rise Path account; the page after it (signed in again). */}
              <Route path="/settings/delete-account" element={<DeleteAccountView />} />
              <Route path="/account/deleted" element={<AccountDeletedView />} />
              <Route path="/settings" element={<SettingsView onNavigate={handleNavigate} />} />
              <Route path="/notifications" element={<NotificationsView onNavigate={handleNavigate} />} />
              {/* The old mock plans page is gone: its URL goes to the plan page, or Settings while billing is off. */}
              <Route path="/subscription" element={<Navigate to={features.billing ? '/settings/plan' : '/settings'} replace />} />
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
              <Route path="/claude-code" element={<ClaudeCodePathView onBack={() => navigate('/learning-hub')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              <Route path="/vibe/prologue" element={<VibePrologueView onBack={() => navigate('/vibe')} onNavigate={handleNavigate} language={language} setLanguage={setLanguage} />} />
              {/* The 12 Vibe chapters now render in the lesson reader. */}
              <Route path="/vibe/:chapter" element={<VibeChapterRedirect />} />

              {/* Lesson reader (risepath.lesson/v1) */}
              <Route path="/learn/:courseSlug" element={<LearnRoute />} />
              <Route path="/learn/:courseSlug/:lessonId" element={<LearnRoute />} />
              {import.meta.env.DEV && (
                <Route path="/preview/:courseSlug/:lessonId" element={<LearnRoute mode="preview" />} />
              )}
              {import.meta.env.DEV && features.devSamples && (
                <Route path="/dev/blocks" element={<DevBlocksRoute />} />
              )}

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

              {/* Design-sample demos. Dev builds only, like their nav group; production sends /demo/* to "/". */}
              {import.meta.env.DEV && (
                <>
                  <Route path="/demo/multi" element={<MultiFormatLessonView onBack={() => navigate('/')} />} />
                  <Route path="/demo/checklist-gen" element={<BlenderChecklistGeneratorView onBack={() => navigate('/')} />} />
                  <Route path="/demo/:kind" element={<DemoBlockViewWrapper />} />
                </>
              )}

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </Layout>
          )}
          {/* Shared Hermes coach: mounted only when features.agentChat is on. The in-lesson tutor
              (components/lesson/TutorPanel) is separate and always available on /learn and /preview. */}
          {features.agentChat && <FloatingChatbot />}
        </>
      )}
    </>
  );
};

// --- Inline Wrappers for less common dynamic routes ---

/** Old chapter URLs (/vibe/chapter-N) → the lesson reader. Unknown slugs go to the path page. */
const VibeChapterRedirect: React.FC = () => {
  const { chapter = '' } = useParams<{ chapter: string }>();
  const match = /^chapter-(\d{1,2})$/.exec(chapter);
  const n = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 11) return <Navigate to="/vibe" replace />;
  return <Navigate to={`/learn/vibe-coding/vibe-ch${n}`} replace />;
};

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

// Design samples: one MultiFormatLessonView page per block type (/demo/concept, ...).
const DEMO_BLOCKS: Record<string, { blockType?: 'concept' | 'dialogue' | 'workshop' | 'reflection' | 'checklist'; subType?: 'blender' }> = {
  checklist: { blockType: 'checklist' },
  concept: { blockType: 'concept' },
  dialogue: { blockType: 'dialogue' },
  workshop: { blockType: 'workshop' },
  blender: { subType: 'blender' },
  reflection: { blockType: 'reflection' },
};

const DemoBlockViewWrapper: React.FC = () => {
  const { kind } = useParams<{ kind: string }>();
  const navigate = useNavigate();
  const demo = DEMO_BLOCKS[kind ?? ''];
  if (!demo) return <Navigate to="/demo/multi" replace />;
  return <MultiFormatLessonView forceBlockType={demo.blockType} forceSubType={demo.subType} onBack={() => navigate('/')} />;
};

const App: React.FC = () => (
  <ErrorBoundary>
    <LanguageProvider>
      <AuthProvider>
        <ThemeProvider>
          <AppContent />
          {/* Lesson progress nobody owns on this device: ask before adding it to the account. */}
          <ProgressAdoptDialog />
          {/* Phase 5 (O4): lesson records still unsaved at logout: ask before logging out. */}
          <UnsavedLogoutDialog />
        </ThemeProvider>
      </AuthProvider>
    </LanguageProvider>
  </ErrorBoundary>
);

export default App;
