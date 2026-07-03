import React from 'react';
import { ViewState } from '../../../types';
import VibeDocView from './VibeDocView';
import { VIBE_CHAPTER_9_DATA } from '../../../data/curricula/vibe_coding/chapter9';

interface VibeChapterNineViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const VibeChapterNineView: React.FC<VibeChapterNineViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {
  return (
    <VibeDocView 
      chapter={VIBE_CHAPTER_9_DATA}
      onBack={onBack}
      onNavigate={onNavigate}
    />
  );
};

export default VibeChapterNineView;