import { GeneratedChapter, GeneratedCourse } from '../types';

type LocalizedText = { jp?: string; en?: string } | string;

type VibeDocBlock =
  | { type: 'text'; content: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'code'; content: string; language: string };

type VibeExercise = { prompt: string; expected: string };
type VibeQuiz = { q: string; choices: string[]; answer: number };
type VibeResource = { title: string; url: string };

type VibeLesson = {
  lesson_id: string;
  summary?: string;
  estimated_min?: number;
  unlock_rule?: string;
  retry_policy?: string;
  doc_blocks?: VibeDocBlock[];
  exercises?: VibeExercise[];
  quiz?: VibeQuiz[];
  resources?: VibeResource[];
  ui_hints?: {
    card_title?: string;
    card_text?: string;
    cta?: string;
    difficulty?: string;
    time?: string;
    tags?: string[];
  };
};

type VibeModule = {
  module_id: string;
  title: string;
  objective?: string;
  prereq_modules?: string[];
  estimated_hours?: number;
  deliverable?: string;
  assessment?: string;
  module_ui_hints?: {
    card_title?: string;
    card_text?: string;
    tags?: string[];
    difficulty?: string;
  };
  lessons?: VibeLesson[];
};

export type VibeCodingCurriculum = {
  curriculum_id?: string;
  version?: number;
  ui_template_id: 'vibe_coding';
  title?: LocalizedText;
  description?: LocalizedText;
  modules: VibeModule[];
};

type Slide = NonNullable<GeneratedChapter['slides']>[number];

const resolveLocalizedText = (
  value: LocalizedText | undefined,
  fallback: string,
  preferred: 'jp' | 'en' = 'jp'
): string => {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (preferred === 'en') return value.en || value.jp || fallback;
  return value.jp || value.en || fallback;
};

const toDurationLabel = (hours?: number): string => {
  if (!hours || !Number.isFinite(hours)) return 'Flexible';
  if (hours < 1) return `${Math.max(hours * 60, 1).toFixed(0)}m`;
  return `${hours.toFixed(1).replace(/\.0$/, '')}h`;
};

const buildSlide = (title: string, bullets: string[], extras?: Partial<Slide>): Slide | null => {
  const cleaned = bullets.filter((item) => typeof item === 'string' && item.trim().length > 0);
  if (!cleaned.length) return null;
  return {
    title: title || 'Overview',
    bullets: cleaned,
    ...extras,
  };
};

const buildLessonSlides = (lesson: VibeLesson): Slide[] => {
  const slides: Slide[] = [];
  const introTitle = lesson.ui_hints?.card_title || lesson.summary || 'Lesson';
  const introBullet = lesson.ui_hints?.card_text || lesson.summary || '';
  const introSlide = buildSlide(introTitle, introBullet ? [introBullet] : [], {
    speechScript: lesson.summary || undefined,
  });
  if (introSlide) slides.push(introSlide);

  for (const block of lesson.doc_blocks || []) {
    if (block.type === 'text') {
      const slide = buildSlide(introTitle, [block.content], {
        speechScript: block.content,
      });
      if (slide) slides.push(slide);
    }
    if (block.type === 'bullets') {
      const slide = buildSlide(introTitle, block.items);
      if (slide) slides.push(slide);
    }
    if (block.type === 'code') {
      const slide = buildSlide(`Code: ${block.language || 'snippet'}`, ['Code sample'], {
        highlightBox: block.content,
        speechScript: block.content,
      });
      if (slide) slides.push(slide);
    }
  }

  if (lesson.exercises?.length) {
    const bullets = lesson.exercises.flatMap((exercise) => [
      `Prompt: ${exercise.prompt}`,
      `Expected: ${exercise.expected}`,
    ]);
    const slide = buildSlide('Workshop', bullets);
    if (slide) slides.push(slide);
  }

  if (lesson.quiz?.length) {
    const bullets = lesson.quiz.flatMap((item) => [
      item.q,
      ...item.choices.map((choice, idx) => `${idx + 1}. ${choice}`),
    ]);
    const slide = buildSlide('Quiz', bullets);
    if (slide) slides.push(slide);
  }

  if (lesson.resources?.length) {
    const bullets = lesson.resources.map((resource) => `${resource.title} - ${resource.url}`);
    const slide = buildSlide('Resources', bullets);
    if (slide) slides.push(slide);
  }

  return slides;
};

const ensureChapterSlides = (slides: Slide[], fallbackTitle: string, fallbackText: string): Slide[] => {
  if (slides.length) return slides;
  const fallbackSlide = buildSlide(fallbackTitle, [fallbackText || 'Overview']);
  return fallbackSlide ? [fallbackSlide] : [];
};

export const isVibeCodingCurriculum = (payload: unknown): payload is VibeCodingCurriculum => {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  return record.ui_template_id === 'vibe_coding' && Array.isArray(record.modules);
};

export const mapVibeCodingToGeneratedCourse = (
  vibe: VibeCodingCurriculum,
  options?: { language?: 'jp' | 'en' }
): GeneratedCourse => {
  const language = options?.language === 'en' ? 'en' : 'jp';
  const title = resolveLocalizedText(vibe.title, 'Generated Curriculum', language);
  const description = resolveLocalizedText(vibe.description, '', language);

  const chapters: GeneratedChapter[] = (vibe.modules || []).map((module, idx) => {
    const lessonSlides = (module.lessons || []).flatMap(buildLessonSlides);
    const slides = ensureChapterSlides(
      lessonSlides,
      module.title || `Module ${idx + 1}`,
      module.objective || module.module_ui_hints?.card_text || ''
    );

    return {
      id: module.module_id || `${idx + 1}`,
      title: module.title || `Module ${idx + 1}`,
      duration: toDurationLabel(module.estimated_hours),
      type: module.assessment || 'lesson',
      content: module.objective || '',
      whyItMatters: module.module_ui_hints?.card_text || module.objective || '',
      keyConcepts: module.module_ui_hints?.tags || [],
      actionStep: module.deliverable || '',
      analogy: '',
      slides,
    };
  });

  const totalHours = vibe.modules?.reduce((sum, module) => sum + (module.estimated_hours || 0), 0) || 0;

  return {
    id: vibe.curriculum_id || crypto.randomUUID(),
    title,
    description,
    duration: toDurationLabel(totalHours),
    chapters,
    createdAt: new Date(),
    modelUsed: 'standard',
  };
};
