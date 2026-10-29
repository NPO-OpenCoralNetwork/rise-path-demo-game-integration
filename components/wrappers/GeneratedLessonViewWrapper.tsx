import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchGeneratedCourseById } from '../../services/curriculumApi';
import { isSignInRequired } from '../../services/generatedCourses';
import GeneratedCoursesSignInNotice from '../common/GeneratedCoursesSignInNotice';
import GeneratedDocView from '../features/ai/GeneratedDocView';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import {
  convertToGeneratedCurriculumV2,
  GeneratedCurriculumV2,
  GeneratedLesson,
  getLessonById,
  CurriculumPersonalization
} from '../../services/curriculumAdapter';
import { reportNexloomLessonCompletion, toNexloomLessonPayload } from '../../services/nexloomWorldsBridge';

const copy = {
  en: {
    loading: 'Loading lesson...',
    noCourseId: 'No course ID provided',
    noLessons: 'No lessons found in this curriculum',
    loadFailed: 'Failed to load course',
    notFound: 'Lesson not found',
    notFoundBody: "The lesson you're looking for doesn't exist or couldn't be loaded.",
    backToMyContent: 'Back to My Content',
  },
  jp: {
    loading: 'レッスンを読み込み中...',
    noCourseId: 'コースIDが指定されていません',
    noLessons: 'このカリキュラムにはレッスンがありません',
    loadFailed: 'コースを読み込めませんでした',
    notFound: 'レッスンが見つかりません',
    notFoundBody: 'お探しのレッスンは存在しないか、読み込めませんでした。',
    backToMyContent: 'マイコンテンツに戻る',
  },
} as const;

type LessonError = 'noCourseId' | 'noLessons' | 'loadFailed';

const GeneratedLessonViewWrapper: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { language, setLanguage } = useLanguage();
  const { user } = useAuth();

  const [curriculum, setCurriculum] = useState<GeneratedCurriculumV2 | null>(null);
  const [currentLesson, setCurrentLesson] = useState<GeneratedLesson | null>(null);
  const [lessonIndex, setLessonIndex] = useState<{ module: number; lesson: number }>({ module: 0, lesson: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LessonError | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const t = copy[language];

  // Get lesson ID from URL params (optional)
  const lessonIdParam = searchParams.get('lesson');
  const moduleIndexParam = searchParams.get('module');
  const lessonIndexParam = searchParams.get('lessonIndex');

  useEffect(() => {
    if (!courseId) {
      setError('noCourseId');
      setLoading(false);
      return;
    }

    setCurriculum(null);
    setCurrentLesson(null);
    setLessonIndex({ module: 0, lesson: 0 });
    setError(null);
    setSignInRequired(false);
    setLoading(true);

    fetchGeneratedCourseById(courseId)
      .then((rawCourse) => {
        // Convert to V2 format using adapter
        const converted = convertToGeneratedCurriculumV2(rawCourse as any, courseId);
        setCurriculum(converted);

        // Determine which lesson to show
        let targetModuleIndex = 0;
        let targetLessonIndex = 0;

        if (lessonIdParam) {
          // Find lesson by ID
          const found = getLessonById(converted, lessonIdParam);
          if (found) {
            targetModuleIndex = found.moduleIndex;
            targetLessonIndex = found.lessonIndex;
          }
        } else if (moduleIndexParam && lessonIndexParam) {
          // Use explicit indices from URL
          targetModuleIndex = parseInt(moduleIndexParam, 10) || 0;
          targetLessonIndex = parseInt(lessonIndexParam, 10) || 0;
        }

        // Set current lesson
        const module = converted.modules[targetModuleIndex];
        if (module && module.lessons[targetLessonIndex]) {
          setCurrentLesson(module.lessons[targetLessonIndex]);
          setLessonIndex({ module: targetModuleIndex, lesson: targetLessonIndex });
        } else if (converted.modules.length > 0 && converted.modules[0].lessons.length > 0) {
          // Fallback to first lesson
          setCurrentLesson(converted.modules[0].lessons[0]);
          setLessonIndex({ module: 0, lesson: 0 });
        } else {
          setError('noLessons');
        }
      })
      .catch((err) => {
        if (isSignInRequired(err)) setSignInRequired(true);
        else setError('loadFailed');
      })
      .finally(() => setLoading(false));
  }, [courseId, lessonIdParam, moduleIndexParam, lessonIndexParam]);

  // Navigation helpers
  const getTotalLessons = () => {
    if (!curriculum) return 0;
    return curriculum.modules.reduce((sum, m) => sum + m.lessons.length, 0);
  };

  const getFlatLessonIndex = () => {
    if (!curriculum) return 0;
    let count = 0;
    for (let mi = 0; mi < lessonIndex.module; mi++) {
      count += curriculum.modules[mi].lessons.length;
    }
    return count + lessonIndex.lesson;
  };

  const navigateToLesson = (moduleIdx: number, lessonIdx: number) => {
    if (!curriculum) return;
    const module = curriculum.modules[moduleIdx];
    if (module && module.lessons[lessonIdx]) {
      setCurrentLesson(module.lessons[lessonIdx]);
      setLessonIndex({ module: moduleIdx, lesson: lessonIdx });
      // Update URL
      navigate(`/generated-lesson/${courseId}?module=${moduleIdx}&lessonIndex=${lessonIdx}`, { replace: true });
      // Scroll to top
      window.scrollTo(0, 0);
    }
  };

  const goToNextLesson = () => {
    if (!curriculum) return;
    const currentModule = curriculum.modules[lessonIndex.module];

    if (lessonIndex.lesson < currentModule.lessons.length - 1) {
      // Next lesson in same module
      navigateToLesson(lessonIndex.module, lessonIndex.lesson + 1);
    } else if (lessonIndex.module < curriculum.modules.length - 1) {
      // First lesson of next module
      navigateToLesson(lessonIndex.module + 1, 0);
    }
  };

  const goToPrevLesson = () => {
    if (!curriculum) return;

    if (lessonIndex.lesson > 0) {
      // Previous lesson in same module
      navigateToLesson(lessonIndex.module, lessonIndex.lesson - 1);
    } else if (lessonIndex.module > 0) {
      // Last lesson of previous module
      const prevModule = curriculum.modules[lessonIndex.module - 1];
      navigateToLesson(lessonIndex.module - 1, prevModule.lessons.length - 1);
    }
  };

  const hasNextLesson = () => {
    if (!curriculum) return false;
    const currentModule = curriculum.modules[lessonIndex.module];
    return (
      lessonIndex.lesson < currentModule.lessons.length - 1 ||
      lessonIndex.module < curriculum.modules.length - 1
    );
  };

  const hasPrevLesson = () => {
    return lessonIndex.lesson > 0 || lessonIndex.module > 0;
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500 font-medium">{t.loading}</p>
        </div>
      </div>
    );
  }

  if (signInRequired) {
    return (
      <div className="mx-auto w-full max-w-form px-4 py-12">
        <GeneratedCoursesSignInNotice />
      </div>
    );
  }

  // Error state
  if (error || !currentLesson || !curriculum) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-md" role="alert">
          <h2 className="text-2xl font-bold text-danger mb-4">{error ? t[error] : t.notFound}</h2>
          <p className="text-slate-500 mb-6">{t.notFoundBody}</p>
          <button
            type="button"
            onClick={() => navigate('/my-content')}
            className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 transition-all"
          >
            {t.backToMyContent}
          </button>
        </div>
      </div>
    );
  }

  // Get localized title for the header
  const courseTitle = typeof curriculum.title === 'string'
    ? curriculum.title
    : (curriculum.title[language] || curriculum.title.jp || curriculum.title.en || undefined);
  const handleComplete = () => {
    if (currentLesson) {
      void reportNexloomLessonCompletion({
        user,
        courseId,
        curriculum,
        lesson: toNexloomLessonPayload(currentLesson),
      });
    }
    navigate(`/generated-course/${courseId}`);
  };

  return (
    <GeneratedDocView
      lesson={currentLesson}
      onBack={() => navigate(`/generated-course/${courseId}`)}
      onComplete={handleComplete}
      onNextLesson={hasNextLesson() ? goToNextLesson : undefined}
      onPrevLesson={hasPrevLesson() ? goToPrevLesson : undefined}
      hasNext={hasNextLesson()}
      hasPrev={hasPrevLesson()}
      language={language}
      setLanguage={setLanguage}
      courseTitle={courseTitle}
      personalization={curriculum?.personalization}
      courseId={courseId}
    />
  );
};

export default GeneratedLessonViewWrapper;
