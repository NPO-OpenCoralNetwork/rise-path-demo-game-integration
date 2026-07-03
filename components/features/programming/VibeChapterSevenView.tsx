import React from 'react';
import { ViewState } from '../../../types';
import VibeDocView from './VibeDocView';
import { VIBE_CHAPTER_7_DATA } from '../../../data/curricula/vibe_coding/chapter7';

interface VibeChapterSevenViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const VibeChapterSevenView: React.FC<VibeChapterSevenViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {
  return (
    <VibeDocView 
      chapter={VIBE_CHAPTER_7_DATA}
      onBack={onBack}
      onNavigate={onNavigate}
    />
  );
};

export default VibeChapterSevenView;