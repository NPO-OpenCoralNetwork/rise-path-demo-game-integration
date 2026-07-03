import React from 'react';
import { ViewState } from '../../../types';
import VibeDocView from './VibeDocView';
import { VIBE_CHAPTER_8_DATA } from '../../../data/curricula/vibe_coding/chapter8';

interface VibeChapterEightViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const VibeChapterEightView: React.FC<VibeChapterEightViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {
  return (
    <VibeDocView 
      chapter={VIBE_CHAPTER_8_DATA}
      onBack={onBack}
      onNavigate={onNavigate}
    />
  );
};

export default VibeChapterEightView;