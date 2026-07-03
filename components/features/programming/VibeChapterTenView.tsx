import React from 'react';
import { ViewState } from '../../../types';
import VibeDocView from './VibeDocView';
import { VIBE_CHAPTER_10_DATA } from '../../../data/curricula/vibe_coding/chapter10';

interface VibeChapterTenViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const VibeChapterTenView: React.FC<VibeChapterTenViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {
  return (
    <VibeDocView 
      chapter={VIBE_CHAPTER_10_DATA}
      onBack={onBack}
      onNavigate={onNavigate}
    />
  );
};

export default VibeChapterTenView;