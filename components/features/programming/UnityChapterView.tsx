import React from 'react';
import { ViewState } from '../../../types';
import VibeDocView from './VibeDocView';
import { UNITY_CHAPTER_0_DATA } from '../../../data/curricula/unity_ai/chapter0';
import { UNITY_CHAPTER_1_DATA } from '../../../data/curricula/unity_ai/chapter1';
import { UNITY_CHAPTER_2_DATA } from '../../../data/curricula/unity_ai/chapter2';
import { UNITY_CHAPTER_3_DATA } from '../../../data/curricula/unity_ai/chapter3';

// Map ViewState or Chapter ID to Data
const CHAPTER_DATA_MAP = {
  [ViewState.UNITY_CHAPTER_0]: UNITY_CHAPTER_0_DATA,
  [ViewState.UNITY_CHAPTER_1]: UNITY_CHAPTER_1_DATA,
  [ViewState.UNITY_CHAPTER_2]: UNITY_CHAPTER_2_DATA,
  [ViewState.UNITY_CHAPTER_3]: UNITY_CHAPTER_3_DATA,
};

interface UnityChapterViewProps {
  viewState: ViewState; // Use ViewState to determine content
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const UnityChapterView: React.FC<UnityChapterViewProps> = ({ 
  viewState, 
  onBack, 
  onNavigate, 
  language, 
  setLanguage 
}) => {
  // @ts-ignore - Indexing with enum is safe here as we only pass valid keys from App.tsx
  const chapterDataBundle = CHAPTER_DATA_MAP[viewState];

  if (!chapterDataBundle) {
    return <div className="p-8 text-center">Chapter data not found.</div>;
  }

  // Handle the bundled localized data { jp: ..., en: ... }
  const chapterData = chapterDataBundle[language] || chapterDataBundle['en'];

  return (
    <VibeDocView 
      chapter={chapterData}
      onBack={onBack}
      onNavigate={onNavigate}
      language={language}
      setLanguage={setLanguage}
    />
  );
};

export default UnityChapterView;
