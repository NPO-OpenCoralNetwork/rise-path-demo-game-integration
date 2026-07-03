import React from 'react';
import { ViewState } from '../../../types';
import VibeDocView from './VibeDocView';
import { VIBE_CHAPTER_5_DATA } from '../../../data/curricula/vibe_coding/chapter5';

interface VibeChapterFiveViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const VibeChapterFiveView: React.FC<VibeChapterFiveViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {
  return (
    <VibeDocView 
      chapter={VIBE_CHAPTER_5_DATA}
      onBack={onBack}
      onNavigate={onNavigate}
    />
  );
};

export default VibeChapterFiveView;