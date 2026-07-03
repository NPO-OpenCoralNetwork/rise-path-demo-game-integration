import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchGeneratedCourseById } from '../../services/curriculumApi';
import GeneratedCourseView from '../features/ai/GeneratedCourseView';
import type { ResumeCardData } from '../features/ai/GeneratedCourseView';
import { GeneratedCourse } from '../../types';

const GeneratedCourseViewWrapper: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<GeneratedCourse | null>(null);
  const [resumeCard, setResumeCard] = useState<ResumeCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) {
      setError("No course ID provided");
      setLoading(false);
      return;
    }

    // Track active curriculum for dashboard widget
    localStorage.setItem('active_curriculum_id', courseId);

    fetchGeneratedCourseById(courseId)
      .then((data) => {
        console.log("[CourseWrapper] Course data fetched:", data);
        setCourse(data);
      })
      .catch((err) => {
        console.error("[CourseWrapper] Failed to load course:", err);
        setError("Failed to load course");
      })
      .finally(() => setLoading(false));

    // Fetch resume card (best-effort)
    fetch(`/api/v2/curricula/${courseId}/resume`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data?.resume_card) setResumeCard(data.resume_card); })
      .catch(() => {});
  }, [courseId]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500 font-medium">Loading course...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !course) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold text-red-500 mb-4">{error || "Course not found"}</h2>
          <p className="text-slate-500 mb-6">The course you're looking for doesn't exist or couldn't be loaded.</p>
          <button
            onClick={() => navigate('/courses')}
            className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 transition-all"
          >
            Back to Courses
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
