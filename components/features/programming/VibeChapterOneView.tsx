import React from 'react';
import { ViewState } from '../../../types';
import VibeDocView from './VibeDocView';
import { VIBE_CHAPTER_1_DATA } from '../../../data/curricula/vibe_coding/chapter1';
import { VIBE_CHAPTER_1_QUIZ } from '../../../data/curricula/vibe_coding/chapter1_quiz';

interface VibeChapterOneViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const VibeChapterOneView: React.FC<VibeChapterOneViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {
  // In the future, we can switch data based on language props
  // For now, we use the hardcoded Japanese content as requested
  
  return (
    <VibeDocView 
      chapter={VIBE_CHAPTER_1_DATA}
      onBack={onBack}
      onNavigate={onNavigate}
      pdfUrl="/slides/chapter1.pdf"
      quizData={VIBE_CHAPTER_1_QUIZ}
    />
  );
};

export default VibeChapterOneView;