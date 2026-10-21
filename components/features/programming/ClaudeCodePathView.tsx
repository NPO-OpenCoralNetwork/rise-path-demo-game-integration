import React from 'react';
import { ViewState } from '../../../types';
import CoursePathView from './CoursePathView';

/** Claude Code course overview (/claude-code): the shared course page for content/courses/claude-code. */

interface ClaudeCodePathViewProps {
  onBack: () => void;
  onNavigate?: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage?: (lang: 'en' | 'jp') => void;
}

const BADGE = { en: 'AI agent', jp: 'AIエージェント' };

const ClaudeCodePathView: React.FC<ClaudeCodePathViewProps> = (props) => <CoursePathView courseSlug="claude-code" badge={BADGE} {...props} />;

export default ClaudeCodePathView;
