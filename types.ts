
export interface Course {
  id: string;
  title: string | LocalizedText;
  description: string | LocalizedText;
  category: string;
  categoryKey?: string;
  progress: number;
  totalLessons: number;
  completedLessons: number;
  thumbnail: string;
  color: string;
  level?: 'beginner' | 'intermediate' | 'advanced';
  durationMinutes?: number;
  formats?: string[];
  goals?: string[];
  tags?: string[];
  source?: 'curated' | 'generated';
}

export interface LearningPortal {
  id: string;
  title: LocalizedText;
  subtitle: LocalizedText;
  description: LocalizedText;
  view: string;
  icon: string;
  color: string;
  bg: string;
  borderColor: string;
  image: string;
  isActive: boolean;
  sortOrder: number;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface ActivityData {
  day: string;
  minutes: number;
}

// New Types for the Personalized Curriculum
export interface LessonTemplate {
  id: string;
  text: string;
  category: 'core' | 'softening' | 'bridging';
  example: string;
}

export interface LessonTask {
  type: 'fill' | 'rewrite_soften' | 'output_3sentences';
  prompt: string;
}

export interface LessonRubric {
  clarity: string;
  linking: string;
  tone: string;
}

export interface PersonalizedLesson {
  id: string;
  title: string;
  goal: string;
  tags: string[];
  templates: LessonTemplate[];
  tasks: LessonTask[];
  rubric: LessonRubric;
}

export interface AnalysisResult {
  clarityScore: number; // 0-100
  linkingScore: number;
  toneScore: number;
  feedback: string;
  refinedVersion: string;
}

// New Types for Daily Micro-Learning
export interface DailyVocabulary {
  word: string;
  partOfSpeech: string;
  definition: string;
  exampleSentence: string;
  pronunciation: string;
}

export interface GrammarQuiz {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number; // index
  explanation: string;
}

export enum ViewState {
  DASHBOARD = 'DASHBOARD',
  LEARNING_HUB = 'LEARNING_HUB', // New centralized hub
  COURSES = 'COURSES', // Renamed to "Path" in UI
  COURSE_DETAILS = 'COURSE_DETAILS', // New view for Course Path
  LIBRARY = 'LIBRARY',

  AI_DIAGNOSIS = 'AI_DIAGNOSIS', // New AI Diagnosis View
  LIFE_JOURNAL = 'LIFE_JOURNAL', // Phase 16: daily life + learning journal
  LIFE_JOURNAL_MONTHLY = 'LIFE_JOURNAL_MONTHLY', // Phase 16-3: monthly analytics
  LIFE_JOURNAL_INSIGHTS = 'LIFE_JOURNAL_INSIGHTS', // Phase 16-4: deterministic insights
  LIFE_JOURNAL_CHAT = 'LIFE_JOURNAL_CHAT', // Phase 16-6e: Hermes habit analyst chat
  AI_CHARACTERS = 'AI_CHARACTERS', // AI Character Introduction
  AI_CHARACTER_DETAIL = 'AI_CHARACTER_DETAIL', // Individual Character Profile
  PROFILE = 'PROFILE',
  PROFILE_DIAGNOSIS = 'PROFILE_DIAGNOSIS',
  PROFILE_HISTORY = 'PROFILE_HISTORY',
  PROFILE_BADGES = 'PROFILE_BADGES',
  PROFILE_GENERATED = 'PROFILE_GENERATED',
  PROFILE_MIRROR = 'PROFILE_MIRROR',
  LESSON = 'LESSON',
  BLENDER = 'BLENDER', // Overview
  BLENDER_PATH = 'BLENDER_PATH', // Detailed Project Path
  BLENDER_LESSON = 'BLENDER_LESSON', // Actual Video/Task Lesson
  TEACHER_BOT_LIVE = 'TEACHER_BOT_LIVE', // Blender sidecar live view
  // Programming Paths Deep Links
  PROGRAMMING_WEB = 'programming_web',
  PROGRAMMING_AI = 'programming_ai',
  PROGRAMMING_VIBE = 'programming_vibe',
  PROGRAMMING = 'PROGRAMMING', // Overview
  PROGRAMMING_PATH = 'PROGRAMMING_PATH', // Detailed Programming Course (Git Style)
  PYTHON_COURSE = 'PYTHON_COURSE', // Python Beginner Course (Notebook Style)
  HTML_CSS_PATH = 'HTML_CSS_PATH', // New: Learning Path Roadmap for HTML/CSS
  HTML_CSS_COURSE = 'HTML_CSS_COURSE', // Web Studio Part 1 (Flexbox)
  HTML_CSS_PART_TWO = 'HTML_CSS_PART_TWO', // Web Studio Part 2 (Grid)
  WEB_INSPECTOR = 'WEB_INSPECTOR', // New: Inspector Tool Simulation
  UNITY_AI_GAME_DEV = 'UNITY_AI_GAME_DEV', // New: Unity x AI Game Dev Course
  UNITY_CHAPTER_0 = 'UNITY_CHAPTER_0',
  UNITY_CHAPTER_1 = 'UNITY_CHAPTER_1',
  UNITY_CHAPTER_2 = 'UNITY_CHAPTER_2',
  UNITY_CHAPTER_3 = 'UNITY_CHAPTER_3',
  VIBE_PATH = 'VIBE_PATH', // New: The Hub for Vibe Coding
  VIBE_PROLOGUE = 'VIBE_PROLOGUE', // Prologue: Mindset
  VIBE_CHAPTER_0 = 'VIBE_CHAPTER_0', // Chapter 0: Premise
  VIBE_CHAPTER_1 = 'VIBE_CHAPTER_1', // Chapter 1: Prompt Engineering
  VIBE_CHAPTER_2 = 'VIBE_CHAPTER_2', // Chapter 2: The Cockpit
  VIBE_CHAPTER_3 = 'VIBE_CHAPTER_3', // Chapter 3: The Engine (Codex)
  VIBE_CHAPTER_4 = 'VIBE_CHAPTER_4', // Chapter 4: GitHub Workflow
  VIBE_CHAPTER_5 = 'VIBE_CHAPTER_5', // Chapter 5: Gemini CLI
  VIBE_CHAPTER_6 = 'VIBE_CHAPTER_6', // Chapter 6: Supabase
  VIBE_CHAPTER_7 = 'VIBE_CHAPTER_7', // Chapter 7: Deployment
  VIBE_CHAPTER_8 = 'VIBE_CHAPTER_8', // Chapter 8: Failure & Debugging
  VIBE_CHAPTER_9 = 'VIBE_CHAPTER_9', // Chapter 9: Game/Service Dev
  VIBE_CHAPTER_10 = 'VIBE_CHAPTER_10', // Chapter 10: Future Learning
  VIBE_CHAPTER_11 = 'VIBE_CHAPTER_11', // Chapter 11: Future Learning (Shifted)

  // Art Section
  ART_MUSEUM = 'ART_MUSEUM', // The Hub
  ART_HISTORY = 'ART_HISTORY', // Horizontal Timeline
  ART_CURRICULUM = 'ART_CURRICULUM', // New: Vertical Detailed Curriculum
  ART_INTRO = 'ART_INTRO', // New: Chapter 0 Introduction
  ART_PERIOD_DETAIL = 'ART_PERIOD_DETAIL', // Detailed learning page for a period
  ART_KINTSUGI = 'ART_KINTSUGI', // Specific Technique View (Interactive Kintsugi)
  ART_CRAFTS = 'ART_CRAFTS', // New: Hub for Japanese Crafts
  ART_CRAFT_DETAIL = 'ART_CRAFT_DETAIL', // New: Detail view for a specific craft
  ART_TRIBAL = 'ART_TRIBAL', // New: Hub for Tribal/Ethnic Art
  ART_TRIBAL_DETAIL = 'ART_TRIBAL_DETAIL', // New: Detail view for Tribal Art chapters

  // Sonic Lab Section
  SONIC_LAB = 'SONIC_LAB', // Hub
  SONIC_SYNTH = 'SONIC_SYNTH', // Synthesizer Lesson
  MY_CONTENT = 'MY_CONTENT', // User generated content
  GENERATED_COURSE_PATH = 'GENERATED_COURSE_PATH', // The roadmap for a generated course
  GENERATED_LESSON_VIEW = 'GENERATED_LESSON_VIEW', // The actual player for generated content
  BALANCE = 'BALANCE', // Wallet and Earnings
  COURSE_GENERATOR = 'COURSE_GENERATOR', // New: AI Course Generator Input View
  MULTI_FORMAT_DEMO = 'MULTI_FORMAT_DEMO', // Full demo
  DEMO_CONCEPT = 'DEMO_CONCEPT',
  DEMO_DIALOGUE = 'DEMO_DIALOGUE',
  DEMO_WORKSHOP = 'DEMO_WORKSHOP',
  DEMO_REFLECTION = 'DEMO_REFLECTION',
  DEMO_BLENDER = 'DEMO_BLENDER',
  DEMO_CHECKLIST = 'DEMO_CHECKLIST',
  DEMO_CHECKLIST_GENERATOR = 'DEMO_CHECKLIST_GENERATOR',
  P_SCHOOL = 'P_SCHOOL',
  PROFILE_EDIT = 'PROFILE_EDIT',
  NOTIFICATIONS = 'NOTIFICATIONS',
  SUBSCRIPTION = 'SUBSCRIPTION',
  SETTINGS = 'SETTINGS',
  SETTINGS_VOICE = 'SETTINGS_VOICE',
  SETTINGS_DIALOGUE_VOICE = 'SETTINGS_DIALOGUE_VOICE',
  SETTINGS_API_KEY = 'SETTINGS_API_KEY',
  SETTINGS_PRIVACY = 'SETTINGS_PRIVACY',
  SETTINGS_AI_MEMORY = 'SETTINGS_AI_MEMORY',
}

// Generated Content Types
export interface Big5Profile {
  openness: number;        // 0-100: Curiosity, Art, Emotion, Adventure, Unusual Ideas
  conscientiousness: number; // 0-100: Self-discipline, Dutifulness, Aim for achievement
  extraversion: number;    // 0-100: Energy, Positive emotions, Surgency, Assertiveness
  agreeableness: number;   // 0-100: Compassionate, Cooperative
  neuroticism: number;     // 0-100: Sensitive, Nervous (vs. Resilient, Confident)
}

export type PersonalityType = '冒険家' | '戦略家' | 'サポーター' | '思想家' | '職人' | 'バランサー' | 'character/openness';

export interface AIAdvice {
  strengths: { title: string; description: string }[];
  growthTips: { title: string; description: string }[];
  learningStrategy: {
    title: string;
    approach: string;
    steps: { label: string; action: string }[];
  };
  careerCompatibility: string;
  relationshipAnalysis: {
    style: string;
    idealPartner: string;
    advice: string;
  };
  businessPartnership: {
    role: string;
    bestSync: string;
    warning: string;
  };
  hiddenTalent: {
    title: string;
    description: string;
  };
}

export interface AssessmentProfile {
  scores: Big5Profile;
  personalityType: PersonalityType;
  learningStyle: string;
  motivation: string;
  completedAt: string;
  aiAdvice?: AIAdvice;
}

// Multi-Format Content Types
export type BlockType = 'concept' | 'dialogue' | 'workshop' | 'reflection';

export interface ChecklistBlock {
  id: string;
  type: 'checklist';
  title: string;
  tasks: {
    id: string;
    label: string;
    details: string;
    imageKeyword?: string;
    imageUrl?: string;
    imageCaption?: string;
    linkUrl?: string;
  }[];
}

export interface ConceptBlock {
  id: string;
  type: 'concept';
  title: string;
  content: string;
  analogy?: string;
}

export interface DialogueBlock {
  id: string;
  type: 'dialogue';
  lines: { speaker: 'AI' | 'User' | 'Rise Path' | 'Guest'; text: string; emotion?: string }[];
}

export interface WorkshopBlock {
  id: string;
  type: 'workshop';
  subType?: 'code' | 'design' | 'logic' | 'blender'; // Added blender
  goal: string;
  steps: string[];
}

export interface ReflectionBlock {
  id: string;
  type: 'reflection';
  question: string;
  options?: string[];
}

export type LearningBlock = ConceptBlock | DialogueBlock | WorkshopBlock | ReflectionBlock | ChecklistBlock;

export interface GeneratedChapter {
  id: string | number;
  title: string;
  duration: string;
  type: string;
  content: string; // Overview

  // Rich Content for Personalized Learning
  whyItMatters: string;
  keyConcepts: string[];
  actionStep: string;
  analogy: string;
  quizQuestion?: string;

  // Multi-Format Content (New Standard)
  blocks?: LearningBlock[];

  // Legacy Slide Format (Deprecated but kept for compatibility)
  slides?: {
    title: string;
    bullets: string[];
    timing?: string;
    visualStyle?: string;
    motionCue?: string;
    accentIcon?: string;
    layoutHint?: string;
    imagePrompt?: string;
    highlightBox?: string;
    speechScript?: string;
  }[];
}

export interface GeneratedCourse {
  id: string;
  title: string;
  description: string;
  duration: string;
  chapters: GeneratedChapter[];
  modules?: any[]; // Optional: new format modules for adapter
  createdAt: Date;
  modelUsed: 'standard' | 'pro' | 'flash' | 'gemini-2.5-flash' | 'gemini-2.5-pro';
  targetProfile?: Big5Profile; // The profile this was generated for
  teacherPersona?: { name: string; role: string; tone: string; greeting: string; };
  personalizationReasoning?: string;
  preferredTemplate?: CourseTemplate;
  ui_template_id?: string;
}

export type CourseTemplate = 'focus_slide' | 'workshop_split' | 'dialogue_chat' | 'explore_map' | 'doc_chapter';

// --- Vibe Coding Document Types ---

export type LocalizedText = string | {
  en: string;
  jp: string;
  fr?: string;
};

export type LocalizedDocBlock =
  | { type: 'text'; text: LocalizedText; style?: 'normal' | 'lead' | 'quote' }
  | { type: 'image'; src?: string; fallbackSrc?: string; prompt?: string; alt: string; caption?: LocalizedText; layout?: 'full' | 'float-right' }
  | { type: 'code'; code: string; language: string; filename?: string; highlightLines?: number[] }
  | { type: 'list'; items: LocalizedText[]; style?: 'bullet' | 'number' | 'check' | 'key' }
  | { type: 'callout'; title?: LocalizedText; text: LocalizedText; variant: 'info' | 'warning' | 'tip' | 'success' }
  | { type: 'mermaid'; chart: string; caption?: LocalizedText }
  | { type: 'table'; headers: LocalizedText[]; rows: LocalizedText[][] }
  | {
    type: 'mindmap';
    root: {
      text: LocalizedText;
      children: {
        text: LocalizedText;
        details: LocalizedText;
        children?: { text: LocalizedText; details: LocalizedText }[];
      }[];
    }
  };

export interface DocSection {
  id: string;
  title: LocalizedText;
  content: LocalizedDocBlock[];
}

export interface DocChapter {
  id: string;
  title: LocalizedText;
  subtitle: LocalizedText;
  readingTime: LocalizedText; // e.g. "10 min read"
  sections: DocSection[];
}

// --- Quiz Types ---

export interface QuizOption {
  id: string;
  text: LocalizedText;
}

export interface QuizQuestion {
  id: string;
  text: LocalizedText;
  options: QuizOption[];
  correctAnswer: string; // id of the correct option
  explanation: LocalizedText;
}

export interface QuizData {
  id: string;
  title: LocalizedText;
  questions: QuizQuestion[];
}
