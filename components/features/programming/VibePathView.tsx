import React from 'react';
import { ViewState } from '../../../types';
import CoursePathView from './CoursePathView';

/** Vibe Coding course overview (/vibe): the shared course page for content/courses/vibe-coding. */

interface VibePathViewProps {
  onBack: () => void;
  onNavigate?: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage?: (lang: 'en' | 'jp') => void;
}

const BADGE = { en: 'Web × AI', jp: 'Web × AI' };

const VibePathView: React.FC<VibePathViewProps> = (props) => <CoursePathView courseSlug="vibe-coding" badge={BADGE} {...props} />;

export default VibePathView;
