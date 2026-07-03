import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getCourseById } from '../../services/curriculumData';
import CoursePathView from '../features/dashboard/CoursePathView';
import { ViewState } from '../../types';

const CoursePathViewWrapper: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const course = courseId ? getCourseById(courseId) : undefined;

  if (!course) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold text-red-500">Course not found</h2>
        <button 
          onClick={() => navigate('/courses')}
          className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-lg"
        >
          Back to Courses
        </button>
      </div>
    );
  }

  return (
    <CoursePathView
      course={course}
      onStartLesson={() => navigate(`/lesson/${course.id}`)}
      onBack={() => navigate('/courses')}
    />
  );
};

export default CoursePathViewWrapper;
