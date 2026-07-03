import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import LessonView from '../common/LessonView';

const LessonViewWrapper: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  return (
    <LessonView
      courseId={courseId}
      onBack={() => navigate(`/course/${courseId}`)}
    />
  );
};

export default LessonViewWrapper;