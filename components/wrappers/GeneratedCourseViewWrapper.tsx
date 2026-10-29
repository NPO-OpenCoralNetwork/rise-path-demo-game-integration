import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchGeneratedCourseById } from '../../services/curriculumApi';
import { apiFetch } from '../../services/apiClient';
import { isSignInRequired, parseResumeCard } from '../../services/generatedCourses';
import GeneratedCoursesSignInNotice from '../common/GeneratedCoursesSignInNotice';
import GeneratedCourseView from '../features/ai/GeneratedCourseView';
import type { ResumeCardData } from '../features/ai/GeneratedCourseView';
import { GeneratedCourse } from '../../types';
import { useLanguage } from '../../context/LanguageContext';

const copy = {
  en: {
    loading: 'Loading course...',
    noCourseId: 'No course ID provided',
    loadFailed: 'Failed to load course',
    notFound: 'Course not found',
    notFoundBody: "The course you're looking for doesn't exist or couldn't be loaded.",
    backToCourses: 'Back to Courses',
  },
  jp: {
    loading: 'コースを読み込み中...',
    noCourseId: 'コースIDが指定されていません',
    loadFailed: 'コースを読み込めませんでした',
    notFound: 'コースが見つかりません',
    notFoundBody: 'お探しのコースは存在しないか、読み込めませんでした。',
    backToCourses: 'コース一覧に戻る',
  },
} as const;

const GeneratedCourseViewWrapper: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = copy[language];
  const [course, setCourse] = useState<GeneratedCourse | null>(null);
  const [resumeCard, setResumeCard] = useState<ResumeCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'noCourseId' | 'loadFailed' | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);

  useEffect(() => {
    if (!courseId) {
      setError('noCourseId');
      setLoading(false);
      return;
    }

    // Another course in the same page (history): nothing of the previous one stays.
    setCourse(null);
    setResumeCard(null);
    setError(null);
    setSignInRequired(false);
    setLoading(true);

    // Track active curriculum for dashboard widget
    localStorage.setItem('active_curriculum_id', courseId);

    fetchGeneratedCourseById(courseId)
      .then((data) => setCourse(data))
      .catch((err) => {
        if (isSignInRequired(err)) setSignInRequired(true);
        else setError('loadFailed');
      })
      .finally(() => setLoading(false));

    // Fetch resume card (best-effort). The route answers { ok: true, ...card }.
    apiFetch(`/curricula/${courseId}/resume`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        const card = parseResumeCard<ResumeCardData>(data);
        if (card) setResumeCard(card);
      })
      .catch(() => {});
  }, [courseId]);

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
  if (error || !course) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-md" role="alert">
          <h2 className="text-2xl font-bold text-danger mb-4">{error ? t[error] : t.notFound}</h2>
          <p className="text-slate-500 mb-6">{t.notFoundBody}</p>
          <button
            type="button"
            onClick={() => navigate('/courses')}
            className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 transition-all"
          >
            {t.backToCourses}
          </button>
        </div>
      </div>
    );
  }

  // Navigate to specific lesson
  const handleStartLesson = (moduleIndex: number, lessonIndex: number) => {
    navigate(`/generated-lesson/${course.id}?module=${moduleIndex}&lessonIndex=${lessonIndex}`);
  };

  return (
    <GeneratedCourseView
      course={course}
      onBack={() => navigate('/courses')}
      onStartLesson={handleStartLesson}
      resumeCard={resumeCard}
    />
  );
};

export default GeneratedCourseViewWrapper;
